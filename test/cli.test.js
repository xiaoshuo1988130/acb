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
    input: options.input,
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

test("save reads handoff body from file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const bodyPath = path.join(dir, "handoff.md");
  fs.writeFileSync(bodyPath, "Changed files:\n- bin/acb.js\n- test/cli.test.js\n", "utf8");
  const env = { ACB_STORE: storePath };

  const saved = run(["save", "--summary", "Added file handoff", "--file", bodyPath], { env });
  assert.equal(saved.status, 0);

  const packet = JSON.parse(run(["latest", "--json"], { env }).stdout);
  assert.equal(packet.summary, "Added file handoff");
  assert.match(packet.body, /Changed files/);

  const prompt = run(["prompt", "--id", packet.id, "--no-copy"], { env });
  assert.equal(prompt.status, 0);
  assert.match(prompt.stdout, /## Context Body/);
  assert.match(prompt.stdout, /bin\/acb\.js/);
});

test("save reads handoff body from stdin", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  const saved = run(["save", "--from", "opencode", "--stdin"], {
    env,
    input: "Last agent found a failing smoke test.\nNext: inspect proxy logs.\n",
  });
  assert.equal(saved.status, 0);

  const packet = JSON.parse(run(["latest", "--json"], { env }).stdout);
  assert.equal(packet.from, "opencode");
  assert.match(packet.body, /failing smoke test/);
});

test("save rejects invalid body sources", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  const both = run(["save", "--summary", "bad", "--file", "x", "--stdin"], { env, input: "x" });
  assert.equal(both.status, 2);
  assert.match(both.stderr, /either --file or --stdin/);

  const missing = run(["save", "--file", path.join(dir, "missing.md")], { env });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /Cannot read --file/);
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

test("delete removes a single packet", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const env = { ACB_STORE: storePath };

  run(["save", "--summary", "first"], { env });
  run(["save", "--summary", "second"], { env });
  const packets = JSON.parse(run(["list", "--json"], { env }).stdout);
  assert.equal(packets.length, 2);

  const deleted = run(["delete", packets[0].id], { env });
  assert.equal(deleted.status, 0);
  assert.match(deleted.stdout, /deleted handoff packet/);

  const remaining = JSON.parse(run(["list", "--json"], { env }).stdout);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, packets[1].id);

  const missing = run(["delete", "pkt_missing"], { env });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No handoff packet found/);
});

test("clear defaults to current workspace and supports all", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const workspaceA = path.join(dir, "a");
  const workspaceB = path.join(dir, "b");
  fs.mkdirSync(workspaceA);
  fs.mkdirSync(workspaceB);
  const env = { ACB_STORE: storePath };

  run(["save", "--workspace", workspaceA, "--summary", "a1"], { env });
  run(["save", "--workspace", workspaceA, "--summary", "a2"], { env });
  run(["save", "--workspace", workspaceB, "--summary", "b1"], { env });

  const clearedWorkspace = run(["clear", "--workspace", workspaceA], { env });
  assert.equal(clearedWorkspace.status, 0);
  assert.match(clearedWorkspace.stdout, /cleared 2 handoff packet/);

  let packets = JSON.parse(run(["list", "--json"], { env }).stdout);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].workspace, workspaceB);

  const clearedAll = run(["clear", "--all"], { env });
  assert.equal(clearedAll.status, 0);
  assert.match(clearedAll.stdout, /cleared 1 handoff packet/);

  packets = JSON.parse(run(["list", "--json"], { env }).stdout);
  assert.equal(packets.length, 0);
});
