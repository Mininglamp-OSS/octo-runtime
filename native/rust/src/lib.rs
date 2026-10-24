//! 附着到已有 Octo Kernel 的原生 IPC 客户端。Drop/close 不取消服务端 Run。
pub mod codec;
mod transport;
pub mod generated {
    pub mod generated_client;
    pub mod models;
    mod rpc;
    pub mod rules;
}
pub use codec::{decode, encode, Error, Presence};
pub use generated::{
    generated_client::{CancelToken, Client},
    models,
};
