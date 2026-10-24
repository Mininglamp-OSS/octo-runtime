import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import mimoCodeAdapter, {
  createMimoCodeAdapter
} from "@mininglamp-oss/octo-runtime-adapter-mimo-code";
import { invokeRequest, deferred } from "./runtime-fixture.js";

function fixture({ fail = false, waitForCancel = false } = {}) {
  const calls = [];
  const clients = [];
  const cancelled = deferred();
  const adapter = createMimoCodeAdapter({
    acpClientFactory(options) {
      calls.push(["spawn", options]);
      const holdForCancellation = waitForCancel && clients.length === 0;
      let nextId = 1;
      const client = {
        closed: false,
        initialize: async (params) => {
          calls.push(["initialize", params]);
          return { protocolVersion: 1 };
        },
        reserveRequestId: () => nextId++,
        request: async (method, params) => {
          calls.push([method, params]);
          return {
            sessionId: "mimo-fixture",
            models: {
              currentModelId: "model-a",
              availableModels: [{ modelId: "model-a" }, { modelId: "model-b" }]
            }
          };
        },
        async *prompt(sessionId, prompt) {
          calls.push(["prompt", { sessionId, prompt }]);
          if (fail) throw new Error("MiMo fixture authentication rejected");
          yield { sessionUpdate: "agent_message_chunk", content: { text: "MiMo " } };
          if (holdForCancellation) await cancelled.promise;
          else yield { sessionUpdate: "agent_message_chunk", content: { text: "reply" } };
          yield {
            type: "prompt_result",
            stopReason: holdForCancellation ? "cancelled" : "end_turn"
          };
        },
        cancel: (sessionId) => {
          calls.push(["cancel", sessionId]);
          cancelled.resolve();
        },
        close: async () => {
          client.closed = true;
          cancelled.resolve();
        }
      };
      clients.push(client);
      return client;
    }
  });
  return { adapter, calls, clients };
}

test("MiMo Code is a distinct canonical ACP adapter in the CLI catalog", async () => {
  assert.equal(mimoCodeAdapter.metadata.type, "mimo-code");
  assert.deepEqual(mimoCodeAdapter.metadata.protocolSupport.modes, ["canonical"]);
  assert.equal(typeof mimoCodeAdapter.respondInteraction, "function");
  const manifest = JSON.parse(
    await readFile(new URL("../apps/cli/src/manifest.json", import.meta.url), "utf8")
  );
  const entry = manifest.adapters.find((entry) => entry.type === "mimo-code");
  assert.equal((await import(entry.module))[entry.export], mimoCodeAdapter);
});

test("MiMo Code forwards command, cwd, isolated env, model and session continuation", async () => {
  const { adapter, calls, clients } = fixture();
  const request = invokeRequest({
    modelInput: "turn input",
    controlInstructions: "",
    executionEnvOverrides: { env_variables: [{ key: "MIMO_FIXTURE_ID", value: "this-run" }] },
    agentConfig: { model: "model-b" }
  });
  const events = await Array.fromAsync(adapter.invoke(request));
  const options = calls.find(([method]) => method === "spawn")[1];
  assert.equal(options.command, "mimo");
  assert.deepEqual(options.args, ["acp"]);
  assert.equal(options.cwd, request.workdir);
  assert.equal(options.env.MIMO_FIXTURE_ID, "this-run");
  assert.equal(process.env.MIMO_FIXTURE_ID, undefined);
  assert.deepEqual(calls.find(([method]) => method === "initialize")[1], { protocolVersion: 1 });
  assert.ok(calls.some(([method]) => method === "session/new"));
  assert.deepEqual(calls.find(([method]) => method === "session/set_model")[1], {
    sessionId: "mimo-fixture",
    modelId: "model-b"
  });
  assert.equal(calls.find(([method]) => method === "prompt")[1].prompt, "turn input");
  assert.equal(
    events
      .filter((event) => event.type === "message.delta")
      .map((event) => event.payload.text)
      .join(""),
    "MiMo reply"
  );
  assert.equal(events.at(-1).type, "run.completed");
  assert.equal(clients[0].closed, true);
  calls.length = 0;
  await Array.fromAsync(
    adapter.invoke({ ...request, providerSession: { sessionId: "mimo-fixture" } })
  );
  assert.ok(
    calls.some(
      ([method, params]) => method === "session/load" && params.sessionId === "mimo-fixture"
    )
  );
  assert.ok(clients.every((client) => client.closed));
});

test("MiMo Code preserves provider failure and closes its transport", async () => {
  const { adapter, clients } = fixture({ fail: true });
  await assert.rejects(
    Array.fromAsync(adapter.invoke(invokeRequest())),
    /MiMo fixture authentication rejected/
  );
  assert.equal(clients[0].closed, true);
});

test("MiMo Code cancellation closes the call and permits a later invocation", async () => {
  const { adapter, calls, clients } = fixture({ waitForCancel: true });
  const controller = new AbortController();
  const events = [];
  for await (const event of adapter.invoke(invokeRequest({ signal: controller.signal }))) {
    events.push(event);
    if (event.type === "message.delta") controller.abort();
  }
  assert.ok(
    calls.some(([method, sessionId]) => method === "cancel" && sessionId === "mimo-fixture")
  );
  assert.equal(events.at(-1).type, "run.cancelled");
  assert.equal(clients[0].closed, true);
  assert.equal(
    (await Array.fromAsync(adapter.invoke(invokeRequest()))).at(-1).type,
    "run.completed"
  );
  assert.ok(clients.every((client) => client.closed));
});

test("public SDK selects MiMo Code through Context v3 and keeps business item order", async () => {
  const { adapter, calls } = fixture();
  const executor = new AgentExecutor();
  executor.register(adapter);
  try {
    const events = await Array.fromAsync(
      executor.invoke({
        protocol_mode: "canonical",
        inputs: [{ type: "text", text: "current message" }],
        contexts: {
          schema: "octo.context-envelope/v3",
          items: [
            { namespace: "octo.execution", name: "adapter", payload: { type: "mimo-code" } },
            {
              namespace: "octo.execution",
              name: "workspace",
              payload: { mode: "fixed", path: process.cwd() }
            },
            {
              namespace: "extra.fixture",
              name: "first",
              payload: { text: "first-context-marker" }
            },
            {
              namespace: "extra.fixture",
              name: "second",
              payload: { text: "second-context-marker" }
            }
          ]
        }
      })
    );
    assert.equal(events.at(-1).type, "run.completed");
    const input = calls.find(([method]) => method === "prompt")[1].prompt;
    const prompt = typeof input === "string" ? input : input.map((part) => part.text).join("\n");
    assert.ok(prompt.includes("first-context-marker"));
    assert.ok(prompt.indexOf("first-context-marker") < prompt.indexOf("second-context-marker"));
    assert.match(prompt, /current message/);
  } finally {
    await executor.shutdown();
  }
});

test("MiMo Code factory accepts an explicit executable without installing it", async () => {
  const adapter = createMimoCodeAdapter({ command: "/octo-fixture-missing-mimo" });
  const probe = await adapter.probe();
  assert.equal(probe.available, false);
});
