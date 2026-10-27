import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { Readable, PassThrough } from "node:stream";
import { runCli } from "../apps/cli/dist/main.js";
import { commandConfig } from "../apps/cli/dist/extra-command-config.js";
import { runtimePaths, withSetupLock } from "../apps/cli/dist/state.js";
import { setExtra, readExtra } from "../apps/cli/dist/extras.js";
import { loadCliManifest } from "../apps/cli/dist/module-manifest.js";

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "octo-commands-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}
async function cli(home, args, input = "", dependencies = {}) {
  const output = [],
    errors = [];
  const code = await runCli(["--home", home, ...args], {
    input: Readable.from([input]),
    output: (line) => output.push(line),
    errorOutput: (line) => errors.push(line),
    ...dependencies
  });
  return { code, output: output.join("\n"), errors: errors.join("\n") };
}
const configPath = (home, name) => join(home, "extras", name, "config.json");
const stored = async (home, name) => JSON.parse(await readFile(configPath(home, name), "utf8"));

for (const name of ["channel-gateway", "channel-wecom", "webui"]) {
  test(`${name}: all help levels are offline and do not create configuration`, async (t) => {
    const home = await fixture(t);
    for (const flag of ["-h", "--help"]) {
      for (const path of [[], ["config"], ["config", "set"], ["configure"]]) {
        const result = await cli(home, [name, ...path, flag]);
        assert.equal(result.code, 0, result.errors);
        assert.match(result.output, /Usage:/);
      }
    }
    assert.match((await cli(home, [name, "--help"])).output, /configure/);
    assert.match((await cli(home, [name, "config", "get", "-h"])).output, /INCLUDING CREDENTIALS/);
    await assert.rejects(access(join(home, "extras")));
  });
}

for (const name of ["channel-gateway", "channel-wecom"]) {
  test(`${name}: core configure upserts by business identity and preserves host fields`, async (t) => {
    const home = await fixture(t);
    const token = randomBytes(24).toString("hex");
    const address = name === "channel-gateway" ? ["--api-url", "https://im.example.com/api/"] : [];
    const required = ["configure", "--bot-id", "机器人", ...address, "--workdir", home];
    const first = await cli(
      home,
      [name, ...required, "--credential-stdin", "--json"],
      token + "\r\n"
    );
    assert.equal(first.code, 0, first.errors);
    assert.equal(JSON.parse(first.output).reload_required, true);
    assert.ok(!first.output.includes(token));
    const initial = await stored(home, name);
    initial.enabled = false;
    initial.module = `@mininglamp-oss/octo-runtime-extra-${name}`;
    initial.config.bots[0].bot_name = "保留名称";
    initial.config.bots[0].allowed_sender_ids = [];
    await setExtra(runtimePaths(home, "default"), name, Readable.from([JSON.stringify(initial)]));
    const updated = await cli(home, [name, ...required, "--model", "some-model"]);
    assert.equal(updated.code, 0, updated.errors);
    assert.match(updated.output, /Restart this Extra/);
    assert.ok(!updated.output.includes(token));
    const data = await stored(home, name);
    assert.equal(data.config.bots.length, 1);
    assert.equal(data.enabled, false);
    assert.equal(data.module, initial.module);
    assert.equal(data.config.bots[0].bot_name, "保留名称");
    assert.deepEqual(data.config.bots[0].allowed_sender_ids, []);
    assert.equal(data.config.bots[0].adapter.model, "some-model");
    assert.equal(
      data.config.bots[0][name === "channel-gateway" ? "bf_token" : "app_secret"],
      token
    );
    if (process.platform !== "win32")
      assert.equal((await stat(configPath(home, name))).mode & 0o777, 0o600);
    const other = required.map((value) => (value === "机器人" ? "second" : value));
    assert.equal((await cli(home, [name, ...other])).code, 0);
    assert.equal((await stored(home, name)).config.bots.length, 2);
    const manifest = await loadCliManifest(home);
    const registration = await readExtra(runtimePaths(home, "default"), name, manifest);
    assert.deepEqual(registration.config, (await stored(home, name)).config);
    assert.equal(registration.enabled, false);
  });
}

