# Host SDK

宿主独立拥有 Kernel 和每个 Extra 的生命周期，SDK 不依赖 CLI 的 JSON 目录或账号登录流程。对外使用主发行包 /host、/executor-kernel、/extra。

- startOwnedKernel：创建独立 Kernel，提供 client、exited、stop 和显式 restart。
- attachKernel：只连接现有 Kernel，没有 start/stop/restart 权限。
- startExtra：在独立 Node 进程加载一个完整插件声明，注入连接端口和宿主依赖。
- startNativeComponent：按绝对 executable、argv、cwd、configPath、endpoint 启动原生组件；shell=false，按声明的 stdin-json 或 signal 合同关闭。

stop 返回 CleanupResult，complete、processExited、pendingResources 和稳定错误码分别表达清理事实。进程退出不等于插件 dispose 或宿主依赖已完成；失败实例保留所有权，禁止同名替换。

函数式 Extra 合同保持 extra(ctx, config)(dependencies)。loadContexts 函数留在宿主；IPC 仅传 instance/epoch/call ID、剩余时限和受限 JSON。默认 8 个实际在途（最大 32），超时或取消只结束调用方等待，实际 Promise 结束前不释放额度。默认 5 秒，范围 1-30 秒，结果最多 32 项 / 64 KiB，发送队列最多 64 条 / 2 MiB。断线和重载不能绕过未完成的真实调用。

宿主也可通过显式 dependencyModule 在 Extra 进程中加载依赖。模块入口必须绝对，不能与函数代理同时使用；它属于产品装配代码，不是 JS 沙箱。

Extra 的 logging.directory 由宿主显式提供，日志使用既有元数据白名单。配置或函数引用变化时，等待旧 handle.stop 完成再创建新 handle；同一函数读取的数据变化无需重载。完整示例见 [SDK 接入](../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md)。
