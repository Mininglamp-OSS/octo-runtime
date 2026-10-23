---
type: Journal
title: Issue 81 与 Dependabot 安全整改验证
description: 最新 main 基线、逐条告警复核、本地检查与交付边界。
tags: [security, testing]
timestamp: 2026-10-23T00:00:00Z
---

# 基线与交付边界

本轮从干净 main 快进至 `origin/main@445d2bb`，建立 `codex/fix-81-security-backlog`。用户授权提交、推送和创建英文 PR，合并由用户确认，未授权合并。未修改 Git author 配置；提交保留 Codex attribution trailer。

原分析为 CodeQL 2.27.2/security-extended 103 条规则、35 条告警；最新 main [托管重扫](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39889943281)成功，CodeQL 2.27.3、同一 suite/103 条规则、39 条 open：原 #2/#11/#13 旧路径 fixed，新增 #36 至 #42，迁移后的相同缺陷仍修复。全部 42 条及两个 Dependabot 告警的根因、信任边界、处置与依据见 [disposition](../../tasks/81-security-remediation/disposition.md)。没有降低查询集、全局排除路径或批量 dismissal。

# 实现与本地证据

保留身份和 URL 语义，以线性扫描消除 PEM、appSlug 与尾斜杠处理退化。配置、日志、dotenv 和 WeCom 探针在打开后的同一描述符校验并读写；拒绝链接、非普通文件，避免 FIFO 阻塞，配置读取有界。截图使用独占临时目录和文件，重启夹具以 wx 文件认领序号。Vitest 及配套 mocker 升级到 4.1.12，覆盖两个已知 GHSA。

2026-10-23 在 macOS arm64、Node 24.19.0、pnpm 11.19.0 验证：

- `pnpm typecheck`、`pnpm lint`、`pnpm lint:names` 通过。
- 最终全量 `pnpm test:suites`：UI 35 通过；Node 1710 项，1670 通过、40 跳过、0 失败。
- 最终针对性回归 28 项通过，包括新增 8 项安全回归、hourly-log、adapter-failures、channel-tool-environment。覆盖超长恶意输入限时、打开后路径替换、链接/FIFO/权限/容量失败和 8 并发进程序号认领。
- `pnpm docs:check` 通过；发行 tgz 打包成功，包含新 URL helper，未发布 npm。
- `pnpm audit --json`：所有严重级别均为 0；`git diff --check` 通过。
- 修改文件 Prettier 检查通过。`uv run --with pyyaml python .octospec/scripts/lint.py` 仅报告 main 已有的三项 frontmatter 缺失：tasks/systemd-directive-paths 的 brief.md、review.md 及 journal/shared/2026-10-22-systemd-directive-paths.md；本次未修改这些文件。
- 从三个真实 CDP 脚本提取模板，以六类恶意字符串逐一构建并执行，18 项保持原数据且不执行注入；从 App.tsx 提取两处实际 hash 路由 guard，10 项恶意路径均拒绝。
- 从实际截图脚本提取函数，离线替代 CDP 返回值：重复 online 状态生成不同文件，目录 0700、文件 0600。没有执行真实桌面操作。

# 复核与尚未验收

逐条核对真实数据流；HTML 注释删除只产生可见性布尔值、JSON 字面量只承载数据、QA 配置的认证请求及私有测试断言各有独立依据，不通过改写合法流程隐瞒告警。可复用规则回写 engineering 的安全告警与文件操作复核一节。

本机不能证明 Windows 真机行为；不支持 O_NOFOLLOW 的平台仍验证文件类型及 dev/ino，相关分支由跨平台 CI 继续核对。没有执行需要真实账号、模型、IM 或桌面写入的 live 探针。分支托管 CodeQL 结果将补入交付记录；最终合并 main 的重扫、逐条 disposition 审核及 Dependabot fixed 状态是 Issue 关闭条件，当前不宣称面板已清零。