test("Gateway canonical URL deduplication and distinct endpoints", async (t) => {
  const home = await fixture(t);
  for (const api of [
    "https://IM.example.com:443/api/",
    "https://im.example.com/api",
    "https://other.example.com/api"
  ]) {
    const result = await cli(home, [
      "channel-gateway",
      "configure",
      "--bot-id",
      "one",
      "--api-url",
      api
    ]);
    assert.equal(result.code, 0, result.errors);
  }
  assert.equal((await stored(home, "channel-gateway")).config.bots.length, 2);
});

test("WebUI keeps one configuration and supports JSON replacement/get and legacy envelope", async (t) => {
  const home = await fixture(t);
  const args = ["webui", "configure", "--session-store-path", join(home, "sessions.json")];
  assert.equal((await cli(home, args)).code, 0);
  assert.equal((await cli(home, ["webui", "configure", "--port", "14444"])).code, 0);
  assert.equal((await stored(home, "webui")).config.port, 14444);
  const envelope = await cli(home, ["extraget", "webui"]);
  assert.deepEqual(JSON.parse(envelope.output), await stored(home, "webui"));
  const business = { sessionStorePath: join(home, "second.json"), port: 15555 };
  assert.equal((await cli(home, ["webui", "config", "set"], JSON.stringify(business))).code, 0);
  assert.deepEqual(JSON.parse((await cli(home, ["webui", "config", "get"])).output), business);
  assert.equal((await cli(home, ["webui", "configure", "--port", "65536"])).code, 2);
  assert.deepEqual((await stored(home, "webui")).config, business);
});

test("Invalid input, duplicates, profile, oversized input and credentials never replace valid config", async (t) => {
  const home = await fixture(t);
  const token = randomBytes(24).toString("hex");
  const bot = {
    bot_id: "one",
    api_url: "https://im.example.com/api",
    adapter: {},
    bf_token: token
  };
  assert.equal(
    (await cli(home, ["channel-gateway", "config", "set"], JSON.stringify({ bots: [bot] }))).code,
    0
  );
  const before = await readFile(configPath(home, "channel-gateway"), "utf8");
  for (const body of [
    JSON.stringify({ bots: [bot, bot] }),
    JSON.stringify({ bots: [{ ...bot, api_url: token }] }),
    JSON.stringify({ config: { bots: [bot] } }),
    token,
    "x".repeat(1024 * 1024 + 1)
  ]) {
    const result = await cli(home, ["channel-gateway", "config", "set", "--json"], body);
    assert.notEqual(result.code, 0);
    assert.ok(!result.output.includes(token));
    assert.ok(!result.errors.includes(token));
    assert.equal(await readFile(configPath(home, "channel-gateway"), "utf8"), before);
  }
  for (const args of [
    ["--profile", "work", "channel-gateway", "config", "set"],
    ["channel-gateway", "config", "set", "--profile", "work"],
    [
      "channel-gateway",
      "configure",
      "--bot-id",
      "one",
      "--api-url",
      "https://im.example.com/api",
      "--bf-token",
      token
    ]
  ])
    assert.equal((await cli(home, args, "{}")).code, 2);
});

test("CAS preserves concurrent extraset updates; cancellation preserves config; blank locks cannot be stolen", async (t) => {
  const home = await fixture(t);
  const paths = runtimePaths(home, "default");
  const api = commandConfig(paths, "webui", "example", new AbortController().signal);
  const first = await api.readConfig();
  await setExtra(
    paths,
    "webui",
    Readable.from([JSON.stringify({ enabled: false, config: { newer: true } })])
  );
  await assert.rejects(api.saveConfig({ stale: true }, first.revision), /EXTRA_CONFIG_CONFLICT/);
  const current = await api.readConfig();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    commandConfig(paths, "webui", "example", controller.signal).saveConfig({}, current.revision)
  );
  assert.deepEqual(await stored(home, "webui"), { enabled: false, config: { newer: true } });
  await mkdir(join(home, "run"), { recursive: true });
  await writeFile(paths.setupLock, "", { mode: 0o600 });
  await assert.rejects(
    withSetupLock(paths, async () => assert.fail("lock was stolen")),
    /SETUP_IN_PROGRESS/
  );
  assert.equal(await readFile(paths.setupLock, "utf8"), "");
});

