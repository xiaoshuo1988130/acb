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
    timeout: options.timeout || 5000,
  });
}

function rpc(method, params = {}, id = 1) {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

function notification(method, params = {}) {
  return `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`;
}

function parseJsonLines(stdout) {
  return stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
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

  const timeline = run(["timeline", "--workspace", workspace], { env });
  assert.equal(timeline.status, 0);
  assert.match(timeline.stdout, /ACB Timeline/);
  assert.match(timeline.stdout, new RegExp(packet.id));
  assert.match(timeline.stdout, /Implemented local handoff/);

  const timelineJson = run(["timeline", "--workspace", workspace, "--json"], { env });
  assert.equal(timelineJson.status, 0);
  assert.equal(JSON.parse(timelineJson.stdout)[0].id, packet.id);

  const markdownExport = run(["export", "--workspace", workspace], { env });
  assert.equal(markdownExport.status, 0);
  assert.match(markdownExport.stdout, /# ACB Handoff Export/);
  assert.match(markdownExport.stdout, /Implemented local handoff/);

  const jsonExport = run(["export", "--workspace", workspace, "--format", "json"], { env });
  assert.equal(jsonExport.status, 0);
  assert.equal(JSON.parse(jsonExport.stdout)[0].id, packet.id);

  const outPath = path.join(dir, "export.md");
  const fileExport = run(["export", "--workspace", workspace, "--out", outPath], { env });
  assert.equal(fileExport.status, 0);
  assert.match(fileExport.stdout, /exported 1 handoff packet/);
  assert.match(fs.readFileSync(outPath, "utf8"), /Implemented local handoff/);

  const prompt = run(["prompt", "--id", packet.id, "--no-copy"], { env });
  assert.equal(prompt.status, 0);
  assert.match(prompt.stdout, /You are taking over work from another local coding agent/);
  assert.match(prompt.stdout, /Implemented local handoff/);
  assert.match(prompt.stdout, /Do not publish yet/);

  const shown = run(["show", packet.id], { env });
  assert.equal(shown.status, 0);
  assert.match(shown.stdout, new RegExp(packet.id));
  assert.match(shown.stdout, /Implemented local handoff/);

  const shownJson = run(["show", packet.id, "--json"], { env });
  assert.equal(shownJson.status, 0);
  assert.equal(JSON.parse(shownJson.stdout).id, packet.id);

  const shownPrompt = run(["show", packet.id, "--prompt"], { env });
  assert.equal(shownPrompt.status, 0);
  assert.match(shownPrompt.stdout, /You are taking over work/);
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

test("save can attach an explicit git snapshot", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const workspace = path.join(dir, "repo");
  fs.mkdirSync(workspace);
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf8" });
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n", "utf8");
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  const saved = run(["save", "--workspace", workspace, "--summary", "Captured git state", "--git"], { env });
  assert.equal(saved.status, 0);

  const packet = JSON.parse(run(["latest", "--workspace", workspace, "--json"], { env }).stdout);
  assert.equal(packet.git.root, fs.realpathSync(workspace));
  assert.equal(packet.git.status.length, 1);
  assert.match(packet.git.status[0], /\?\? README\.md/);

  const prompt = run(["prompt", "--id", packet.id, "--no-copy"], { env });
  assert.equal(prompt.status, 0);
  assert.match(prompt.stdout, /## Git Snapshot/);
  assert.match(prompt.stdout, /dirty_files: 1/);
});

test("save rejects git snapshot outside a git workspace", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  const saved = run(["save", "--workspace", dir, "--summary", "not git", "--git"], { env });
  assert.equal(saved.status, 2);
  assert.match(saved.stderr, /requires a Git workspace/);
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

test("export validates requested format", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const result = run(["export", "--format", "html"], { env: { ACB_STORE: path.join(dir, "packets.json") } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--format must be markdown or json/);
});

test("import restores JSON exports and skips duplicates", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const sourceStore = path.join(dir, "source.json");
  const targetStore = path.join(dir, "target.json");
  const exportPath = path.join(dir, "handoffs.json");
  const workspace = path.join(dir, "workspace");
  fs.mkdirSync(workspace);

  const sourceEnv = { ACB_STORE: sourceStore };
  run(["save", "--workspace", workspace, "--summary", "portable packet", "--note", "import me"], { env: sourceEnv });
  const exported = run(["export", "--workspace", workspace, "--format", "json", "--out", exportPath], { env: sourceEnv });
  assert.equal(exported.status, 0);

  const targetEnv = { ACB_STORE: targetStore };
  const imported = run(["import", "--file", exportPath], { env: targetEnv });
  assert.equal(imported.status, 0);
  assert.match(imported.stdout, /imported 1 handoff packet/);

  const packets = JSON.parse(run(["list", "--json"], { env: targetEnv }).stdout);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].summary, "portable packet");

  const duplicate = run(["import", "--file", exportPath], { env: targetEnv });
  assert.equal(duplicate.status, 0);
  assert.match(duplicate.stdout, /skipped 1 duplicate/);
  assert.equal(JSON.parse(run(["list", "--json"], { env: targetEnv }).stdout).length, 1);

  const replaced = run(["import", "--file", exportPath, "--replace"], { env: targetEnv });
  assert.equal(replaced.status, 0);
  assert.match(replaced.stdout, /imported 1 handoff packet/);
  assert.equal(JSON.parse(run(["list", "--json"], { env: targetEnv }).stdout).length, 1);
});

test("import validates JSON packet shape", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const invalidPath = path.join(dir, "bad.json");
  fs.writeFileSync(invalidPath, JSON.stringify([{ id: "missing-required-fields" }]), "utf8");

  const result = run(["import", "--file", invalidPath], { env: { ACB_STORE: path.join(dir, "packets.json") } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid packet/);
});

test("store path prints configured store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "custom.json");
  const result = run(["store", "path"], { env: { ACB_STORE: storePath } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), storePath);
});

