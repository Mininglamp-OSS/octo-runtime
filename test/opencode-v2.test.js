import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createOpenCodeAdapter,
  buildOpenCodeCommand,
  probeOpenCode
} from "@mininglamp-oss/octo-runtime-adapter-opencode";
import {
  AcpInvocationError,
  createAcpAdapter,
  normalizeAcpUpdate
} from "@mininglamp-oss/octo-runtime-adapter-acp";
import { invokeRequest } from "./runtime-fixture.js";

// 实际子进程验证选择路径和版本门禁，不安装或替换宿主 Provider。
async function executable(t, body) {
  const directory = await mkdtemp(join(tmpdir(), "octo-opencode-fixture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const command = join(directory, "opencode");
  await writeFile(command, `#!${process.execPath}\n${body}`);
  await chmod(command, 0o700);
  return { directory, command };
}
const posix = { skip: process.platform === "win32" };
for (const version of ["1.18.30", "2.0.0", "2.1.2", "2.1.3-beta", "3.0.0", "unparseable"]) {
  test(
    `OpenCode ${version} is rejected during probe and direct invocation on both transports`,
    posix,
    async (t) => {
      const fixture = await executable(
        t,
        `if(process.argv[2]==="--version"){console.log(${JSON.stringify(version)});process.exit(0)} throw Error("must not start transport");`
      );
      const adapter = createOpenCodeAdapter({ command: fixture.command });
      const probe = await adapter.probe();
      assert.equal(probe.available, false);
      assert.match(
        probe.reason,
        version === "unparseable"
          ? /OPENCODE_VERSION_DETECTION_FAILED/
          : /OPENCODE_VERSION_UNSUPPORTED/
      );
      if (version.startsWith("1.")) assert.match(probe.reason, /OpenCode 1 is no longer supported/);
      for (const approvalMode of ["ask", "full_access"]) {
        await assert.rejects(async () => {
          for await (const _ of adapter.invoke(invokeRequest({ approvalMode }))) {
            /* drain */
          }
        }, /OPENCODE_VERSION_/);
      }
    }
  );
}
test("version detection failure and timeout fail closed", posix, async (t) => {
  for (const body of ["process.exit(1)", "setTimeout(()=>{},10000)"]) {
    const fixture = await executable(t, body);
    const started = Date.now();
    assert.match(
      (await probeOpenCode(fixture.command)).reason,
      /OPENCODE_VERSION_DETECTION_FAILED/
    );
    assert.ok(Date.now() - started < 5000);
  }
});
test(
  "invocation uses its PATH/cwd and keeps the selected executable through execution",
  posix,
  async (t) => {
    const fixture = await executable(
      t,
      `
if(process.argv[2]==="--version"){console.log("opencode v2.1.3");process.exit(0)}
let input="";process.stdin.on("data",d=>input+=d);process.stdin.on("end",()=>{
 console.log(JSON.stringify({type:"text",sessionID:"ses_v2",part:{type:"text",id:"text",text:input}}));
 console.log(JSON.stringify({type:"step_finish",part:{type:"step-finish",reason:"stop",tokens:{input:3,output:2}}}));
});`
    );
    for (const command of ["opencode", "./opencode"]) {
      const events = [];
      for await (const event of createOpenCodeAdapter({ command }).invoke(
        invokeRequest({
          approvalMode: "full_access",
          workdir: fixture.directory,
          agentConfig: { effort: "high" },
          modelInput: 'exact\n"quoted"  spacing',
          executionEnvOverrides: { env_variables: [{ key: "PATH", value: fixture.directory }] }
        })
      ))
        events.push(event);
      assert.equal(
        events.find((e) => e.type === "message.delta").payload.text,
        'exact\n"quoted"  spacing'
      );
      assert.deepEqual(
        events
          .filter((e) => e.type.startsWith("run.") && e.type !== "run.notice")
          .map((e) => e.type),
        ["run.completed"]
      );
      assert.equal(
        events.find((e) => e.type === "run.notice").payload.params.warningCode,
        "REASONING_EFFORT_NOT_APPLIED"
      );
    }
  }
);
test("a step stop followed by process failure cannot become successful", posix, async (t) => {
  const fixture = await executable(
    t,
    `if(process.argv[2]==="--version"){console.log("2.1.3");process.exit(0)}
console.log(JSON.stringify({type:"text",part:{type:"text",text:"partial"}}));
console.log(JSON.stringify({type:"step_finish",part:{reason:"stop"}}));process.exitCode=7;`
  );
  const events = [];
  for await (const event of createOpenCodeAdapter({ command: fixture.command }).invoke(
    invokeRequest({ approvalMode: "full_access" })
  ))
    events.push(event);
  assert.equal(
    events.some((e) => e.type === "run.completed"),
    false
  );
  assert.equal(events.at(-1).type, "run.failed");
});
test("OpenCode V2 preserves native config and overlays MCP under servers with execution timeout", async () => {
  const original = {
    instructions: ["existing.md"],
    providers: { custom: {} },
    mcp: { timeout: { catalog: 123 }, servers: { existing: { disabled: true } } }
  };
  const request = invokeRequest({
    approvalMode: "full_access",
    controlInstructions: "CONTROL",
    executionEnvOverrides: {
      env_variables: [{ key: "OPENCODE_CONFIG_CONTENT", value: JSON.stringify(original) }]
    },
    context: {
      schema: "octo.context-envelope/v3",
      items: [
        {
          namespace: "octo.execution",
          name: "mcp",
          payload: {
            mcpServers: {
              live: { type: "stdio", command: "node", args: ["server.js"], toolTimeoutMs: 5000 }
            }
          }
        }
      ]
    }
  });
  const spec = await buildOpenCodeCommand(request);
  const config = JSON.parse(spec.env.OPENCODE_CONFIG_CONTENT);
  try {
    assert.deepEqual(config.mcp.servers.existing, { disabled: true });
    assert.deepEqual(config.mcp.timeout, { catalog: 123 });
    assert.deepEqual(config.mcp.servers.live.timeout, { execution: 5000 });
    assert.equal(config.mcp.servers.live.disabled, false);
    assert.deepEqual(config.providers, original.providers);
    assert.equal(await readFile(config.instructions[1], "utf8"), "CONTROL");
  } finally {
    await spec.cleanup();
  }
  await assert.rejects(readFile(config.instructions[1]), { code: "ENOENT" });
  for (const invalid of ["{", "[]", "null", "42"]) {
    await assert.rejects(
      buildOpenCodeCommand({
        ...request,
        executionEnvOverrides: {
          env_variables: [{ key: "OPENCODE_CONFIG_CONTENT", value: invalid }]
        }
      }),
      /OPENCODE_CONFIG_INVALID/
    );
  }
});
test("V2 ACP usage retains context size and cost", () => {
  assert.deepEqual(
    normalizeAcpUpdate(
      {
        sessionUpdate: "usage_update",
        used: 100,
        size: 128000,
        cost: { amount: 0.1, currency: "USD" }
      },
      "opencode"
    )[0].payload,
    { used: 100, size: 128000, cost: { amount: 0.1, currency: "USD" } }
  );
});

test("ACP only qualifies ordinary invocation errors after successful transport cleanup", async () => {
  for (const closeFails of [false, true]) {
    const providerError = new Error("provider rejected the request");
    const cleanupError = new Error("cleanup could not finish");
    const adapter = createAcpAdapter(
      { type: "fixture", provider: "fixture", command: "unused" },
      {
        acpClientFactory: () => ({
          initialize: async () => {
            throw providerError;
          },
          close: async () => {
            if (closeFails) throw cleanupError;
          }
        })
      }
    );
    await assert.rejects(
      async () => {
        for await (const _ of adapter.invoke(invokeRequest({ approvalMode: "ask" }))) {
          /* drain */
        }
      },
      (error) =>
        closeFails
          ? error === cleanupError
          : error instanceof AcpInvocationError && error.cause === providerError
    );
  }
  const structured = Object.assign(new Error("capacity exceeded"), {
    code: "STREAM_RAW_MESSAGE_TOO_LARGE",
    limitBytes: 100
  });
  const adapter = createAcpAdapter(
    { type: "fixture", provider: "fixture", command: "unused" },
    {
      acpClientFactory: () => ({
        initialize: async () => {
          throw structured;
        },
        close: async () => {}
      })
    }
  );
  await assert.rejects(
    async () => {
      for await (const _ of adapter.invoke(invokeRequest({ approvalMode: "ask" }))) {
        /* drain */
      }
    },
    (error) => error === structured
  );
});
