// 显式手动运行：node --test test/manual/npm-pack-json.test.mjs，不加入默认 CI。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { parseNpmPackResult } from "../../scripts/parse-npm-pack-result.mjs";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const name = "@fixture/runtime";
const result = { name, filename: "fixture-runtime-0.0.0.tgz", bundled: ["fixture-cli"] };
const parse = (value) => parseNpmPackResult(JSON.stringify(value), name);

test("数组按 name 选择目标，兼容空白和额外字段", () => {
  const value = [{ name: "other" }, { ...result, extra: true }];
  assert.deepEqual(parseNpmPackResult(` \n${JSON.stringify(value)}\n`, name), value[1]);
});

test("对象按自有包名键选择，允许目标省略 name", () => {
  assert.deepEqual(parse({ other: {}, [name]: result }), result);
  const { name: ignored, ...withoutName } = result;
  assert.deepEqual(parse({ other: { name: "other" }, [name]: withoutName }), withoutName);
  assert.equal(ignored, name);
  assert.deepEqual(
    parseNpmPackResult('{"__proto__":{"filename":"a.tgz","bundled":[]}}', "__proto__"),
    {
      filename: "a.tgz",
      bundled: []
    }
  );
});

for (const [label, value, reason] of [
  ["空数组", [], /缺少/],
  ["空对象", {}, /缺少/],
  ["其他数组包", [{ name: "other" }], /缺少/],
  ["其他对象包", { other: {} }, /缺少/],
  ["继承属性名不是自有包", {}, /缺少/],
  ["重复目标", [result, result], /歧义/],
  ["null", null, /结果必须/],
  ["标量", 42, /结果必须/],
  ["字符串", "text", /结果必须/],
  ["null 数组条目", [null], /数组条目/],
  ["数组嵌套", [[]], /数组条目/],
  ["缺少 name", [{}], /数组条目/],
  ["name 非字符串", [{ name: 1 }], /数组条目/],
  ["name 空白", [{ name: " " }], /数组条目/],
  ["对象条目 null", { [name]: null }, /元数据必须/],
  ["对象条目数组", { [name]: [] }, /元数据必须/],
  ["对象身份冲突", { [name]: { ...result, name: "other" } }, /不一致/],
  ["其他键冒充目标", { other: result }, /不一致/],
  ["对象 name null", { [name]: { ...result, name: null } }, /不一致/]
]) {
  test(`拒绝${label}`, () => {
    const expected = label === "继承属性名不是自有包" ? "toString" : name;
    assert.throws(
      () => parseNpmPackResult(JSON.stringify(value), expected),
      (error) => {
        assert.equal(error.name, "Error");
        assert.ok(error.message.includes(`npm pack --json (${expected})`));
        assert.match(error.message, reason);
        return true;
      }
    );
  });
}

test("非法 JSON 保留 cause 和预期包上下文", () => {
  for (const value of ["", "not json", `log\n${JSON.stringify([result])}`]) {
    assert.throws(
      () => parseNpmPackResult(value, name),
      (error) => {
        assert.ok(error.message.includes(name));
        assert.match(error.message, /无效 JSON/);
        assert.ok(error.cause instanceof SyntaxError);
        return true;
      }
    );
  }
});

for (const filename of [
  undefined,
  null,
  1,
  "",
  " ",
  "a.zip",
  "../a.tgz",
  "/a.tgz",
  "a\\b.tgz",
  " a.tgz",
  "a.tgz ",
  "a\0.tgz",
  "a\n.tgz",
  "a\r.tgz",
  ".",
  ".."
]) {
  test(`拒绝 filename ${JSON.stringify(filename)}`, () => {
    assert.throws(() => parse([{ ...result, filename }]), /filename/);
  });
}

for (const bundled of [undefined, null, "", {}, [null], [1], [""], [" "], [" pkg"], ["pkg "]]) {
  test(`拒绝 bundled ${JSON.stringify(bundled)}`, () => {
    assert.throws(() => parse({ [name]: { ...result, bundled } }), /bundled/);
  });
}