test("doctor reports local store and workspace state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const workspace = path.join(dir, "workspace");
  fs.mkdirSync(workspace);
  const env = { ACB_STORE: storePath };

  run(["save", "--workspace", workspace, "--summary", "doctor packet"], { env });

  const human = run(["doctor", "--workspace", workspace], { env });
  assert.equal(human.status, 0);
  assert.match(human.stdout, /ACB Doctor/);
  assert.match(human.stdout, /workspace_packets: 1/);

  const json = run(["doctor", "--workspace", workspace, "--json"], { env });
  assert.equal(json.status, 0);
  const report = JSON.parse(json.stdout);
  assert.equal(report.store_path, storePath);
  assert.equal(report.workspace, workspace);
  assert.equal(report.workspace_packets, 1);
  assert.equal(report.total_packets, 1);
  assert.equal(report.checks.store_readable, true);
  assert.equal(typeof report.checks.git_available, "boolean");
  assert.equal(typeof report.checks.clipboard_command_available, "boolean");
});

test("serve exposes handoff tools over MCP stdio", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const workspace = path.join(dir, "workspace");
  fs.mkdirSync(workspace);
  const env = { ACB_STORE: storePath };

  const saved = run(["save", "--workspace", workspace, "--summary", "MCP handoff", "--note", "Pull me"], { env });
  assert.equal(saved.status, 0);

  const input = [
    rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    }, 1),
    notification("notifications/initialized"),
    rpc("tools/list", {}, 2),
    rpc("tools/call", { name: "read_latest_handoff", arguments: { workspace } }, 3),
    rpc("tools/call", { name: "list_handoffs", arguments: { workspace, limit: 5 } }, 4),
  ].join("");

  const served = run(["serve"], { env, input });
  assert.equal(served.status, 0);
  assert.equal(served.stderr, "");
  const messages = parseJsonLines(served.stdout);
  assert.equal(messages.length, 4);
  assert.equal(messages[0].result.protocolVersion, "2025-06-18");
  assert.deepEqual(messages[0].result.capabilities, { tools: { listChanged: false } });
  assert.equal(messages[1].result.tools[0].name, "read_latest_handoff");
  assert.match(messages[2].result.content[0].text, /MCP handoff/);
  assert.equal(messages[2].result.structuredContent.packet.summary, "MCP handoff");
  assert.equal(messages[3].result.structuredContent.packets.length, 1);

  const id = messages[3].result.structuredContent.packets[0].id;
  const readById = run(["serve"], {
    env,
    input: rpc("tools/call", { name: "read_handoff", arguments: { id } }, 1),
  });
  assert.equal(readById.status, 0);
  const [readMessage] = parseJsonLines(readById.stdout);
  assert.equal(readMessage.result.structuredContent.packet.id, id);
  assert.match(readMessage.result.content[0].text, /MCP handoff/);
});

test("serve returns tool errors as tool results", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const env = { ACB_STORE: path.join(dir, "packets.json") };
  const input = rpc("tools/call", { name: "read_latest_handoff", arguments: { workspace: dir } }, 1);

  const served = run(["serve"], { env, input });
  assert.equal(served.status, 0);
  const [message] = parseJsonLines(served.stdout);
  assert.equal(message.result.isError, true);
  assert.match(message.result.content[0].text, /No handoff packet found/);
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
