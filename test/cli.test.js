import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const bin = path.resolve("bin/acb.js");

function run(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    cwd: options.cwd || process.cwd(),
  });
}

test("prints version and help", () => {
  const version = run(["--version"]);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), "acb 0.0.1");

  const help = run(["help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /AgentContextBus/);
  assert.match(help.stdout, /acb save/);
});

test("save, latest, list, and prompt use local store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const workspace = path.join(dir, "workspace");
  fs.mkdirSync(workspace);
  const env = { ACB_STORE: storePath };

  const saved = run([
    "save",
    "--from",
    "codex",
    "--workspace",
    workspace,
    "--summary",
    "Implemented local handoff",
    "--status",
    "tests pending",
    "--note",
    "Do not publish yet",
    "--tag",
    "mvp",
  ], { env });
  assert.equal(saved.status, 0);
  assert.match(saved.stdout, /saved handoff packet/);

  const latest = run(["latest", "--workspace", workspace, "--json"], { env });
  assert.equal(latest.status, 0);
  const packet = JSON.parse(latest.stdout);
  assert.equal(packet.from, "codex");
  assert.equal(packet.workspace, workspace);
  assert.equal(packet.summary, "Implemented local handoff");
  assert.deepEqual(packet.notes, ["Do not publish yet"]);
  assert.deepEqual(packet.tags, ["mvp"]);

  const listed = run(["list", "--workspace", workspace], { env });
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, new RegExp(packet.id));
  assert.match(listed.stdout, /Implemented local handoff/);

  const prompt = run(["prompt", "--id", packet.id, "--no-copy"], { env });
  assert.equal(prompt.status, 0);
  assert.match(prompt.stdout, /You are taking over work from another local coding agent/);
  assert.match(prompt.stdout, /Implemented local handoff/);
  assert.match(prompt.stdout, /Do not publish yet/);
});

test("save requires useful handoff content", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const result = run(["save"], { env: { ACB_STORE: path.join(dir, "packets.json") } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /needs at least/);
});

test("store path prints configured store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "custom.json");
  const result = run(["store", "path"], { env: { ACB_STORE: storePath } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), storePath);
});
