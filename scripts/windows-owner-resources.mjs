import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyWindowsOwnerResources(directory) {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.toolchain, "go1.25.14");
  const license = await readFile(join(directory, "LICENSE.go"), "utf8");
  assert.match(license, /Copyright 2009 The Go Authors\./);
  assert.match(license, /Redistribution and use in source and binary forms/);
  for (const [architecture, machine] of [
    ["amd64", 0x8664],
    ["arm64", 0xaa64]
  ]) {
    const name = `windows-process-owner-${architecture}.exe`;
    const bytes = await readFile(join(directory, name));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.binaries[name]);
    assert.equal(bytes.toString("ascii", 0, 2), "MZ");
    const pe = bytes.readUInt32LE(0x3c);
    assert.equal(bytes.toString("ascii", pe, pe + 4), "PE\0\0");
    assert.equal(bytes.readUInt16LE(pe + 4), machine);
  }
}
