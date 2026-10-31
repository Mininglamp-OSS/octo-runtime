---
type: Journal
title: PR 258 DSH SDK 升级安装策略修复
description: 同步 rc.4 的显式禁用构建规则，修复 frozen-lockfile 安装失败。
tags: [adapter, installation, testing]
---

# 修复与验证

基线为 PR #258 的 `5cb4801083403ebed8853e8eb0a0e8c0f96dea99`，目标主线为
`80d49138500a3216e4fa9144cada6545e02c3a68`。在 macOS arm64、Node
`24.22.2`、pnpm `11.19.0` 上，修复前的 `pnpm install --frozen-lockfile`
以退出码 1 报告 `ERR_PNPM_IGNORED_BUILDS`，依赖为
`@deepseek-ai/dsh-subprocess-local@0.2.1-rc.4`。

将 `pnpm-workspace.yaml` 中该包的版本限定禁用规则从 `rc.3` 同步为 `rc.4`，
继续保留 `false`。Runtime 仍使用宿主安装的 Provider，不执行 npm Provider
原生辅助脚本；其他依赖构建策略与安全 overrides 保持原值。

修复后的同一工作树验证结果：

- `pnpm install --frozen-lockfile` 通过，包含 workspace prepare/build；退出码 0。
- `pnpm lint` 通过。
- `node --test test/dsh-adapter.test.js test/dsh-launch.test.js test/dsh-sdk-boundaries.test.js test/cli-dsh.test.js`
  通过：116 项测试，0 失败，0 跳过。
- `git diff --check` 通过；本地安装未修改锁文件。
- 相对目标分支的 workflow diff 为空，未增加 job、矩阵、触发条件、必需状态或专项测试入口。

以上是离线验证，未运行真实 Provider 或请求模型。GitHub 现有跨平台 CI 的结果独立记录于 PR。
