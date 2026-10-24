import asyncio
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from octo_runtime import KernelError
from octo_runtime.transport import Channel, BEHAVIOR


def windows_transport(win32file, pywintypes, win32event=None):
    modules = {
        "win32file": win32file,
        "pywintypes": pywintypes,
        "win32event": win32event or types.ModuleType("win32event"),
        "win32con": types.SimpleNamespace(WAIT_TIMEOUT=258),
    }
    path = Path(__file__).parents[1] / "src/octo_runtime/transport.py"
    # 加载同一 SDK 模块的 Windows 分支，不需要 Windows 专属脚本或发行包。
    with patch.dict(sys.modules, modules), patch.object(sys, "platform", "win32"):
        spec = importlib.util.spec_from_file_location(
            "octo_runtime._test_windows_transport", path
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


class Stream:
    def __init__(self, data, chunk=4096):
        self.data, self.offset, self.chunk = data, 0, chunk

    async def read(self, n):
        end = min(self.offset + min(n, self.chunk), len(self.data))
        data = self.data[self.offset : end]
        self.offset = end
        return data


class MeasuredBuffer(bytearray):
    scanned = 0

    def find(self, sub, start=0):
        self.scanned += len(self) - start
        return super().find(sub, start)


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_fragmented_large_line_scanning_is_linear(self):
        payload = "界".encode() * 1_000_000
        channel = Channel(Stream(payload + b"\nnext\r\n"), None)
        measured = MeasuredBuffer()
        channel.buffer = measured
        self.assertEqual(await channel.line(), payload)
        self.assertEqual(await channel.line(), b"next\r")
        self.assertLessEqual(measured.scanned, len(payload) + 32)
        with self.assertRaises(KernelError):
            await channel.line()

    async def test_exact_limit_and_missing_newline(self):
        with patch.dict(BEHAVIOR["limits"], lineBytes=4):
            self.assertEqual(await Channel(Stream(b"1234\n", 2), None).line(), b"1234")
            for data in [b"12345\n", b"12345"]:
                with self.assertRaisesRegex(KernelError, "HOST_FRAME_TOO_LARGE"):
                    await Channel(Stream(data, 2), None).line()

    async def test_windows_close_survives_repeated_cancellation(self):
        # 在非 Windows 主机只验证关闭任务控制流，不能替代真实 named-pipe 测试。
        calls = []
        win32file = types.ModuleType("win32file")
        win32file.CancelIoEx = lambda *args: None
        win32file.CloseHandle = lambda handle: calls.append(handle)
        pywintypes = types.ModuleType("pywintypes")
        pywintypes.error = OSError
        module = windows_transport(win32file, pywintypes)
        pipe = module._WindowsPipe("handle")
        pipe.pending.add("overlapped")
        closing = asyncio.create_task(pipe.close())
        await asyncio.sleep(0)
        closing.cancel()
        await asyncio.sleep(0.005)
        closing.cancel()
        await asyncio.sleep(0.005)
        self.assertEqual(calls, [])  # completion 前不能释放底层 handle。
        self.assertFalse(closing.done())
        pipe.pending.clear()
        with self.assertRaises(asyncio.CancelledError):
            await closing
        await pipe.close()
        await pipe.close()
        self.assertEqual(calls, ["handle"])

    async def test_windows_cancel_error_waits_for_io_completion(self):
        for data in (None, b"write"):
            with self.subTest(operation="read" if data is None else "write"):
                calls = []
                started, cancelled = asyncio.Event(), asyncio.Event()
                completed = False

                class Overlapped:
                    pass

                class WinError(OSError):
                    winerror = 5

                def cancel_io(*args):
                    cancelled.set()
                    raise WinError("cancel failed")

                def begin_io(*args):
                    started.set()
                    return 997, b"read"

                win32file = types.SimpleNamespace(
                    CancelIoEx=cancel_io,
                    CloseHandle=calls.append,
                    ReadFile=begin_io,
                    WriteFile=begin_io,
                    GetOverlappedResult=lambda *args: 4,
                )
                module = windows_transport(
                    win32file,
                    types.SimpleNamespace(error=WinError, OVERLAPPED=Overlapped),
                    types.SimpleNamespace(
                        CreateEvent=lambda *args: "event",
                        WaitForSingleObject=lambda *args: 0 if completed else 258,
                    ),
                )
                pipe = module._WindowsPipe("handle")
                operation = asyncio.create_task(pipe.operation(data=data))
                await started.wait()
                operation.cancel()
                await cancelled.wait()
                operation.cancel()
                closing = asyncio.create_task(pipe.close())
                await asyncio.sleep(0.01)
                self.assertFalse(operation.done())
                self.assertFalse(closing.done())
                self.assertEqual(len(pipe.pending), 1)
                self.assertEqual(calls, [])
                completed = True
                with self.assertRaisesRegex(OSError, "pipe IO failed"):
                    await operation
                with self.assertRaises(WinError):
                    await closing
                self.assertEqual(pipe.pending, set())
                self.assertEqual(calls, ["event", "handle"])
                self.assertTrue(pipe._closing.done())
                self.assertFalse(
                    any(
                        "operation.<locals>.completion" in task.get_coro().__qualname__
                        for task in asyncio.all_tasks()
                    )
                )

    async def test_platform_selection_uses_one_transport(self):
        from octo_runtime.transport import Transport

        reader = types.SimpleNamespace(read=None)
        writer = types.SimpleNamespace(close=lambda: None)

        async def wait_closed():
            pass

        writer.wait_closed = wait_closed
        transport = Transport("kernel.sock")
        with patch(
            "asyncio.open_unix_connection", return_value=(reader, writer)
        ) as opened:
            with patch.object(sys, "platform", "linux"):
                channel = await transport.open()
            opened.assert_awaited_once()
            self.assertIs(channel.stream.reader, reader)
            await transport.close()
        self.assertEqual(transport.channels, set())

        module = windows_transport(
            types.SimpleNamespace(), types.SimpleNamespace(error=OSError)
        )
        stream = types.SimpleNamespace(close=wait_closed)
        with patch.object(module, "_open_windows_pipe", return_value=stream) as opened:
            with patch.object(sys, "platform", "win32"):
                transport = module.Transport("kernel-pipe")
                channel = await transport.open()
            opened.assert_awaited_once_with("kernel-pipe")
            self.assertIs(channel.stream, stream)
            await transport.close()
        self.assertEqual(transport.channels, set())


if __name__ == "__main__":
    unittest.main()
