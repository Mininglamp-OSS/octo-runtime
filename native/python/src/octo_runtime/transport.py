"""有界平台字节 IO；关闭连接不发送业务取消。"""

from __future__ import annotations
import asyncio
import sys
from .codec import KernelError
from .generated_rules import BEHAVIOR

if sys.platform == "win32":
    import win32file
    import win32event
    import win32con
    import pywintypes


class _WindowsPipe:
    """SDK 内部的异步 named-pipe 分支，持有资源直到 OVERLAPPED completion。"""

    def __init__(self, handle):
        self.handle, self.pending, self.closed = handle, set(), False
        self._closing = None

    async def operation(self, data=None, n=65536):
        if self.closed:
            raise OSError("closed")
        ov = pywintypes.OVERLAPPED()
        ov.hEvent = win32event.CreateEvent(None, True, False, None)
        # 每条连接仅拉取一次 read 或一次 write，客户端最多 32 连接。
        self.pending.add(ov)
        buffer = None
        try:
            if data is None:
                _, buffer = win32file.ReadFile(self.handle, n, ov)
            else:
                buffer = data
                win32file.WriteFile(self.handle, buffer, ov)

            async def completion():
                while (
                    win32event.WaitForSingleObject(ov.hEvent, 0)
                    == win32con.WAIT_TIMEOUT
                ):
                    await asyncio.sleep(0.002)
                return win32file.GetOverlappedResult(self.handle, ov, False)

            task = asyncio.create_task(completion())
            try:
                count = await asyncio.shield(task)
            except asyncio.CancelledError:
                cancellation_error = None
                try:
                    win32file.CancelIoEx(self.handle, ov)
                except pywintypes.error as e:
                    if e.winerror != 1168:
                        cancellation_error = e
                # CancelIoEx 失败也不证明 IO 已结束，不能提前释放 buffer/event。
                while not task.done():
                    try:
                        await asyncio.shield(task)
                    except asyncio.CancelledError:
                        continue
                    except pywintypes.error:
                        break
                if task.done() and not task.cancelled():
                    try:
                        task.result()
                    except pywintypes.error:
                        pass
                if cancellation_error is not None:
                    raise cancellation_error
                raise
            return bytes(buffer[:count]) if data is None else count
        except pywintypes.error as e:
            raise OSError(e.winerror, "pipe IO failed") from e
        finally:
            self.pending.discard(ov)
            win32file.CloseHandle(ov.hEvent)

    async def read(self, n):
        return await self.operation(n=n)

    async def write(self, data):
        while data:
            count = await self.operation(data=data)
            if count <= 0:
                raise OSError("partial write")
            data = data[count:]

    async def close(self):
        # 关闭共享回收任务；调用方取消后仍须等 completion 才释放 handle。
        if self._closing is None:
            self.closed = True
            self._closing = asyncio.create_task(self._finish_close())
        interrupted = False
        while not self._closing.done():
            try:
                await asyncio.shield(self._closing)
            except asyncio.CancelledError:
                interrupted = True
        self._closing.result()
        if interrupted:
            raise asyncio.CancelledError

    async def _finish_close(self):
        cancellation_error = None
        for ov in list(self.pending):
            try:
                win32file.CancelIoEx(self.handle, ov)
            except pywintypes.error as e:
                if e.winerror != 1168:
                    cancellation_error = e
        while self.pending:
            await asyncio.sleep(0.002)
        win32file.CloseHandle(self.handle)
        if cancellation_error is not None:
            raise cancellation_error


async def _open_windows_pipe(endpoint):
    while True:
        try:
            handle = win32file.CreateFile(
                endpoint,
                win32con.GENERIC_READ | win32con.GENERIC_WRITE,
                0,
                None,
                win32con.OPEN_EXISTING,
                win32con.FILE_FLAG_OVERLAPPED,
                None,
            )
            return _WindowsPipe(handle)
        except pywintypes.error as e:
            if e.winerror != 231:
                raise OSError(e.winerror, "pipe connect failed") from e
            await asyncio.sleep(0.01)


class UnixChannel:
    def __init__(self, reader, writer):
        self.reader, self.writer = reader, writer

    async def read(self, n):
        return await self.reader.read(n)

    async def write(self, data):
        self.writer.write(data)
        await self.writer.drain()

    async def close(self):
        self.writer.close()
        try:
            await self.writer.wait_closed()
        except (OSError, ConnectionError):
            pass


class Channel:
    def __init__(self, stream, owner):
        self.stream, self.owner, self.buffer, self.closed = (
            stream,
            owner,
            bytearray(),
            False,
        )

    async def line(self):
        maximum = BEHAVIOR["limits"]["lineBytes"]
        scanned = 0
        while True:
            # 已确认没有换行的前缀不再扫描；残留的下一行从零开始。
            offset = self.buffer.find(b"\n", scanned)
            if offset >= 0:
                if offset > maximum:
                    raise KernelError("HOST_FRAME_TOO_LARGE")
                line = bytes(self.buffer[:offset])
                del self.buffer[: offset + 1]
                return line
            if len(self.buffer) > maximum:
                raise KernelError("HOST_FRAME_TOO_LARGE")
            scanned = len(self.buffer)
            try:
                chunk = await self.stream.read(BEHAVIOR["limits"]["readChunkBytes"])
            except OSError as e:
                raise KernelError("CONNECTION_CLOSED") from e
            if not chunk:
                raise KernelError("CONNECTION_CLOSED")
            self.buffer.extend(chunk)

    async def write(self, data):
        try:
            await self.stream.write(data)
        except OSError as e:
            raise KernelError("CONNECTION_CLOSED") from e

    async def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            await self.stream.close()
        finally:
            self.owner.channels.discard(self)


class Transport:
    def __init__(self, endpoint):
        self.endpoint, self.channels, self.opening, self.closed = (
            endpoint,
            set(),
            0,
            False,
        )

    async def open(self):
        if self.closed:
            raise KernelError("CLIENT_CLOSED")
        if len(self.channels) + self.opening >= BEHAVIOR["limits"]["connections"]:
            raise KernelError("CLIENT_CAPACITY_EXHAUSTED")
        self.opening += 1
        try:
            async with asyncio.timeout(BEHAVIOR["timeoutsMs"]["connect"] / 1000):
                if sys.platform == "win32":
                    stream = await _open_windows_pipe(self.endpoint)
                else:
                    r, w = await asyncio.open_unix_connection(
                        self.endpoint, limit=BEHAVIOR["limits"]["readChunkBytes"]
                    )
                    stream = UnixChannel(r, w)
            if self.closed:
                await stream.close()
                raise KernelError("CLIENT_CLOSED")
            c = Channel(stream, self)
            self.channels.add(c)
            return c
        except (OSError, TimeoutError) as e:
            raise KernelError("KERNEL_UNAVAILABLE") from e
        finally:
            self.opening -= 1

    async def close(self):
        self.closed = True
        await asyncio.gather(*(c.close() for c in list(self.channels)))
