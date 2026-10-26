import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";
import { recoveryLiveFaults } from "../test-support/recovery-live-faults.mjs";

test("live fault preload records only the main thread when workers inherit NODE_OPTIONS", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recovery-preload-"));
  const controlFile = join(directory, "fault.json"),
    eventsFile = join(directory, "events");
  try {
    await writeFile(controlFile, JSON.stringify({ blocked: false, drop: 1 }));
    await writeFile(eventsFile, "");
    const preload = new URL("../test-support/recovery-live-faults.mjs", import.meta.url).href;
    await promisify(execFile)(
      process.execPath,
      [
        "--eval",
        `const { Worker } = require("node:worker_threads");
const worker = new Worker("setTimeout(() => {}, 350)", { eval: true });
worker.once("error", (error) => { throw error; });
worker.once("exit", (code) => { process.exitCode = code; });`
      ],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${preload}`,
          OCTO_RECOVERY_QA_CONTROL: controlFile,
          OCTO_RECOVERY_QA_EVENTS: eventsFile
        },
        timeout: 10_000,
        killSignal: "SIGKILL",
        maxBuffer: 32 * 1024
      }
    );
    const events = (await readFile(eventsFile, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(events.length, 1, "the inherited preload must not record a worker drop");
    assert.equal(events[0].event, "drop");
    assert.equal(events[0].sockets, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("live fault harness isolates test auth, drops once and restores global hooks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recovery-probe-"));
  const controlFile = join(directory, "fault.json"),
    eventsFile = join(directory, "events");
  const originalFetch = globalThis.fetch,
    originalSend = WebSocket.prototype.send;
  const forwarded = [];
  globalThis.fetch = async (url) => {
    forwarded.push(String(url));
    return new Response("ok");
  };
  WebSocket.prototype.send = function () {
    return "sent";
  };
  const stubFetch = globalThis.fetch,
    stubSend = WebSocket.prototype.send;
  let restore;
  try {
    await writeFile(controlFile, JSON.stringify({ blocked: true, drop: 0 }));
    restore = recoveryLiveFaults({ controlFile, eventsFile });
    await assert.rejects(
      globalThis.fetch("https://im-test.deepminer.com.cn/api/v1/auth/verify-bot"),
      /RECOVERY_QA_LOCAL_NETWORK_FAULT/
    );
    await globalThis.fetch("https://im.deepminer.com.cn/api/v1/auth/verify-bot");
    await globalThis.fetch("https://im-test.deepminer.com.cn/api/v1/bot/register");
    assert.equal(forwarded.length, 2);
    const socket = new EventEmitter();
    let drops = 0;
    socket.terminate = () => {
      drops++;
      socket.emit("close");
    };
    assert.equal(WebSocket.prototype.send.call(socket), "sent");
    await writeFile(controlFile, JSON.stringify({ blocked: false, drop: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(drops, 1);
    await globalThis.fetch("https://im-test.deepminer.com.cn/api/v1/auth/verify-bot");
    assert.equal(forwarded.length, 3);
    const events = (await readFile(eventsFile, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(
      events.map((event) => event.event),
      ["blocked_auth", "drop"]
    );
    assert.equal(events[1].sockets, 1);
    restore();
    restore = undefined;
    assert.equal(globalThis.fetch, stubFetch);
    assert.equal(WebSocket.prototype.send, stubSend);
  } finally {
    restore?.();
    globalThis.fetch = originalFetch;
    WebSocket.prototype.send = originalSend;
    await rm(directory, { recursive: true, force: true });
  }
});
