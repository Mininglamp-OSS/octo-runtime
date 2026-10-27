---
type: Review
title: Issue 194 verified-review
tags: [review]
timestamp: 2026-10-27T00:00:00Z
---

# 审查范围与方法

使用 verified-review 的串行双轨：先逐文件核对本次工作区新增/修改，再执行真实 CLI 与发行包验证。基线 main `a7c33b64064b8a54f59f70178873983ba143c1b3`，dirty=yes，macOS arm64 / Node v24.19.0 / pnpm 11.19.0。

范围包含 44 个文件（含本报告、验证记录及 journal）：CLI 路由/输出/帮助/存储、模块清单条目、Host SDK 合同、三个 Extra 业务命令与 package exports、主包公开转发、专项测试、双语指南及入口、OKF 规则和记录。每个文件单独检查；无锁文件、二进制或生成代码进入 diff，无跳过文件。编译/打包产物是验证对象，不是源码审查文件。

检查计划：

1. 路由与声明：追踪根/组件/嵌套帮助、宿主选项归属、字符串值与 `--`、保留名称、退出码。
2. 身份与存储：核对业务 imBotIdentity、旧字段保留、module 来源、CAS、写锁、取消与原子保存边界。
3. 导入与发行：核对元数据无服务加载、缺失导出/损坏依赖分流、公开类型及实际 npm 安装路径。
4. 凭据与文档：核对错误正文与输出、帮助是否标明凭据返回、CLI 与 SDK 责任，以及中英文示例一致性。

# 已复现并修复

- **medium / bug，apps/cli/src/extra-commands.ts，optionName / routeExtraCommand**：原先 `token.replace(/^--/, "")` 会把裸命令 `json` 当作宿主选项；调用 `loop-daemon json` 返回 2。改为只有 `--` / `-h` 才产生选项名。Tier: reproduced。回归 `A custom command named json is not mistaken for a host flag`，修前失败、修后成功。
- **medium / bug，apps/cli/src/extra-commands.ts，结果输出分支**：原先 `value.saved === true` 推断保存回执，导致合法业务配置包含 saved 字段时 config get 丢失 JSON 输出。改为 ExtraCommandResult.message 明确提供普通终端文本，value 始终按 JSON 输出。Tier: reproduced。回归 `config get always returns business JSON even when it contains a saved field`，修前 JSON.parse 失败、修后完全一致。
- **high / concurrency，apps/cli/src/state.ts，acquireProcessLock**：引入命令读改写时核对到旧锁初始化窗口和并发陈旧锁回收窗口；不得让回收者删除另一个新写入者的锁。当前修改拒绝未知 owner，并以独占 reclaim 目录+二次 owner 检查串行回收。新锁窗口与多竞争者回收测试均通过；旧代码 `owner !== undefined && processAlive(owner)` 对空锁不能阻止进入（已用 HEAD 原始 state.ts 独立转译执行，空锁仍进入写入者；退出 0 表示缺陷成功复现，Tier: reproduced；临时模块已删除）。陈旧锁竞态路径为 read-confirmed，修后竞争验证通过。修后同时验证旧生命周期竞争测试，避免仅验证新命令调用方。

两个输出/解析复现记录：`/tmp/octo-194-review-repro.log`，当时 2 项均失败，失败属于产品边界复现。修后专项和全量通过；见验证记录。锁回收测试从进入事件控制排空，不以外部固定时间提前释放锁。

审查过程中还补齐未导出命令的旧包兼容、未知 handler 错误去私密正文、业务 JSON/回执显示分离与双语文档入口；最终不存在待修复的 medium 或更高等级发现。

# 运行证据与限制

`pnpm typecheck`、最终 `pnpm test:suites`（Node1898通过/54跳过、UI35通过）、lint/names、docs:check、格式检查均通过。实际 tgz 在仓库外 npm 离线安装，三个 Extra 及另装第三方包命令通过，公开合同 strict TypeScript 编译通过。完整命令、证据及未覆盖范围见 [验证记录](validation.md)。

不能将 fixture login 视为真实业务认证，不能将 manifest 接入视为 #192 全局发现，不能将 macOS 通过视为 Windows/Linux 验收。审查未创建远端 issue 或 PR，未提交。
