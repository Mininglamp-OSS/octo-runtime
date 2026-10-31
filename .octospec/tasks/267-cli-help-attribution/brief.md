---
type: Task
title: Issue 267 CLI 根帮助署名规格
description: 明确 CLI 根帮助中的公司署名、开源仓库入口及保持既有行为的验收要求。
tags: [cli, help, attribution]
---

# #267：根帮助展示公司署名与开源仓库

## 状态与来源

- 状态：用户以“开始实施”认可规格；实现及本地验证已完成，结果见 [validation.md](validation.md)。
- Loop：ORT-85；GitHub：https://github.com/Mininglamp-OSS/octo-runtime/issues/267。
- 依据：原始需求、分诊评论 66d5b8b2-89c7-4735-845b-da5459da3ea5，以及用户“开始spec”请求。
- 基线：`0bcd89c528018ffd508ca8099c8ac9c6b88de35d`。
- 分支：`feat/267-cli-help-attribution`。
- worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-267`。

## 目标与责任

用户第一次查看 Runtime CLI 帮助时，应能识别项目所属公司，并直接复制官方仓库地址进入源码、文档、反馈和贡献入口。此需求属于 Runtime CLI 的展示责任，决定权属于该 CLI 的产品维护者，不改变通用 SDK 或其他宿主的产品策略。

显式输入为现有帮助请求。当前缺口由 CLI 根描述产生，在 `apps/cli/src/command-tree.ts` 修复；不通过 Adapter、Channel 或 SDK 补充信息。不增加默认动作、降级或网络请求，不读取凭据。服务拓扑、资源所有权、公共接口和会话行为均不涉及本任务。

## 已有需求与规格选择

已由需求确定：公司名称使用 README 版权中的 `Mininglamp Technology`；仓库使用 `https://github.com/Mininglamp-OSS/octo-runtime`；链接必须有开源项目含义的标签、以纯文本显示；保持现有帮助、解析与退出行为；不得扩大 GitHub CI。

本规格选择以下精确展示合同，用户已通过“开始实施”确认：

```text
<现有 cliHelpHeader：名称、版本、commit、build>

Manage the local Octo Agent runtime and independent services.

Octo Runtime by Mininglamp Technology
Open source on GitHub: https://github.com/Mininglamp-OSS/octo-runtime

Usage:
  <现有 usage>
```

- 保留现有根描述，随后空一行显示两行新增信息，再按现有格式进入 `Usage`。
- 每行新增信息在一次根帮助中仅出现一次；URL 是完整连续字符串，不插入 ANSI、OSC 超链接或换行。终端自身的视觉折行不属于 CLI 插入换行。
- `--help` 与 `-h` 必须一致；现有无参数和 `help` 根帮助入口沿用同一结果。
- 无需联网或启用颜色即可读取新增信息；不引入依赖或运行时远端查询。
- 保留版本头内容与位置，`version`、`--version`、`-v` 不附带新增署名或仓库信息。

## 实现范围

1. 在 `apps/cli/src/command-tree.ts` 的根命令 description 中组织上述文案，复用现有 `formatHelp` 与 Commander 路径。避免为纯文案引入新抽象。
2. 在 `test/cli-help.test.js` 既有帮助回归中补充精确文案、URL 完整性及出现次数断言，继续使用其现有入口等价、退出码和不导入业务模块的检查。
3. 保存本任务的规格、规则读取记录及后续验证证据。

不修改子命令描述、排序、示例、Flags、Global Flags、解析逻辑、manifest 读取或模块加载策略，不添加公司信息的开关。无发布、安装、自启或 SDK 行为变更。无需修改 README、依赖、package scripts 或 GitHub workflow。

## 验收标准

| ID | 场景 | 必须满足 |
| --- | --- | --- |
| AC1 | 根 `--help` 与 `-h` | 退出码均为 0，stderr 为空；同一构建、相同 Home/manifest 的 stdout 完全一致，且包含两行精确英文文案，各一次。 |
| AC2 | 普通文本输出 | 设置 `NO_COLOR=1`、`TERM=dumb` 并捕获 stdout，官方 URL 连续完整，署名与链接行不含 ESC 控制字符；可直接复制 URL。 |
| AC3 | 帮助可扫描性 | 保留版本、commit、build 和原根描述；新增两行位于根描述之后与 Usage 之前；现有 Examples、Available Commands、Flags 等区域及排序维持现有合同。 |
| AC4 | 兼容性 | `help` 和无参数入口继续等价于根帮助；现有版本、子命令帮助、非法参数和模块隔离相关回归通过，解析或错误退出行为不因文案改变。 |
| AC5 | 离线能力 | 新增内容完全来自静态字符串，不引入网络或认证依赖；现有帮助测试保持无需导入业务模块。记录静态核对与实际本地输出，不能将此表述为已完成系统断网测试。 |
| AC6 | 交付边界 | 相对基线的 `.github/workflows` diff 为空；无脚本、默认测试开关、CI gate 或必需检查范围变化。专项检查仅本地显式执行。 |

## 本地验证计划

以下是实施后的计划，本规格阶段不宣称这些命令通过。

1. 需要时在本 worktree 运行 `pnpm install --frozen-lockfile`；不接受为完成安装而改变锁文件或依赖版本。运行 `pnpm typecheck`（含构建）、`pnpm lint`，再运行 `node --test test/cli-help.test.js`。本任务不跨包修改合同，不要求真实 Provider 或服务联调。
2. 使用独立临时 Runtime Home，分别执行 `NO_COLOR=1 TERM=dumb node apps/cli/dist/index.js --home <临时目录> --help` 与对应 `-h`；捕获 stdout、stderr 和退出码，比较输出，检查精确文案、出现次数及 URL 连续性，并人工检查布局。两次调用使用同一构建与环境，不启动服务。
3. 检查既有帮助测试实际覆盖的子命令、非法参数、版本和模块加载用例；若 AC4 有未覆盖行为，补充最小针对性回归或显式本地验证，记录命令与预期退出结果。
4. 执行 `git diff --check`、`git diff <基线> -- .github/workflows`，核对所有变更文件与现有检查列表，确认没有间接扩大 CI。实现阶段按 code-review 流程检查规格与仓库约定，修复有效问题。
5. 验证证据记录代码 SHA/dirty、平台、命令、输出摘录、逐项结果以及未执行原因；本地通过与托管 CI 分开说明。不得以旧版本结果代替本次结果。

## 待审查决策

| 项目 | 本规格建议 | 状态 |
| --- | --- | --- |
| 最终英文文案 | 使用上述两行，与 issue 示例和 README 名称一致。 | 用户已认可 |
| 展示位置 | 放在原根描述之后、Usage 之前；版本头保持。 | 用户已认可 |

无阻塞的外部输入或技术待决项。以上有可直接实施的默认选择，用户认可规格后即可执行；如反馈调整，只增量修改本 brief。

可执行性自评：97/100。文案、位置、文件范围、兼容边界和逐项验收均已确定；剩余 3 分为文案及位置尚待用户规格审查，不代表实现质量或测试通过率。

## 授权与后续

规格阶段仅编写规格并上传 Loop 附件。用户随后授权开始实施，当前完成实现和本地验证；提交、推送或创建 PR 仍需相应授权。若后续获准提交或创建 GitHub PR，按用户开源项目约定使用英文，保留 Git 作者配置，并为 Codex 贡献添加规定 trailer。
