# Linux systemd 路径指令修复与原生验证

工作于 2026-10-22 开始，最终复验于 2026-10-23（Asia/Shanghai）完成。

## 需求与范围

- Issue #113；独立分支 `fix/systemd-directive-paths`，基线 `fe19d350431534da4ed3a76f3466add4ced86d81`。
- 修复 WorkingDirectory 及已确认同样错误的 StandardOutput/StandardError append 值；不改 argv/env 引号、macOS/Windows 或前台 run。
- 业务目标、职责与验收见 [任务简报](../../tasks/systemd-directive-paths/brief.md)；可复用合同已回写 [生命周期规则](../../rules/runtime-lifecycle.md)。

## 原因与结果

systemd 上游 `src/core/load-fragment.c` 的 `config_parse_working_directory` 与 `config_parse_exec_output` 不执行参数式去引号。前者把带引号的绝对路径拒绝为非绝对路径；后者无法识别带引号的 `append:` 前缀，警告并忽略日志设置。
修复后使用无外围引号的原生路径，仅转义 `%` specifier；包含内部空格、字面 `%h`/`%n`、双引号、反斜杠及 Unicode 的目录和日志文件通过实际进程验证。
路径本身的尾部空格或制表符会被原生行解析改变，明确拒绝而不是静默写错目录或文件；原生未裁剪的垂直制表符与换页符保持不变。尾部反斜杠按奇偶处理：偶数个原样保留，奇数个附加保护空格避开续行，之后由原生 strstrip 移除保护空格。Spec 审查发现尾部反斜杠和垂直制表符/换页符的过度拒绝，最终均修复并补充原生保真回归。

## 自动化验证

- `pnpm typecheck`（含完整 build）、`pnpm lint`、`pnpm lint:names`、`pnpm format:check` 通过。
- `pnpm docs:check` 通过：文档配对、JSON/Context 样例及 4 个文档行为测试无失败。
- 最终 `pnpm test:suites`：Node 1701 项，1661 通过、40 跳过、0 失败；WebUI 35/35。
- macOS 最终聚焦测试：44 通过、5 个 Linux 原生测试按平台跳过。
- 隔离 Linux 中最终相同聚焦测试：49/49，无跳过；其中包含 systemd-analyze 原生解析和真实 user manager 进程测试，cwd 与两个日志文件均覆盖奇偶尾部反斜杠、垂直制表符与换页符。
- 另以非 root 的 Linux 用户执行原生 parser 测试通过；4 个需显式启用 user manager 的测试跳过，确认普通 CI 用户可运行离线解析验证。
- 原生 manager 测试需显式设置 `OCTO_TEST_SYSTEMD_USER=1`，使用唯一临时 unit 并在收尾卸载；默认不触碰开发者服务配置。parser 测试只在 Linux 且存在 systemd-analyze 时运行。

## 真实 Linux 服务验证

环境：Docker 隔离容器，Debian 12 arm64、Node 24.19.0、systemd 252.39，使用真实 `systemd --user` 与 `systemctl --user`，不是 fake runner。仅运行组件生命周期，无真实 Provider 调用、无 IM 外部联网。

1. Home `/tmp/octo native 100%`，真实 CLI `executor-kernel install/start/status` 成功，IPC ready、worker ready。
2. 显式配置 WebUI 的 module、port、sessionStorePath 与 Context，真实 CLI `webui install/start/status` 成功，IPC ready、Kernel ready、HTTP 200。
3. 分别把两个已安装 unit 的 WorkingDirectory 恢复为旧式带引号值，原生 manager 确认 LoadState=bad-setting。
4. 分别重新 install，manager 立即确认 LoadState=loaded，无额外手动 reload；start 后两组件重新 ready。
5. 独立原生测试确认含特殊字符的真实 cwd 与 stdout/stderr 文件精确落点；旧式 quoted cwd 被确认 bad-setting，再由 backend.install 修复并启动。
6. 验证后卸载上述组件与临时 unit。测试未覆盖报告者的 WSL2，也未连接真实 channel-gateway/IM；已配置 Extra 以 WebUI 完成验收，不宣称 Provider 或 Bot 在线。

奇偶修复后分别以末尾包含一个、两个字面反斜杠的 Home 重复上述 Kernel/WebUI 旧坏 unit 重装与启动，两个组件重新 ready、WebUI HTTP 200；随后卸载两组件。最终代码的原生保真回归共 49/49，通过四组尾字符的真实 cwd 与日志落点验证。

原生复验入口：在已构建且具备 user manager 的隔离 Linux 中执行 `OCTO_TEST_SYSTEMD_USER=1 node --test test/cross-service.test.js test/cross-service-systemd-native.test.js`。
