---
type: Validation
title: Issue 309：双包发行与独立客户端验证
description: 记录最终本地归档、包外 npm/pnpm、基线互操作、发布恢复、现有回归和未验环境。
tags: [testing, packaging, release, protocol, lifecycle]
---

# 验证记录

2026-11-05，按[确认设计](design.md)完成本地实现。worktree `octo-runtime-issue-309-runtime-client`，分支 `codex/issue-309-runtime-client`；基线和 HEAD 均为 `de3ff37a86ee3cb8f6ab66148ceca817f6ae5240`，工作树 dirty，尚无本次提交。测试包版本 `0.0.309` 仅用于本地，不表示已发布。构建元数据为相同 commit、`dirty: true`、`buildTime: 2026-11-05T02:28:58.985Z`。

环境：macOS 26.6.2 / Darwin arm64，Node 24.22.2、pnpm 11.19.0、npm 12.2.1。所有安装和模拟发布均在独占临时目录，不安装系统服务、不执行真实 npm/GitHub 写入，不改变用户 Runtime Home。

## 最终发行物

两包来自一次 workspace 构建，通过 `node scripts/pack-release.mjs --version 0.0.309` 产出；最后仅重新构建 client 以同步入口注释后再打包。归档位于仓库 `dist/release/`（忽略的本地产物）。解包字节统计为 tar 内全部文件内容之和，不包含文件系统占用开销。

| 包 | 归档 | 压缩字节 | 解包字节 | 文件数 | 内置依赖包数 |
| --- | --- | --- | --- | --- | --- |
| runtime | `mininglamp-oss-octo-runtime-0.0.309.tgz` | 1601522 | 6670792 | 1234 | 68 |
| client | `mininglamp-oss-octo-runtime-client-0.0.309.tgz` | 121415 | 962166 | 81 | 1 |

runtime 完整 SHA-512：`sha512-P2YsFEQVpbP5eGvxmOY+x19swq39B3Px//h8PwAYtdyIu1aGVSBjpAUlgeiBPouoLasy9IHq/mDkf7blHhpxBw==`。

client 完整 SHA-512：`sha512-fdMZosDHeT/G/1XDR7NuJZs8lUHghcYi+5SgYPLp2/iQRP0M5+ULA1B5Dccxv5lxBjGlx3JHaA15o/2H+3sf6g==`。

client 唯一运行依赖为内置 `@mininglamp-oss/octo-runtime-protocol@0.0.309`；没有 CLI、Kernel server、Core、Host、Adapter、Extra，全部传递 JS/d.ts 无这些依赖。runtime 将同版本 client 和 protocol 物化到自身 node_modules，内部只解析一个客户端/协议实例。全部 client exports 目标存在；四份 schema 与唯一源码原件字节一致；两包构建元数据完全一致；发行 manifest 无 workspace/link/file。安装产物无工作区软链。

这些数字只反映当前本地归档大小，不声称启动、吞吐、内存或真实产品性能提升。

## 实际命令

下表最终命令退出码均为 0；初轮失败及修复另记，不混入最终通过数。

| 命令 | 结果 |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | lockfile 冻结安装通过；lock 仅增加三个 importer 的 client 关系，没有第三方版本升级 |
| `pnpm typecheck` | 完整 build 和根类型检查通过；随后 client 注释同步后单独 build 通过 |
| `pnpm lint`、`pnpm lint:names`、`pnpm format:check` | 全库通过，命名 0 findings |
| `pnpm test:suites` | WebUI 35/35；Node 2400 项中 2334 通过、66 按原有条件跳过、0 失败 |
| `pnpm docs:check` | 35 对双语页、71 Markdown、20 JSON 示例、14 Mermaid、12 Context 示例；4 项运行验证通过 |
| `node scripts/check-developer-docs.mjs --scope current` | 163 文档、2117 链接、112 fragment，0 errors；127 外链按既有规则跳过 |
| `pnpm native:check` | 3 组生成输入及文件 hash 一致；未改 schema 或生成文件 |
| `uv run --no-project --with pyyaml python .octospec/scripts/lint.py`、`git diff --check` | 657 个 OKF 单元、20 条规则、3990 个本地文件链接及空白检查通过；临时 PyYAML 环境未修改仓库依赖 |
| `node scripts/pack-release.mjs --version 0.0.309` | 同次产出上述两个同版本 tgz |
| `node --test test/manual/runtime-client-309.test.mjs` | 最终 tgz 的 6 项全通过 |
| `node --test test/manual/runtime-client-release-309.test.mjs` | 19 项全通过；包括实际 workflow run 脚本的本地命令夹具 |
| `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.309.tgz --expected-commit de3ff37a86ee3cb8f6ab66148ceca817f6ae5240` | 单 runtime tgz 空缓存全局离线安装、公开类型、内置 Extra/WebUI、原生 Kernel、独立 Extra、Host store、状态 sink、恢复探针、CLI 和卸载保留 Home 全通过 |
| `pnpm run test:global-extras dist/release/mininglamp-oss-octo-runtime-0.0.309.tgz` | npm/pnpm v11 实际全局安装、独立分组、命令/配置/ESM initializer、混合来源、后续安装/移除均通过 |

