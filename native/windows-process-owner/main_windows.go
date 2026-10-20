//go:build windows

package main

import (
	"bufio"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	createJob        = kernel32.NewProc("CreateJobObjectW")
	setJob           = kernel32.NewProc("SetInformationJobObject")
	assignJob        = kernel32.NewProc("AssignProcessToJobObject")
	terminateJob     = kernel32.NewProc("TerminateJobObject")
	queryJob         = kernel32.NewProc("QueryInformationJobObject")
	resumeThread     = kernel32.NewProc("ResumeThread")
	getStartupInfo   = kernel32.NewProc("GetStartupInfoW")
	initAttributes   = kernel32.NewProc("InitializeProcThreadAttributeList")
	updateAttribute  = kernel32.NewProc("UpdateProcThreadAttribute")
	deleteAttributes = kernel32.NewProc("DeleteProcThreadAttributeList")
)

type basicLimits struct {
	ProcessTime, JobTime int64
	Flags                uint32
	Minimum, Maximum     uintptr
	Active               uint32
	Affinity             uintptr
	Priority, Schedule   uint32
}

type extendedLimits struct {
	Basic                      basicLimits
	IO                         [6]uint64
	ProcessMemory, JobMemory   uintptr
	PeakProcess, PeakJobMemory uintptr
}

type accounting struct {
	Times                             [4]int64
	Faults, Total, Active, Terminated uint32
}

type command struct {
	Type    string   `json:"type"`
	Command string   `json:"command"`
	Args    []string `json:"args"`
	Argv0   string   `json:"argv0"`
	Owner   uint32   `json:"owner"`
	GraceMs int      `json:"grace_ms"`
	Nonce   string   `json:"nonce"`
}

// syscall.StartupInfo 将 CRT reserved2 字段隐藏为 padding；保持同一 Win32 ABI。
type startupInfo struct {
	Cb                          uint32
	Reserved, Desktop, Title    *uint16
	Geometry                    [7]uint32
	Flags                       uint32
	ShowWindow, CbReserved2     uint16
	Reserved2                   *byte
	StdInput, StdOutput, StdErr syscall.Handle
}

type startupInfoEx struct {
	Startup    startupInfo
	Attributes *byte
}

func checked(proc *syscall.LazyProc, args ...uintptr) error {
	result, _, err := proc.Call(args...)
	if result == 0 {
		return fmt.Errorf("%s: %w", proc.Name, err)
	}
	return nil
}

// libuv 使用 CRT reserved2 传递 fd，而 Go 的 os.NewFile 接收 Win32 HANDLE。
func inheritedFiles() (*startupInfo, []syscall.Handle, []byte, error) {
	startup := &startupInfo{}
	getStartupInfo.Call(uintptr(unsafe.Pointer(startup)))
	if startup.CbReserved2 < 4 || startup.Reserved2 == nil {
		return nil, nil, nil, errors.New("missing inherited descriptors")
	}
	data := unsafe.Slice(startup.Reserved2, int(startup.CbReserved2))
	count := int(binary.LittleEndian.Uint32(data))
	if count < 5 || count > 64 || len(data) < 4+count*9 {
		return nil, nil, nil, errors.New("invalid inherited descriptors")
	}
	handles := make([]syscall.Handle, count)
	for i := range handles {
		handles[i] = syscall.Handle(binary.LittleEndian.Uint64(data[4+count+i*8:]))
	}
	return startup, handles, data[4 : 4+count], nil
}

func active(job syscall.Handle) (uint32, error) {
	var info accounting
	if err := checked(queryJob, uintptr(job), 1, uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info), 0); err != nil {
		return 0, err
	}
	return info.Active, nil
}

