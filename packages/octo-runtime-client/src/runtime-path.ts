import { posix, win32 } from "node:path";

export interface StartupPathDiagnostic {
  domain: "startup";
  code: string;
  path?: string;
  resource: string;
  operation: string;
  action: string;
  systemCode?: string;
  endpoint?: string;
  measured?: number;
  limit?: number;
  unit?: "utf8-bytes" | "utf16-units";
}

/** 启动域的受控路径失败；只公开必要路径/errno，不复制原始配置或异常正文。 */
export class RuntimeHomeError extends Error {
  readonly code: string;
  readonly diagnostic: Readonly<StartupPathDiagnostic>;
  constructor(diagnostic: Omit<StartupPathDiagnostic, "domain">, cause?: unknown) {
    super(diagnostic.code, { cause });
    this.name = "RuntimeHomeError";
    this.code = diagnostic.code;
    // 明确投影字段，避免 JS 调用方附带的配置等额外属性进入公开启动诊断。
    this.diagnostic = Object.freeze({
      domain: "startup",
      code: diagnostic.code,
      resource: diagnostic.resource,
      operation: diagnostic.operation,
      action: diagnostic.action,
      ...(diagnostic.path !== undefined ? { path: diagnostic.path } : {}),
      ...(diagnostic.systemCode !== undefined ? { systemCode: diagnostic.systemCode } : {}),
      ...(diagnostic.endpoint !== undefined ? { endpoint: diagnostic.endpoint } : {}),
      ...(diagnostic.measured !== undefined ? { measured: diagnostic.measured } : {}),
      ...(diagnostic.limit !== undefined ? { limit: diagnostic.limit } : {}),
      ...(diagnostic.unit !== undefined ? { unit: diagnostic.unit } : {})
    });
  }
}

export const action =
  "The host must select and prepare an existing, accessible absolute Runtime Home, then retry with that directory. No replacement Home is selected.";
export const lengthAction =
  "The host must choose a directory/address within the reported filesystem and IPC limits, prepare it, and retry. Existing data is not moved automatically.";

/** 先检查原始输入，再规范化；这是纯路径计算，不代表目录已存在或启动已验证。 */
export function normalizeRuntimeHome(
  input: string,
  platform: NodeJS.Platform = process.platform,
  resource = "home"
): string {
  const fail = (code: string): never => {
    throw new RuntimeHomeError({
      code,
      ...(typeof input === "string" ? { path: input } : {}),
      resource,
      operation: "validate-input",
      action
    });
  };
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.includes("\0") ||
    /[\uD800-\uDFFF]/u.test(input)
  )
    fail("HOME_INVALID");
  if (!["win32", "darwin", "linux"].includes(platform)) fail("HOME_UNSUPPORTED");
  const api = platform === "win32" ? win32 : posix;
  if (!api.isAbsolute(input)) fail("HOME_INVALID");
  if (platform === "win32") {
    // 仅支持本地盘绝对路径。拒绝 UNC/device/root-relative/ADS 和 Win32 别名，避免 hash 与 IO 指向不同资源。
    const local = input.replaceAll("/", "\\");
    if (
      !/^[a-z]:\\/i.test(local) ||
      /[<>"|?*]/.test(local) ||
      [...local].some((character) => character.codePointAt(0)! < 32) ||
      local.slice(2).includes(":")
    )
      fail("HOME_UNSUPPORTED");
    for (const part of local.slice(3).split("\\")) {
      if (part === "." || part === "..") continue;
      if (/[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))
        fail("HOME_UNSUPPORTED");
    }
  }
  const home = api.resolve(input);
  if (home === api.parse(home).root) fail("HOME_UNSUPPORTED");
  return home;
}

