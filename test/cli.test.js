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

  const status = run(["status", "--workspace", workspace], { env });
  assert.equal(status.status, 0);
  assert.match(status.stdout, /ACB Status/);
  assert.match(status.stdout, new RegExp(packet.id));
  assert.match(status.stdout, /next_resume/);
  assert.match(status.stdout, new RegExp(`acb resume --id ${packet.id}`));

  const statusJson = run(["status", "--workspace", workspace, "--json"], { env });
  assert.equal(statusJson.status, 0);
  const statusReport = JSON.parse(statusJson.stdout);
  assert.equal(statusReport.latest_packet.id, packet.id);
  assert.equal(statusReport.workspace_packets, 1);
  assert.equal(statusReport.next.resume, `acb resume --id ${packet.id}`);
  assert.equal(statusReport.next.copy_prompt, `acb prompt --id ${packet.id}`);

  const listed = run(["list", "--workspace", workspace], { env });
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, new RegExp(packet.id));
  assert.match(listed.stdout, /Implemented local handoff/);

  const workspaces = run(["workspaces"], { env });
  assert.equal(workspaces.status, 0);
  assert.match(workspaces.stdout, /ACB Workspaces/);
  assert.match(workspaces.stdout, new RegExp(workspace));

  const workspacesJson = run(["workspaces", "--json"], { env });
  assert.equal(workspacesJson.status, 0);
  const workspaceSummary = JSON.parse(workspacesJson.stdout)[0];
  assert.equal(workspaceSummary.workspace, workspace);
  assert.equal(workspaceSummary.packets, 1);
  assert.equal(workspaceSummary.latest_packet_id, packet.id);

  const searched = run(["search", "publish", "--workspace", workspace], { env });
  assert.equal(searched.status, 0);
  assert.match(searched.stdout, /ACB Search: publish/);
  assert.match(searched.stdout, new RegExp(packet.id));

  const searchedJson = run(["search", "mvp", "--workspace", workspace, "--json"], { env });
  assert.equal(searchedJson.status, 0);
  assert.equal(JSON.parse(searchedJson.stdout)[0].id, packet.id);

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

  const previewPath = path.join(dir, "preview", "handoff.md");
  const preview = run(["preview", "--id", packet.id, "--out", previewPath], { env });
  assert.equal(preview.status, 0);
  assert.match(preview.stdout, /wrote prompt preview/);
  const previewContent = fs.readFileSync(previewPath, "utf8");
  assert.match(previewContent, /# ACB Handoff Prompt Preview/);
  assert.match(previewContent, /Implemented local handoff/);

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

test("save can immediately render a handoff prompt", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  const saved = run([
    "save",
    "--from",
    "codex",
    "--summary",
    "One step handoff",
    "--note",
    "Paste directly into the next agent",
    "--print-prompt",
  ], { env });
  assert.equal(saved.status, 0);
  assert.match(saved.stdout, /You are taking over work/);
  assert.match(saved.stdout, /One step handoff/);
  assert.match(saved.stdout, /Paste directly into the next agent/);

  const packet = JSON.parse(run(["latest", "--json"], { env }).stdout);
  assert.equal(packet.summary, "One step handoff");

  const invalid = run(["save", "--summary", "bad", "--copy", "--print-prompt"], { env });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Use only one save output mode/);
});

test("save can return the created packet as JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  const saved = run([
    "save",
    "--from",
    "script",
    "--summary",
    "Machine readable packet",
    "--json",
  ], { env });
  assert.equal(saved.status, 0);
  const packet = JSON.parse(saved.stdout);
  assert.match(packet.id, /^pkt_/);
  assert.equal(packet.from, "script");
  assert.equal(packet.summary, "Machine readable packet");

  const latest = JSON.parse(run(["latest", "--json"], { env }).stdout);
  assert.equal(latest.id, packet.id);

  const invalid = run(["save", "--summary", "bad", "--json", "--copy"], { env });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Use only one save output mode/);
});

