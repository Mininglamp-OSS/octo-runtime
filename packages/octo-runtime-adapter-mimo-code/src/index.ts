import { createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";

/** 宿主可覆盖 executable；执行、交互及进程所有权沿用共享 ACP 合同。 */
export function createMimoCodeAdapter(options: Parameters<typeof createAcpAdapter>[1] = {}) {
  return createAcpAdapter(
    {
      type: "mimo-code",
      provider: "mimo-code",
      command: "mimo",
      args: ["acp"]
    },
    options
  );
}

export const mimoCodeAdapter = createMimoCodeAdapter();

export default mimoCodeAdapter;
