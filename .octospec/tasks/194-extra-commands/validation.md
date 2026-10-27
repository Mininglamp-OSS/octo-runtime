---
type: Verification
title: Issue 194 实施与验证
tags: [extra, cli, configuration, verification]
timestamp: 2026-10-27T00:00:00Z
---

# 最终实现

分支 `codex/194-extra-commands`，基线 `a7c33b64064b8a54f59f70178873983ba143c1b3`，未提交工作区。平台 macOS / arm64，Node.js v24.19.0，pnpm 11.19.0。

- 独立 `/commands`，apiVersion=1，命令树、选项、位置参数、输出、退出码与取消合同从主包 `/extra` 导出。根帮助只读 manifest，详细帮助只加载选中命令模块。
- CLI 分阶段路由；自有命令要求 --home/--manifest 位于命令前，--json/-h/--help 可以位于命令后，-- 后是位置参数。生命周期命令保留旧参数语法且不导入 commands。
- 三个业务接入是 channel-gateway、channel-wecom、webui；configure 只暴露核心配置。Gateway/WeCom 使用各自现有 imBotIdentity，WebUI 为 Home 内单例。configure 更新同 ID、追加不同 ID，config set 完整替换并拒绝重复身份。
- 同一个 config.json、权限与写锁；CAS 比较整份声明，保留 module/enabled。交互不占写锁；取消前不写，开始原子写入后以实际结果为准。保存提示明确需要整个 Extra 重启，不自动启动或启用。
- 旧 extraset/extraget 外壳接口继续保留；config get 明确返回可能含凭据的业务 JSON。普通保存和错误不输出凭据，未知第三方 handler 错误折叠。

# 验证结果

所有命令在本 worktree 执行；测试凭据仅在临时目录/内存按次随机生成，未使用真实认证值。

| 检查 | 命令/证据 | 结果 |
| --- | --- | --- |
| 构建及严格类型 | `pnpm typecheck`；`/tmp/octo-194-final2-typecheck.log` | PASS，退出 0 |
| Node 全量 | `pnpm test:suites`；`/tmp/octo-194-final2-tests.log` | PASS，1952 项中 1898 通过、54 跳过、0 失败 |
| UI | 同一 `pnpm test:suites` | PASS，35 通过，2 个测试文件 |
| ESLint | `pnpm lint`；`/tmp/octo-194-final-lint-pass.log` | PASS |
| 命名 | `pnpm lint:names`；`/tmp/octo-194-final-names.log` | PASS，findings=[] |
| 文档 | `pnpm docs:check`；`/tmp/octo-194-docs2.log` | PASS，双语链接/代码一致，4 个执行示例通过 |
| 改动格式 | 对 Git 改动及未跟踪的 TS/JS/JSON 执行 `pnpm exec prettier --check` | PASS，`/tmp/octo-194-format-check.log` |
| 空白错误 | `git diff --check` | PASS |
| 发行包 | `node scripts/pack-release.mjs` | PASS，生成 dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz |
| 包外安装与命令 | `node /tmp/octo-194-verify-release.mjs "$PWD"`；`/tmp/octo-194-release-verification-final.log` | PASS，npm 离线安装实际 tgz；三个 Extra 的帮助、配置、重复请求、extraget、读回及 POSIX 0600 |
| 第三方实际安装 | 上述发行验收脚本另用 npm 安装独立包，通过 Home manifest 发现 `loop-daemon login` | PASS，不改 CLI，服务入口若被导入会抛错；帮助及命令运行成功 |
| 包外公开类型 | 上述脚本 `tsc --strict --module NodeNext --target ES2022 --skipLibCheck false --noEmit --types node` | PASS，主包 ExtraCommand 合同及三个 commands 子路径 |

最初 `pnpm test` 已完整通过一次（1895 通过/54 跳过、UI35），审查修复后增加 3 个回归，最终重新 typecheck + test:suites 得到表中结果。一次 lint 与 clean/build 同时运行导致产物暂时缺失，未视为源码缺陷；构建完成后串行 lint 通过。包外 TS fixture 首次遗漏 TypeScript 6 的显式 `--types node`，补齐与仓库发行脚本相同参数后通过，未改产品类型掩盖错误。

# 行为与故障覆盖

`test/extra-commands.test.js` 有 27 项专项测试，包含未配置/disabled、全部帮助层级、CRLF/Unicode、两渠道 ID 去重与不同端点、保存回执与业务 JSON 分离、完整 JSON 替换、重复身份/非法 URL/非法端口/超量输入拒绝、profile 拒绝、核心字段保留、凭据不回显、损坏配置不覆盖。

并发覆盖两种路径：同进程快照与 extraset 冲突，以及两个真实 CLI 进程先读同一快照、在无锁 stdin 交互后按顺序提交；前者保存，后者明确 EXTRA_CONFIG_CONFLICT，原配置保留。新锁尚未写完时不可抢占；多个竞争者回收同一陈旧锁时使用独占 reclaim 目录和二次 owner 检查，只有一个写入者进入。取消测试在 stdin 未结束时返回 130，解除监听并不创建配置。

外部模块覆盖根帮助不 import、选择来源、忽略同名条目、文件模块声明、旧包无 exports、缺少可选导出、依赖损坏、API 不兼容、保留名称/重复命令/宿主选项冲突、嵌套命令、`--` 字面量、非法退出输入与可控退出码。普通异常正文不会成为公开凭据。

# 边界

- 全局 npm 自动发现 #192 尚未合入本基线；本轮复用选中 manifest catalog，不另实现扫描。实际第三方安装通过 Home manifest 验证，不能宣称无 manifest 的全局发现已完成。
- 本次改动是离线配置入口。没有执行真实 IM/WeCom 认证或消息投递，没有新增业务网络登录。外部 login 是命令扩展 fixture，不能证明业务认证成功。
- 未做 Windows/Linux 原生平台验证，54 项条件跳过保留事实。没有测试真人交互终端 prompt；stdin 及 signal 已覆盖。
- 命令扩展是可信同进程代码，须自行观察取消与关闭资源；不提供恶意 JS 沙箱或远端副作用回滚。
- 不重置任何用户 Home、身份、凭据或运行服务。没有 commit、push 或创建 PR。

逐文件审查与修复见 [verified-review](review.md)。
