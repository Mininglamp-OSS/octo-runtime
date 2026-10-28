# Verified Review

## 评审计划

Summary: 收敛 DSH 启动合同为宿主显式 npm JS 入口；删除自动发现和 Desktop 桥接，维护官方 SDK 原有协议与生命周期。

Issues

1. [high] 启动边界：检查配置缺失、相对路径、wrapper、Desktop/ASAR 及链接目标是否被拒绝，文件缺失后是否会执行另一安装。
   → 读取 launch、官方 SDK 及调用方；运行配置拒绝、缺失文件、符号链接与原有 Adapter 回归。
2. [high] 公共链路：确认 Kernel discovery 与 invocation 消费同一配置，Electron 子进程使用宿主 runtime 和独立 Node mode 环境。
   → 读取 Kernel configure/list/invoke；运行 Kernel worker fixture 及真实 npm 初始化。
3. [medium] 兼容与交付：检查 Windows 路径转换、CI 三平台原生验证、失败保留、双语文档、发行物和现有测试的合同一致性。
   → 每个修改文件单独检查；运行类型、lint、format、docs、完整测试及发行包验证。
4. [high] CLI 宿主自动发现：检查常驻 Kernel 与 playboard 都在创建前解析 npm 入口，显式配置优先、首个 PATH 安装固定、Windows 不执行 shim、不覆盖其他配置、不将 CLI 策略注入 SDK/Adapter。
   → 新增 CLI 配置和实际 CLI 入口回归，三平台原生任务增加真实 npm shim 解析与 CLI worker list 验证。
5. [high] 远端 review：检查 realpath 校验与实际启动是否使用同一路径。
   → 在 stat 校验后确定性替换宿主目录链接；旧实现执行替换后的 Desktop 哨兵而失败，新实现固定 physicalPath 并通过版本校验，返回同一路径给官方 SDK。

以上是风险检查计划，不是已确认缺陷。最终结论与实际证据见 validation.md。
