# Windows 进程归属

这是 Runtime 内部的 Win32 Job broker，不是业务 IPC client。仅支持 Windows amd64/arm64，源码不依赖第三方 Go 模块。

Node launcher 保留真实 ChildProcess/broker PID。broker 从 libuv 的 CRT reserved2 接收原始 fd0..3，fd4 使用独立 overlapped 双向控制 Pipe；目标仅继承 fd0..3 的句柄白名单。控制、owner 和 Job 句柄不继承，避免隐藏 EOF 或延长 Job 生存期。

broker 打开 owner 进程句柄并完成随机 challenge，随后挂起创建目标、关联 KILL_ON_JOB_CLOSE Job、读取 PID/创建时间，收到 resume 后才运行用户入口。leader 退出、显式 stop、owner 退出或控制 EOF 都回收原 Job；只有 active count=0 才发送 cleared。broker 被强杀时最后一个 Job 句柄关闭触发 OS 回收，不伪造成功确认。组件 owner 退出保留最多 4500 ms 的 drain 宽限，普通 Provider 为 0。

Job 关联或查询失败直接失败；不使用 taskkill、WMI 或普通 spawn 成功回退。独立系统服务等脱离 Job 的外部工作不属于受管集合。Node 数据通道不经过 JSON 包装，不把 Go 控制帧写入目标 stdout。目标 argv 使用 Win32 的参数编码，不新增 shell 拼接。

`node scripts/build-windows-process-owner.mjs` 使用固定 Go 1.25.14、CGO_ENABLED=0、trimpath、空 build ID 生成两个架构资源、SHA-256 manifest 和 Go 许可。开发构建需要 Go；最终 npm 包直接携带二进制。打包及包外验证检查摘要、PE 架构与许可，Windows 包外检查还实际运行目标并回收。

原生回归入口为 `test/windows-process-owner.test.js`，受影响 launcher 另由进程组、Codex、Host/Kernel 与原生组件测试覆盖。跨平台编译/PE 检查不等于 Windows 执行；Server、桌面和 arm64 证据分别见 `.octospec/tasks/gateway-drain-windows-cleanup/implementation.md`。
