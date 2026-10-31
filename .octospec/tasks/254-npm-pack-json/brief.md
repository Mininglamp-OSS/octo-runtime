---
type: Task
title: 兼容 npm pack 的数组与包名索引 JSON
description: 修复 npm 12 归档已生成却因元数据解析失败退出的问题，明确目标包选择和异常诊断。
tags: [packaging, testing]
---

# 目标

修复 [GitHub Issue 254](https://github.com/Mininglamp-OSS/octo-runtime/issues/254)，对应 Loop `ORT-80`。
`scripts/pack-release.mjs` 对 npm pack 的 JSON 输出使用 `[0]`，在 npm 12.2.1 返回包名索引对象时，归档虽然生成，脚本仍因访问 `undefined.bundled` 失败。
本次同时支持既有数组结构与对象结构，明确识别缺失、歧义和格式错误，恢复可验证的本地发行流程。

## 基线与当前状态

- 用户已认可分诊并要求“开始写spec”，随后要求从 main 更新最新代码。
- 规格基线为 `0c67c256e5196b6170971cc9759d1d4bbea03017`；用户在实现前再次要求更新 main，已快进至 `origin/main@a5a32835882deab5e2364b559dd06bf1675c1335`。
- 主机：`lvsijiaMacBook-Pro.local`；分支：`fix/254-npm-pack-json`。
- Worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-254`。
- 本机 Node `v24.22.2`、npm `12.2.1`；当前 pnpm `12.4.1`，仓库声明 `pnpm@11.19.0`。
- 用户已通过“更新最新main代码 然后 开始实现”认可本规格及 D1-D3。实现和功能/发行验证已完成；用户随后认可基线文档格式问题作为已知问题，要求按成功进入验证审查并创建 PR，已授权对应提交与推送。

## 产品意图与责任归属

| 检查项 | 本需求的边界 |
| --- | --- |
| 业务目标 | 发行维护者可以使用 npm 12 打包，且不会把错误元数据当成成功 |
| 决定权 | 根 package.json 决定预期包名；调用者通过既有参数决定发行版本 |
| 显式输入 | npm 命令 stdout、根清单 name、既有生产依赖集合和归档目录 |
| 合同内动作 | 解析、选择目标、验证消费字段、执行原依赖数量检查并输出归档路径 |
| 越界动作 | 猜测首个包、凭归档存在判成功、自动换 npm、发布包或改变 CI 范围 |
| 对其他产品的影响 | 无 SDK、Provider、Extra 或宿主运行合同变更；仅涉及发行工具 |

## 已确认约束

1. 支持数组及包名索引对象；显式选择根清单声明的包。
2. 缺失、歧义或格式错误必须明确失败。
3. 保留依赖完整性数量检查和成功时的归档路径输出。
4. 验证只在本地或显式手动执行，不扩大 GitHub CI。
5. 按用户要求使用更新后的 main 基线；提交、推送、创建 PR 分别遵循后续授权。

## 关键合同

以下具体规则已随本 brief 获用户认可。实现必须满足表中可观察行为，不能通过放宽断言绕过异常输入。

### 1. JSON 解析与目标选择

预期包名取根清单 `manifest.name`，不得写死包名或通过文件名推断身份。stdout 必须作为完整 JSON 解析；不截取花括号、不剥离日志或猜测兼容未知结构。允许 JSON 本身支持的首尾空白。

| 输入 | 选择与拒绝规则 |
| --- | --- |
| 数组 | 每项须为非 null、非数组对象，并具有非空字符串 name；按 name 精确匹配预期包名 |
| 数组无匹配 | 报预期包元数据缺失；即使数组只有一项也不兜底选择 |
| 数组多次匹配 | 报目标包元数据歧义；即使各条内容相同也拒绝 |
| 包名索引对象 | 每个自有条目的值须为非 null、非数组对象；以自有键精确匹配预期包名，不使用继承属性 |
| 对象内 name | 可省略；存在时须为非空字符串且与其键完全相同，冲突即为格式错误，不扫描 name 作为缺键兜底 |
| 对象缺目标键 | 报预期包元数据缺失；不得选首个键或唯一其他键 |
| 空数组或空对象 | 报预期包元数据缺失 |
| 非法 JSON、null、标量或不符合上述条目规则的容器 | 报解析或结构错误 |

其他包可以与目标包共存，不要求它们具备 filename 或 bundled，但必须满足上述条目身份规则。数组重复检查只针对目标包。对象重复文本键按标准 JSON.parse 语义处理，不另建 JSON 解析器检测重复文本键；对象身份冲突按上述规则拒绝。

### 2. 目标元数据校验

- `filename` 必须为非空字符串、无首尾空白且以 `.tgz` 结尾；不能含 `/`、`\\`、NUL、CR 或 LF，不能是 `.` 或 `..`。其用途仅为现有输出目录下的归档文件名，不允许相对路径或绝对路径。
- `bundled` 必须为数组，每项为非空且无首尾空白的字符串；不把缺失字段、null、字符串或对象转换成空数组。不重排、不去重、不补包名。
- 不要求 npm 的额外字段存在，未知字段不影响兼容性。
- 结构及目标字段校验完成后，继续执行原有 `result.bundled.length !== packages.size` 检查，保留现有失败信息“npm 未完整打包生产依赖，禁止发布”。本次不升级为集合、版本或文件逐项验证。
- 空 bundled 是合法字段结构，但当预期依赖数量非零时必须被原完整性检查拒绝。

### 3. 输出、失败与资源清理

- npm 子进程失败时保持现有失败传播，禁止尝试从 stdout 解析成功结果覆盖原始命令错误。
- 解析或元数据错误必须是带上下文的 Error，说明来自 `npm pack --json`、预期包名及具体原因或字段；不得以未定义属性访问的 TypeError 收尾，不要求固定完整错误文案。
- 仅在元数据校验及原数量检查均通过后，执行既有 `console.log(join(output, result.filename))`；stdout 保持现有归档路径行，不额外输出成功 JSON 或解释文字。
- 失败时返回非零，不能因为归档已经存在而宣布成功；本次不删除已生成的输出归档。临时物料目录继续由既有 finally 清理。
- npm 入口选择、版本参数、临时清单、依赖收集、DSH bundling、版本注入及归档目录保持既有合同。

## 实施范围

- 生产修改限于 `scripts/pack-release.mjs` 的结果处理；如为测试需要，可提取一个无副作用的内部解析 helper 至 `scripts/`，不新增公共包 API 或通用框架。
- 新增显式手动专项 `test/manual/npm-pack-json.test.mjs`，不得由 package.json、默认测试通配符或既有 CI 步骤自动调用。
- 维护本任务 brief、context、后续验证及审查记录。实现阶段按开发工作流运行 code-review，处理发现的问题。

## 范围外

- npm 发布、Release 上传、全局替换本机 Runtime、合并 PR。
- 修改 npm 或 pnpm 版本策略，修复其他发行脚本中未确认的类似解析。
- 新增或调整 workflow、job、矩阵、自动触发、必需状态及 CI Gate 依赖；通过默认脚本或测试开关变相增加专项 CI。
- 把本修复宣称为全平台发行认证；当前真实环境是 macOS。

## 验收矩阵

下列条目为验收要求，实际执行结果单独记录于 validation.md，不将计划视为通过。

| 编号 | 场景 | 可观察的通过条件 |
| --- | --- | --- |
| A1 | 合法数组，含多个包且目标不在首项 | 精确选择目标，返回其 filename 和 bundled |
| A2 | 合法对象，含其他包；目标有或无 name | 均精确选择目标，自有键为身份依据 |
| A3 | 首尾空白、额外字段 | 合法 JSON 正常解析，额外字段不影响结果 |
| A4 | 空数组、空对象、只有其他包、对象缺键但值的 name 指向目标 | 明确缺失或身份冲突，禁止首项兜底 |
| A5 | 数组两个目标，包含同内容重复 | 明确歧义 |
| A6 | 非法 JSON、null、数字、字符串、错误条目类型、数组缺 name、对象 name 冲突 | 明确解析或结构错误，包含预期包上下文 |
| A7 | filename 缺失、空、非字符串、路径、换行或非 tgz；bundled 缺失、非数组或含非法元素 | 明确指出非法字段，成功路径不输出 |
| A8 | 合法结构但 bundled 数量不足，含空数组 | 原数量检查继续阻止成功；无需伪造完整依赖构建即可验证 |
| A9 | 完整脚本使用真实 npm 12.2.1 | 打包退出 0，stdout 末行指向存在的 tgz；归档包含声明的 bundled 包，并保留当前构建来源 |
| A10 | 既有数组结构兼容 | 手动 fixture 覆盖 A1/A3；标记为数组合同回归，不冒充旧 npm 的端到端实测 |
| A11 | 真实归档的现有发行验收 | verify-release 全部适用检查通过，记录离线安装、CLI version/help、构建 SHA/dirty 与其他脚本检查；失败或未运行明确记录 |
| A12 | CI 范围与代码检查 | 相对基线 workflow diff 为空；新增专项没有默认入口；适用检查通过或有明确失败证据 |

### 本地执行顺序

1. 确认实际 pnpm 为 `11.19.0`；可用 `corepack pnpm --version` 检查仓库声明版本，不改全局版本。后续 `pnpm` 命令均通过已确认的声明版本入口执行。
2. `pnpm install --frozen-lockfile --ignore-scripts`，然后 `pnpm build`。
3. `node --test test/manual/npm-pack-json.test.mjs`，覆盖 A1-A8/A10，并用脚本级 harness 或实际脚本调用检查失败无成功路径输出。helper 测试不能单独证明脚本已正确接入。
4. `node --test test/release-manifest.test.js`，确认已有清单和参数合同。
5. 确认 `npm --version` 为 `12.2.1`，且脚本实际调用的 npm CLI 对应该版本；执行 `node scripts/pack-release.mjs`，记录并检查 stdout 末行归档路径。
6. `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz --expected-commit 0c67c256e5196b6170971cc9759d1d4bbea03017`。若实现前基线或提交发生变化，参数替换为实际构建来源；dirty 构建不传 require-clean，明确记录 dirty。
7. 按修改范围执行 `pnpm lint` 与 `pnpm typecheck`；规格及记录执行 `python3 .octospec/scripts/lint.py`。如 Python 缺 PyYAML，可用 `uv run --with pyyaml python .octospec/scripts/lint.py`。
8. `git diff origin/main -- .github/workflows`，核对 package.json 默认入口与实际 CI 检查列表，确认没有新增专项自动执行。验证报告不得包含凭据。

必要能力缺失或真实打包/发行验收失败时，不以 fixture 通过代替真实通过；按工作流记录失败并等待用户决定。

## 审查事项与可执行性

- 已确认决定见上文“已确认约束”，无需重新选择任务范围。
- 已认可 D1：数组要求显式 name，对象允许省略 name，但禁止键/name 冲突。
- 已认可 D2：采用上述最小 filename 与 bundled 字段校验，保留原数量检查，不增加集合完整性策略。
- 已认可 D3：数组兼容以确定性 fixture 验证；真实端到端验收使用 npm 12.2.1，本次不增加旧 npm 安装矩阵。
- 无额外业务输入缺口；用户要求修改时增量优化。当前已授权实现与本地验证。
- 可执行性自评 `96/100`：目标/责任边界 20/20，选择与字段合同 29/30，失败与兼容边界 19/20，验收映射 19/20，环境及授权 9/10。剩余不确定性是本机声明 pnpm 入口可用性及真实发行检查结果，须实现阶段实测。

## 依据

- [打包脚本](../../../scripts/pack-release.mjs)、[发行验收脚本](../../../scripts/verify-release.mjs)、[现有发行清单测试](../../../test/release-manifest.test.js)。
- [基础架构](../../rules/architecture.md)、[开发与验证规则](../../rules/engineering.md)、[阅读记录](context.yaml)。
- Loop 分诊评论 `fe9c35c1-acab-4820-b5c6-4347b280f8be`；规格执行 `ORT-80-spec-20261031T180132Z`。
