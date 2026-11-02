// 仅由显式专项启动，复用生产 Adapter 和同一个 AgentExecutor/worker。
import { createOpenClawAdapter } from "@mininglamp-oss/octo-runtime-adapter-openclaw";

export const adapters = [createOpenClawAdapter()];