export interface PathLimits {
  path: number;
  name: number;
}
// Unix 的纯计算上限来自对应 OS 的 PATH_MAX/NAME_MAX；真实启动再查询所选文件系统。
// Windows Node/libuv 使用扩展 UTF-16 路径：32767 包括 NUL 和自动追加的 \\?\ 前缀，不使用 MAX_PATH=260。
export function platformLimits(platform: NodeJS.Platform): PathLimits {
  if (platform === "win32") return { path: 32767 - 1 - 4, name: 255 };
  if (platform === "linux") return { path: 4096 - 1, name: 255 };
  if (platform === "darwin") return { path: 1024 - 1, name: 255 };
  throw new RuntimeHomeError({
    code: "HOME_UNSUPPORTED",
    resource: "home",
    operation: "path-budget",
    action
  });
}

/** 检查实际附加文件名的预算；Windows 按 UTF-16 code unit，POSIX 按 UTF-8 字节。 */
export function assertRuntimePath(
  path: string,
  resource: string,
  platform: NodeJS.Platform = process.platform,
  limits = platformLimits(platform)
): void {
  const unit = platform === "win32" ? "utf16-units" : "utf8-bytes";
  const measure = (value: string) =>
    Buffer.byteLength(value, platform === "win32" ? "utf16le" : "utf8") /
    (platform === "win32" ? 2 : 1);
  const fail = (measured: number, limit: number, operation: string) => {
    throw new RuntimeHomeError({
      code: "HOME_PATH_TOO_LONG",
      path,
      resource,
      operation,
      action: lengthAction,
      measured,
      limit,
      unit
    });
  };
  if (measure(path) > limits.path) fail(measure(path), limits.path, "path-budget");
  const api = platform === "win32" ? win32 : posix;
  for (const part of path.slice(api.parse(path).root.length).split(api.sep)) {
    if (measure(part) > limits.name) fail(measure(part), limits.name, "filename-budget");
  }
}

/** endpoint-only API 只拥有传输，不推断或创建 Home；同样在连接/监听前拒绝无效或超长地址。 */
export function assertIpcEndpoint(
  endpoint: string,
  platform: NodeJS.Platform = process.platform
): void {
  const fail = (code: string, extra: Partial<StartupPathDiagnostic> = {}): never => {
    throw new RuntimeHomeError({
      code,
      ...(typeof endpoint === "string" ? { path: endpoint, endpoint } : {}),
      resource: "ipc-endpoint",
      operation: "ipc-address",
      action: lengthAction,
      ...extra
    });
  };
  if (
    typeof endpoint !== "string" ||
    !endpoint ||
    endpoint.includes("\0") ||
    /[\uD800-\uDFFF]/u.test(endpoint)
  )
    fail("IPC_ENDPOINT_INVALID");
  if (platform === "win32") {
    if (!/^\\\\[.?]\\pipe\\[^\\]+$/i.test(endpoint)) fail("IPC_ENDPOINT_INVALID");
    const measured = Buffer.byteLength(endpoint, "utf16le") / 2;
    // CreateNamedPipeW: 完整 pipe 名最多 256 WCHAR；namespace 不是文件路径，不套用 Unix sun_path。
    if (measured > 256)
      fail("IPC_ENDPOINT_TOO_LONG", { measured, limit: 256, unit: "utf16-units" });
  } else {
    if (!posix.isAbsolute(endpoint)) fail("IPC_ENDPOINT_INVALID");
    // Node net + libuv 的 pathname socket 必须留出结尾 NUL：Linux 108、Darwin 104 字节 sun_path。
    const limit = platform === "linux" ? 107 : platform === "darwin" ? 103 : undefined;
    if (limit === undefined) fail("IPC_ENDPOINT_UNSUPPORTED");
    const measured = Buffer.byteLength(endpoint, "utf8");
    if (measured > limit!) fail("IPC_ENDPOINT_TOO_LONG", { measured, limit, unit: "utf8-bytes" });
    assertRuntimePath(endpoint, "ipc-endpoint", platform);
    assertRuntimePath(`${endpoint}.owner.recovery`, "endpoint-ownership", platform);
  }
}