手动 client 验证在 npm/pnpm 各自仓外工程、空缓存/空 store、禁用 NODE_PATH 下执行：先仅安装 client，一个 tgz 即可离线安装；随后加 full，一个 runtime tgz 即可安装。两种情况下执行 strict=true、skipLibCheck=false 的外部 TypeScript；同时安装后检查跨发行物双向结构类型、schema/validator 行为一致，以及发行物内部的 attachKernel/KernelError/validator 身份。跨发行物 KernelError 确认不是同一个类，符合用户确认的发行模型。

基线兼容专项通过 `git archive de3ff37a86ee3cb8f6ab66148ceca817f6ae5240` 提取原 protocol、Adapter SDK、Core 和 Kernel，按原 tsconfig 逐包编译。仅编译工具、Node 类型及第三方 import-meta-resolve 借用现有工具链，服务端未使用当前实现。独立 client 从最终 tgz 空缓存安装后连接该基线服务，status/list/invoke、真实事件及关闭后服务仍可用均通过。基线服务完整 close 后才删除所属临时目录。

## 验收映射

| ID | 本地结果与证据 |
| --- | --- |
| A01-A04 | 通过：最终归档闭包、exports、schema、构建来源、npm/pnpm 外部安装、严格类型和身份边界 |
| A05-A06 | 通过本地 fake Provider：包外原生服务、service.client、standalone attach 关闭隔离；既有 public SDK/Host lifecycle/Extra direct 与 IPC 回归通过 |
| A07-A08 | 通过：唯一实现迁移；既有 canonical/native、问答/审批、取消/abort、尾流、未知 ACK/控制、原游标和实例恢复回归均通过 |
| A09 | 通过：未知/缺失 IPC 版本仅发 status，不发 invoke；拆包前固定基线 Kernel 互操作通过 |
| A10-A11 | 通过可控夹具：两包均缺、任一存在、两包存在只补缺包；两个预检中任一冲突/鉴权失败则无上传；上传 ACK 丢失后先确认已发字节；构建时间能由任一包恢复，双来源时间冲突失败；原有延迟可读和有界超时测试通过 |
| A12-A13 | 通过可控夹具：Release 只补缺失附件，已有附件必须 cmp 相等；完整双 npm/双附件各自核对 integrity；三 latest 中断恢复、不回退及 dry-run 零写入；历史单包不会被当作新双包完整记录 |
| A14 | macOS npm/pnpm 离线和全局真实安装通过；Windows 真机 **not run**，现有平台模拟测试不作真机证明 |
| A15 | 本地现有完整检查通过；生成来源未变；CI 结构及默认 scripts 比对通过，远端实际 checks **not run**（未提交/推送） |
| A16 | 归档体积/依赖/来源已记录；平台和真实集成边界如下 |

## CI 范围

以 YAML 结构对比固定基线与当前所有修改的 workflow：触发器、顶层权限、job 集合、job 所有非 steps 字段（包含矩阵、needs、if、并发）、step 数量、每步 actions uses 均未变。ci.yml 的 check/Windows/Gate 仍分别为 15/23/1 步；npm-publish 的 validate/verify/publish 为 5/0/6 步；release-publish 的 npm/Release/latest 为 0/2/3 步。

仅修改现有构建归档/上传材料、双包预检与发布、部分附件恢复和 latest 对象；根 package.json scripts 完全相同。原有测试只调整 private/单包路径旧断言与 UTF-8 合成 status 的合法字段，没有增加测试个数。新增 6+19 专项均在 `test/manual/`，不被 `test/*.test.js` 或 CI 默认 selector 选择。无新增 workflow/job/matrix/trigger/required status/needs，也无新增专项 CI 步骤。尚未推送，不把本地比对记为远端 CI 已通过。

## 失败处置与边界

- 初始草稿缺 PathLimits 导出导致编译失败，已修复；全构建/类型和端点旧用例通过。
- 曾把 lint 与带 clean 的 build 同时运行，临时缺失 dist 导致大量类型解析错误；改在完整构建后执行，全 lint 通过，没有放宽规则。
- 新 status 校验暴露两个 UTF-8 接收夹具返回不合法 status，已补足原协议字段，保留大字符拆包/字节上限/后续连接恢复断言；全套通过。
- 旧发行测试硬编码所有 workspace private 及单归档路径，已按双包合同调整原断言。双语新示例注释同步后通过现有 docs 检查。
- global Extra 旧验收脚本只取 npm pack JSON[0]，在 npm 12 包名索引输出下失败；复用仓库既有 parseNpmPackResult，原场景通过，没有增加场景或 CI。
- 手动夹具的身份重复、模块路径、workflow run 区块截取及基线 after 清理顺序问题已修正；最终手动 25 项均通过。Review 发现的三项规范问题均修复，见[审查记录](review.md)。

Node 26、Linux/Windows 原生安装及 named pipe 真机、Electron 打包、真实 Provider turn、官方 npm 新包权限/provenance 和真实 npm/GitHub Release 均 **not run**。本次移动既有客户端实现，真实 Provider/Electron 不由 Node fake Provider 结果推定；没有通过真实 publish 试探权限。原生 Go/Python 运行测试未重跑，本轮仅明确执行 native 生成校验。所有手动临时服务均完整关闭后清理，未改变用户 Home。

以上为提交前取得的本地证据。两轴审查完成后，用户追加授权英文 commit/push 并向 main 创建 PR；提交前重新 fetch 确认 origin/main 仍为相同基线，并复核知识检查和 workflow 范围。合并、打 tag 和正式发行须另按授权执行。
