# Issue 205：宿主管理 DSH npm 入口

2026-10-28 按 Issue #205 评论实施：宿主维护并传入绝对路径 `providerOptions.dshBin`，删除 Adapter 内的 PATH、command/args、Desktop/ASAR 发现与桥接。官方 SDK 保持未修改；Kernel 原有配置链路同时服务 discovery 与 invocation，Electron 子进程固定 Node mode。

PR #219 首版遗漏 CLI 自身的自动解析。按用户指出的问题，补齐 apps/cli 宿主配置层：显式 profile dshBin 优先，否则从首个 PATH dsh 的 npm 元数据解析入口；常驻 Kernel 与 playboard 共用并传入同一配置，不执行 Windows shim、不换另一安装。新增 CLI 集成回归及三平台真实 npm shim 解析验证，SDK 不继承 CLI 选择策略。

方案、责任与验收见[任务简报](../../tasks/205-host-configured-dsh/brief.md)，实际命令、测试范围、已修正评审项及上游 Electron 39 原生兼容限制见[验证记录](../../tasks/205-host-configured-dsh/validation.md)。不重置宿主或 Provider 身份、配置、认证和已有会话。跨平台 fixture 与原生结果分别记录，不以 Node 或 macOS 成功替代 Windows/Linux 验收。
