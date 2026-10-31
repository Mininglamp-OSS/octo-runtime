// 显式手动执行；OCTO_CARD_RENDER_PROBE 指向用同目录 Go 源码构建的服务端渲染探针。
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { ImRunProjector } from "../../../packages/octo-runtime-extra-channel-gateway/dist/presentation/run-projector.js";
import { buildReasoningFrame } from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/reasoning-frame.js";
import { ImRuntime } from "../../../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { WukongConnection } from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/wukong.js";
import { waitFor } from "../../../test/runtime-fixture.js";

const require = createRequire(
  new URL("../../../packages/octo-runtime-extra-channel-gateway/package.json", import.meta.url)
);
const { fromMarkdown } = await import(require.resolve("mdast-util-from-markdown"));
const probe = process.env.OCTO_CARD_RENDER_PROBE;
const template = (version) => ({
  ref: { id: "ai.reasoning-process", version },
  maxPayloadBytes: 16384
});
const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
function render(frame, version) {
  const result = spawnSync(probe, [], {
    input: JSON.stringify({ version, state: frame.state, data: frame }) + "\n",
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function assertLiteral(value) {
  const visit = (node) => {
    assert.ok(
      ![
        "link",
        "image",
        "linkReference",
        "imageReference",
        "definition",
        "html",
        "emphasis",
        "strong",
        "inlineCode"
      ].includes(node.type),
      JSON.stringify({ value, type: node.type })
    );
    node.children?.forEach(visit);
  };
  visit(fromMarkdown(value));
}

for (const text of [
  "[HTML](/tmp/hello.html)",
  "![PNG](/tmp/a.png)",
  "[SVG](file:///tmp/a.svg)",
  "[relative](./hello.html)",
  "[Windows](C:/output/hello.html)",
  "[reference][file]\n\n[file]: /tmp/hello.html",
  "<file:///tmp/hello.html>",
  "`[literal](/tmp/a.png)` and **verified**",
  "\\[escaped](/tmp/a.png)",
  "prefix ".repeat(23) + "[file](/tmp/a.png)",
  "[**nested** ![PNG](/tmp/a.png)](/tmp/hello.html)",
  "[remote](https://cdn.example.com/a.html)"
]) {
  test(`card summaries remain literal while original final Markdown is preserved: ${text.slice(0, 65)}`, () => {
    const p = new ImRunProjector("literal");
    p.accept(event("model_step.started", { stepId: "s" }));
    p.accept(event("message.update", { messageId: "final", channel: "final", text }));
    p.accept(
      event("model_step.finished", { stepId: "s", status: "completed", finishReason: "stop" })
    );
    p.accept(event("run.completed"));
    for (const version of ["0.4.0", "0.4.1"]) {
      const frame = buildReasoningFrame(p.snapshot(), template(version));
      assert.equal(frame.state, "completed");
      for (const phase of frame.phases) {
        assertLiteral(phase.thought);
        for (const action of phase.actions) {
          assertLiteral(action.tool);
          assertLiteral(action.detail);
        }
      }
      if (probe) assert.deepEqual(render(frame, version), { ok: true });
    }
    assert.equal(p.finalReply.text, text);
  });
}

test("readable labels and alt text survive without deliverable Markdown", () => {
  const p = new ImRunProjector("labels");
  p.accept(
    event("message.update", {
      channel: "commentary",
      text: "Written **and verified**: [HTML](/tmp/a.html), ![PNG](/tmp/a.png)"
    })
  );
  const frame = buildReasoningFrame(p.snapshot(), template("0.4.1"));
  assert.equal(frame.phases[0].thought, "Written and verified: HTML, PNG");
});

for (const field of ["tool", "diagnostic", "failure", "empty-alt"]) {
  test(`all public card fields use literal, nonempty text: ${field}`, () => {
    const p = new ImRunProjector("public-fields");
    const text = field === "empty-alt" ? "![](/tmp/a.png)" : "[local](/tmp/hello.html)";
    const snapshot = p.snapshot();
    snapshot.phase = "tool";
    if (field === "tool")
      snapshot.items = [
        {
          id: "tool",
          kind: "tool",
          status: "completed",
          content: "",
          toolName: text,
          summary: text
        }
      ];
    else if (field === "diagnostic" || field === "empty-alt")
      snapshot.providerDiagnostic = {
        adapter: "fixture",
        diagnosticId: text,
        category: "fixture",
        message: text
      };
    else {
      snapshot.terminal = "failed";
      snapshot.failureMessage = text + " `brackets[]`".repeat(30);
      snapshot.failureDetail = text;
      snapshot.failure = {
        code: "OH-RUN-2010",
        diagnosticId: "diag_0123456789abcdef0123456789abcdef",
        action: { type: "check_runtime" }
      };
    }
    for (const version of ["0.4.0", "0.4.1"]) {
      const frame = buildReasoningFrame(snapshot, template(version));
      for (const phase of frame.phases) {
        assert.ok(phase.thought.trim());
        assertLiteral(phase.thought);
        for (const action of phase.actions) {
          assert.ok(action.tool.trim());
          assert.ok(action.detail.trim());
          assertLiteral(action.tool);
          assertLiteral(action.detail);
        }
      }
      if (frame.errorMessage) assertLiteral(frame.errorMessage);
      if (field === "failure") {
        assert.ok(frame.errorMessage.endsWith(snapshot.failure.diagnosticId));
        assert.ok(Array.from(frame.errorMessage).length <= 121);
      }
      if (probe) assert.deepEqual(render(frame, version), { ok: true });
    }
  });
}

for (const [rejectSvg, rejectTerminal] of [
  [false, false],
  [true, false],
  [false, true],
  [true, true]
]) {
  test(
    `real Runtime/transport finalizes the same progress card before local delivery, SVG rejected=${rejectSvg}, terminal rejected=${rejectTerminal}`,
    { skip: !probe, timeout: 15000 },
    async (t) => {
      const workspace = await mkdtemp(join(tmpdir(), "octo-249-"));
      t.after(() => rm(workspace, { recursive: true, force: true }));
      for (const name of ["hello.html", "a.png", "a.svg"])
        await writeFile(join(workspace, name), `fixture:${name}`);
      const accepted = [],
        rejected = [],
        finals = [],
        files = [],
        uploads = [],
        uploadCardStates = [],
        outcomes = [],
        diagnostics = [];
      let receive,
        calls = 0,
        terminalRejected = false;
      const version = "0.4.1";
      const currentTemplate = template(version);
      t.mock.method(globalThis, "fetch", async (url, init) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith("/auth/verify-bot"))
          return Response.json({ bot_uid: "bot", space_id: "space" });
        if (parsed.pathname.endsWith("/bot/register"))
          return Response.json({
            robot_id: "bot",
            ws_url: "wss://fixture.invalid/ws",
            im_token: randomUUID()
          });
        if (parsed.pathname.endsWith("/card/profile"))
          return Response.json({
            available: true,
            enabled: true,
            card_version: "1.5",
            profiles: ["octo/v1", "octo/v2"],
            config: {
              card_enabled: true,
              display_enabled: true,
              interaction_enabled: true,
              reasoning_enabled: true,
              reasoning_template_ref: currentTemplate.ref
            },
            templating: {
              supported: true,
              wire: "template-ref/v1",
              templates: [
                {
                  ...currentTemplate.ref,
                  available: true,
                  views: [
                    {
                      name: "active",
                      wire_profile: "octo/v2",
                      states: ["reasoning", "answering"],
                      submit_actions: []
                    },
                    {
                      name: "error",
                      wire_profile: "octo/v2",
                      states: ["error"],
                      submit_actions: []
                    },
                    {
                      name: "result",
                      wire_profile: "octo/v1",
                      states: ["completed", "stopped"],
                      submit_actions: []
                    }
                  ]
                }
              ]
            }
          });
        if (parsed.pathname.endsWith("/events"))
          return new Promise((_resolve, reject) => {
            const abort = () => reject(init.signal.reason);
            init.signal.addEventListener("abort", abort, { once: true });
            if (init.signal.aborted) abort();
          });
        if (parsed.pathname.endsWith("/sendMessage") || parsed.pathname.endsWith("/message/edit")) {
          const body = JSON.parse(init.body);
          if (body.payload?.type === 1) {
            finals.push(body.payload.content);
            return Response.json({ message_id: "final-message" });
          }
          if (body.payload?.type === 8) {
            files.push(body.payload);
            return Response.json({ message_id: `file-${files.length}` });
          }
          const frame = body.data ?? body.payload.data;
          const validation = render(frame, version);
          if (rejectTerminal && frame.state === "completed" && !terminalRejected) {
            terminalRejected = true;
            rejected.push({ body, error: "injected rich terminal rejection" });
            return Response.json({ error: "rich terminal rejected" }, { status: 400 });
          }
          if (!validation.ok) {
            rejected.push({ body, error: validation.error });
            return Response.json({ error: validation.error }, { status: 400 });
          }
          accepted.push({ body, frame });
          return Response.json({ message_id: "progress-card" });
        }
        if (parsed.pathname.endsWith("/upload/presigned")) {
          const name = parsed.searchParams.get("filename");
          uploadCardStates.push(accepted.at(-1).frame.state);
          if (rejectSvg && name === "a.svg")
            return Response.json({ error: "type rejected" }, { status: 415 });
          return Response.json({
            method: "PUT",
            uploadUrl: `https://storage.example.com/${name}`,
            downloadUrl: `https://cdn.example.com/${name}`
          });
        }
        if (parsed.origin === "https://storage.example.com") {
          uploads.push(parsed.pathname.slice(1));
          return new Response(null, { status: 200 });
        }
        if (parsed.pathname.includes("read")) return Response.json({});
        throw new Error(`unexpected request: ${parsed.pathname}`);
      });
      t.mock.method(WukongConnection.prototype, "connect", async function () {
        receive = this.onMessage;
      });
      t.mock.getter(WukongConnection.prototype, "connected", () => true);
      t.mock.method(WukongConnection.prototype, "close", async () => {});
      const text = `Written and verified: [HTML](${join(workspace, "hello.html")}) ![PNG](${join(workspace, "a.png")}) [SVG](${join(workspace, "a.svg")})`;
      const runtime = new ImRuntime(
        {
          bot_id: "bot",
          api_url: "https://fixture.invalid/api",
          typing: false,
          adapter: { adapter_type: "openclaw" }
        },
        {
          credentials: async () => `bf_${randomUUID()}`,
          kernel: {
            async *invoke() {
              calls++;
              yield event("model_step.started", { stepId: "prepare" });
              yield event("message.update", {
                messageId: "progress",
                channel: "commentary",
                text: "Preparing files"
              });
              await waitFor(() => accepted.length > 0, 5000);
              yield event("model_step.finished", {
                stepId: "prepare",
                status: "completed",
                finishReason: "tool-calls"
              });
              yield event("model_step.started", { stepId: "answer" });
              yield event("message.update", {
                messageId: "final",
                stepId: "answer",
                channel: "final",
                text
              });
              yield event("model_step.finished", {
                stepId: "answer",
                status: "completed",
                finishReason: "stop"
              });
              yield event("run.completed");
            },
            async cancelInvocation() {
              throw new Error("completed generation must not be cancelled");
            }
          },
          log(_level, name, data) {
            if (name === "agent_run.finished") outcomes.push(data.status);
            if (name === "channel.diagnostic") diagnostics.push(data);
          }
        }
      );
      t.after(() => runtime.close().catch(() => {}));
      await runtime.start();
      assert.equal(runtime.status.state, "online");
      receive({
        messageId: "create",
        fromUid: "owner",
        channelId: "owner",
        channelType: 1,
        payload: { type: 1, content: "Create local files" }
      });
      await waitFor(() => finals.length > 0 && runtime.status.sessions.length === 0, 10000);
      t.diagnostic(
        JSON.stringify({
          outcome: outcomes,
          lastAcceptedCard: accepted.at(-1).frame.state,
          rejectedCards: rejected.map(({ body, error }) => ({ state: body.state, error })),
          uploads,
          finalHasUploadedHtml: finals[0].includes("https://cdn.example.com/hello.html")
        })
      );
      assert.equal(calls, 1);
      assert.deepEqual(outcomes, ["completed"]);
      assert.equal(rejected.length, rejectTerminal ? 1 : 0);
      assert.ok(!diagnostics.some(({ code }) => code === "IM_PRESENTATION_FAILED"));
      if (rejectTerminal) {
        assert.equal(
          diagnostics.find(({ code }) => code === "IM_CARD_EDIT_400").path,
          "/v1/bot/message/edit"
        );
        assert.ok(diagnostics.some(({ code }) => code === "IM_CARD_TERMINAL_DEGRADED"));
        assert.equal(accepted.at(-1).body.card_seq, rejected[0].body.card_seq + 1);
      }
      assert.ok(
        uploadCardStates.every((state) => state === "completed"),
        "terminal card must land before uploads"
      );
      assert.equal(accepted.at(-1).frame.state, "completed");
      assert.equal(accepted.at(-1).body.message_id, "progress-card");
      assert.equal(accepted.at(-1).body.transient, undefined);
      assert.equal(accepted.at(-1).frame.traceCollapsed, true);
      assert.equal(accepted.at(-1).frame.progressText, undefined);
      assert.match(finals[0], /\[HTML\]\(https:\/\/cdn.example.com\/hello.html\)/);
      assert.match(finals[0], /!\[PNG\]\(https:\/\/cdn.example.com\/a.png\)/);
      assert.equal(files.length, rejectSvg ? 1 : 2);
      assert.deepEqual(
        uploads,
        rejectSvg ? ["hello.html", "a.png"] : ["hello.html", "a.png", "a.svg"]
      );
      if (rejectSvg) assert.match(finals[0], /a.svg \(upload-rejected\)/);
      else assert.doesNotMatch(finals[0], /delivery failed/);
      await runtime.close();
    }
  );
}
