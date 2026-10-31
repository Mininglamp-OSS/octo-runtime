---
type: Task
title: 群和话题直接点名后的会话命令
description: 在保留真实提及准入的前提下精确识别 reset/new/stop，语义文本继续交给 AgentRun。
tags: [channel, session, reset, testing]
---

# 目标

修复 [Issue #18](https://github.com/Mininglamp-OSS/octo-runtime/issues/18) / Loop ORT-8：群或话题中直接点名当前 Bot 后，完整的 `/reset`、`/new`、`/stop` 应由 Channel 立即处理，不能入队或调用模型。

规格状态：用户已认可并授权实现；最新补充明确加入 `/stop`，只对 strip 后纯指令做完整匹配。未授权提交、推送、创建 PR 或合并。

## 基线与事实

- 2026-11-01 已在原 worktree 执行 `git fetch origin main`、`git rebase origin/main`；规格阶段从 `f7384fcbc63b` 更新到 `0c67c256e5196b6170971cc9759d1d4bbea03017`。按用户最新要求再次 rebase 后，当前 HEAD 与 origin/main 均为 `a5a32835882deab5e2364b559dd06bf1675c1335`；新增提交未改动本次涉及的 Gateway 命令路径。
- 分支 `fix/18-mentioned-slash-commands`；worktree `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-18`。
- `transport/normalize.ts` 先检查发送者、空间、群范围与真实提及；`transport/channel.ts` 仍将原始 content 作为 text；`application/im-channel.ts` trim 后精确比较命令，因此 `@Bot /reset` 无法命中。
- 当前主线已经支持 `/new` 与 `/reset` 共用重置分支；本需求不是新增另一种会话生命周期。
- 客户端依据：同工作区 `octo-web/packages/dmworkbase/src/features/chat-composer/adapters/tiptap/mentionSendParse.ts` 的 `parseSendMentionText()` 输出可读名称和实体。`ais` 广播还会把 Bot UID 展开到 uids，不能把 uids 包含当前 Bot 一概视为直接点名。
- 现有群/话题隔离用例只有裸命令及 UID 元数据，没有覆盖正文中的真实提及前缀。

## 产品意图与责任归属

业务目标是准确处理渠道会话控制，决定权归 Channel Gateway。显式输入是当前入站消息的 payload.type、content、mention、真实发送者及频道地址，身份依据来自已核验 Bot 配置。

合同内动作包括准入后解析直接点名、选择现有重置分支、返回原有控制回执。名称匹配、历史推断、跨频道控制、修改宿主会话策略均不属于本模块动作。Host SDK、Kernel、Executor、Adapter、WeCom 不增加 Octo 提及或命令规则；无需修改公共 Run/Context wire schema。

## 已确认约束

1. 现有发送者、Space、父群范围、Bot 身份及拒绝自消息检查必须先通过，不得通过正文补造提及授权。
2. `/new` 继续作为 `/reset` 的别名；DM 的现有命令处理不变。
3. reset/new 成功返回“会话已经重置”；stop 沿用“已请求停止本轮执行。”或“当前没有可停止的执行。”。三者均不创建新 Run、不调用 Adapter、不进入普通队列；不触发历史、群规则、动态 Context 或模型输入准备。stop 只调用已有取消路径，取消 ACK 不宣称执行已终止。
4. 重置复用现有 store.reset 与去重：清除当前 session/Provider binding、名称及 rulesContext，增加 generation，下一条普通消息延迟分配新 session。重复 messageId 仍只重置一次。
5. reset 不取消已有 Run；旧代次投递及迟到 binding 更新继续受现有保护。不删除历史、文件、工作目录或长期记忆。
6. 普通直接提及和普通 AI 广播继续按现有准入与原文执行，不修改群/话题回复地址。
7. 专项验证显式本地运行，不增加 GitHub workflow、job、矩阵、触发条件、必需状态、Gate 依赖，也不通过脚本或默认测试开关扩展 CI。

## 已认可的解析合同

用户“开始实现”认可 D1-D3，随后将 `/stop` 加入同一规则并强调语义文本必须走普通 AgentRun。以下合同按这两条最新指令增量更新。

### D1：广播与混合提及

只在没有广播标记的消息中允许群/话题 reset/new/stop。`all`、`ais`、`humans` 任一为数字 1 或布尔 true 均阻止这三个命令，包括“广播 + 独立直接点名”混合消息。其他类型不作为广播标记，沿用既有 flag 规则。

理由：广播会展开 UID，混合操作容易使多个 Bot 同时重置或停止；保守规则与 Issue 对广播命令的禁止一致。纯直接点名多个 Bot 可由各 Bot 独立处理自身 scope，每个 Bot 必须有自身实体，或满足下述裸命令兼容规则。

被禁止的会话控制不得回退命中 application 的裸 reset/new/stop 分支。原有准入拒绝的消息仍拒绝；其余消息沿普通提示路径使用原文，不重置、不取消、不返回控制成功回执。这不承诺广播负例零模型调用；零模型调用要求针对已识别并获准的 Channel 命令。

### D2：实体和前缀

群/话题仅对 `payload.type === 1` 的当前纯文本消息识别命令。真实客户端例子：

```json
{
  "type": 1,
  "content": "@助理 Bot /reset",
  "mention": {
    "uids": ["bot-uid"],
    "entities": [{ "uid": "bot-uid", "offset": 0, "length": 7 }]
  }
}
```

实体偏移单位为 JavaScript UTF-16 code unit，针对未 trim 的原文；必须先校验再使用，不能用码点数或 trim 后位置计算。

规则：

1. 要求 `mention.uids` 数组包含当前 Bot UID，且不存在 D1 广播标记。
2. entities 必须为数组；使用副本按 offset 排序。每项要求为对象、非空字符串 uid、非负安全整数 offset、正安全整数 length，结束位置不超出 content.length，不相互重叠，不从 UTF-16 代理对中间切分；实体覆盖文本必须以 `@` 开始且包含非空名称。普通 UID 实体还须在 mention.uids 中。任一实体无效时不生成会话控制结果，不修补、截断或猜测名称。
3. 仅消费正文起始区域连续出现的原生提及实体及其间的空白。至少一个已消费实体必须属于当前 Bot；其他被真实点名的 UID 前缀可以一起消费。提及名称可以含空格、中文及 emoji，不能用按空格切词来剥离名称。
4. 去掉有效提及前缀后的完整输入 trim 后必须严格等于 `/reset`、`/new` 或 `/stop`，不使用 includes、子串或“命令开头”匹配。`帮我看一下/stop为啥不生效`、`/stop 为啥不生效`、`解释 /reset 和 /new`、代码/引用中的命令均是有语义的普通输入，照常创建 AgentRun；即使输入从 `/stop` 开始也不能吞掉后面的正文。命令参数、多个命令、代码围栏、大小写变体、命令后置提及都不匹配；`/new session`、`请 /reset`、`/reset @Bot` 均走普通提示路径。
5. 仅识别这三个命令。`/cancel`、`/approve`、`/decline`、`/respond` 不扩展提及前缀支持，保留原有行为。strip 结果只用于控制判断，非命令 AgentRun 的输入仍保留原文，不从正文中删除命令词或说明。

### D3：旧客户端兼容

保留现有“裸 `/reset`、`/new` 或 `/stop` + 当前 Bot UID”的群/话题调用：只有 entities 缺失或为空数组、且没有 D1 广播标记时，允许直接比较原始正文 trim 后的完整命令。

只有 UID、缺失实体但正文带 `@名称` 的消息不猜测前缀，继续走普通提示。实体存在但畸形不得退回裸命令兼容规则。DM 不应用实体门槛，继续按原处理路径执行。引用、转发、富文本、资源标题中的命令不能成为此次新命令入口。

## 实现边界与步骤

1. 在 Gateway transport 增加纯解析函数，输入已准入消息及 botId，返回 reset/new/stop 或无结果；将全部实体校验、前缀识别和广播限制集中在此处。保留 `acceptsImMessage()` 的普通任务合同。
2. 在内部 `ImInboundMessage` 增加可选 `sessionControl?: "/reset" | "/new" | "/stop" | null`。Gateway 群/话题每次都显式设置：成功为命令，其他为 null；原始 text 保留不变。字段只在内部回调使用，不进入模型 Context 或公共执行协议。
3. application 对 reset/new/stop 使用这个字段：undefined 保留现有文本匹配（DM 及既有内部调用者），null 禁止三者，显式命令进入原重置或停止分支。不能写成空值合并后回退原文，否则广播裸命令会再次命中。
4. `/cancel` 等其他分支继续匹配原始 text。recognized reset/new/stop 在现有去重、存储错误和回复失败处理下运行；存储失败不得发送成功回执或入队兜底。stop 绕过普通队列并复用取消准备/投递/执行的原流程，不能变成 reset。
5. 更新 Channel 和 session-reset 规则，说明普通 mention 准入与 reset/new 授权的区别；维护就近中文合同注释。新增本地专项入口，使用真实 GatewayTransport → ImRuntime → store 的路径，仅替换网络和执行边界。

## 验收矩阵

专项计划文件：`test/manual/channel-mentioned-session-commands.test.mjs`。不得被默认 `test/*.test.js` 或 CI 脚本隐式纳入。

| 编号 | 输入与场景 | 可观察结果 |
| --- | --- | --- |
| A1 | 群、话题各发送直接点名实体前缀 + reset/new，组合 2 × 2 | 正确频道收到成功回执；reset 恰好一次、generation +1；enqueue、invoke、Run、Adapter 均为零 |
| A2 | 先普通执行建立 Provider binding，再发送 A1 | 命令不增加执行次数；下一普通消息用新 session/generation、刷新规则，固定 workdir 不变 |
| A3 | 当前 Bot 名称含空格、中文、emoji；前置空白、换行、重复点名、多实体输入顺序不同 | 用原文 UTF-16 实体解析成功，无名称猜测或正文误删 |
| A4 | 纯 all、humans、ais，含真实客户端 ais 展开当前 UID；裸命令和带广播前缀各覆盖 reset/new | store.reset 调用数零、binding 不变、无重置成功回执；原有拒绝或普通任务行为保持 |
| A5 | 广播 + 独立直接点名实体 | 按 D1 禁止会话控制；不得因独立实体或展开 UID 绕过 |
| A6 | 裸命令 + 当前 UID，entities 缺失/空数组；UID 存在但前缀无实体 | 前者重置且不执行；后者原文进入普通提示，不重置 |
| A7 | 实体负数、小数、NaN（纯函数）、零长度、超界、相互重叠、错误 UID、拆代理对、错误字段类型 | 不识别控制，不抛出未处理错误、不修改原文、不重置 |
| A8 | 文字中伪造 @Bot、UID 名称标记、引用/历史/转发/富文本中的 reset/new | 不补造准入或控制授权；非命令仍按各类型既有投影处理 |
| A9 | 错 Space、群范围、空发送者、自消息、显式发送者名单拒绝、无提及/错 Bot | 不入队、不调用执行、不重置、不发成功回执；话题按父群核验 |
| A10 | 普通直接点名问题、普通 AI 广播、命令带参数/正文文字/后置提及 | 原始 text 到达执行，次数按消息准入与去重预期，不进入 reset |
| A11 | DM reset/new；已有 stop/cancel/交互回归 | DM 行为不变；其他控制分支没有扩大前缀识别 |
| A12 | 相同 messageId 重投、store.reset 抛错、正在运行或排队时 reset | 去重有效；失败不成功、不兜底执行；reset 不取消已有 Run，旧队列冻结身份及代次保护保持 |
| A13 | 两 Bot 同群点名其中一个，群与话题独立 | 只改变目标 Bot 原频道的 binding，其他 Bot/频道不变 |
| A14 | 群/话题中直接点名 + stop，空闲及正在执行各一组 | 空闲回执准确；执行中向原 invocation 请求取消，不增加新任务/Run、不改变 binding 代次 |
| A15 | `@Bot 帮我看一下/stop为啥不生效`、`@Bot /stop 为啥不生效`、`@Bot 解释 /reset 和 /new` | 精确完整匹配失败；原始正文进入一次普通 AgentRun，零 reset/取消调用 |

A3-A10、A12-A13 的实体、广播、兼容、失败和隔离矩阵同样适用于新增 `/stop`；取消调用数与 reset 调用数分别断言。A11 的 DM 回归同时包含 stop。

A1 的零入队通过观察内部 enqueue 调用（若测试可安全 spy）或验证零任务创建、零准备函数调用及零工作队列增量证明；不能仅以 Adapter 零调用推断未排队。A2 的执行计数以发送命令前快照为基准。

## 验证命令与记录

实现后执行，最终结果见[本轮验证记录](../../journal/shared/2026-11-01-18-mentioned-slash-commands.md)：

```bash
pnpm build
pnpm lint
pnpm typecheck
node --test test/manual/channel-mentioned-session-commands.test.mjs
node --test test/im-mention-trigger.test.js test/im-group-bot-isolation.test.js test/im-group-rules.test.js test/im-runtime.test.js test/im-session-store.test.js test/im-session-scheduling.test.js
git diff origin/main -- .github package.json scripts
```

若内部消息字段变更影响其他调用者，按规则扩大本地相关回归，必要时运行 `pnpm test`；不改变 CI 检查集合。使用 code-review 审查规格符合性和仓库规范，修复后重跑受影响检查。真实 IM 仅使用线上测试环境，记录源码 SHA/dirty、客户端、群与话题的实际提及形态、回执及零执行证据；缺环境记未执行，不以 fixture 结果替代。测试凭据仅运行时生成或由宿主注入，禁止写入仓库。

## 范围外

不修复客户端发送逻辑、服务端 UID 展开或投递协议；不新增免 @、名称配置、网络成员查询或持久化。本文不改变普通广播任务准入，不统一各渠道控制命令，不扩展到其他斜杠命令，不重新设计会话重置和取消。

## 可执行性与待审查事项

准备度自评 96/100：基线、输入形态、解析步骤、消息字段、兼容路径、失败行为和逐项验收已明确。该分数衡量规格可执行性，不表示实现正确或验证通过。

已认可：D1 混合广播禁止三命令；D2 仅接受连续前置原生实体及三个精确命令；D3 只为裸命令保留无实体兼容。用户特别确认语义文本不作为控制命令，见 A15。无新增待决策项。

最新实现验证基线为 `a5a32835882deab5e2364b559dd06bf1675c1335` 加当前未提交修改。构建、类型、lint、命名、25 项专项与 590 项相关回归通过；全仓知识 lint 在补齐 Issue 267 三份文档的 frontmatter 后通过，正文未改。上一轮知识检查失败已解除；真实 IM 未执行，详见本轮验证记录。