test("Cancellation while waiting on credential stdin releases the command without saving", async (t) => {
  const home = await fixture(t);
  const input = new PassThrough(),
    controller = new AbortController();
  t.after(() => input.destroy());
  const pending = cli(
    home,
    [
      "channel-gateway",
      "configure",
      "--bot-id",
      "one",
      "--api-url",
      "https://im.example.com/api",
      "--credential-stdin"
    ],
    "",
    { input, commandSignal: controller.signal }
  );
  const timer = setTimeout(() => controller.abort(), 30);
  t.after(() => clearTimeout(timer));
  assert.equal((await pending).code, 130);
  await assert.rejects(access(configPath(home, "channel-gateway")));
  assert.equal(input.listenerCount("data"), 0);
});

async function external(
  t,
  source,
  exports = { ".": "./service.js", "./commands": "./commands.js" }
) {
  const home = await fixture(t);
  const directory = join(home, "node_modules", "outside-extra");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "outside-extra", type: "module", exports })
  );
  await writeFile(
    join(directory, "service.js"),
    'throw new Error("service must never be imported by commands");'
  );
  await writeFile(join(directory, "commands.js"), source);
  await writeFile(
    join(home, "manifest.json"),
    JSON.stringify({
      version: 1,
      adapters: [],
      extras: [{ name: "loop-daemon", module: "outside-extra" }]
    })
  );
  return home;
}
const externalSource = `export default { apiVersion: 1, commands: [{ name: "login", description: "Offline test login", options: [{name:"endpoint",type:"string",description:"Endpoint",required:true}], arguments:[{name:"literal"}], async run(ctx, input) { const old = await ctx.readConfig(); return {value:{...await ctx.saveConfig({...old.config,endpoint:input.options.endpoint,literal:input.arguments[0]??null},old.revision)}} } } ] };`;

test("External package adds direct command, lazy root/help and literal -- values", async (t) => {
  const home = await external(t, externalSource);
  const root = await cli(home, ["-h"]);
  assert.equal(root.code, 0, root.errors);
  assert.match(root.output, /loop-daemon/);
  assert.equal((await cli(home, ["loop-daemon", "login", "-h"])).code, 0);
  await assert.rejects(access(join(home, "extras")));
  const result = await cli(home, ["loop-daemon", "login", "--endpoint=--json", "--", "--home"]);
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual((await stored(home, "loop-daemon")).config, {
    endpoint: "--json",
    literal: "--home"
  });
  for (const args of [
    ["login"],
    ["login", "--endpoint", "a", "--endpoint", "b"],
    ["login", "--endpoint", "a", "extra", "extra"],
    ["login", "--endpoint", "a", "--manifest", "unused"]
  ])
    assert.equal((await cli(home, ["loop-daemon", ...args])).code, 2);
});

for (const [label, source, expected] of [
  ["broken import", 'import "dependency-that-does-not-exist";', "EXTRA_COMMAND_LOAD_FAILED"],
  [
    "unsupported API",
    "export default {apiVersion:2,commands:[]};",
    "EXTRA_COMMAND_API_UNSUPPORTED"
  ],
  [
    "reserved lifecycle",
    'export default {apiVersion:1,commands:[{name:"start",description:"bad",async run(){}}]};',
    "EXTRA_COMMAND_DEFINITION_INVALID"
  ],
  [
    "duplicates",
    'const c={name:"login",description:"bad",async run(){}};export default {apiVersion:1,commands:[c,c]};',
    "EXTRA_COMMAND_DEFINITION_INVALID"
  ],
  [
    "host flag conflict",
    'export default {apiVersion:1,commands:[{name:"login",description:"bad",options:[{name:"home",type:"string",description:"bad"}],async run(){}}]};',
    "EXTRA_COMMAND_DEFINITION_INVALID"
  ]
]) {
  test(`${label} is isolated from root help, other Extras and offline lifecycle`, async (t) => {
    const home = await external(t, source);
    assert.equal((await cli(home, ["-h"])).code, 0);
    const result = await cli(home, ["loop-daemon", "-h", "--json"]);
    assert.notEqual(result.code, 0);
    assert.equal(JSON.parse(result.output).error.code, expected);
    assert.equal((await cli(home, ["webui", "-h"])).code, 0);
    assert.equal((await cli(home, ["loop-daemon", "status", "--help"])).code, 0);
  });
}