func clear(job syscall.Handle) error {
	if err := checked(terminateJob, uintptr(job), 1); err != nil {
		return err
	}
	until := time.Now().Add(5 * time.Second)
	for {
		count, err := active(job)
		if err != nil {
			return err
		}
		if count == 0 {
			return nil
		}
		if time.Now().After(until) {
			return errors.New("job cleanup timed out")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func run() int {
	_, handles, flags, err := inheritedFiles()
	if err != nil {
		return 125
	}
	control := os.NewFile(uintptr(handles[4]), "owner-control")
	if control == nil {
		return 125
	}
	defer control.Close()
	encoder := json.NewEncoder(control)
	failed := func() int {
		_ = encoder.Encode(map[string]any{"type": "failed", "code": "WINDOWS_PROCESS_START_FAILED"})
		return 125
	}
	// control/owner/Job 句柄不得被目标继承，否则 owner 死亡不能触发 EOF 或最终回收。
	if syscall.SetHandleInformation(handles[4], syscall.HANDLE_FLAG_INHERIT, 0) != nil {
		return failed()
	}
	messages := make(chan command)
	go func() {
		defer close(messages)
		scanner := bufio.NewScanner(control)
		scanner.Buffer(make([]byte, 4096), 128*1024)
		for scanner.Scan() {
			var message command
			if json.Unmarshal(scanner.Bytes(), &message) != nil {
				return
			}
			messages <- message
		}
	}()
	read := func() (command, bool) {
		select {
		case message, ok := <-messages:
			return message, ok
		case <-time.After(5 * time.Second):
			return command{}, false
		}
	}
	config, ok := read()
	if !ok || config.Type != "launch" || config.Owner == 0 || config.GraceMs < 0 || config.GraceMs > 4500 {
		return failed()
	}
	owner, err := syscall.OpenProcess(syscall.SYNCHRONIZE|0x1000, false, config.Owner)
	if err != nil {
		return failed()
	}
	defer syscall.CloseHandle(owner)
	challenge := make([]byte, 32)
	if _, err := rand.Read(challenge); err != nil {
		return failed()
	}
	nonce := hex.EncodeToString(challenge)
	if encoder.Encode(map[string]any{"type": "challenge", "nonce": nonce}) != nil {
		return failed()
	}
	response, ok := read()
	ownerState, err := syscall.WaitForSingleObject(owner, 0)
	if !ok || response.Type != "owner" || response.Nonce != nonce || err != nil || ownerState != syscall.WAIT_TIMEOUT {
		return failed()
	}
	jobValue, _, _ := createJob.Call(0, 0)
	if jobValue == 0 {
		return failed()
	}
	job := syscall.Handle(jobValue)
	defer syscall.CloseHandle(job)
	limits := extendedLimits{}
	limits.Basic.Flags = 0x2000 // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE，禁止 breakaway。
	if checked(setJob, uintptr(job), 9, uintptr(unsafe.Pointer(&limits)), unsafe.Sizeof(limits)) != nil {
		return failed()
	}
	executable, err := exec.LookPath(config.Command)
	if err != nil {
		return failed()
	}
	if config.Argv0 == "" {
		config.Argv0 = config.Command
	}
	arguments := append([]string{config.Argv0}, config.Args...)
	for i := range arguments {
		arguments[i] = syscall.EscapeArg(arguments[i])
	}
	application, err := syscall.UTF16PtrFromString(executable)
	if err != nil {
		return failed()
	}
	line, err := syscall.UTF16PtrFromString(strings.Join(arguments, " "))
	if err != nil {
		return failed()
	}
	// 只继承原始数据通道 0..3；control fd4 永不出现在目标 CRT 表中。
	const count = 4
	descriptors := make([]byte, 4+count*9)
	binary.LittleEndian.PutUint32(descriptors, count)
	copy(descriptors[4:], flags[:count])
	for i, handle := range handles[:count] {
		binary.LittleEndian.PutUint64(descriptors[4+count+i*8:], uint64(handle))
	}
	targetStartup := startupInfoEx{Startup: startupInfo{
		Cb: uint32(unsafe.Sizeof(startupInfoEx{})), Flags: syscall.STARTF_USESTDHANDLES | syscall.STARTF_USESHOWWINDOW,
		StdInput: handles[0], StdOutput: handles[1], StdErr: handles[2],
		CbReserved2: uint16(len(descriptors)), Reserved2: &descriptors[0],
	}}
	allowed := make([]syscall.Handle, 0, count)
	for _, handle := range handles[:count] {
		if handle != 0 && handle != syscall.InvalidHandle {
			allowed = append(allowed, handle)
		}
	}
	var attributeSize uintptr
	initAttributes.Call(0, 1, 0, uintptr(unsafe.Pointer(&attributeSize)))
	if attributeSize == 0 || len(allowed) == 0 {
		return failed()
	}
	attributes := make([]byte, attributeSize)
	targetStartup.Attributes = &attributes[0]
	if checked(initAttributes, uintptr(unsafe.Pointer(targetStartup.Attributes)), 1, 0, uintptr(unsafe.Pointer(&attributeSize))) != nil {
		return failed()
	}
	defer deleteAttributes.Call(uintptr(unsafe.Pointer(targetStartup.Attributes)))
	if checked(updateAttribute, uintptr(unsafe.Pointer(targetStartup.Attributes)), 0, 0x20002, uintptr(unsafe.Pointer(&allowed[0])), uintptr(len(allowed))*unsafe.Sizeof(allowed[0]), 0, 0) != nil {
		return failed()
	}
	var target syscall.ProcessInformation
	if syscall.CreateProcess(application, line, nil, nil, true, 4|0x80000|syscall.CREATE_UNICODE_ENVIRONMENT, nil, nil, (*syscall.StartupInfo)(unsafe.Pointer(&targetStartup)), &target) != nil {
		return failed()
	}
	defer syscall.CloseHandle(target.Process)
	defer syscall.CloseHandle(target.Thread)
	assigned := false
	defer func() {
		if !assigned {
			_ = syscall.TerminateProcess(target.Process, 125)
			_, _ = syscall.WaitForSingleObject(target.Process, 5000)
		}
	}()
	if checked(assignJob, uintptr(job), uintptr(target.Process)) != nil {
		return failed()
	}
	assigned = true
	var created, exited, kernel, user syscall.Filetime
	if syscall.GetProcessTimes(target.Process, &created, &exited, &kernel, &user) != nil {
		return failed()
	}
	// Windows manifest 与原 PowerShell UTC ticks 使用相同单位和纪元。
	ticks := (uint64(created.HighDateTime)<<32 | uint64(created.LowDateTime)) + 504911232000000000
	if encoder.Encode(map[string]any{"type": "started", "pid": target.ProcessId, "started": fmt.Sprintf("windows:%d", ticks)}) != nil {
		return failed()
	}
	response, ok = read()
	if !ok || response.Type != "resume" {
		return failed()
	}
	// broker 不保留任何数据句柄副本，否则目标/owner 退出后 EOF 与 IPC disconnect 会被隐藏。
	for _, handle := range handles[:count] {
		if handle != 0 && handle != syscall.InvalidHandle {
			_ = syscall.CloseHandle(handle)
		}
	}
	if value, _, _ := resumeThread.Call(uintptr(target.Thread)); value == 0xffffffff {
		return failed()
	}
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	var ownerGone time.Time
	for {
		select {
		case message, connected := <-messages:
			if !connected {
				messages = nil
				ownerGone = time.Now()
				continue
			}
			if message.Type == "stop" {
				if err := clear(job); err != nil {
					return 125
				}
				_ = encoder.Encode(map[string]any{"type": "cleared"})
				return 0
			}
		case <-ticker.C:
			state, err := syscall.WaitForSingleObject(target.Process, 0)
			if err != nil {
				return 125
			}
			if state == syscall.WAIT_OBJECT_0 {
				var code uint32
				if syscall.GetExitCodeProcess(target.Process, &code) != nil || clear(job) != nil {
					return 125
				}
				_ = encoder.Encode(map[string]any{"type": "cleared", "exit_code": code})
				return int(code)
			}
			state, err = syscall.WaitForSingleObject(owner, 0)
			if err != nil {
				return 125
			}
			if state == syscall.WAIT_OBJECT_0 {
				if ownerGone.IsZero() {
					ownerGone = time.Now()
				}
			}
			if !ownerGone.IsZero() && time.Since(ownerGone) >= time.Duration(config.GraceMs)*time.Millisecond {
				if clear(job) != nil {
					return 125
				}
				return 0
			}
		}
	}
}

func main() { os.Exit(run()) }
