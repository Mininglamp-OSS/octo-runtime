use crate::{generated::rules::*, Error};
use std::sync::{Arc, Mutex, Weak};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    sync::{Mutex as AsyncMutex, OwnedSemaphorePermit, Semaphore},
};
use tokio_util::sync::CancellationToken;
trait IO: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> IO for T {}
type SocketSlot = AsyncMutex<Option<Box<dyn IO>>>;
type Socket = Arc<SocketSlot>;
/// 平台传输只拉取字节；不预读帧，不包含业务重试和取消。
pub struct Transport {
    endpoint: String,
    pub closed: CancellationToken,
    slots: Arc<Semaphore>,
    sockets: Mutex<Vec<Weak<SocketSlot>>>,
}
pub struct Channel {
    socket: Socket,
    buffer: Vec<u8>,
    closed: CancellationToken,
    _permit: OwnedSemaphorePermit,
}
impl Transport {
    pub fn new(endpoint: String) -> Self {
        Self {
            endpoint,
            closed: CancellationToken::new(),
            slots: Arc::new(Semaphore::new(LIMIT_CONNECTIONS)),
            sockets: Mutex::new(Vec::new()),
        }
    }
    pub async fn open(&self) -> Result<Channel, Error> {
        if self.closed.is_cancelled() {
            return Err(Error::new("CLIENT_CLOSED"));
        }
        let permit = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::new("CLIENT_CAPACITY_EXHAUSTED"))?;
        let io = tokio::select! {_ = self.closed.cancelled()=>return Err(Error::new("CLIENT_CLOSED")),result=tokio::time::timeout(std::time::Duration::from_millis(TIMEOUT_CONNECT),dial(&self.endpoint))=>result.map_err(|_|Error::new("KERNEL_UNAVAILABLE"))?.map_err(|_|Error::new("KERNEL_UNAVAILABLE"))?};
        let socket = Arc::new(AsyncMutex::new(Some(io)));
        let mut sockets = self.sockets.lock().unwrap();
        sockets.retain(|s| s.strong_count() > 0);
        sockets.push(Arc::downgrade(&socket));
        Ok(Channel {
            socket,
            buffer: Vec::new(),
            closed: self.closed.clone(),
            _permit: permit,
        })
    }
    pub async fn close(&self) {
        self.closed.cancel();
        let sockets: Vec<_> = self
            .sockets
            .lock()
            .unwrap()
            .iter()
            .filter_map(Weak::upgrade)
            .collect();
        for s in sockets {
            s.lock().await.take();
        }
    }
}
impl Channel {
    pub async fn write(&mut self, data: &[u8]) -> Result<(), Error> {
        let mut slot = self.socket.lock().await;
        let io = slot.as_mut().ok_or_else(|| Error::new("CLIENT_CLOSED"))?;
        tokio::select! {_ = self.closed.cancelled()=>Err(Error::new("CLIENT_CLOSED")),r=io.write_all(data)=>r.map_err(Into::into)}
    }
    pub async fn line(&mut self) -> Result<Vec<u8>, Error> {
        let mut scanned = 0;
        loop {
            // 只扫描新到达的字节；下一次 line 从剩余缓冲头开始。
            if let Some(offset) = self.buffer[scanned..].iter().position(|b| *b == b'\n') {
                let at = scanned + offset;
                if at > LIMIT_LINE_BYTES {
                    return Err(Error::new("HOST_FRAME_TOO_LARGE"));
                };
                let rest = self.buffer.split_off(at + 1);
                self.buffer.pop();
                let line = std::mem::replace(&mut self.buffer, rest);
                return Ok(line);
            }
            if self.buffer.len() > LIMIT_LINE_BYTES {
                return Err(Error::new("HOST_FRAME_TOO_LARGE"));
            }
            let mut chunk = vec![0u8; LIMIT_READ_CHUNK_BYTES];
            let mut slot = self.socket.lock().await;
            let io = slot.as_mut().ok_or_else(|| Error::new("CLIENT_CLOSED"))?;
            let n = tokio::select! {_ = self.closed.cancelled()=>return Err(Error::new("CLIENT_CLOSED")),r=io.read(&mut chunk)=>r?};
            if n == 0 {
                return Err(Error::new("CONNECTION_CLOSED"));
            };
            scanned = self.buffer.len();
            self.buffer.extend_from_slice(&chunk[..n]);
        }
    }
    pub async fn close(&mut self) {
        self.socket.lock().await.take();
    }
}
#[cfg(unix)]
async fn dial(endpoint: &str) -> std::io::Result<Box<dyn IO>> {
    Ok(Box::new(tokio::net::UnixStream::connect(endpoint).await?))
}
#[cfg(windows)]
async fn dial(endpoint: &str) -> std::io::Result<Box<dyn IO>> {
    loop {
        match tokio::net::windows::named_pipe::ClientOptions::new().open(endpoint) {
            Ok(pipe) => return Ok(Box::new(pipe)),
            Err(e) if e.raw_os_error() == Some(231) => {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await
            }
            Err(e) => return Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 小 chunk 承载接近上限的大行，覆盖跨块 UTF-8、尾部下一行以及无 LF 超限。
    async fn channel_bytes(data: Vec<u8>) -> Channel {
        let (reader, mut writer) = tokio::io::duplex(8192);
        tokio::spawn(async move {
            for chunk in data.chunks(4096) {
                if writer.write_all(chunk).await.is_err() {
                    break;
                }
            }
        });
        Channel {
            socket: Arc::new(AsyncMutex::new(Some(Box::new(reader)))),
            buffer: Vec::new(),
            closed: CancellationToken::new(),
            _permit: Arc::new(Semaphore::new(1)).acquire_owned().await.unwrap(),
        }
    }
    #[tokio::test]
    async fn fragmented_large_lines_and_tail() {
        let expected = "界".repeat(LIMIT_LINE_BYTES / 3);
        let mut channel = channel_bytes(format!("{expected}\nnext\r\n").into_bytes()).await;
        let line = tokio::time::timeout(std::time::Duration::from_secs(10), channel.line())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(line, expected.as_bytes());
        assert_eq!(channel.line().await.unwrap(), b"next\r");
        assert_eq!(channel.line().await.unwrap_err().code, "CONNECTION_CLOSED");
    }
    #[tokio::test]
    async fn oversized_line_is_rejected_without_newline() {
        let mut channel = channel_bytes(vec![b'x'; LIMIT_LINE_BYTES + 1]).await;
        assert_eq!(
            channel.line().await.unwrap_err().code,
            "HOST_FRAME_TOO_LARGE"
        );
    }
}