test("No optional commands export retains lifecycle help", async (t) => {
  const home = await external(t, 'throw new Error("not exported");', { ".": "./service.js" });
  assert.equal((await cli(home, ["loop-daemon", "-h"])).code, 0);
  assert.equal((await cli(home, ["loop-daemon", "login"])).code, 2);
});

test("Explicit file command declaration supports nested commands and exit results", async (t) => {
  const home = await fixture(t);
  await writeFile(
    join(home, "commands.mjs"),
    'export default {apiVersion:1,commands:[{name:"account",description:"Accounts",commands:[{name:"check",description:"Check",async run(){return {value:{checked:true},exitCode:7}}}]}]};'
  );
  await writeFile(
    join(home, "manifest.json"),
    JSON.stringify({
      version: 1,
      adapters: [],
      extras: [{ name: "custom", module: "./never-import.mjs", commands: "./commands.mjs" }]
    })
  );
  for (const flag of ["-h", "--help"]) {
    assert.equal((await cli(home, ["custom", "account", flag])).code, 0);
    assert.equal((await cli(home, ["custom", "account", "check", flag])).code, 0);
  }
  const result = await cli(home, ["custom", "account", "check", "--json"]);
  assert.equal(result.code, 7);
  assert.deepEqual(JSON.parse(result.output), { checked: true });
});

test("Third-party handler failure never prints arbitrary credential-shaped errors or saves partial config", async (t) => {
  const token = randomBytes(24).toString("hex").toUpperCase();
  const home = await external(
    t,
    `export default {apiVersion:1,commands:[{name:"login",description:"Login",async run(ctx){await ctx.readConfig(); throw new Error(${JSON.stringify(token)});}}]};`
  );
  const result = await cli(home, ["loop-daemon", "login", "--json"]);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.output).error.code, "EXTRA_COMMAND_FAILED");
  assert.ok(!result.output.includes(token));
  await assert.rejects(access(configPath(home, "loop-daemon")));
});

test("Same-name ignored manifest entry is not imported", async (t) => {
  const home = await fixture(t);
  await writeFile(
    join(home, "manifest.json"),
    JSON.stringify({
      version: 1,
      adapters: [],
      extras: [{ name: "webui", module: "./bad-service.mjs", commands: "./bad-commands.mjs" }]
    })
  );
  const result = await cli(home, [
    "webui",
    "configure",
    "--session-store-path",
    join(home, "sessions.json")
  ]);
  assert.equal(result.code, 0, result.errors);
  assert.match(result.errors, /built-in declaration takes precedence/);
  assert.equal((await stored(home, "webui")).config.sessionStorePath, join(home, "sessions.json"));
});

test("Malformed stored config is not treated as first setup", async (t) => {
  const home = await fixture(t);
  const file = configPath(home, "webui");
  await mkdir(join(home, "extras", "webui"), { recursive: true });
  await writeFile(file, "{", { mode: 0o600 });
  const result = await cli(home, [
    "webui",
    "configure",
    "--session-store-path",
    join(home, "sessions.json")
  ]);
  assert.notEqual(result.code, 0);
  assert.equal(await readFile(file, "utf8"), "{");
});

test("Reserved Runtime namespace is rejected without importing it", async (t) => {
  const home = await fixture(t);
  await writeFile(
    join(home, "manifest.json"),
    JSON.stringify({
      version: 1,
      adapters: [],
      extras: [{ name: "doctor", module: "./unused.mjs" }]
    })
  );
  const result = await cli(home, ["--help", "--json"]);
  assert.equal(JSON.parse(result.output).error.code, "EXTRA_COMMAND_NAMESPACE_CONFLICT");
});

