# 文档维护

[English](../en/maintenance.md) | [文档目录](README.md)

## 内容归属

docs 描述当前公开接口和使用方式。接口说明按主题集中维护示例、payload 定义和注意事项；包 README 介绍职责、最小用法并链接相应参考。CLI 或 Electron/app 的模块清单、工厂调用和内部资源装配方式属于宿主实现。

研发过程、历史架构、迁移流水、源码基线和历次验证结果记录在 .octospec，不作为用户文档内容。

## 更新规则

中英文使用相同的页面路径和代码示例，共享可执行示例位于 docs/examples。接口或行为变化时，同步更新两种语言、示例、图和导航。API 名称保持原文；AgentEnv 标准项集中在[标准参考](reference/agent-env-standard.md)，Adapter 私有字段注明所属 Adapter。

## 本地检查

先运行 `pnpm build`，再运行 `pnpm docs:check`。检查覆盖本地链接、双语页面与代码块一致性、JSON 结构、标准项示例、共享示例类型和测试 Adapter 的本地 Kernel 调用，不证明真实 Provider 或外部业务可用。

修改 Mermaid 图后，单独渲染并检查语法与布局。修改[启动诊断目录](guides/startup-diagnostics.md)对应的共享 catalog 后，显式运行 `node test/manual/generate-startup-catalog.mjs`，构建后运行 `node --test test/manual/startup-diagnostics.test.js`。

按变更范围选择本地专项检查，将实际命令、结果与未验证范围记录在任务 validation 中。专项检查不扩大默认测试或 GitHub CI 范围。
