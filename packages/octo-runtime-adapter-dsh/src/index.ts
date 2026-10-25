import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  defineAdapter,
  invocationEnvironment,
  providerInputParts,
  initialControlInstructions,
  DriverQueue,
  noopRuntimeLog,
  type RuntimeLog,
  type CanonicalEvent,
  type InvokeRequest,
  type AdapterInvocationContext
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { contextActmode, DEFAULT_STREAM_LIMIT_POLICY } from "@mininglamp-oss/octo-runtime-protocol";
import { createProcessCleanup } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-cleanup";
import {
  HarnessClient,
  type NotificationSubscription,
  type SdkPromptContentBlock
} from "@deepseek-ai/dsh-sdk-client";
import { DshError, dshError, record, DSH_VERSION } from "./errors.js";
import { resolveDshLaunch, timeoutOption, stringOption } from "./launch.js";
import { DshTrajectory } from "./trajectory.js";

export { DshError, DSH_VERSION } from "./errors.js";

export interface DshAdapterOptions {
  /** 同一 RuntimeLog sink；只记录身份、阶段、时间和安全枚举，不记录原始轨迹。 */
  log?: RuntimeLog;
}

/**
 * SDK/CLI 共用的独立 Adapter。每 invoke 拥有一个 Provider 子进程；资源回收后才发唯一终态。
 * providerSession 来自调用方，跨调用显式 resume；不缓存业务上下文或安装/修改 Provider。
 */
