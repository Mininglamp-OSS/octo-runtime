import {
  ExtraCommandError,
  configCommands,
  savedConfigResult,
  type ExtraCommandExtension,
  type JsonObject
} from "@mininglamp-oss/octo-runtime-host-sdk/extra-commands";
import { validateImBots, imBotIdentity } from "./lifecycle/configuration.js";

/** 离线业务校验复用运行时 Bot 合同；不认证、不构造 manager 或服务。 */
function validate(config: JsonObject): void {
  try {
    validateImBots(config.bots ?? []);
    const spaces = config.authorized_space_ids;
    if (
      spaces !== undefined &&
      (!Array.isArray(spaces) || spaces.some((id) => typeof id !== "string" || !id.trim()))
    )
      throw new Error("IM_AUTHORIZED_SPACES_INVALID");
    const settings = config.context_loading;
    if (settings !== undefined) {
      if (
        !settings ||
        typeof settings !== "object" ||
        Array.isArray(settings) ||
        Object.keys(settings).some((key) => !["timeout_ms", "max_in_flight"].includes(key))
      )
        throw new Error("IM_CONTEXT_LOADING_CONFIG_INVALID");
      for (const [key, max] of [
        ["timeout_ms", 30000],
        ["max_in_flight", 32]
      ] as const) {
        const value = settings[key];
        if (
          value !== undefined &&
          (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max)
        )
          throw new Error("IM_CONTEXT_LOADING_CONFIG_INVALID");
      }
    }
  } catch (error) {
    const hints: Record<string, string> = {
      IM_BOT_ID_REQUIRED: "Provide a non-empty --bot-id (JSON: bots[].bot_id).",
      IM_ADAPTER_REQUIRED:
        "Each Bot requires an adapter object; configure maps --adapter/--workdir to it.",
      IM_WORKDIR_ABSOLUTE_REQUIRED: "Provide an absolute --workdir for a local adapter.",
      IM_OPENCLAW_WORKDIR_UNSUPPORTED:
        "OpenClaw uses its own workspace; remove adapter.workdir using config set.",
      IM_PROVIDER_AGENT_ID_UNSUPPORTED: "--provider-agent-id is supported only by OpenClaw.",
      IM_API_URL_INVALID:
        "Use a valid endpoint URL without credentials, query or fragment; insecure URLs are loopback-only.",
      IM_BOT_DUPLICATED: "Duplicate Bot identity in bots; keep one entry per endpoint and bot_id.",
      IM_CONFIG_LIST_REQUIRED: "bots must be an array within this Extra's Bot limit.",
      IM_AUTHORIZED_SPACES_INVALID: "authorized_space_ids must contain non-empty strings.",
      IM_CONTEXT_LOADING_CONFIG_INVALID:
        "context_loading accepts timeout_ms (1..30000) and max_in_flight (1..32)."
    };
    const code =
      error instanceof Error && Object.hasOwn(hints, error.message)
        ? error.message
        : "EXTRA_CONFIG_INVALID";
    throw new ExtraCommandError(
      code,
      hints[code] ??
        "Invalid Bot configuration. Check config set --help and this Extra's configuration schema."
    );
  }
}

/** 单 Bot 配置命令按现有业务身份 upsert；省略字段保留，重复调用不会追加相同 Bot。 */
const extension: ExtraCommandExtension = {
  apiVersion: 1,
  commands: [
    {
      name: "configure",
      description: "Add or update one Bot by endpoint + bot_id; saves config only",
      options: [
        { name: "bot-id", type: "string", required: true, description: "Platform Bot ID" },
        {
          name: "ws-url",
          type: "string",
          description: "WeCom WebSocket URL; defaults to the official endpoint"
        },
        {
          name: "adapter",
          type: "string",
          description: "Execution adapter type (adapter.adapter_type)"
        },
        { name: "workdir", type: "string", description: "Absolute local execution directory" },
        { name: "model", type: "string", description: "Provider model ID" },
        {
          name: "effort",
          type: "string",
          description: "Reasoning effort: low, medium, high, xhigh"
        },
        { name: "provider-agent-id", type: "string", description: "Existing OpenClaw Agent ID" },
        {
          name: "credential-stdin",
          type: "boolean",
          description: "Read the raw credential from stdin; never put it in argv"
        }
      ],
      examples: [
        "octo-runtime channel-wecom configure --bot-id assistant --adapter codex --workdir /absolute/workspace --credential-stdin < /secure/bot-credential"
      ],
      async run(context, input) {
        const snapshot = await context.readConfig();
        validate(snapshot.config);
        const bots = snapshot.config.bots ?? [];
        validateImBots(bots);
        const identityFields = {
          bot_id: input.options["bot-id"],
          ws_url: input.options["ws-url"] ?? "wss://openws.work.weixin.qq.com"
        };
        let key: string;
        try {
          key = imBotIdentity(identityFields as unknown as Parameters<typeof imBotIdentity>[0]);
        } catch {
          throw new ExtraCommandError("IM_API_URL_INVALID", "Provide a valid endpoint URL.");
        }
        const position = bots.findIndex((bot) => imBotIdentity(bot) === key);
        const old = position < 0 ? undefined : bots[position];
        const adapter: JsonObject = { ...old?.adapter };
        for (const [flag, field] of [
          ["adapter", "adapter_type"],
          ["workdir", "workdir"],
          ["model", "model"],
          ["effort", "effort"],
          ["provider-agent-id", "provider_agent_id"]
        ]) {
          const value = input.options[flag];
          if (typeof value === "string") adapter[field] = value;
        }
        if (
          adapter.effort !== undefined &&
          (typeof adapter.effort !== "string" ||
            !["low", "medium", "high", "xhigh"].includes(adapter.effort))
        )
          throw new ExtraCommandError(
            "EXTRA_CONFIG_INVALID",
            "--effort must be low, medium, high or xhigh."
          );
        const bot = { ...old, ...identityFields, adapter } as unknown as JsonObject;
        if (input.options["credential-stdin"]) {
          const credential = (await context.readStdin()).trim();
          if (!credential)
            throw new ExtraCommandError(
              "EXTRA_CONFIG_INVALID",
              "Credential stdin must not be empty."
            );
          bot.app_secret = credential;
        }
        const nextBots = [...bots] as unknown as JsonObject[];
        if (position < 0) nextBots.push(bot);
        else nextBots[position] = bot;
        const config: JsonObject = { ...snapshot.config, bots: nextBots };
        validate(config);
        return savedConfigResult(await context.saveConfig(config, snapshot.revision));
      }
    },
    configCommands(validate)
  ]
};
export default extension;