test("Legacy package without an exports map has no optional extension", async (t) => {
  const home = await external(t, 'throw new Error("unexported commands are not loaded");', null);
  const directory = join(home, "node_modules", "outside-extra");
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "outside-extra", type: "module", main: "./service.js" })
  );
  assert.equal((await cli(home, ["loop-daemon", "-h"])).code, 0);
});

test(
  "Two real CLI processes detect a conflicting snapshot after unlocked interaction",
  { timeout: 10000 },
  async (t) => {
    const home = await external(
      t,
      `export default {apiVersion:1,commands:[{name:"login",description:"Barrier login",async run(ctx){const old=await ctx.readConfig();ctx.output("ready");const value=await ctx.readStdin();return {value:{...await ctx.saveConfig({value},old.revision)}}}}]};`
    );
    const entry = fileURLToPath(new URL("../apps/cli/dist/index.js", import.meta.url));
    const processes = [1, 2].map(() =>
      spawn(process.execPath, [entry, "--home", home, "loop-daemon", "login", "--json"], {
        stdio: ["pipe", "pipe", "pipe"]
      })
    );
    t.after(() => {
      for (const process of processes) if (process.exitCode === null) process.kill();
    });
    const outputs = ["", ""];
    const completions = processes.map((process) => once(process, "close"));
    await Promise.all(
      processes.map(
        (process, index) =>
          new Promise((resolve, reject) => {
            process.on("error", reject);
            process.stdout.on("data", (chunk) => {
              outputs[index] += chunk.toString();
              if (outputs[index].includes("ready\n")) resolve();
            });
            process.stderr.resume();
            process.on("exit", (code) => {
              if (!outputs[index].includes("ready\n"))
                reject(new Error(`exited before barrier: ${code}`));
            });
          })
      )
    );
    processes[0].stdin.end("first");
    assert.equal((await completions[0])[0], 0);
    processes[1].stdin.end("second");
    assert.notEqual((await completions[1])[0], 0);
    assert.match(outputs[1], /EXTRA_CONFIG_CONFLICT/);
    assert.deepEqual((await stored(home, "loop-daemon")).config, { value: "first" });
  }
);

test("A custom command named json is not mistaken for a host flag", async (t) => {
  const home = await external(
    t,
    'export default {apiVersion:1,commands:[{name:"json",description:"A valid operation name",async run(){return {value:{ok:true}}}}]};'
  );
  const result = await cli(home, ["loop-daemon", "json"]);
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(JSON.parse(result.output), { ok: true });
});

test("config get always returns business JSON even when it contains a saved field", async (t) => {
  const home = await fixture(t);
  const config = { sessionStorePath: join(home, "sessions.json"), saved: true };
  assert.equal((await cli(home, ["webui", "config", "set"], JSON.stringify(config))).code, 0);
  const result = await cli(home, ["webui", "config", "get"]);
  assert.deepEqual(JSON.parse(result.output), config);
});

test("Concurrent stale-lock recovery cannot delete a newly acquired writer lock", async (t) => {
  const home = await fixture(t),
    paths = runtimePaths(home, "default");
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await once(child, "exit");
  await mkdir(join(home, "run"), { recursive: true });
  await writeFile(paths.setupLock, JSON.stringify({ pid: child.pid }), { mode: 0o600 });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let entered = 0;
  let rejected = 0;
  const actions = Array.from({ length: 8 }, () =>
    withSetupLock(paths, async () => {
      entered++;
      if (entered > 1) release();
      await gate;
    }).catch((error) => {
      if (++rejected === 7) release();
      throw error;
    })
  );
  t.after(release);
  const outcomes = await Promise.allSettled(actions);
  assert.equal(entered, 1);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  for (const result of outcomes)
    if (result.status === "rejected") assert.match(result.reason.message, /SETUP_IN_PROGRESS/);
});