test("空 bundled 结构合法，保留数量检查责任", () => {
  assert.deepEqual(parse([{ ...result, bundled: [] }]).bundled, []);
});

// 复制真实脚本到最小物料树，仅替换外部 npm 和未使用的 DSH bundler。
// 由子进程跑完整入口，验证 helper 接线、原数量检查、成功输出和 finally 清理。
test("完整打包脚本：两种结果、数量不足、非法元数据及 npm 失败", async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "npm-pack-json-test-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const put = async (file, value) => {
    const target = join(directory, file);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, value);
  };
  for (const folder of ["scripts", "packages", "apps/cli/dist", "dist/public"]) {
    await mkdir(join(directory, folder), { recursive: true });
  }
  for (const file of ["pack-release.mjs", "parse-npm-pack-result.mjs"]) {
    await copyFile(join(root, "scripts", file), join(directory, "scripts", file));
  }
  await put(
    "scripts/bundle-dsh-client.mjs",
    'export const dshAdapterName="unused", dshClientName="unused-client", bundleDshClient=()=>{throw new Error("unexpected DSH bundle")};'
  );
  await put(
    "package.json",
    JSON.stringify({
      name,
      version: "0.0.0",
      dependencies: {},
      exports: {},
      engines: { node: ">=24" }
    })
  );
  await put("apps/cli/package.json", JSON.stringify({ name: "fixture-cli", version: "0.0.0" }));
  for (const file of ["README.md", "LICENSE", "apps/cli/README.md", "apps/cli/dist/index.js"])
    await put(file, "fixture\n");
  await put(
    "npm-cli.js",
    `
    const fs = require("node:fs");
    const path = require("node:path");
    fs.writeFileSync(process.env.PACK_TEST_CWD, process.cwd());
    if (process.env.PACK_TEST_FAIL) {
      console.error("fixture npm command failed");
      process.exit(7);
    }
    const destination = process.argv[process.argv.indexOf("--pack-destination") + 1];
    fs.writeFileSync(path.join(destination, "${result.filename}"), "fixture archive");
    console.log(process.env.PACK_TEST_JSON);
  `
  );
  // .js 使用 fixture 根的 CommonJS 默认值，与真实 npm-cli.js 入口兼容。
  for (const [label, metadata, failure] of [
    ["array", [{ name: "other" }, result]],
    ["object", { [name]: result }],
    ["object without name", { [name]: { filename: result.filename, bundled: result.bundled } }],
    ["incomplete", [{ ...result, bundled: [] }], /npm 未完整打包生产依赖/],
    ["invalid filename", [{ ...result, filename: "../escape.tgz" }], /filename/],
    ["missing package", {}, /缺少预期包元数据/],
    ["ambiguous package", [result, result], /歧义/],
    ["malformed bundled", [{ ...result, bundled: null }], /bundled/],
    ["invalid JSON", "not json", /无效 JSON/],
    ["npm failed", [], /fixture npm command failed/]
  ]) {
    await t.test(label, async () => {
      const record = join(directory, "npm-cwd.txt");
      const invocation = execute(process.execPath, [join(directory, "scripts/pack-release.mjs")], {
        cwd: directory,
        timeout: 10_000,
        env: {
          ...process.env,
          npm_execpath: join(directory, "npm-cli.js"),
          PACK_TEST_CWD: record,
          PACK_TEST_JSON: typeof metadata === "string" ? metadata : JSON.stringify(metadata),
          PACK_TEST_FAIL: label === "npm failed" ? "1" : ""
        }
      });
      if (failure) {
        await assert.rejects(invocation, (error) => {
          assert.notEqual(error.code, 0);
          assert.equal(error.stdout, "");
          assert.match(error.stderr, failure);
          if (label === "npm failed") assert.doesNotMatch(error.stderr, /无效 JSON/);
          return true;
        });
      } else {
        const { stdout, stderr } = await invocation;
        assert.equal(stdout, `${join(directory, "dist/release", result.filename)}\n`);
        assert.equal(stderr, "");
        await access(stdout.trim());
      }
      const temporary = await readFile(record, "utf8");
      await assert.rejects(access(temporary), { code: "ENOENT" });
    });
  }
});
