---
type: Rule
title: 本轮模型输入与工作目录
description: Context v3 的执行配置与调用方普通提示词输入边界。
tags: ["context","model-input","workspace"]
timestamp: 2026-10-22T00:00:00Z
implementation_baseline: df63c8f
id: runtime-context-input
tier: repo
priority: 90
load_bearing: true
inject_when:
  paths: ["packages/octo-runtime-protocol/**","packages/octo-runtime-executor-core/**","packages/octo-runtime-adapter-*/**","test/model-context*"]
  touches: ["context","model-input","workspace"]
source: self
supersedes: []
---

# 模型输入和执行环境分离

公开入口为 KernelClient.invoke(inputs, sessionId, providerSession, agentEnv)。inputs 是业务方已经准备好的有序文本/图片；Runtime 不读取、拼装、渲染业务历史、extra.* 或资源引用，不规定业务标签格式。Gateway/应用可选 namespace/XML/Markdown，均只是输入内容。

agentEnv 复用 Context v3 schema/items 执行信封，承载公共执行 bean 和宿主与 Adapter 约定的私有 item；业务材料和应用提示词由 inputs 传递。cwd、Adapter、model/effort、envs、MCP、limits、审批属于 agentEnv；Core 每轮复制快照并保序透传，Adapter 直接读取与校验，不改变原配置，不从其他调用补齐业务材料。

应用启动提示词由调用方与业务材料、当前文本/图片一起构造为普通 inputs，内容、顺序和每轮是否携带均归调用方。Runtime 不提供可移植 system/developer/受信提示词抽象，不按新建、续接或重建会话添加提示词、标记和分隔符。Provider 私有能力的存在不构成 Runtime 公共注入合同。

Issue 334 删除 octo.control/instructions、controlInstructions 及派生/首轮注入 helper，不保留别名。旧项在通用 Context、配置持久层和 agentEnv 拒绝；旧字段即使为空也拒绝，不能静默丢弃。主输入、modelInput 与显式 fresh fallback 各由调用方完整准备，重试复用同一冻结内容，不重复前置。历史图片不可用必须显式失败，不静默退化。MCP 和环境变量不得因提示词迁移进入正文。

Core 内部 InvokeRequest 和 Adapter signal 保留为执行接口，不等同于公开 KernelClient 签名。详见[输入合同](invoke-input.md)、[调用与取消](local-execution.md)、[标识说明](../../docs/zh-CN/concepts/identifiers.md)。

## 调用方准备目录，Runtime 只校验并执行

本地执行必须显式提供已存在的绝对目录：octo.execution/workspace payload 仅为 {path}。SDK 与 CLI 均无隐式 cwd，Core/Kernel 不分配目录、不创建缺失路径、不从旧会话补目录。调用方临时目录须先成功创建再传入；续接和 fresh recovery 路径消失明确失败，不替换或重建。

Issue 335 删除 mode 的 fixed/random/none 分支、workspace_mode 回执/投影字段、prepareRunContext 和 WorkspaceAssignments；旧 payload 明确拒绝，不兼容转换，不删除历史用户目录。Adapter 在 Provider 操作前校验路径，稳定原因码为 WORKDIR_REQUIRED、WORKDIR_INVALID、WORKDIR_NOT_FOUND、WORKDIR_NOT_DIRECTORY、WORKDIR_UNAVAILABLE，沿用公开分类 OH-ADP-3004。声明 metadata.workspace:false 的 Adapter 没有本地覆盖时允许缺省，OpenClaw 使用 Provider 工作区；Runtime Home/log/IPC 等自有目录继续独立管理。


## 信封最小结构与业务边界

ContextItem 只含 namespace、name、payload；顶层 guidance、data_format 已删除并按未知字段拒绝。inline/references/history 的类型、格式、解释和拼接归业务，不进入公共 catalog，不保留 references 身份合并。PublicObjectMaterial 的 task/discussion/mention/history 业务分类已删除；无生产消费者的旧 ContextPreparationReceipt 和整个 RunContextProjection 也已移除，不再暴露独立准备回执或配置投影。通用未知 item 的 payload 保持 opaque，显式 mergeContext 对普通 item 整项替换；现有公共执行配置的显式组合保留，Core 不隐式合并。

模型或 effort 使用 Provider 选择时，分别省略 selection 或 reasoning；均不设置时省略整个 model item。已删除 use_provider_default，消费校验拒绝旧哨兵及空 setting。显式组合 defaults 的调用方须先去掉不需要的默认覆盖；省略 request 不会清除 defaults。省略也不保证已恢复原生会话重置为全局默认。

actmode 和来源分类不再属于公共执行合同。adapter.xxx 并非公共命名空间规范，不登记 schema/catalog/生成类型。具体 Adapter 可自行约定 item 名称及字段，权威说明在各包 README；通用结构校验通过不代表未知项生效，旧 source/actmode 不做迁移转换。

## 有限执行预算

`octo.execution/limits` 不再接受 enforcement，RuntimeLimits 也不保留同名字段或兼容组合分支。调用方通过相应有限预算表达等待时长，Runtime执行预算；调大整轮预算不自动延长首帧/模型空闲/工具预算。model_idle_policy=observe仅控制模型空闲终止，其他预算继续生效。通用AgentEnv仍只校验opaque信封，旧字段在Adapter读取limits时拒绝，不静默忽略。删除验证见[任务](../tasks/remove-limits-enforcement/brief.md)。

## 开发参考入口与单一维护位置

公共输入的字段、payload、缺省和错误边界统一维护于 docs 的 [inputs](../../docs/zh-CN/reference/input-parts.md)、[Invoke API](../../docs/zh-CN/reference/invoke-input.md) 与 [AgentEnv 分章参考](../../docs/zh-CN/reference/agent-env-standard.md)，七个公共执行项集中在同一个文件，用 H2 区分 item，H3 仅组织示例、payload 定义和注意事项。packages/README 提供汇总导航，包 README 保留职责、导入、装配及包级合同入口，链接到对应参考，不复制完整公共参数目录。

Adapter 私有 item 仍归所属包，包 README 链接其维护的专属字段参考，不加入公共 schema/catalog。涉及 modeId 时必须明确其为工作模式 ID，不是模型 ID；模型 ID 使用 octo.execution/model.payload.selection.id，两者独立校验与设置。

AgentEnv 构造、读取及合并 helper 归标准参考的附属 API 文档，不在顶层导航建立 defaults/mandatory 配置主题。这些名字仅作为具体辅助函数的参数或参数字段说明，不推广为 AgentEnv 标准字段、执行配置层或产品概念。

用户 docs 只描述当前公开合同，不包含历史基线、旧架构验收、迁移流水或兼容层叙述。历史证据保留在 .octospec 并按适用范围标记过期；CLI/Electron/app 的 Manifest、模块加载、工厂调用和内部关闭方式属于宿主实现，不建用户参考页。公开客户端取消、终态及连接关闭的实际行为仍需准确说明。