test("handoff is a one-step save entrypoint", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  const prompt = run([
    "handoff",
    "--from",
    "codex",
    "--summary",
    "Handoff shortcut",
    "--note",
    "Use the main entrypoint",
    "--print-prompt",
  ], { env });
  assert.equal(prompt.status, 0);
  assert.match(prompt.stdout, /You are taking over work/);
  assert.match(prompt.stdout, /Handoff shortcut/);

  const packet = JSON.parse(run(["latest", "--json"], { env }).stdout);
  assert.equal(packet.summary, "Handoff shortcut");

  const json = run(["handoff", "--summary", "Machine handoff", "--json"], { env });
  assert.equal(json.status, 0);
  assert.equal(JSON.parse(json.stdout).summary, "Machine handoff");

  const noCopy = run(["handoff", "--summary", "Two step handoff", "--no-copy"], { env });
  assert.equal(noCopy.status, 0);
  assert.match(noCopy.stdout, /saved handoff packet/);
  assert.match(noCopy.stdout, /next: acb prompt/);

  const invalid = run(["handoff", "--summary", "bad", "--no-copy", "--json"], { env });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Use only one handoff output mode/);
});

test("resume is a downstream handoff entrypoint", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const workspace = path.join(dir, "workspace");
  fs.mkdirSync(workspace);
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  run([
    "handoff",
    "--workspace",
    workspace,
    "--summary",
    "Resume shortcut",
    "--note",
    "Continue from here",
    "--no-copy",
  ], { env });
  const packet = JSON.parse(run(["latest", "--workspace", workspace, "--json"], { env }).stdout);

  const prompt = run(["resume", "--workspace", workspace, "--print-prompt"], { env });
  assert.equal(prompt.status, 0);
  assert.match(prompt.stdout, /You are taking over work/);
  assert.match(prompt.stdout, /Resume shortcut/);
  assert.match(prompt.stdout, /Continue from here/);

  const json = run(["resume", "--id", packet.id, "--json"], { env });
  assert.equal(json.status, 0);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.packet.id, packet.id);
  assert.match(payload.prompt, /Resume shortcut/);

  const missing = run(["resume", "--workspace", path.join(dir, "missing"), "--print-prompt"], { env });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No handoff packet found to resume/);

  const invalid = run(["resume", "--id", packet.id, "--json", "--print-prompt"], { env });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Use only one resume output mode/);
});

test("update edits packet metadata, tags, notes, and body", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const bodyPath = path.join(dir, "updated.md");
  fs.writeFileSync(bodyPath, "Updated body from a follow-up pass.\n", "utf8");
  const env = { ACB_STORE: storePath };

  run([
    "save",
    "--from",
    "codex",
    "--summary",
    "Original handoff",
    "--status",
    "draft",
    "--note",
    "old note",
    "--tag",
    "old",
  ], { env });
  const original = JSON.parse(run(["latest", "--json"], { env }).stdout);

  const updated = run([
    "update",
    original.id,
    "--summary",
    "Updated handoff",
    "--status",
    "ready",
    "--note",
    "new note",
    "--tag",
    "new",
    "--file",
    bodyPath,
    "--json",
  ], { env });
  assert.equal(updated.status, 0);
  const packet = JSON.parse(updated.stdout);
  assert.equal(packet.id, original.id);
  assert.equal(packet.created_at, original.created_at);
  assert.match(packet.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(packet.summary, "Updated handoff");
  assert.equal(packet.status, "ready");
  assert.deepEqual(packet.notes, ["old note", "new note"]);
  assert.deepEqual(packet.tags, ["old", "new"]);
  assert.match(packet.body, /Updated body/);

  const shown = run(["show", original.id], { env });
  assert.equal(shown.status, 0);
  assert.match(shown.stdout, /updated_at:/);
  assert.match(shown.stdout, /Updated handoff/);

  const prompt = run(["show", original.id, "--prompt"], { env });
  assert.equal(prompt.status, 0);
  assert.match(prompt.stdout, /updated_at:/);
  assert.match(prompt.stdout, /Updated body from a follow-up pass/);

  const reset = run([
    "update",
    original.id,
    "--clear-notes",
    "--note",
    "only note",
    "--clear-tags",
    "--tag",
    "solo",
    "--json",
  ], { env });
  assert.equal(reset.status, 0);
  const resetPacket = JSON.parse(reset.stdout);
  assert.deepEqual(resetPacket.notes, ["only note"]);
  assert.deepEqual(resetPacket.tags, ["solo"]);

  const markdownExport = run(["export"], { env });
  assert.equal(markdownExport.status, 0);
  assert.match(markdownExport.stdout, /updated_at:/);
});

