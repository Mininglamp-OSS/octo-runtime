---
type: Journal
title: Issue 163 HTTP-date Retry-After 修复与评审
description: 独立 worktree 的基线复现、共享解析、本地 HTTP 回归及 verified-review 处置。
tags: [channel, delivery, testing]
---

# 基线与结果

- 需求：[Issue #163](https://github.com/Mininglamp-OSS/octo-runtime/issues/163)；合同见[brief](../../tasks/163-http-date-retry-after/brief.md)，实际规则见[context](../../tasks/163-http-date-retry-after/context.yaml)。
- 从 origin/main 建立独立 worktree，基线为 `0ca12a03a055ccb766e6126716c51bb6cc6efe1c`，分支 `fix/163-http-date-retry-after`。基线干净；验证时为该 SHA 加本任务未提交修改。首轮修复验收时没有提交、推送、PR 或部署，后续授权见交付记录。
- 环境：macOS 26.6.2，Darwin 25.6.0 arm64，Node.js v24.19.0，pnpm 11.19.0。
- REST 与鉴权/注册共用 `transport/retry-after.ts`。未来日期按本机剩余时间等待；正数 header 优先于 body，不裁剪为默认短等待。零值兜底、响应 body 取消、错误分类、重试次数及等待预算保持既有合同。
- 共享后鉴权/注册也按秒数理解小数形式；REST 原本支持小数。连接的零值仍交给外层 5/10/15 秒退避，不新增连接策略。

# 基线失败证据

先构建基线源码，在新增手动专项上执行：

```sh
node --test --test-name-pattern='future HTTP-date|real HTTP message retry|real HTTP over-budget' test/manual/gateway-retry-after.test.mjs
```

退出码 1，3 项均失败，含义是缺陷被复现：

- 固定当前时间后，未来日期的剩余时间应为 5750 ms，实际 `retryAfterMs=1000`。
- 真实 loopback HTTP 经 `sendMessage`、`postJson`、错误转换和退避后发出第二次请求，服务器观测到该请求比要求时刻早 1215 ms。
- 服务端日期约在 15 秒后，基线仍按 1000 ms 重试；最终错误没有保留大于 10000 ms 的提示。

# Verified Review

首轮范围为工作区全部改动及新增文件，逐文件检查代码、测试、brief/context、规则、索引、日志和本记录；共 10 个文件、440 行新增/删除（含新增文件全文，不含后续交付记录）。没有跳过实现文件、配置文件或测试文件，没有评审构建产物和依赖目录。采用 verified-review 的阅读及运行两条路径。

评审计划与实际核对：

1. 共享解析：区分数字、日期、空值、负数和非有限值；确认未来日期不被 body 或默认值覆盖。
2. REST：保持两次重试、10000 ms 提示上限、15000 ms 累计退避上限及只向上增加的抖动；确认不因投递失败重新执行模型。
3. 连接调用方：读取提示后仍取消响应正文，AUTH/REGISTER 错误分类、脱敏和非有限值归零保持原合同。
4. 运行验证：真实 HTTP 的最早到达时间、client_msg_no 保持、连续 429、取消和超预算请求数；累计预算另用受控时钟验证。
5. CI：核对 workflow、根 package scripts、lockfile 和默认测试发现范围。

## 已处理发现

**medium / bug / reproduced**：初版共享解析在有限秒数乘 1000 溢出后返回 undefined，REST 会退回 1000 ms。旧实现保留 Infinity，并通过既有预算检查拒绝重试；初版产生了数值兼容回归。

输入为十进制字符串 `"1" + "0".repeat(308)`。直接比较基线与初版得到 `Infinity` 与 `1000`。再执行以下真实 HTTP 回归，初版退出码 1，记录三次请求且错误提示仍为 1000 ms：

```sh
node --test --test-name-pattern='numeric conversion overflow' test/manual/gateway-retry-after.test.mjs
```

最终[共享解析](../../../packages/octo-runtime-extra-channel-gateway/src/transport/retry-after.ts)保留换算溢出的 Infinity，REST 按超预算停止；body 秒数解析及连接错误归零继续保持基线行为。最终同一专项通过，只有一次 HTTP 请求。

第二遍逐文件检查和运行回归后，没有遗留 medium 及以上发现。

# 最终验证

| 检查 | 结果与边界 |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | PASS；独立安装，lockfile 无变化 |
| `pnpm typecheck` | PASS；包括全 workspace 构建和根类型检查。WebUI 构建仍有已有 use-client/chunk 大小提示 |
| `pnpm lint` | PASS；review 修正后另对三个改动 TS 文件执行 ESLint，PASS |
| `pnpm format:check` | PASS |
| `pnpm lint:names` | PASS；无 findings |
| 下方组合测试命令 | PASS，186 项，0 失败、0 跳过；其中本任务手动专项 27 项，既有回归 159 项 |
| `uv run --with pyyaml python .octospec/scripts/lint.py` | PASS；系统 python3 缺少 PyYAML，改用 uv 的隔离依赖运行，未修改仓库依赖 |
| `git diff --check` | PASS |
| `git diff --exit-code origin/main -- .github/workflows package.json pnpm-lock.yaml` | PASS，无 diff |

```sh
node --test test/manual/gateway-retry-after.test.mjs test/im-connection-state-machine.test.js test/im-delivery-ack.test.js test/im-context-gap-policy.test.js test/im-task-retry.test.js
```

专项覆盖未来/过去日期、整数/小数秒、空值、无效/负数/溢出输入、header/body/default 优先级。真实 HTTP 经过消息发送路径，确认日期等待后到达、数字秒最小等待、相同 client_msg_no、超过 10 秒不重试、最多三次请求、显式关闭重试及退避取消。累计预算使用 fake fetch 和确定时钟：第一次等待 8750 ms，第二次需要 9000 ms，总和超过 15000 ms，因此不发第三次请求，不缩短等待。所有测试拥有的 HTTP server/socket 在清理钩子中关闭。

# CI 与未测边界

- 手动专项位于 `test/manual/gateway-retry-after.test.mjs`，没有接入 npm scripts 或任何 workflow。实际 `test/*.test.js` 发现 191 个既有根测试文件，不包含该专项。
- 既有 CI 仍为 Linux/macOS × Node 24/26、Windows Node 24/26 及原 CI Gate；其他 workflow 不变。本次没有执行托管 CI，也没有新增状态、矩阵、触发条件或 Gate 依赖。
- 没有执行全部 `pnpm test:suites`、真实 IM/模型联调、Windows/Linux 真机或部署验证。此改动的网络证据限于本地真实 HTTP；日期单元验证使用固定本机时钟，未验证分布式时钟偏差。
- 原始终端结果保留于本聊天；可重复运行的 fixture 和断言保留于手动专项。不能用本地返回成功推断远端服务部署情况或客户端呈现情况。

# 2026-10-28 后续交付

- 用户明确授权 review 通过后提交 PR。再次 fetch origin/main 后，目标仍为上述基线，无需同步冲突；产品代码和测试与已通过 review 的版本一致。
- 复核共享解析、REST/连接调用方及专项断言，无遗留 medium 及以上问题。本轮仅更新授权和交付状态记录，沿用未变化代码已通过的 186 项测试及构建检查，不重复运行。
- 提交前再次核对 workflow、package scripts、lockfile 无 diff，默认专项发现范围不变。英文 Conventional Commit 与 PR 关联 #163；保持配置的 Git 作者，提交包含一次 Codex co-author trailer。
- 本次交付只创建 PR，不执行合并或部署。托管 CI 以 PR 实际状态为准，首轮本地证据不代表远端检查已经通过。

# PR #226 同步最新 main 与冲突处理

- PR 创建期间 main 合入 #225，推进至 `27c5cde4b7f46a986c1c9a91d0f06d24f428e8da`；用户随后要求处理冲突。将 origin/main 合入本任务分支，唯一文本冲突为 index 当前任务区的并列新增记录，已完整保留 Issue 163 和 Issue 150/171 两条入口。
- 逐项复核自动合并结果：本任务的 Retry-After 实现和专项未变化，上游容量准入实现及其测试与 origin/main 完全一致；channel 规则同时保留双方新增合同。没有遗留冲突标记或未解决路径。
- 同步后重新执行 `pnpm typecheck`（含 workspace 构建）、`pnpm lint`、`pnpm format:check`、Octospec lint 及 diff 空白检查，均 PASS。构建仅有前述已有 WebUI 提示。
- 下方组合回归 PASS：190 项，0 失败、0 跳过，包含 27 项手动 Retry-After 专项及 163 项既有回归；本轮加入容量准入测试，覆盖与最新 main 的集成。
- 再次核对相对 origin/main 的 workflow、package scripts、lockfile 无 diff，没有扩展 CI 范围。更新现有 PR #226，不合并 PR 或部署；远端 CI 以新提交实际检查结果为准。

```sh
node --test test/manual/gateway-retry-after.test.mjs test/im-connection-state-machine.test.js test/im-delivery-ack.test.js test/im-context-gap-policy.test.js test/im-task-retry.test.js test/im-admission-capacity.test.js
```

# Jerry-Xin review：asctime 时区修正

- 来源为 [PR review](https://github.com/Mininglamp-OSS/octo-runtime/pull/226#pullrequestreview-5681722244) 的 P2 blocker。依据 [RFC 9110 §5.6.7](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7)，三种 HTTP-date 均代表 UTC，asctime 也不例外。
- 基线 `a448b6aa530cf8a11e16bb7db72a88a8e727e2ad`；macOS arm64、Node v24.19.0、pnpm 11.19.0。新增测试时产品源码及 dist 尚未修改，测试工作树为 dirty。下方命令退出码 1：两项均失败，固定时钟应返回 5750 ms，REST 实际为 1000 ms；真实 HTTP 第二次请求提前 902 ms。此为 reproduced，不是仅根据差异推测。

```sh
env TZ=Asia/Shanghai node --test --test-name-pattern='^(HTTP-date forms use UTC|real HTTP asctime retry respects UTC)$' test/manual/gateway-retry-after.test.mjs
```

## 本轮 verified-review 计划

1. 核查共享解析仅对 asctime 补 GMT，保留带 GMT 日期、数字秒/小数秒、溢出和无效提示的兼容行为；同时跟踪 REST 与 AUTH/REGISTER 调用方。
2. 核查非 UTC 子进程的筛选不会递归启动驱动测试，子进程有超时且等待退出；HTTP fixture 关闭本轮拥有的 server/socket，真实重试时间用 UTC 目标断言。
3. 复跑本轮失败命令及独立时区驱动，运行相关既有回归和静态检查；逐文件核对任务、合同、日志及实际结果，检查默认测试 glob、workflow、scripts 和 lockfile 未扩大 CI。

修正仅在共享解析中识别 RFC asctime 形状并补 GMT。专项在独立子进程固定 Asia/Shanghai、America/Los_Angeles，覆盖三种日期格式、空格补齐的单数字日期、过去日期及真实 HTTP 重试。

## 修正后的验证与复核

- 原失败命令重新执行退出码 0，两项通过；固定时钟返回 5750 ms，真实 HTTP 不早于 UTC 目标时间。独立时区驱动也通过，两个子进程各实际执行解析与 HTTP 两项测试。
- 首次驱动测试发现子进程继承 `NODE_TEST_CONTEXT` 会跳过嵌套运行；输出包含测试名称的断言将此情况判为失败。已移除子进程的该标记，等待子进程退出并保留有限超时，两个时区均实际执行。未把空跑或跳过算作通过。
- 同步最新 `origin/main@5cc600e`（#228），合并提交为 `c4b10d9`，index 自动合并保留所有任务；上游 DSH 代码、测试、package 和 lockfile 与 origin/main 完全一致。离线 frozen-lockfile 安装成功，未改写 lockfile。
- 同步后执行 `pnpm typecheck`（含全 workspace 构建）、`pnpm lint`、`pnpm lint:names`、`pnpm format:check`，全部 PASS。与构建清理 dist 同时运行的首轮 lint 因类型产物暂缺而失败；构建完成后顺序独立运行 lint 通过，没有修改无关产品代码。构建提示仍仅为已有 WebUI 提示。
- 六文件组合回归最终 PASS：195 项，0 失败、0 跳过；其中手动专项 32 项（包含时区驱动及两个时区子测试），既有回归 163 项。驱动另外执行的两个子进程各两项检查不重复计入这 195 项。覆盖 REST、AUTH/REGISTER、数字兼容、预算、取消和真实 HTTP。
- 本轮逐文件复核共享解析、手动测试、规则、brief、context、journal、log，并复查两个调用方和退避逻辑；没有遗留 medium 及以上发现。用户指出的 P2 已由同一失败用例先失败后通过确认修复。
- Octospec lint 与 diff 空白检查 PASS。相对 origin/main 的 workflow、package scripts、lockfile 无 diff，默认测试入口未变化；专项继续只显式执行。未运行完整仓库测试、远端 IM/模型、原生 Windows/Linux 或部署验证，尚待 Jerry-Xin 远端复审。
