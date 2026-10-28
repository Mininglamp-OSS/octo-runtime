# Issue 205 验证与评审

## 基线与范围

- 日期：2026-10-28；系统：macOS arm64；Node：24.19.0；pnpm：11.19.0。
- 基线：`59cb21a14259b6dc828f8791b8117ba1f3689f4c`，分支 `fix/205-host-configured-dsh-bin`，验证时包含本任务未提交修改。
- npm Provider 与官方 Client 均为 `0.2.1-rc.3`；Client/Protocol 未修改。
- 范围：本分支 25 个变更文件（源码、测试、CI、示例及文档）逐文件评审；无 lockfile、生成代码或二进制变更，无跳过文件。删除文件只核对引用与发行物清理。

## 执行结果

| 检查 | 结果 | 证据与边界 |
| --- | --- | --- |
| `pnpm typecheck` | PASS | 全 workspace 构建及严格类型检查 |
| `pnpm lint`、`pnpm lint:names` | PASS | 无 lint 或命名问题 |
| `pnpm format:check` | PASS | 完整格式检查；后续变更文件另行定向检查 |
| `pnpm docs:check` | PASS | 双语文档、公开示例严格编译及 4 项运行测试 |
| `pnpm test:suites` | PASS | 2,107 项 Node 测试通过、57 项条件跳过；35 项 UI 测试通过。复用已完成的 typecheck 构建，无需重复构建 |
| `node --test test/dsh-launch.test.js` | PASS | 最后新增的链接目标拒绝回归也通过；该文件 6 项通过 |
| `node scripts/pack-release.mjs` | PASS | 生成单包发行物；未打包 Provider 或 Desktop 桥接文件 |
| `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz --expected-commit 59cb21a14259b6dc828f8791b8117ba1f3689f4c` | PASS | 包外离线安装、DSH 调用、公开类型、原生 Kernel/Extra、Home 保留与卸载 |
| 真实 npm DSH / Node | PASS | `OCTO_DSH_NATIVE_BIN=/tmp/octo-runtime-205-native/node_modules/@deepseek-ai/dsh/lib/bin.js node --test test/dsh-native.test.js`：公开 Kernel discovery、版本、官方 SDK 初始化、关闭通过，无模型请求 |
| 真实 npm DSH / Electron 39.8.10 | FAIL | 版本探针通过，初始化被上游原生加载器以 `unsupported Electron runtime fingerprint` 拒绝。fixture 不代表此版本可用；已写入双语兼容说明 |
| 真实 npm DSH / Electron 44.7.0 | PASS | `node scripts/verify-dsh-platform.mjs /tmp/octo-runtime-205-native`：Node 与 Electron 各 7 项检查全部通过。Electron 使用自带 Node 24.21.0；包含公开 Kernel discovery、官方 SDK 初始化和关闭，无模型请求 |
| Windows/Linux 原生平台 | NOT_RUN（本机） | 已加入 CI 三平台 Node/Electron 真实 npm 初始化检查及 CI Gate；远端结果单独记录 |
| 真实模型、IM 联调 | NOT_RUN | 本次只验证启动和 SDK 初始化，不触发消息投递或模型调用，无需读取用户提供的测试账号文件 |

运行日志保存在仓库外 `/tmp/octo-runtime-205-{tests-final,format,pack,release,platform}.log`，不包含认证材料。

## Verified Review

按 [review.md](review.md) 的计划检查正确性、安全、性能、维护性及测试。配置生产/消费、Kernel list/invoke、官方 SDK 子进程启动、环境隔离、缺失/版本/握手失败均已追踪到实际实现，并运行验证。

发现并修正：新增 CI Gate 依赖后旧测试断言未同步（执行复现，定向 20 项通过）；新增文档误写 CLI 配置文件为身份文件 runtime.json（源码确认，已改为 `<home>/<profile>/config.json`）。修正后没有中等级别及以上的未解决代码问题。

Electron 39 的上游原生 runtime 限制是实际验证失败，不作为本次 Adapter 修复已覆盖的能力。其他 Electron 构建、Windows/Linux 及真实模型执行均按对应实测结果报告。