export function createDshAdapter(options: DshAdapterOptions = {}) {
  const sessions = new Set<string>();
  const log = options.log ?? noopRuntimeLog;
  return defineAdapter(
    {
      metadata: { type: "dsh", agentSources: ["provisioned"] },
      async probe(probeOptions?: { providerOptions?: Record<string, string> }) {
        try {
          const launch = await resolveDshLaunch(probeOptions?.providerOptions ?? {}, {
            ...process.env
          });
          return { available: true, command: launch.command, version: DSH_VERSION };
        } catch (error) {
          return {
            available: false,
            command: "dsh",
            reason: dshError(error, "DSH_START_FAILED").code
          };
        }
      },
      async *invoke(
        request: InvokeRequest,
        context?: AdapterInvocationContext
      ): AsyncGenerator<CanonicalEvent> {
        const invocationLog = context?.log ?? log;
        if (request.approvalMode !== "full_access")
          throw new Error(
            "APPROVAL_MODE_UNSUPPORTED: DSH SDK 0.2.1-rc.3 has no interactive approval transport; explicitly select full_access"
          );
        const actmode = contextActmode(request.context);
        if (actmode !== undefined && actmode !== "default")
          throw new Error("ACTMODE_UNSUPPORTED: DSH SDK has no actmode setter");
        if (
          request.agentConfig.sandbox !== undefined &&
          request.agentConfig.sandbox !== "danger-full-access"
        )
          throw new Error("DSH_CONFIG_INVALID: full_access requires danger-full-access sandbox");
        const config = request.agentConfig.providerOptions ?? {};
        if (!record(config))
          throw new TypeError("DSH_CONFIG_INVALID: providerOptions must be an object");
        const requestedId = request.providerSession?.sessionId;
        if (
          requestedId !== undefined &&
          (typeof requestedId !== "string" || !requestedId || requestedId.length > 191)
        )
          throw new DshError("DSH_SESSION_RESUME_FAILED");
        const sessionId = requestedId ?? `octo-${randomUUID()}`;
        if (sessions.has(sessionId)) throw new DshError("DSH_SESSION_BUSY");
        sessions.add(sessionId);
        const started = Date.now();
        let phase = "launch";
        let failurePhase: string | undefined;
        let client: HarnessClient | undefined;
        let subscription: NotificationSubscription | undefined;
        let notifications: Promise<void> | undefined;
        let primary: DshError | undefined;
        let cleanup: DshError | undefined;
        let terminal: CanonicalEvent | undefined;
        let closing: Promise<void> | undefined;
        let cancelOverridesFailure = true;
        const limits = context?.streamLimits ?? DEFAULT_STREAM_LIMIT_POLICY;
        const trajectory = new DshTrajectory(sessionId, limits.rawMessageMaxBytes);
        let receiptId: string | undefined;
        const queue = new DriverQueue<CanonicalEvent>({
          limits,
          boundary: "adapter.dsh_queue",
          discardOnFailure: true,
          onFailure: (error) => {
            // 首个具体失败决定原因；清理引起的 transport/trajectory 错误不能覆盖容量证据。
            primary ??= dshError(error, "DSH_EXECUTION_FAILED");
            failurePhase ??= phase;
            void close().catch(() => {});
          }
        });
        const close = (): Promise<void> =>
          (closing ??= Promise.resolve().then(() => client?.close()));
        const abort = (): void => {
          cancelOverridesFailure = primary === undefined;
          queue.close(new DshError("DSH_TRANSPORT_CLOSED", { phase: "cancel" }));
          void close().catch(() => {});
        };
        const diagnostic = (code: string, data: Record<string, unknown> = {}): void => {
          try {
            invocationLog(code === "completed" ? "info" : "error", "dsh.execution", {
              run_id: request.runId,
              invocation_id: request.invocationId,
              session_id: sessionId,
              adapter_type: "dsh",
              code,
              state: cleanup ? "cleanup" : (failurePhase ?? phase),
              duration_ms: Date.now() - started,
              request_id: data.requestId,
              native_code: data.nativeCode,
              pid: data.pid,
              exit_code: data.exitCode,
              signal: data.signal,
              primary_code: data.primaryCode,
              cleanup_code: data.cleanupCode
            });
          } catch {
            /* 诊断 sink 不改变执行或清理结果。 */
          }
        };
        let producer: Promise<void> | undefined;
        try {
          if (request.signal?.aborted) {
            terminal = {
              protocolVersion: 2,
              type: "run.cancelled",
              payload: { reason: "cancelled" }
            };
          } else {
            const initializeTimeoutMs = timeoutOption(config, "initializeTimeoutMs", 15_000);
            const requestTimeoutMs = timeoutOption(config, "requestTimeoutMs", 30_000);
            const runTimeoutMs = request.runtimeLimits?.runTimeoutMs ?? 120_000;
            const shutdownTimeoutMs = timeoutOption(config, "shutdownTimeoutMs", 1000);
            const env = invocationEnvironment(request, {
              DSH_PERMISSION_MODE: "danger-full-access"
            });
            if (config.dshHome !== undefined) env.DSH_HOME = stringOption(config, "dshHome", "");
            const launch = await resolveDshLaunch(config, env, request.signal);
            if (request.signal?.aborted)
              throw new DshError("DSH_TRANSPORT_CLOSED", { phase: "cancel" });
            client = new HarnessClient({
              dshBin: launch.dshBin,
              profile: stringOption(config, "profile", "sdk"),
              processCwd: request.workdir,
              env: launch.env,
              // 版本锁定的 pnpm 补丁仅增加生命周期与读取预算接线；RPC/订阅仍由官方实现。
              detached: process.platform !== "win32",
              createProcessCleanup: (child) =>
                createProcessCleanup(child, {
                  processGroup: process.platform !== "win32",
                  processTree: true,
                  termGraceMs: 1000,
                  killGraceMs: 1000
                }),
              rawMessageMaxBytes: limits.rawMessageMaxBytes,
              maxSessionRelationships: 128,
              initializeTimeoutMs,
              requestTimeoutMs,
              shutdownTimeoutMs
            });
            // 在官方订阅过滤回调中同步投影，返回 false 避免再积累一份无界通知队列。
            // 原始行预算在官方 Protocol 的补丁中、解码前检查；此处保留投影对象检查。
            subscription = client.subscribe((notification) => {
              if (phase !== "prompt" && phase !== "wait") return false;
              try {
                if (Buffer.byteLength(JSON.stringify(notification)) > limits.rawMessageMaxBytes)
                  throw new DshError("PROVIDER_MESSAGE_TOO_LARGE", { phase: "notification_limit" });
                for (const value of trajectory.accept(notification)) queue.push(value);
              } catch (error) {
                primary ??= dshError(error, "DSH_TRAJECTORY_INVALID");
                failurePhase ??= phase;
                queue.close(primary);
                void close().catch(() => {});
              }
              return false;
            });
            notifications = subscription.next().then(
              () => {},
              (error: unknown) => {
                if (closing) return;
                primary ??= dshError(error, "DSH_TRANSPORT_CLOSED");
                failurePhase ??= phase;
                queue.close(primary);
              }
            );
            request.signal?.addEventListener("abort", abort, { once: true });
            if (request.signal?.aborted) abort();
            const owned = client;
            producer = (async () => {
              try {
                phase = "initialize";
                const initialization = await owned.initialize({
                  cwd: request.workdir,
                  provider: stringOption(config, "provider", "deepseek-account"),
                  model: request.agentConfig.model ?? "deepseek-flash",
                  ...(config.maxTokens === undefined
                    ? {}
                    : { maxTokens: timeoutOption(config, "maxTokens", 4096) })
                });
                if (
                  !record(initialization) ||
                  !record(initialization.serverInfo) ||
                  initialization.serverInfo.name !== "deepseek-harness-sdk-runtime" ||
                  initialization.serverInfo.version !== "0.0.1"
                )
                  throw new DshError("DSH_VERSION_UNSUPPORTED");
                if (requestedId) {
                  phase = "resume";
                  try {
                    await owned.resumeSession(sessionId);
                    // 先证明原会话恢复，再应用本轮执行目录；不能让 set 隐式创建替代会话。
                    const directory = await owned.setWorkingDirectory(sessionId, request.workdir);
                    if ((await realpath(directory)) !== (await realpath(request.workdir)))
                      throw new DshError("DSH_SESSION_RESUME_FAILED");
                  } catch (error) {
                    throw new DshError(
                      "DSH_SESSION_RESUME_FAILED",
                      dshError(error, "DSH_RPC_ERROR").diagnostics,
                      { cause: error }
                    );
                  }
                }
                queue.push({
                  protocolVersion: 2,
                  type: "session.update",
                  payload: {
                    providerSession: {
                      sessionId,
                      resumable: true,
                      resumeOutcome: requestedId ? "resumed" : "new"
                    }
                  }
                });
                const contentBlocks: SdkPromptContentBlock[] = providerInputParts(request).map(
                  (part) =>
                    part.type === "image"
                      ? { type: "image", mimeType: part.mimeType, data: part.data }
                      : { type: "text", text: part.text }
                );
                const instructions = initialControlInstructions(request);
                if (instructions) contentBlocks.unshift({ type: "text", text: instructions });
                phase = "prompt";
                const receipt = await owned.prompt(sessionId, contentBlocks);
                if (!receipt || receipt.length > 191) throw new DshError("DSH_PROTOCOL_ERROR");
                receiptId = receipt;
                phase = "wait";
                await owned.request("session/wait", { sessionId }, runTimeoutMs);
                terminal = trajectory.finish(receiptId);
                queue.close();
              } catch (error) {
                const failure = dshError(error, "DSH_EXECUTION_FAILED");
                primary ??=
                  phase === "initialize" && failure.code === "DSH_REQUEST_TIMEOUT"
                    ? new DshError("DSH_INITIALIZE_TIMEOUT", {}, { cause: error })
                    : failure;
                failurePhase ??= phase;
                queue.close(primary);
              }
            })();
            yield* queue;
            await producer;
          }
        } catch (error) {
          primary ??= dshError(error, "DSH_EXECUTION_FAILED");
          failurePhase ??= phase;
        } finally {
          phase = "cleanup";
          try {
            await close();
          } catch (error) {
            cleanup = dshError(error, "DSH_CLEANUP_FAILED");
          }
          subscription?.close();
          await notifications;
          await producer;
          request.signal?.removeEventListener("abort", abort);
          queue.close();
          queue.drain();
          sessions.delete(sessionId);
        }
        if (cleanup) {
          const code = request.signal?.aborted ? "DSH_CANCEL_FAILED" : "DSH_CLEANUP_FAILED";
          primary = new DshError(code, {
            primaryCode: primary?.code ?? "NONE",
            cleanupCode: cleanup.code,
            ...cleanup.diagnostics
          });
        } else if (request.signal?.aborted && cancelOverridesFailure) {
          terminal = {
            protocolVersion: 2,
            type: "run.cancelled",
            payload: { reason: "cancelled" }
          };
          primary = undefined;
        }
        if (primary) {
          diagnostic(primary.code, primary.diagnostics);
          yield {
            protocolVersion: 2,
            type: "run.failed",
            payload: {
              code: primary.code,
              message: primary.message,
              retryable: false,
              adapterType: "dsh",
              diagnostics: {
                phase: cleanup ? "cleanup" : (failurePhase ?? phase),
                durationMs: Date.now() - started,
                ...primary.diagnostics
              }
            }
          };
        } else if (terminal) {
          diagnostic(terminal.type === "run.completed" ? "completed" : "cancelled");
          yield terminal;
        } else {
          throw new DshError("DSH_TRAJECTORY_INVALID");
        }
      }
    },
    null
  );
}

export const dshAdapter = createDshAdapter();
export default dshAdapter;