test("update validates packet id and requested changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  run(["save", "--summary", "original"], { env });
  const packet = JSON.parse(run(["latest", "--json"], { env }).stdout);

  const noChange = run(["update", packet.id], { env });
  assert.equal(noChange.status, 2);
  assert.match(noChange.stderr, /needs at least one change/);

  const missing = run(["update", "pkt_missing", "--summary", "x"], { env });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No handoff packet found/);
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

test("save can attach a bounded git diff body", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const workspace = path.join(dir, "repo");
  fs.mkdirSync(workspace);
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: workspace, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "ACB Test"], { cwd: workspace, encoding: "utf8" });
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n", "utf8");
  spawnSync("git", ["add", "README.md"], { cwd: workspace, encoding: "utf8" });
  spawnSync("git", ["commit", "-m", "initial"], { cwd: workspace, encoding: "utf8" });
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n\nchanged line for handoff\n", "utf8");
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  const saved = run(["save", "--workspace", workspace, "--summary", "Captured diff", "--diff", "--diff-limit", "1000"], { env });
  assert.equal(saved.status, 0);

  const packet = JSON.parse(run(["latest", "--workspace", workspace, "--json"], { env }).stdout);
  assert.match(packet.body, /## Git Diff/);
  assert.match(packet.body, /changed line for handoff/);
  assert.equal(packet.git.status.length, 1);

  const prompt = run(["prompt", "--id", packet.id, "--no-copy"], { env });
  assert.equal(prompt.status, 0);
  assert.match(prompt.stdout, /## Context Body/);
  assert.match(prompt.stdout, /```diff/);

  const diffPreview = run(["diff-preview", "--workspace", workspace, "--diff-limit", "1000"], { env });
  assert.equal(diffPreview.status, 0);
  assert.match(diffPreview.stdout, /## Git Diff/);
  assert.match(diffPreview.stdout, /changed line for handoff/);

  const outPath = path.join(dir, "diff-preview.md");
  const filePreview = run(["diff-preview", "--workspace", workspace, "--out", outPath], { env });
  assert.equal(filePreview.status, 0);
  assert.match(filePreview.stdout, /wrote diff preview/);
  assert.match(fs.readFileSync(outPath, "utf8"), /changed line for handoff/);
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
  assert.match(both.stderr, /Use only one body source/);

  const missing = run(["save", "--file", path.join(dir, "missing.md")], { env });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /Cannot read --file/);

  const badDiffLimit = run(["save", "--summary", "bad", "--diff", "--diff-limit", "nope"], { env });
  assert.equal(badDiffLimit.status, 2);
  assert.match(badDiffLimit.stderr, /--diff-limit must be/);

  const diffOutsideGit = run(["diff-preview", "--workspace", dir], { env });
  assert.equal(diffOutsideGit.status, 2);
  assert.match(diffOutsideGit.stderr, /--diff requires a Git workspace/);
});

test("save requires useful handoff content", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const result = run(["save"], { env: { ACB_STORE: path.join(dir, "packets.json") } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /needs at least/);
});

test("status reports an empty workspace without failing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const workspace = path.join(dir, "workspace");
  fs.mkdirSync(workspace);
  const result = run(["status", "--workspace", workspace], { env: { ACB_STORE: path.join(dir, "packets.json") } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /latest_packet: none/);
  assert.match(result.stdout, /acb handoff --summary/);
});

test("preview reports missing packets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const result = run(["preview", "--id", "pkt_missing"], { env: { ACB_STORE: path.join(dir, "packets.json") } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No handoff packet found/);
});

test("search handles empty matches and validates limit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  const missingQuery = run(["search"], { env });
  assert.equal(missingQuery.status, 2);
  assert.match(missingQuery.stderr, /Usage: acb search/);

  const badLimit = run(["search", "anything", "--limit", "0"], { env });
  assert.equal(badLimit.status, 2);
  assert.match(badLimit.stderr, /--limit must be/);

  const empty = run(["search", "nothing"], { env });
  assert.equal(empty.status, 0);
  assert.match(empty.stdout, /no packets matched/);
});

test("workspaces groups packet history by workspace", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const workspaceA = path.join(dir, "a");
  const workspaceB = path.join(dir, "b");
  fs.mkdirSync(workspaceA);
  fs.mkdirSync(workspaceB);
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  run(["save", "--workspace", workspaceA, "--summary", "a1"], { env });
  run(["save", "--workspace", workspaceA, "--summary", "a2"], { env });
  run(["save", "--workspace", workspaceB, "--summary", "b1"], { env });

  const result = run(["workspaces", "--json"], { env });
  assert.equal(result.status, 0);
  const summaries = JSON.parse(result.stdout);
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].workspace, workspaceB);
  assert.equal(summaries[0].packets, 1);
  assert.equal(summaries[1].workspace, workspaceA);
  assert.equal(summaries[1].packets, 2);

  const limited = run(["workspaces", "--limit", "1", "--json"], { env });
  assert.equal(limited.status, 0);
  assert.equal(JSON.parse(limited.stdout).length, 1);

  const badLimit = run(["workspaces", "--limit", "0"], { env });
  assert.equal(badLimit.status, 2);
  assert.match(badLimit.stderr, /--limit must be/);
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

test("store info reports local store metadata", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const env = { ACB_STORE: storePath };

  const missing = run(["store", "info", "--json"], { env });
  assert.equal(missing.status, 0);
  const missingReport = JSON.parse(missing.stdout);
  assert.equal(missingReport.path, storePath);
  assert.equal(missingReport.exists, false);
  assert.equal(missingReport.readable, true);
  assert.equal(missingReport.packets, 0);

  run(["save", "--summary", "store info"], { env });
  const human = run(["store", "info"], { env });
  assert.equal(human.status, 0);
  assert.match(human.stdout, /ACB Store/);
  assert.match(human.stdout, /exists: yes/);
  assert.match(human.stdout, /packets: 1/);

  fs.writeFileSync(storePath, "{not valid json", "utf8");
  const broken = run(["store", "info", "--json"], { env });
  assert.equal(broken.status, 0);
  const brokenReport = JSON.parse(broken.stdout);
  assert.equal(brokenReport.exists, true);
  assert.equal(brokenReport.readable, false);
  assert.match(brokenReport.error, /Cannot read ACB store/);

  const brokenHuman = run(["store", "info"], { env });
  assert.equal(brokenHuman.status, 1);
  assert.match(brokenHuman.stdout, /readable: no/);
});

test("store backup copies the raw local store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const backupPath = path.join(dir, "backups", "packets.backup.json");
  const env = { ACB_STORE: storePath };

  run(["save", "--summary", "backup me"], { env });
  const backup = run(["store", "backup", "--out", backupPath, "--json"], { env });
  assert.equal(backup.status, 0);
  const report = JSON.parse(backup.stdout);
  assert.equal(report.source, storePath);
  assert.equal(report.destination, backupPath);
  assert.equal(fs.readFileSync(backupPath, "utf8"), fs.readFileSync(storePath, "utf8"));

  const duplicate = run(["store", "backup", "--out", backupPath], { env });
  assert.equal(duplicate.status, 2);
  assert.match(duplicate.stderr, /Backup already exists/);

  const forced = run(["store", "backup", "--out", backupPath, "--force"], { env });
  assert.equal(forced.status, 0);
  assert.match(forced.stdout, /backed up store/);
});

test("store backup works for malformed stores and reports missing stores", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const backupPath = path.join(dir, "broken.backup.json");
  const env = { ACB_STORE: storePath };
  fs.writeFileSync(storePath, "{not valid json", "utf8");

  const backup = run(["store", "backup", "--out", backupPath], { env });
  assert.equal(backup.status, 0);
  assert.equal(fs.readFileSync(backupPath, "utf8"), "{not valid json");

  fs.rmSync(storePath);
  const missing = run(["store", "backup"], { env });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No ACB store found/);
});

test("config mcp prints a copyable MCP server snippet", () => {
  const config = run(["config", "mcp"]);
  assert.equal(config.status, 0);
  assert.deepEqual(JSON.parse(config.stdout), {
    mcpServers: {
      acb: {
        command: "acb",
        args: ["serve"],
      },
    },
  });

  const localConfig = run(["config", "mcp", "--command", "/tmp/acb/bin/acb.js", "--name", "local-acb"]);
  assert.equal(localConfig.status, 0);
  const parsed = JSON.parse(localConfig.stdout);
  assert.equal(parsed.mcpServers["local-acb"].command, "/tmp/acb/bin/acb.js");
  assert.deepEqual(parsed.mcpServers["local-acb"].args, ["serve"]);

  const nodeConfig = run([
    "config",
    "mcp",
    "--command",
    process.execPath,
    "--arg",
    bin,
    "--arg",
    "serve",
    "--name",
    "node-acb",
  ]);
  assert.equal(nodeConfig.status, 0);
  assert.deepEqual(JSON.parse(nodeConfig.stdout).mcpServers["node-acb"].args, [bin, "serve"]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const outPath = path.join(dir, "nested", "mcp.json");
  const written = run(["config", "mcp", "--name", "file-acb", "--out", outPath]);
  assert.equal(written.status, 0);
  assert.match(written.stdout, /wrote MCP config/);
  assert.equal(JSON.parse(fs.readFileSync(outPath, "utf8")).mcpServers["file-acb"].command, "acb");
});

test("verify mcp smoke tests a configured stdio server", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const configPath = path.join(dir, "mcp.json");
  const config = run([
    "config",
    "mcp",
    "--command",
    process.execPath,
    "--arg",
    bin,
    "--arg",
    "serve",
    "--name",
    "local-acb",
  ]);
  assert.equal(config.status, 0);
  fs.writeFileSync(configPath, config.stdout, "utf8");

  const verified = run(["verify", "mcp", "--config", configPath, "--name", "local-acb"]);
  assert.equal(verified.status, 0);
  assert.match(verified.stdout, /ACB MCP Verify/);
  assert.match(verified.stdout, /initialize: ok/);
  assert.match(verified.stdout, /read_latest_handoff/);

  const json = run(["verify", "mcp", "--config", configPath, "--name", "local-acb", "--json"]);
  assert.equal(json.status, 0);
  const report = JSON.parse(json.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.server, "local-acb");
  assert.equal(report.checks.required_tools, true);
});

test("verify mcp reports launch failures", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const configPath = path.join(dir, "bad-mcp.json");
  fs.writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      broken: {
        command: "definitely-not-acb-command",
        args: ["serve"],
      },
    },
  }), "utf8");

  const verified = run(["verify", "mcp", "--config", configPath, "--name", "broken"]);
  assert.equal(verified.status, 1);
  assert.match(verified.stdout, /launch: failed/);
  assert.match(verified.stdout, /error:/);
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
  assert.equal(typeof report.checks.acb_command_available, "boolean");
  assert.equal(report.mcp.config_command, "acb config mcp --out ./mcp.json");
  assert.match(human.stdout, /mcp_config_command/);
});

test("doctor reports corrupt stores without overwriting them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  fs.writeFileSync(storePath, "{not valid json", "utf8");
  const env = { ACB_STORE: storePath };

  const doctor = run(["doctor", "--workspace", dir], { env });
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /store_readable: no/);
  assert.match(doctor.stdout, /store_error:/);

  const save = run(["save", "--summary", "must not overwrite"], { env });
  assert.equal(save.status, 2);
  assert.match(save.stderr, /Cannot read ACB store/);
  assert.equal(fs.readFileSync(storePath, "utf8"), "{not valid json");
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
    rpc("tools/call", { name: "search_handoffs", arguments: { workspace, query: "pull", limit: 5 } }, 5),
    rpc("tools/call", { name: "list_workspaces", arguments: { limit: 5 } }, 6),
  ].join("");

  const served = run(["serve"], { env, input });
  assert.equal(served.status, 0);
  assert.equal(served.stderr, "");
  const messages = parseJsonLines(served.stdout);
  assert.equal(messages.length, 6);
  assert.equal(messages[0].result.protocolVersion, "2025-06-18");
  assert.deepEqual(messages[0].result.capabilities, { tools: { listChanged: false } });
  assert.equal(messages[1].result.tools[0].name, "read_latest_handoff");
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "search_handoffs"));
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "update_handoff"));
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "list_workspaces"));
  assert.match(messages[2].result.content[0].text, /MCP handoff/);
  assert.equal(messages[2].result.structuredContent.packet.summary, "MCP handoff");
  assert.equal(messages[3].result.structuredContent.packets.length, 1);
  assert.equal(messages[4].result.structuredContent.packets[0].summary, "MCP handoff");
  assert.equal(messages[5].result.structuredContent.workspaces[0].workspace, workspace);

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

test("serve can save handoff packets over MCP stdio", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const workspace = path.join(dir, "workspace");
  fs.mkdirSync(workspace);
  const env = { ACB_STORE: storePath };

  const input = [
    rpc("tools/call", {
      name: "save_handoff",
      arguments: {
        from: "cline",
        workspace,
        summary: "Saved through MCP",
        status: "ready for another agent",
        notes: ["Use the generated prompt"],
        tags: ["mcp", "handoff"],
        body: "The upstream agent completed the first pass.",
      },
    }, 1),
    rpc("tools/call", { name: "read_latest_handoff", arguments: { workspace } }, 2),
  ].join("");

  const served = run(["serve"], { env, input });
  assert.equal(served.status, 0);
  const messages = parseJsonLines(served.stdout);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].result.isError, false);
  assert.match(messages[0].result.content[0].text, /Saved ACB handoff packet/);
  assert.equal(messages[0].result.structuredContent.packet.from, "cline");
  assert.equal(messages[1].result.structuredContent.packet.summary, "Saved through MCP");
  assert.match(messages[1].result.content[0].text, /ready for another agent/);

  const latest = JSON.parse(run(["latest", "--workspace", workspace, "--json"], { env }).stdout);
  assert.equal(latest.summary, "Saved through MCP");
  assert.deepEqual(latest.tags, ["mcp", "handoff"]);
});

test("serve can update handoff packets over MCP stdio", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const workspace = path.join(dir, "workspace");
  fs.mkdirSync(workspace);
  const env = { ACB_STORE: storePath };

  run([
    "save",
    "--workspace",
    workspace,
    "--summary",
    "MCP original",
    "--note",
    "old note",
    "--tag",
    "old",
  ], { env });
  const original = JSON.parse(run(["latest", "--workspace", workspace, "--json"], { env }).stdout);

  const served = run(["serve"], {
    env,
    input: [
      rpc("tools/call", {
        name: "update_handoff",
        arguments: {
          id: original.id,
          summary: "MCP updated",
          status: "ready",
          notes: ["new note"],
          tags: ["new"],
          body: "Updated from MCP client.",
        },
      }, 1),
      rpc("tools/call", { name: "read_handoff", arguments: { id: original.id } }, 2),
    ].join(""),
  });
  assert.equal(served.status, 0);
  const messages = parseJsonLines(served.stdout);
  assert.equal(messages[0].result.isError, false);
  assert.match(messages[0].result.content[0].text, /Updated ACB handoff packet/);
  assert.equal(messages[0].result.structuredContent.packet.created_at, original.created_at);
  assert.match(messages[0].result.structuredContent.packet.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(messages[0].result.structuredContent.packet.summary, "MCP updated");
  assert.deepEqual(messages[0].result.structuredContent.packet.notes, ["old note", "new note"]);
  assert.deepEqual(messages[0].result.structuredContent.packet.tags, ["old", "new"]);
  assert.match(messages[1].result.content[0].text, /MCP updated/);
  assert.match(messages[1].result.content[0].text, /Updated from MCP client/);

  const reset = run(["serve"], {
    env,
    input: rpc("tools/call", {
      name: "update_handoff",
      arguments: {
        id: original.id,
        clear_notes: true,
        notes: ["only"],
        clear_tags: true,
        tags: ["solo"],
      },
    }, 1),
  });
  assert.equal(reset.status, 0);
  const [resetMessage] = parseJsonLines(reset.stdout);
  assert.deepEqual(resetMessage.result.structuredContent.packet.notes, ["only"]);
  assert.deepEqual(resetMessage.result.structuredContent.packet.tags, ["solo"]);
});

test("serve can save handoff packets with git diff over MCP stdio", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const workspace = path.join(dir, "repo");
  fs.mkdirSync(workspace);
  spawnSync("git", ["init"], { cwd: workspace, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: workspace, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "ACB Test"], { cwd: workspace, encoding: "utf8" });
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n", "utf8");
  spawnSync("git", ["add", "README.md"], { cwd: workspace, encoding: "utf8" });
  spawnSync("git", ["commit", "-m", "initial"], { cwd: workspace, encoding: "utf8" });
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n\nmcp diff line\n", "utf8");
  const env = { ACB_STORE: storePath };

  const served = run(["serve"], {
    env,
    input: rpc("tools/call", {
      name: "save_handoff",
      arguments: {
        workspace,
        summary: "MCP diff packet",
        include_diff: true,
        diff_limit: 1000,
      },
    }, 1),
  });
  assert.equal(served.status, 0);
  const [message] = parseJsonLines(served.stdout);
  assert.equal(message.result.isError, false);
  assert.match(message.result.structuredContent.packet.body, /mcp diff line/);
  assert.equal(message.result.structuredContent.packet.git.status.length, 1);
});

test("serve returns tool errors as tool results", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const env = { ACB_STORE: path.join(dir, "packets.json") };
  const input = [
    rpc("tools/call", { name: "read_latest_handoff", arguments: { workspace: dir } }, 1),
    rpc("tools/call", { name: "save_handoff", arguments: { workspace: dir } }, 2),
    rpc("tools/call", { name: "search_handoffs", arguments: { query: "" } }, 3),
    rpc("tools/call", { name: "list_workspaces", arguments: { limit: 0 } }, 4),
    rpc("tools/call", { name: "update_handoff", arguments: { id: "pkt_missing", summary: "x" } }, 5),
  ].join("");

  const served = run(["serve"], { env, input });
  assert.equal(served.status, 0);
  const [message, saveMessage, searchMessage, workspaceMessage, updateMessage] = parseJsonLines(served.stdout);
  assert.equal(message.result.isError, true);
  assert.match(message.result.content[0].text, /No handoff packet found/);
  assert.equal(saveMessage.result.isError, true);
  assert.match(saveMessage.result.content[0].text, /requires summary/);
  assert.equal(searchMessage.result.isError, true);
  assert.match(searchMessage.result.content[0].text, /query is required/);
  assert.equal(workspaceMessage.result.isError, true);
  assert.match(workspaceMessage.result.content[0].text, /limit must be/);
  assert.equal(updateMessage.result.isError, true);
  assert.match(updateMessage.result.content[0].text, /No handoff packet found/);
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
