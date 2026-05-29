import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const bin = path.resolve("bin/acb.js");
const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));

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

function realWorkspace(workspace) {
  return fs.realpathSync.native(workspace);
}

function waitForStdout(child, pattern) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}. Output: ${output}`)), 5000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(pattern);
      if (match) {
        clearTimeout(timer);
        resolve(match);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Process exited before stdout matched ${pattern}: ${code}. Output: ${output}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode >= 400) reject(new Error(`HTTP ${response.statusCode}: ${body}`));
        else resolve(body);
      });
    }).on("error", reject);
  });
}

function httpPostJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = http.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        responseBody += chunk;
      });
      response.on("end", () => {
        resolve({ statusCode: response.statusCode, body: responseBody });
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("prints version and help", () => {
  const version = run(["--version"]);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), `acb ${pkg.version}`);

  const help = run(["help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, new RegExp(`AgentContextBus \\(acb\\) ${pkg.version}`));
  assert.match(help.stdout, /acb save/);
  assert.match(help.stdout, /acb view/);
  assert.match(help.stdout, /acb dashboard/);
  assert.match(help.stdout, /acb brief/);
  assert.match(help.stdout, /acb recipe/);
  assert.match(help.stdout, /acb quickstart/);

  const quickstart = run(["quickstart"]);
  assert.equal(quickstart.status, 0);
  assert.match(quickstart.stdout, new RegExp(`npm install -g ${pkg.name.replace("/", "\\/")}`));
  assert.match(quickstart.stdout, /acb handoff/);
  assert.match(quickstart.stdout, /acb resume/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const workspace = path.join(dir, "workspace");
  fs.mkdirSync(workspace);
  const quickstartCheck = run(["quickstart", "--check", "--workspace", workspace], { env: { ACB_STORE: storePath } });
  assert.equal(quickstartCheck.status, 0);
  assert.match(quickstartCheck.stdout, /ACB Quickstart Check/);
  assert.match(quickstartCheck.stdout, /next_handoff: acb handoff/);
  assert.match(quickstartCheck.stdout, /next_resume: acb resume/);
  assert.match(quickstartCheck.stdout, /next_brief: acb brief/);

  const quickstartJson = run(["quickstart", "--check", "--workspace", workspace, "--json"], { env: { ACB_STORE: storePath } });
  assert.equal(quickstartJson.status, 0);
  const quickstartReport = JSON.parse(quickstartJson.stdout);
  assert.equal(quickstartReport.version, pkg.version);
  assert.equal(quickstartReport.package, pkg.name);
  assert.equal(quickstartReport.workspace, realWorkspace(workspace));
  assert.equal(quickstartReport.store_path, storePath);
  assert.equal(quickstartReport.next.resume, "acb resume");
  assert.equal(quickstartReport.next.brief, "acb brief");
});

test("recipe lists and renders client handoff paths", () => {
  const list = run(["recipe"]);
  assert.equal(list.status, 0);
  assert.match(list.stdout, /ACB Recipes/);
  assert.match(list.stdout, /opencode/);
  assert.match(list.stdout, /cline/);

  const opencode = run(["recipe", "opencode"]);
  assert.equal(opencode.status, 0);
  assert.match(opencode.stdout, /ACB Recipe: OpenCode/);
  assert.match(opencode.stdout, /acb handoff/);
  assert.match(opencode.stdout, /Use acb to read the latest handoff/);
  assert.match(opencode.stdout, /No hidden prompt injector|hidden prompt injector/i);

  const clineJson = run(["recipe", "cline", "--json"]);
  assert.equal(clineJson.status, 0);
  const cline = JSON.parse(clineJson.stdout);
  assert.equal(cline.id, "cline");
  assert.equal(cline.title, "Cline");
  assert.ok(cline.setup.includes("acb resume"));
  assert.match(cline.prompt, /workspace status/);
  assert.ok(cline.notes.some((note) => note.includes("Do not edit VS Code")));

  const listJson = run(["recipe", "--json"]);
  assert.equal(listJson.status, 0);
  const recipes = JSON.parse(listJson.stdout);
  assert.ok(recipes.recipes.some((recipe) => recipe.id === "claude-desktop"));

  const alias = run(["recipe", "roo-code", "--json"]);
  assert.equal(alias.status, 0);
  assert.equal(JSON.parse(alias.stdout).id, "roo");

  const missing = run(["recipe", "missing-client"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /Unknown recipe target/);
  assert.match(missing.stderr, /Available targets/);
});

test("brief renders a compact receiving-side handoff", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const workspace = path.join(dir, "workspace");
  const otherWorkspace = path.join(dir, "other");
  fs.mkdirSync(workspace);
  fs.mkdirSync(otherWorkspace);
  const env = { ACB_STORE: path.join(dir, "packets.json") };
  const longBody = `${"body context ".repeat(260)}tail marker`;

  run(["save", "--workspace", otherWorkspace, "--summary", "Other packet"], { env });
  run([
    "save",
    "--workspace",
    workspace,
    "--from",
    "codex",
    "--summary",
    "Compact takeover",
    "--status",
    "ready",
    "--note",
    "Inspect tests first",
    "--tag",
    "brief",
    "--stdin",
  ], { env, input: longBody });
  const packet = JSON.parse(run(["latest", "--workspace", workspace, "--json"], { env }).stdout);

  const brief = run(["brief", "--workspace", workspace, "--print-brief"], { env });
  assert.equal(brief.status, 0);
  assert.match(brief.stdout, /ACB brief/);
  assert.match(brief.stdout, /Compact takeover/);
  assert.match(brief.stdout, /Inspect tests first/);
  assert.match(brief.stdout, /Full Context Commands/);
  assert.match(brief.stdout, new RegExp(`acb resume --id ${packet.id}`));
  assert.doesNotMatch(brief.stdout, /Other packet/);
  assert.match(brief.stdout, /text truncated at 1800 characters/);

  const json = run(["brief", "--id", packet.id, "--json"], { env });
  assert.equal(json.status, 0);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.packet.id, packet.id);
  assert.equal(payload.packet.next_brief, `acb brief --id ${packet.id}`);
  assert.equal(payload.packet.next_mcp_brief, "read_handoff_brief");
  assert.match(payload.brief, /Compact takeover/);

  const missing = run(["brief", "--workspace", path.join(dir, "missing"), "--print-brief"], { env });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No handoff packet found to brief/);

  const invalid = run(["brief", "--id", packet.id, "--json", "--print-brief"], { env });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Use only one brief output mode/);
});

test("runs when invoked through a bin symlink", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const linkPath = path.join(dir, "acb");
  fs.symlinkSync(bin, linkPath);

  const version = spawnSync(linkPath, ["--version"], {
    encoding: "utf8",
    env: process.env,
    cwd: process.cwd(),
  });

  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), `acb ${pkg.version}`);
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
  assert.equal(packet.workspace, realWorkspace(workspace));
  assert.equal(packet.summary, "Implemented local handoff");
  assert.deepEqual(packet.notes, ["Do not publish yet"]);
  assert.deepEqual(packet.tags, ["mvp"]);
  assert.equal(packet.next_resume, `acb resume --id ${packet.id}`);
  assert.equal(packet.next_brief, `acb brief --id ${packet.id}`);
  assert.equal(packet.next_mcp_read, "read_handoff");
  assert.equal(packet.next_mcp_brief, "read_handoff_brief");

  const status = run(["status", "--workspace", workspace], { env });
  assert.equal(status.status, 0);
  assert.match(status.stdout, /ACB Status/);
  assert.match(status.stdout, new RegExp(packet.id));
  assert.match(status.stdout, /next_resume/);
  assert.match(status.stdout, new RegExp(`acb resume --id ${packet.id}`));
  assert.match(status.stdout, new RegExp(`acb brief --id ${packet.id}`));

  const statusJson = run(["status", "--workspace", workspace, "--json"], { env });
  assert.equal(statusJson.status, 0);
  const statusReport = JSON.parse(statusJson.stdout);
  assert.equal(statusReport.latest_packet.id, packet.id);
  assert.equal(statusReport.workspace_packets, 1);
  assert.equal(statusReport.next.resume, `acb resume --id ${packet.id}`);
  assert.equal(statusReport.next.brief, `acb brief --id ${packet.id}`);
  assert.equal(statusReport.next.copy_prompt, `acb prompt --id ${packet.id}`);
  assert.equal(statusReport.next.mcp_status, "get_workspace_status");
  assert.equal(statusReport.next.mcp_read_latest, "read_latest_handoff");
  assert.equal(statusReport.next.mcp_read_brief, "read_handoff_brief");

  const listed = run(["list", "--workspace", workspace], { env });
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, /ACB List/);
  assert.match(listed.stdout, new RegExp(`workspace: ${realWorkspace(workspace)}`));
  assert.match(listed.stdout, new RegExp(packet.id));
  assert.match(listed.stdout, /Implemented local handoff/);

  const workspaces = run(["workspaces"], { env });
  assert.equal(workspaces.status, 0);
  assert.match(workspaces.stdout, /ACB Workspaces/);
  assert.match(workspaces.stdout, new RegExp(workspace));
  assert.match(workspaces.stdout, new RegExp(`next_resume: acb resume --id ${packet.id}`));
  assert.match(workspaces.stdout, new RegExp(`next_brief: acb brief --id ${packet.id}`));

  const workspacesJson = run(["workspaces", "--json"], { env });
  assert.equal(workspacesJson.status, 0);
  const workspaceSummary = JSON.parse(workspacesJson.stdout)[0];
  assert.equal(workspaceSummary.workspace, realWorkspace(workspace));
  assert.equal(workspaceSummary.packets, 1);
  assert.equal(workspaceSummary.latest_packet_id, packet.id);
  assert.equal(workspaceSummary.next_resume, `acb resume --id ${packet.id}`);
  assert.equal(workspaceSummary.next_brief, `acb brief --id ${packet.id}`);

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
  const timelineSummary = JSON.parse(timelineJson.stdout)[0];
  assert.equal(timelineSummary.id, packet.id);
  assert.equal(timelineSummary.next_resume, `acb resume --id ${packet.id}`);
  assert.equal(timelineSummary.next_brief, `acb brief --id ${packet.id}`);
  assert.equal(timelineSummary.next_show_prompt, `acb show ${packet.id} --prompt`);
  assert.equal(timelineSummary.next_mcp_read, "read_handoff");
  assert.equal(timelineSummary.next_mcp_brief, "read_handoff_brief");

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

  const scopedPrompt = run(["prompt", "--no-copy"], { env, cwd: workspace });
  assert.equal(scopedPrompt.status, 0);
  assert.match(scopedPrompt.stdout, /Implemented local handoff/);

  const previewPath = path.join(dir, "preview", "handoff.md");
  const preview = run(["preview", "--id", packet.id, "--out", previewPath], { env });
  assert.equal(preview.status, 0);
  assert.match(preview.stdout, /wrote prompt preview/);
  const previewContent = fs.readFileSync(previewPath, "utf8");
  assert.match(previewContent, /# ACB Handoff Prompt Preview/);
  assert.match(previewContent, /Implemented local handoff/);

  const scopedPreviewPath = path.join(dir, "preview", "scoped-handoff.md");
  const scopedPreview = run(["preview", "--out", scopedPreviewPath], { env, cwd: workspace });
  assert.equal(scopedPreview.status, 0);
  assert.match(fs.readFileSync(scopedPreviewPath, "utf8"), /Implemented local handoff/);

  const shown = run(["show", packet.id], { env });
  assert.equal(shown.status, 0);
  assert.match(shown.stdout, new RegExp(packet.id));
  assert.match(shown.stdout, /Implemented local handoff/);
  assert.match(shown.stdout, new RegExp(`next_resume: acb resume --id ${packet.id}`));
  assert.match(shown.stdout, new RegExp(`next_brief: acb brief --id ${packet.id}`));

  const shownJson = run(["show", packet.id, "--json"], { env });
  assert.equal(shownJson.status, 0);
  const shownJsonPacket = JSON.parse(shownJson.stdout);
  assert.equal(shownJsonPacket.id, packet.id);
  assert.equal(shownJsonPacket.next_brief, `acb brief --id ${packet.id}`);
  assert.equal(shownJsonPacket.next_show_prompt, `acb show ${packet.id} --prompt`);

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

test("latest defaults to current workspace and supports all", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const workspaceA = path.join(dir, "a");
  const workspaceB = path.join(dir, "b");
  fs.mkdirSync(workspaceA);
  fs.mkdirSync(workspaceB);
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  run(["save", "--workspace", workspaceA, "--summary", "Workspace A"], { env });
  run(["save", "--workspace", workspaceB, "--summary", "Workspace B"], { env });

  const scoped = run(["latest", "--json"], { env, cwd: workspaceA });
  assert.equal(scoped.status, 0);
  assert.equal(JSON.parse(scoped.stdout).summary, "Workspace A");

  const global = run(["latest", "--all", "--json"], { env, cwd: workspaceA });
  assert.equal(global.status, 0);
  assert.equal(JSON.parse(global.stdout).summary, "Workspace B");

  const invalid = run(["latest", "--workspace", workspaceA, "--all"], { env });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Use either --workspace or --all/);
});

test("history commands default to current workspace and support all", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const workspaceA = path.join(dir, "a");
  const workspaceB = path.join(dir, "b");
  fs.mkdirSync(workspaceA);
  fs.mkdirSync(workspaceB);
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  run(["save", "--workspace", workspaceA, "--summary", "Alpha handoff"], { env });
  run(["save", "--workspace", workspaceB, "--summary", "Beta handoff"], { env });

  const listScoped = JSON.parse(run(["list", "--json"], { env, cwd: workspaceA }).stdout);
  assert.equal(listScoped.length, 1);
  assert.equal(listScoped[0].summary, "Alpha handoff");

  const listAll = JSON.parse(run(["list", "--all", "--json"], { env, cwd: workspaceA }).stdout);
  assert.equal(listAll.length, 2);

  const listAllHuman = run(["list", "--all"], { env, cwd: workspaceA });
  assert.equal(listAllHuman.status, 0);
  assert.match(listAllHuman.stdout, /workspace: all/);

  const searchScoped = run(["search", "handoff", "--json"], { env, cwd: workspaceA });
  const searchScopedPackets = JSON.parse(searchScoped.stdout);
  assert.equal(searchScopedPackets.length, 1);
  assert.match(searchScopedPackets[0].next_resume, /^acb resume --id pkt_/);

  const searchAllHuman = run(["search", "handoff", "--all"], { env, cwd: workspaceA });
  assert.equal(searchAllHuman.status, 0);
  assert.match(searchAllHuman.stdout, /workspace: all/);

  const timelineScopedHuman = run(["timeline"], { env, cwd: workspaceA });
  assert.equal(timelineScopedHuman.status, 0);
  assert.match(timelineScopedHuman.stdout, new RegExp(`workspace: ${realWorkspace(workspaceA)}`));

  const timelineAll = JSON.parse(run(["timeline", "--all", "--json"], { env, cwd: workspaceA }).stdout);
  assert.equal(timelineAll.length, 2);

  const timelineAllHuman = run(["timeline", "--all"], { env, cwd: workspaceA });
  assert.equal(timelineAllHuman.status, 0);
  assert.match(timelineAllHuman.stdout, /workspace: all/);

  const exportScoped = run(["export", "--format", "json"], { env, cwd: workspaceA });
  assert.equal(JSON.parse(exportScoped.stdout).length, 1);

  const invalid = run(["list", "--workspace", workspaceA, "--all"], { env });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Use either --workspace or --all/);
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
  const noCopyPacket = JSON.parse(run(["latest", "--json"], { env }).stdout);
  assert.match(noCopy.stdout, new RegExp(`next: acb resume --id ${noCopyPacket.id}`));

  const invalid = run(["handoff", "--summary", "bad", "--no-copy", "--json"], { env });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Use only one handoff output mode/);
});

test("resume is a downstream handoff entrypoint", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const workspace = path.join(dir, "workspace");
  const otherWorkspace = path.join(dir, "other-workspace");
  fs.mkdirSync(workspace);
  fs.mkdirSync(otherWorkspace);
  const env = { ACB_STORE: path.join(dir, "packets.json") };

  run(["handoff", "--workspace", otherWorkspace, "--summary", "Other workspace handoff", "--no-copy"], { env });
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

  const defaultPrompt = run(["resume", "--print-prompt"], { env, cwd: workspace });
  assert.equal(defaultPrompt.status, 0);
  assert.match(defaultPrompt.stdout, /Resume shortcut/);
  assert.doesNotMatch(defaultPrompt.stdout, /Other workspace handoff/);

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

  const previewPath = path.join(dir, "resume-preview.md");
  const preview = run(["resume", "--id", packet.id, "--preview", "--out", previewPath], { env });
  assert.equal(preview.status, 0);
  assert.match(preview.stdout, /wrote prompt preview/);
  const previewContent = fs.readFileSync(previewPath, "utf8");
  assert.match(previewContent, /# ACB Handoff Prompt Preview/);
  assert.match(previewContent, /Resume shortcut/);

  const missing = run(["resume", "--workspace", path.join(dir, "missing"), "--print-prompt"], { env });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No handoff packet found to resume/);

  const invalid = run(["resume", "--id", packet.id, "--json", "--preview"], { env });
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
  assert.match(result.stdout, /next_mcp_save: save_handoff/);

  const json = run(["status", "--workspace", workspace, "--json"], { env: { ACB_STORE: path.join(dir, "packets.json") } });
  assert.equal(json.status, 0);
  const report = JSON.parse(json.stdout);
  assert.equal(report.next.mcp_status, "get_workspace_status");
  assert.equal(report.next.mcp_save, "save_handoff");
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
  assert.equal(summaries[0].workspace, realWorkspace(workspaceB));
  assert.equal(summaries[0].packets, 1);
  assert.equal(summaries[1].workspace, realWorkspace(workspaceA));
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

test("view writes a standalone local HTML viewer", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const workspace = path.join(dir, "workspace");
  const outPath = path.join(dir, "viewer", "acb.html");
  fs.mkdirSync(workspace);
  const env = { ACB_STORE: storePath };

  run([
    "save",
    "--workspace",
    workspace,
    "--from",
    "codex",
    "--summary",
    "Review <viewer> output",
    "--status",
    "ready",
    "--note",
    "HTML escapes unsafe text",
    "--tag",
    "viewer",
  ], { env });

  const viewed = run(["view", "--workspace", workspace, "--out", outPath], { env });
  assert.equal(viewed.status, 0);
  assert.match(viewed.stdout, /wrote local viewer/);
  assert.ok(fs.existsSync(outPath));
  const html = fs.readFileSync(outPath, "utf8");
  assert.match(html, /<!doctype html>/);
  assert.match(html, /ACB Handoff Viewer/);
  assert.match(html, /Review &lt;viewer&gt; output/);
  assert.match(html, /acb resume --id pkt_/);
  assert.match(html, /acb brief --id pkt_/);

  const emptyPath = path.join(dir, "empty.html");
  const empty = run(["view", "--workspace", path.join(dir, "missing"), "--out", emptyPath], { env });
  assert.equal(empty.status, 0);
  assert.match(fs.readFileSync(emptyPath, "utf8"), /No handoff packets matched this view/);

  const badLimit = run(["view", "--limit", "0"], { env });
  assert.equal(badLimit.status, 2);
  assert.match(badLimit.stderr, /--limit must be/);
});

test("dashboard serves local state and explicit takeover prompt controls", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const storePath = path.join(dir, "packets.json");
  const workspace = path.join(dir, "workspace");
  const otherWorkspace = path.join(dir, "other-workspace");
  fs.mkdirSync(workspace);
  fs.mkdirSync(otherWorkspace);
  const env = { ...process.env, ACB_STORE: storePath };

  run([
    "save",
    "--workspace",
    workspace,
    "--from",
    "codex",
    "--summary",
    "Dashboard smoke",
    "--note",
    "Inspect local UI",
  ], { env });
  run([
    "save",
    "--workspace",
    otherWorkspace,
    "--from",
    "codex",
    "--summary",
    "Other workspace packet",
    "--note",
    "Do not leak this scope",
  ], { env });

  const child = spawn(process.execPath, [bin, "dashboard", "--workspace", workspace, "--port", "0"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const match = await waitForStdout(child, /dashboard: (http:\/\/127\.0\.0\.1:\d+\/)/);
    const url = match[1];
    const html = await httpGet(url);
    assert.match(html, /ACB Dashboard/);
    assert.match(html, /Dashboard smoke/);
    assert.match(html, /acb brief --id pkt_/);
    assert.match(html, /Copy Brief Prompt/);
    assert.match(html, /Copy Full Prompt/);
    assert.match(html, /Copy MCP Pull Instruction/);
    assert.match(html, /Start here/);
    assert.match(html, /Next handoff/);
    assert.match(html, /Target Client/);
    assert.match(html, /OpenCode/);
    assert.match(html, /Codex/);
    assert.match(html, /\/api\/copy-prompt/);

    const state = JSON.parse(await httpGet(`${url}api/state`));
    assert.equal(state.version, pkg.version);
    assert.equal(state.workspace, realWorkspace(workspace));
    assert.equal(state.shown_packets, 1);
    assert.equal(state.total_packets, 1);
    assert.equal(state.workspace_count, 1);
    assert.ok(state.targets.some((target) => target.id === "auto"));
    assert.ok(state.targets.some((target) => target.id === "opencode"));
    assert.ok(state.targets.some((target) => target.id === "codex"));
    assert.ok(state.recommended_target_id);
    assert.ok(state.targets.some((target) => target.id === state.recommended_target_id));
    assert.deepEqual(state.workspaces.map((item) => item.workspace), [realWorkspace(workspace)]);
    assert.equal(state.latest_packet.summary, "Dashboard smoke");
    assert.match(state.latest_packet.next_brief, /^acb brief --id pkt_/);
    assert.doesNotMatch(JSON.stringify(state), /Other workspace packet/);
    assert.doesNotMatch(JSON.stringify(state), new RegExp(otherWorkspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const dryRun = await httpPostJson(`${url}api/copy-prompt`, {
      id: state.latest_packet.id,
      mode: "brief",
      dry_run: true,
    });
    assert.equal(dryRun.statusCode, 200);
    const dryRunPayload = JSON.parse(dryRun.body);
    assert.equal(dryRunPayload.ok, true);
    assert.equal(dryRunPayload.copied, false);
    assert.equal(dryRunPayload.mode, "brief");
    assert.equal(dryRunPayload.id, state.latest_packet.id);
    assert.match(dryRunPayload.message, /Brief takeover prompt is ready/);

    const mcpDryRun = await httpPostJson(`${url}api/copy-prompt`, {
      id: state.latest_packet.id,
      mode: "mcp",
      dry_run: true,
    });
    assert.equal(mcpDryRun.statusCode, 200);
    const mcpPayload = JSON.parse(mcpDryRun.body);
    assert.equal(mcpPayload.ok, true);
    assert.equal(mcpPayload.mode, "mcp");
    assert.match(mcpPayload.message, /MCP pull instruction is ready/);

    const blocked = await httpPostJson(`${url}api/copy-prompt`, {
      id: JSON.parse(run(["latest", "--workspace", otherWorkspace, "--json"], { env }).stdout).id,
      mode: "full",
      dry_run: true,
    });
    assert.equal(blocked.statusCode, 404);

    const health = await httpGet(`${url}health`);
    assert.equal(health, "ok\n");
  } finally {
    child.kill();
  }
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

  const packets = JSON.parse(run(["list", "--all", "--json"], { env: targetEnv }).stdout);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].summary, "portable packet");

  const duplicate = run(["import", "--file", exportPath], { env: targetEnv });
  assert.equal(duplicate.status, 0);
  assert.match(duplicate.stdout, /skipped 1 duplicate/);
  assert.equal(JSON.parse(run(["list", "--all", "--json"], { env: targetEnv }).stdout).length, 1);

  const replaced = run(["import", "--file", exportPath, "--replace"], { env: targetEnv });
  assert.equal(replaced.status, 0);
  assert.match(replaced.stdout, /imported 1 handoff packet/);
  assert.equal(JSON.parse(run(["list", "--all", "--json"], { env: targetEnv }).stdout).length, 1);
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
  const firstStore = fs.readFileSync(storePath, "utf8");
  run(["save", "--summary", "second packet"], { env });
  assert.equal(fs.readFileSync(`${storePath}.bak`, "utf8"), firstStore);
  assert.match(fs.readFileSync(storePath, "utf8"), /second packet/);

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
  assert.match(verified.stdout, /get_workspace_status: ok/);
  assert.match(verified.stdout, /read_latest_handoff/);
  assert.match(verified.stdout, /read_handoff_brief/);

  const json = run(["verify", "mcp", "--config", configPath, "--name", "local-acb", "--json"]);
  assert.equal(json.status, 0);
  const report = JSON.parse(json.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.server, "local-acb");
  assert.equal(report.workspace, realWorkspace(process.cwd()));
  assert.equal(report.checks.required_tools, true);
  assert.equal(report.checks.workspace_status, true);
});

test("verify workflow smoke tests client handoff surfaces", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-"));
  const workspace = path.join(dir, "workspace");
  fs.mkdirSync(workspace);

  const verified = run(["verify", "workflow", "opencode", "--workspace", workspace]);
  assert.equal(verified.status, 0);
  assert.match(verified.stdout, /ACB Workflow Verify/);
  assert.match(verified.stdout, /target: opencode/);
  assert.match(verified.stdout, /brief: ok/);
  assert.match(verified.stdout, /mcp_latest_handoff: ok/);
  assert.match(verified.stdout, /dashboard_html: ok/);
  assert.match(verified.stdout, /mcp_verify: ok/);

  const json = run(["verify", "workflow", "cline", "--workspace", workspace, "--json"]);
  assert.equal(json.status, 0);
  const report = JSON.parse(json.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.target, "cline");
  assert.equal(report.workspace, realWorkspace(workspace));
  assert.equal(report.artifacts_retained, false);
  assert.equal(report.artifacts_cleaned, true);
  assert.equal(fs.existsSync(report.store_path), false);
  assert.equal(report.checks.resume_prompt, true);
  assert.equal(report.checks.brief, true);
  assert.equal(report.checks.mcp_latest_handoff, true);
  assert.equal(report.checks.dashboard_state, true);
  assert.equal(report.mcp.checks.required_tools, true);
  assert.equal(report.mcp.checks.latest_handoff, true);
  assert.equal(report.mcp.workspace, realWorkspace(workspace));
  assert.match(report.commands.dashboard, /acb dashboard --workspace/);

  const retained = run(["verify", "workflow", "codex", "--workspace", workspace, "--keep-artifacts", "--json"]);
  assert.equal(retained.status, 0);
  const retainedReport = JSON.parse(retained.stdout);
  assert.equal(retainedReport.artifacts_retained, true);
  assert.equal(fs.existsSync(retainedReport.store_path), true);
  fs.rmSync(path.dirname(retainedReport.store_path), { recursive: true, force: true });

  const missing = run(["verify", "workflow", "missing-client"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /Unknown workflow target/);
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
  assert.equal(report.workspace, realWorkspace(workspace));
  assert.equal(report.workspace_packets, 1);
  assert.equal(report.total_packets, 1);
  assert.equal(report.checks.store_readable, true);
  assert.equal(typeof report.checks.git_available, "boolean");
  assert.equal(typeof report.checks.clipboard_command_available, "boolean");
  assert.equal(typeof report.checks.acb_command_available, "boolean");
  assert.equal(report.mcp.config_command, "acb config mcp --out ./mcp.json");
  assert.equal(report.mcp.install_command, `npm install -g ${pkg.name}`);
  assert.match(report.mcp.local_config_command, /acb config mcp --command node --arg/);
  assert.match(human.stdout, /mcp_config_command/);
  if (!report.mcp.default_command_available) {
    assert.match(human.stdout, new RegExp(`mcp_install_hint: npm install -g ${pkg.name.replace("/", "\\/")}`));
    assert.match(human.stdout, /mcp_local_config_hint:/);
  }
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
    rpc("tools/call", { name: "get_workspace_status", arguments: { workspace } }, 3),
    rpc("tools/call", { name: "read_latest_handoff", arguments: { workspace } }, 4),
    rpc("tools/call", { name: "list_handoffs", arguments: { workspace, limit: 5 } }, 5),
    rpc("tools/call", { name: "search_handoffs", arguments: { workspace, query: "pull", limit: 5 } }, 6),
    rpc("tools/call", { name: "list_workspaces", arguments: { limit: 5 } }, 7),
    rpc("tools/call", { name: "read_handoff_brief", arguments: { workspace } }, 8),
  ].join("");

  const served = run(["serve"], { env, input });
  assert.equal(served.status, 0);
  assert.equal(served.stderr, "");
  const messages = parseJsonLines(served.stdout);
  assert.equal(messages.length, 8);
  assert.equal(messages[0].result.protocolVersion, "2025-06-18");
  assert.deepEqual(messages[0].result.capabilities, { tools: { listChanged: false } });
  assert.equal(messages[1].result.tools[0].name, "get_workspace_status");
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "read_latest_handoff"));
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "read_handoff_brief"));
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "search_handoffs"));
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "update_handoff"));
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "list_workspaces"));
  assert.match(messages[2].result.content[0].text, /ACB Status/);
  assert.equal(messages[2].result.structuredContent.report.workspace_packets, 1);
  assert.match(messages[2].result.structuredContent.report.next.resume, /^acb resume --id pkt_/);
  assert.match(messages[2].result.structuredContent.report.next.brief, /^acb brief --id pkt_/);
  assert.equal(messages[2].result.structuredContent.report.next.mcp_read_latest, "read_latest_handoff");
  assert.equal(messages[2].result.structuredContent.report.next.mcp_read_brief, "read_handoff_brief");
  assert.match(messages[3].result.content[0].text, /MCP handoff/);
  assert.equal(messages[3].result.structuredContent.packet.summary, "MCP handoff");
  assert.equal(messages[3].result.structuredContent.packet.next_mcp_read, "read_handoff");
  assert.equal(messages[3].result.structuredContent.packet.next_mcp_brief, "read_handoff_brief");
  assert.equal(messages[4].result.structuredContent.packets.length, 1);
  assert.equal(messages[4].result.structuredContent.packets[0].next_mcp_read, "read_handoff");
  assert.equal(messages[5].result.structuredContent.packets[0].summary, "MCP handoff");
  assert.match(messages[5].result.structuredContent.packets[0].next_resume, /^acb resume --id pkt_/);
  assert.equal(messages[6].result.structuredContent.workspaces[0].workspace, realWorkspace(workspace));
  assert.match(messages[6].result.structuredContent.workspaces[0].next_brief, /^acb brief --id pkt_/);
  assert.match(messages[7].result.content[0].text, /ACB brief/);
  assert.equal(messages[7].result.structuredContent.packet.summary, "MCP handoff");
  assert.match(messages[7].result.structuredContent.brief, /Full Context Commands/);

  const id = messages[4].result.structuredContent.packets[0].id;
  const readById = run(["serve"], {
    env,
    input: rpc("tools/call", { name: "read_handoff", arguments: { id } }, 1),
  });
  assert.equal(readById.status, 0);
  const [readMessage] = parseJsonLines(readById.stdout);
  assert.equal(readMessage.result.structuredContent.packet.id, id);
  assert.equal(readMessage.result.structuredContent.packet.next_show_prompt, `acb show ${id} --prompt`);
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

  let packets = JSON.parse(run(["list", "--all", "--json"], { env }).stdout);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].workspace, realWorkspace(workspaceB));

  const clearedAll = run(["clear", "--all"], { env });
  assert.equal(clearedAll.status, 0);
  assert.match(clearedAll.stdout, /cleared 1 handoff packet/);

  packets = JSON.parse(run(["list", "--all", "--json"], { env }).stdout);
  assert.equal(packets.length, 0);
});
