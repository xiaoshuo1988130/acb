#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STORE_VERSION,
  clipboardCandidates,
  commandExists,
  copyToClipboard,
  escapeHtml,
  formatCommand,
  jsonRpcLine,
  normalizeWorkspace,
  openFile,
  parseJsonRpcLines,
  readStore,
  storeError,
  storePath,
  writeStore,
} from "../lib/runtime.js";

const PACKAGE_META = readPackageMeta();
const VERSION = PACKAGE_META.version;
const PACKAGE_NAME = PACKAGE_META.name;
const DEFAULT_LIMIT = 10;
const PROMPT_BODY_LIMIT = 12000;
const BRIEF_BODY_LIMIT = 1800;
const DIFF_BODY_LIMIT = 20000;
const MCP_PROTOCOL_VERSION = "2025-06-18";

const usage = `AgentContextBus (acb) ${VERSION}

Usage:
  acb handoff [--from <agent>] [--workspace <path>] [--summary <text>] [--status <text>] [--note <text>] [--tag <tag>] [--file <path> | --stdin | --diff] [--git] [--diff-limit <chars>] [--no-copy | --print-prompt | --json]
  acb save [--from <agent>] [--workspace <path>] [--summary <text>] [--status <text>] [--note <text>] [--tag <tag>] [--file <path> | --stdin | --diff] [--git] [--diff-limit <chars>] [--copy | --print-prompt | --json]
  acb update <packet-id> [--summary <text>] [--status <text>] [--note <text>] [--tag <tag>] [--file <path> | --stdin | --diff] [--git] [--clear-notes] [--clear-tags] [--json]
  acb diff-preview [--workspace <path>] [--diff-limit <chars>] [--out <path>]
  acb latest [--workspace <path>] [--all] [--json]
  acb status [--workspace <path>] [--json]
  acb show <packet-id> [--json | --prompt]
  acb resume [--workspace <path>] [--id <packet-id>] [--no-copy | --print-prompt | --json | --preview] [--out <path>] [--open]
  acb brief [--workspace <path>] [--id <packet-id>] [--no-copy | --print-brief | --json]
  acb prompt [--workspace <path>] [--id <packet-id>] [--no-copy]
  acb preview [--workspace <path>] [--id <packet-id>] [--out <path>] [--open]
  acb list [--workspace <path>] [--all] [--limit <n>] [--json]
  acb workspaces [--limit <n>] [--json]
  acb search <query> [--workspace <path>] [--all] [--limit <n>] [--json]
  acb timeline [--workspace <path>] [--all] [--limit <n>] [--json]
  acb view [--workspace <path>] [--all] [--limit <n>] [--out <path>] [--open]
  acb dashboard [--workspace <path>] [--all] [--limit <n>] [--host <host>] [--port <port>] [--open]
  acb export [--workspace <path>] [--all] [--limit <n>] [--format markdown|json] [--out <path>]
  acb import --file <path> [--replace]
  acb delete <packet-id>
  acb clear [--workspace <path>] [--all]
  acb doctor [--workspace <path>] [--json]
  acb recipe [target] [--json]
  acb config mcp [--command <path-or-command>] [--name <server-name>] [--arg <value>...] [--out <path>]
  acb verify mcp [--config <path>] [--name <server-name>] [--workspace <path>] [--json]
  acb verify workflow <target> [--workspace <path>] [--keep-artifacts] [--json]
  acb serve
  acb store path
  acb store info [--json]
  acb store backup [--out <path>] [--force] [--json]
  acb quickstart [--check] [--workspace <path>] [--json]
  acb --version
  acb help

Purpose:
  Save a local handoff packet and turn it into a paste-ready prompt for another coding agent.
`;

const quickstart = `AgentContextBus quickstart

Install:
  npm install -g ${PACKAGE_NAME}

Check your local setup:
  acb quickstart --check

1. From the agent that has context:
  acb handoff --from codex --summary "Ready for the next agent" --git

2. In the next agent's workspace:
  acb resume

3. For a shorter first message:
  acb brief

4. Paste the copied handoff prompt or brief into the next agent.

For explicit MCP pull mode:
  acb config mcp --out ./mcp.json
  acb verify mcp --config ./mcp.json --name acb

Use the scoped package name ${PACKAGE_NAME}; the unscoped acb package name is already taken.
`;

const RECIPE_PROMPT = "Use acb to read the latest handoff for this workspace, then continue from it.";
const INSPECT_PROMPT = "Use acb to inspect this workspace status. If a latest handoff exists, read it before making changes.";

const RECIPE_TARGETS = [
  {
    id: "opencode",
    title: "OpenCode",
    aliases: ["open-code"],
    mode: "Copy/paste first; MCP pull when configured.",
    setup: [
      "acb quickstart --check",
      "acb handoff --from codex --summary \"Ready for OpenCode to continue\" --git",
      "acb resume",
      "acb config mcp --out ./mcp.json",
      "acb verify mcp --config ./mcp.json --name acb",
    ],
    prompt: RECIPE_PROMPT,
    notes: [
      "Use copy/paste mode for the first run because it works with every OpenCode setup.",
      "Add the generated MCP server entry only through the config path supported by your installed OpenCode version.",
      "Keep ACB as an explicit handoff source, not a hidden prompt injector.",
    ],
  },
  {
    id: "cline",
    title: "Cline",
    aliases: ["claude-dev"],
    mode: "Copy/paste first; MCP pull through Cline's own MCP configuration.",
    setup: [
      "acb quickstart --check",
      "acb handoff --from codex --summary \"Ready for Cline to continue\" --git",
      "acb resume",
      "acb config mcp --out ./mcp.json",
      "acb verify mcp --config ./mcp.json --name acb",
    ],
    prompt: INSPECT_PROMPT,
    notes: [
      "Do not edit VS Code extension storage or Cline private databases.",
      "Paste the handoff prompt into Cline, or add the generated MCP entry through Cline's supported settings path.",
      "Ask Cline to summarize the loaded handoff before it changes files.",
    ],
  },
  {
    id: "roo",
    title: "Roo Code",
    aliases: ["roo-code", "roocode"],
    mode: "Copy/paste first; MCP pull through Roo's own MCP configuration.",
    setup: [
      "acb quickstart --check",
      "acb handoff --from codex --summary \"Ready for Roo Code to continue\" --git",
      "acb resume",
      "acb config mcp --out ./mcp.json",
      "acb verify mcp --config ./mcp.json --name acb",
    ],
    prompt: INSPECT_PROMPT,
    notes: [
      "Do not patch Roo or VS Code private state.",
      "Use Roo's supported MCP configuration UI or file if you want tool-based pull mode.",
      "Use copy/paste mode when MCP config format changes between Roo versions.",
    ],
  },
  {
    id: "claude-desktop",
    title: "Claude Desktop",
    aliases: ["claude", "claude-code", "claude-desktop-app"],
    mode: "MCP pull when configured; copy/paste remains the fallback.",
    setup: [
      "acb quickstart --check",
      "acb config mcp --out ./mcp.json",
      "acb verify mcp --config ./mcp.json --name acb",
      "acb handoff --from codex --summary \"Ready for Claude Desktop to continue\" --git",
    ],
    prompt: "Use acb to read the latest handoff for this workspace. Summarize what you loaded before acting.",
    notes: [
      "Add the generated MCP server entry through Claude Desktop's supported local config path.",
      "Restart Claude Desktop after changing MCP configuration if your version requires it.",
      "Keep handoff loading explicit and auditable.",
    ],
  },
  {
    id: "codex",
    title: "Codex",
    aliases: ["openai-codex"],
    mode: "Copy/paste first; scripts can also read JSON directly.",
    setup: [
      "acb quickstart --check",
      "acb handoff --from opencode --summary \"Ready for Codex to continue\" --git",
      "acb resume",
      "acb latest --json",
    ],
    prompt: RECIPE_PROMPT,
    notes: [
      "Use copy/paste mode when resuming a Codex thread from another tool.",
      "Use JSON commands for scripts or automation that should avoid natural-language parsing.",
      "Do not ask ACB to commit, push, or publish unless the user explicitly requests it.",
    ],
  },
  {
    id: "generic-mcp",
    title: "Generic MCP Client",
    aliases: ["mcp", "generic", "mcp-client"],
    mode: "Explicit MCP pull.",
    setup: [
      "acb quickstart --check",
      "acb config mcp --out ./mcp.json",
      "acb verify mcp --config ./mcp.json --name acb",
    ],
    prompt: RECIPE_PROMPT,
    notes: [
      "Use the generated stdio server entry wherever your MCP client accepts local servers.",
      "If PATH lookup fails, run acb doctor and use the local node command hint.",
      "Prefer read_latest_handoff for workspace takeover and get_workspace_status for triage.",
    ],
  },
];

function readPackageMeta() {
  try {
    const packageUrl = new URL("../package.json", import.meta.url);
    const parsed = JSON.parse(fs.readFileSync(packageUrl, "utf8"));
    return {
      name: parsed.name || "@xiaoshuo1988/acb",
      version: parsed.version || "0.0.0",
    };
  } catch {
    return { name: "@xiaoshuo1988/acb", version: "0.0.0" };
  }
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || "help";
  const args = argv.slice(1);

  if (command === "help" || command === "--help" || command === "-h") return print(usage);
  if (command === "--version" || command === "-v" || command === "version") return print(`acb ${VERSION}\n`);
  if (command === "quickstart") return quickstartCommand(args);
  if (command === "handoff") return handoffCommand(args);
  if (command === "save") return saveCommand(args);
  if (command === "update") return updateCommand(args);
  if (command === "diff-preview") return diffPreviewCommand(args);
  if (command === "latest") return latestCommand(args);
  if (command === "status") return statusCommand(args);
  if (command === "show") return showCommand(args);
  if (command === "resume") return resumeCommand(args);
  if (command === "brief") return briefCommand(args);
  if (command === "prompt") return promptCommand(args);
  if (command === "preview") return previewCommand(args);
  if (command === "list") return listCommand(args);
  if (command === "workspaces") return workspacesCommand(args);
  if (command === "search") return searchCommand(args);
  if (command === "timeline") return timelineCommand(args);
  if (command === "view") return viewCommand(args);
  if (command === "dashboard") return dashboardCommand(args);
  if (command === "export") return exportCommand(args);
  if (command === "import") return importCommand(args);
  if (command === "delete") return deleteCommand(args);
  if (command === "clear") return clearCommand(args);
  if (command === "doctor") return doctorCommand(args);
  if (command === "recipe" || command === "recipes") return recipeCommand(args);
  if (command === "config") return configCommand(args);
  if (command === "verify") return verifyCommand(args);
  if (command === "serve") return serveCommand(args);
  if (command === "store") return storeCommand(args);

  console.error(`Unknown command: ${command}\n\n${usage}`);
  return 2;
}

function handoffCommand(args) {
  if (args.includes("--no-copy") && saveOutputModes(args).length > 0) {
    console.error("Use only one handoff output mode: --no-copy, --print-prompt, or --json.");
    return 2;
  }

  const cleanArgs = args.filter((arg) => arg !== "--no-copy");
  if (args.includes("--no-copy") || saveOutputModes(cleanArgs).length > 0) {
    return saveCommand(cleanArgs);
  }
  return saveCommand([...cleanArgs, "--copy"]);
}

function quickstartCommand(args) {
  if (args.includes("--check")) {
    const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
    const report = buildDoctorReport(workspace);
    const check = {
      ok: report.ok,
      version: VERSION,
      package: PACKAGE_NAME,
      command_path: path.resolve(process.argv[1] || "bin/acb.js"),
      install_command: `npm install -g ${PACKAGE_NAME}`,
      workspace,
      store_path: report.store_path,
      checks: report.checks,
      next: {
        handoff: "acb handoff --from codex --summary \"Ready for the next agent\" --git",
        resume: "acb resume",
        brief: "acb brief",
        doctor: "acb doctor",
        mcp_config: report.mcp.config_command,
        mcp_verify: report.mcp.verify_command,
      },
    };
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify(check, null, 2)}\n`);
      return check.ok ? 0 : 1;
    }
    printQuickstartCheck(check, report);
    return check.ok ? 0 : 1;
  }

  if (args.includes("--json")) {
    console.error("Usage: acb quickstart --check --json");
    return 2;
  }

  return print(quickstart);
}

function saveCommand(args) {
  if (saveOutputModes(args).length > 1) {
    console.error("Use only one save output mode: --copy, --print-prompt, or --json.");
    return 2;
  }

  const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const summary = argValue(args, "--summary") || "";
  const status = argValue(args, "--status") || "";
  const notes = argValues(args, "--note");
  const tags = argValues(args, "--tag");
  const from = argValue(args, "--from") || process.env.ACB_AGENT || "unknown";
  const bodyResult = readSaveBody(args, workspace);
  const gitResult = args.includes("--git") || args.includes("--diff")
    ? readGitSnapshot(workspace)
    : { ok: true, snapshot: null };

  if (!bodyResult.ok) {
    console.error(bodyResult.error);
    return 2;
  }
  if (!gitResult.ok) {
    console.error(gitResult.error);
    return 2;
  }

  if (!summary && !status && notes.length === 0 && !bodyResult.body && !gitResult.snapshot) {
    console.error("acb save needs at least --summary, --status, --note, --file, --stdin, --diff, or --git.");
    return 2;
  }

  const packet = createHandoffPacket({
    from,
    workspace,
    summary: summary || null,
    status: status || null,
    notes,
    tags,
    body: bodyResult.body || null,
    git: gitResult.snapshot,
  });

  const store = loadStore();
  store.packets.unshift(packet);
  writeStore(store);

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
    return 0;
  }

  if (args.includes("--print-prompt")) {
    process.stdout.write(renderHandoffPrompt(packet));
    return 0;
  }

  if (args.includes("--copy")) {
    const copied = copyToClipboard(renderHandoffPrompt(packet));
    if (copied.ok) {
      console.log(`[acb] saved handoff packet: ${packet.id}`);
      console.log("[acb] handoff prompt copied to clipboard.");
      console.log("[acb] switch to your next agent and paste.");
      return 0;
    }
    console.error(`[acb] clipboard unavailable: ${copied.error}`);
    console.error("[acb] saved packet, printing prompt instead:\n");
    process.stdout.write(renderHandoffPrompt(packet));
    return 0;
  }

  console.log(`[acb] saved handoff packet: ${packet.id}`);
  console.log(`[acb] workspace: ${packet.workspace}`);
  console.log(`[acb] next: acb resume --id ${packet.id}`);
  return 0;
}

function saveOutputModes(args) {
  return ["--copy", "--print-prompt", "--json"].filter((flag) => args.includes(flag));
}

function createHandoffPacket({ from, workspace, summary = null, status = null, notes = [], tags = [], body = null, git = null }) {
  return {
    id: createPacketId(),
    version: STORE_VERSION,
    created_at: new Date().toISOString(),
    from: from || "unknown",
    workspace,
    summary,
    status,
    notes,
    tags,
    body,
    git,
  };
}

function updateCommand(args) {
  const id = args[0] || argValue(args, "--id");
  if (!id) {
    console.error("Usage: acb update <packet-id> [--summary <text>] [--status <text>] [--note <text>] [--tag <tag>] [--file <path> | --stdin | --diff] [--git] [--clear-notes] [--clear-tags] [--json]");
    return 2;
  }
  if (!hasUpdateArgs(args)) {
    console.error("acb update needs at least one change: --summary, --status, --note, --tag, --file, --stdin, --diff, --git, --clear-notes, or --clear-tags.");
    return 2;
  }

  const existing = findPacket({ id });
  if (!existing) {
    console.error(`No handoff packet found for id: ${id}`);
    return 1;
  }

  const packet = { ...existing };
  if (argValue(args, "--summary") !== undefined) packet.summary = argValue(args, "--summary") || null;
  if (argValue(args, "--status") !== undefined) packet.status = argValue(args, "--status") || null;

  const notes = argValues(args, "--note");
  if (args.includes("--clear-notes")) packet.notes = [];
  if (notes.length) packet.notes = [...(packet.notes || []), ...notes];

  const tags = argValues(args, "--tag");
  if (args.includes("--clear-tags")) packet.tags = [];
  if (tags.length) packet.tags = uniqueStrings([...(packet.tags || []), ...tags]);

  if (hasBodySource(args)) {
    const bodyResult = readSaveBody(args, packet.workspace);
    if (!bodyResult.ok) {
      console.error(bodyResult.error);
      return 2;
    }
    packet.body = bodyResult.body || null;
  }

  if (args.includes("--git") || args.includes("--diff")) {
    const gitResult = readGitSnapshot(packet.workspace);
    if (!gitResult.ok) {
      console.error(gitResult.error);
      return 2;
    }
    packet.git = gitResult.snapshot;
  }

  packet.updated_at = new Date().toISOString();
  replacePacket(packet);

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
    return 0;
  }
  console.log(`[acb] updated handoff packet: ${packet.id}`);
  console.log(`[acb] next: acb show ${packet.id}`);
  return 0;
}

function diffPreviewCommand(args) {
  const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const diffResult = readGitDiffBody(workspace, argValue(args, "--diff-limit"));
  if (!diffResult.ok) {
    console.error(diffResult.error);
    return 2;
  }
  const outPath = argValue(args, "--out");
  if (outPath) {
    const resolved = path.resolve(outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, diffResult.body);
    console.log(`[acb] wrote diff preview to ${resolved}`);
    return 0;
  }
  process.stdout.write(diffResult.body);
  return 0;
}

function latestCommand(args) {
  if (args.includes("--workspace") && args.includes("--all")) {
    console.error("Use either --workspace or --all, not both.");
    return 2;
  }
  const workspace = args.includes("--all")
    ? null
    : normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const packet = findPacket({ workspace });
  if (!packet) {
    console.error(workspace ? `No handoff packet found for workspace: ${workspace}` : "No handoff packets found.");
    return 1;
  }
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(packetWithNextSteps(packet), null, 2)}\n`);
    return 0;
  }
  printPacket(packet);
  return 0;
}

function statusCommand(args) {
  const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const report = buildStatusReport(workspace);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  printStatusReport(report);
  return 0;
}

function showCommand(args) {
  const id = args[0] || argValue(args, "--id");
  if (!id) {
    console.error("Usage: acb show <packet-id> [--json | --prompt]");
    return 2;
  }
  const packet = findPacket({ id });
  if (!packet) {
    console.error(`No handoff packet found for id: ${id}`);
    return 1;
  }
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(packetWithNextSteps(packet), null, 2)}\n`);
    return 0;
  }
  if (args.includes("--prompt")) {
    process.stdout.write(renderHandoffPrompt(packet));
    return 0;
  }
  printPacket(packet);
  return 0;
}

function resumeCommand(args) {
  const wantsPreview = resumeWantsPreview(args);
  if (resumeOutputModes(args, wantsPreview).length > 1) {
    console.error("Use only one resume output mode: --no-copy, --print-prompt, --json, or --preview.");
    return 2;
  }

  const { workspace, id } = resolveReadScope(args);
  const packet = findPacket({ workspace, id });
  if (!packet) {
    console.error(id ? `No handoff packet found for id: ${id}` : "No handoff packet found to resume.");
    return 1;
  }

  const prompt = renderHandoffPrompt(packet);
  if (wantsPreview) {
    return writePromptPreview(packet, args);
  }
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ packet, prompt }, null, 2)}\n`);
    return 0;
  }
  if (args.includes("--no-copy") || args.includes("--print-prompt")) {
    process.stdout.write(prompt);
    return 0;
  }

  const copied = copyToClipboard(prompt);
  if (copied.ok) {
    console.log("[acb] resume prompt copied to clipboard.");
    console.log("[acb] paste it into the current agent session.");
    return 0;
  }

  console.error(`[acb] clipboard unavailable: ${copied.error}`);
  console.error("[acb] printing resume prompt instead:\n");
  process.stdout.write(prompt);
  return 0;
}

function briefCommand(args) {
  if (briefOutputModes(args).length > 1) {
    console.error("Use only one brief output mode: --no-copy, --print-brief, or --json.");
    return 2;
  }

  const id = argValue(args, "--id");
  const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const packet = findPacket({ workspace: id ? null : workspace, id });
  if (!packet) {
    console.error(id ? `No handoff packet found for id: ${id}` : "No handoff packet found to brief.");
    return 1;
  }

  const brief = renderBriefPrompt(packet);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ packet: packetWithNextSteps(packet), brief }, null, 2)}\n`);
    return 0;
  }
  if (args.includes("--print-brief") || args.includes("--no-copy")) {
    process.stdout.write(brief);
    return 0;
  }

  const copied = copyToClipboard(brief);
  if (copied.ok) {
    console.log("[acb] brief copied to clipboard.");
    console.log("Paste it into the next agent as the first message.");
    return 0;
  }
  console.error(`[acb] clipboard unavailable: ${copied.error}`);
  console.error("[acb] printing brief instead:\n");
  process.stdout.write(brief);
  return 0;
}

function briefOutputModes(args) {
  return ["--no-copy", "--print-brief", "--json"].filter((flag) => args.includes(flag));
}

function resumeWantsPreview(args) {
  return args.includes("--preview") || args.includes("--open") || args.includes("--out");
}

function resumeOutputModes(args, wantsPreview = resumeWantsPreview(args)) {
  return [
    ...["--no-copy", "--print-prompt", "--json"].filter((flag) => args.includes(flag)),
    ...(wantsPreview ? ["--preview"] : []),
  ];
}

function promptCommand(args) {
  const { workspace, id } = resolveReadScope(args);
  const packet = findPacket({ workspace, id });
  if (!packet) {
    console.error(id ? `No handoff packet found for id: ${id}` : "No handoff packet found.");
    return 1;
  }

  const prompt = renderHandoffPrompt(packet);
  if (args.includes("--no-copy")) {
    process.stdout.write(prompt);
    return 0;
  }

  const copied = copyToClipboard(prompt);
  if (copied.ok) {
    console.log("[acb] handoff prompt copied to clipboard.");
    console.log("[acb] switch to your next agent and paste.");
    return 0;
  }

  console.error(`[acb] clipboard unavailable: ${copied.error}`);
  console.error("[acb] printing prompt instead:\n");
  process.stdout.write(prompt);
  return 0;
}

function previewCommand(args) {
  const { workspace, id } = resolveReadScope(args);
  const packet = findPacket({ workspace, id });
  if (!packet) {
    console.error(id ? `No handoff packet found for id: ${id}` : "No handoff packet found.");
    return 1;
  }

  return writePromptPreview(packet, args);
}

function resolveReadScope(args) {
  const id = argValue(args, "--id");
  const workspace = id
    ? (args.includes("--workspace") ? normalizeWorkspace(argValue(args, "--workspace")) : null)
    : normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  return { workspace, id };
}

function writePromptPreview(packet, args) {
  const outPath = argValue(args, "--out") || defaultPreviewPath(packet);
  const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, renderPromptPreview(packet));

  if (args.includes("--open")) {
    const opened = openFile(resolved);
    if (!opened.ok) {
      console.error(`[acb] wrote prompt preview to ${resolved}`);
      console.error(`[acb] cannot open preview: ${opened.error}`);
      return 1;
    }
    console.log(`[acb] opened prompt preview: ${resolved}`);
    return 0;
  }

  console.log(`[acb] wrote prompt preview to ${resolved}`);
  console.log("[acb] add --open to open it with your system default app.");
  return 0;
}

function listCommand(args) {
  const scope = resolveHistoryScope(args);
  if (!scope.ok) {
    console.error(scope.error);
    return 2;
  }
  const { workspace } = scope;
  const limit = parseLimit(argValue(args, "--limit"));
  if (!limit) {
    console.error("--limit must be a positive integer.");
    return 2;
  }
  const store = loadStore();
  const packets = store.packets
    .filter((packet) => !workspace || packet.workspace === workspace)
    .slice(0, limit);

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(packets, null, 2)}\n`);
    return 0;
  }
  if (packets.length === 0) {
    console.log(workspace ? `[acb] no packets for workspace: ${workspace}` : "[acb] no packets");
    return 0;
  }
  console.log("ACB List");
  console.log(workspace ? `workspace: ${workspace}` : "workspace: all");
  for (const packet of packets) {
    console.log(`${packet.id}  ${packet.created_at}  ${packet.from}  ${packet.workspace}`);
    if (packet.summary) console.log(`  ${packet.summary}`);
  }
  return 0;
}

function workspacesCommand(args) {
  const limit = parseLimit(argValue(args, "--limit"));
  if (!limit) {
    console.error("--limit must be a positive integer.");
    return 2;
  }
  const workspaces = listWorkspaceSummaries(limit);

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(workspaces, null, 2)}\n`);
    return 0;
  }
  if (workspaces.length === 0) {
    console.log("[acb] no workspaces");
    return 0;
  }

  console.log("ACB Workspaces");
  for (const item of workspaces) {
    console.log(`${item.workspace}`);
    console.log(`  packets: ${item.packets}`);
    console.log(`  latest: ${item.latest_packet_id}  ${item.latest_created_at}  ${item.latest_from}`);
    if (item.latest_summary) console.log(`  summary: ${item.latest_summary}`);
    console.log(`  next_resume: ${item.next_resume}`);
    console.log(`  next_brief: ${item.next_brief}`);
  }
  return 0;
}

function searchCommand(args) {
  const query = args.find((arg) => !arg.startsWith("--"));
  if (!query) {
    console.error("Usage: acb search <query> [--workspace <path>] [--all] [--limit <n>] [--json]");
    return 2;
  }
  const scope = resolveHistoryScope(args);
  if (!scope.ok) {
    console.error(scope.error);
    return 2;
  }
  const { workspace } = scope;
  const limit = parseLimit(argValue(args, "--limit"));
  if (!limit) {
    console.error("--limit must be a positive integer.");
    return 2;
  }
  const matches = searchPackets({ query, workspace, limit });

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(matches, null, 2)}\n`);
    return 0;
  }

  if (matches.length === 0) {
    console.log(workspace ? `[acb] no packets matched "${query}" in workspace: ${workspace}` : `[acb] no packets matched "${query}"`);
    return 0;
  }

  console.log(`ACB Search: ${query}`);
  console.log(workspace ? `workspace: ${workspace}` : "workspace: all");
  for (const packet of matches) {
    console.log(`${packet.id}  ${packet.created_at}  ${packet.from}`);
    console.log(`  workspace: ${packet.workspace}`);
    if (packet.summary) console.log(`  summary: ${packet.summary}`);
    if (packet.status) console.log(`  status: ${packet.status}`);
    if (packet.tags?.length) console.log(`  tags: ${packet.tags.join(", ")}`);
  }
  return 0;
}

function timelineCommand(args) {
  const scope = resolveHistoryScope(args);
  if (!scope.ok) {
    console.error(scope.error);
    return 2;
  }
  const { workspace } = scope;
  const limit = parseLimit(argValue(args, "--limit"));
  if (!limit) {
    console.error("--limit must be a positive integer.");
    return 2;
  }
  const packets = loadStore().packets
    .filter((packet) => !workspace || packet.workspace === workspace)
    .slice(0, limit);

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(packets.map(packetSummary), null, 2)}\n`);
    return 0;
  }

  if (packets.length === 0) {
    console.log(workspace ? `[acb] no timeline packets for workspace: ${workspace}` : "[acb] no timeline packets");
    return 0;
  }

  console.log("ACB Timeline");
  console.log(workspace ? `workspace: ${workspace}` : "workspace: all");
  for (const packet of packets) printTimelinePacket(packet);
  return 0;
}

function viewCommand(args) {
  const scope = resolveHistoryScope(args);
  if (!scope.ok) {
    console.error(scope.error);
    return 2;
  }
  const { workspace } = scope;
  const limit = parseLimit(argValue(args, "--limit"));
  if (!limit) {
    console.error("--limit must be a positive integer.");
    return 2;
  }

  const packets = loadStore().packets
    .filter((packet) => !workspace || packet.workspace === workspace)
    .slice(0, limit);
  const outPath = path.resolve(argValue(args, "--out") || defaultViewPath(workspace));
  const html = renderHtmlView(packets, { workspace, limit });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);

  if (args.includes("--open")) {
    const opened = openFile(outPath);
    if (!opened.ok) {
      console.error(`[acb] wrote local viewer to ${outPath}`);
      console.error(`[acb] cannot open viewer: ${opened.error}`);
      return 1;
    }
    console.log(`[acb] opened local viewer: ${outPath}`);
    return 0;
  }

  console.log(`[acb] wrote local viewer to ${outPath}`);
  console.log(`[acb] packets: ${packets.length}`);
  console.log("[acb] add --open to open it with your system default browser.");
  return 0;
}

function dashboardCommand(args) {
  const scope = resolveHistoryScope(args);
  if (!scope.ok) {
    console.error(scope.error);
    return 2;
  }
  const { workspace } = scope;
  const limit = parseLimit(argValue(args, "--limit"));
  if (!limit) {
    console.error("--limit must be a positive integer.");
    return 2;
  }
  const host = argValue(args, "--host") || "127.0.0.1";
  const port = parsePort(argValue(args, "--port"));
  if (port === null) {
    console.error("--port must be an integer between 0 and 65535.");
    return 2;
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", `http://${host}`);
    if (request.method !== "GET") {
      sendDashboardResponse(response, 405, "text/plain; charset=utf-8", "Method not allowed\n");
      return;
    }
    if (url.pathname === "/health") {
      sendDashboardResponse(response, 200, "text/plain; charset=utf-8", "ok\n");
      return;
    }
    const state = buildDashboardState({ workspace, limit });
    if (url.pathname === "/api/state") {
      sendDashboardResponse(response, 200, "application/json; charset=utf-8", `${JSON.stringify(state, null, 2)}\n`);
      return;
    }
    if (url.pathname === "/") {
      sendDashboardResponse(response, 200, "text/html; charset=utf-8", renderDashboardHtml(state));
      return;
    }
    sendDashboardResponse(response, 404, "text/plain; charset=utf-8", "Not found\n");
  });

  return new Promise((resolve) => {
    server.on("error", (error) => {
      console.error(`[acb] dashboard failed: ${error.message}`);
      resolve(1);
    });
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      const url = `http://${host}:${actualPort}/`;
      console.log(`[acb] dashboard: ${url}`);
      console.log("[acb] read-only; press Ctrl+C to stop.");
      if (args.includes("--open")) {
        const opened = openFile(url);
        if (!opened.ok) console.error(`[acb] cannot open dashboard: ${opened.error}`);
      }
    });
  });
}

function sendDashboardResponse(response, status, contentType, body) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}

function buildDashboardState({ workspace = null, limit = DEFAULT_LIMIT } = {}) {
  const store = loadStore();
  const scopedPackets = store.packets
    .filter((packet) => !workspace || packet.workspace === workspace);
  const packets = scopedPackets.slice(0, limit);
  const workspaces = workspace
    ? listWorkspaceSummaries(20).filter((item) => item.workspace === workspace)
    : listWorkspaceSummaries(20);
  return {
    version: VERSION,
    generated_at: new Date().toISOString(),
    scope: workspace ? "workspace" : "all",
    workspace,
    store_path: storePath(),
    limit,
    total_packets: scopedPackets.length,
    shown_packets: packets.length,
    workspace_count: new Set(scopedPackets.map((packet) => packet.workspace)).size,
    dirty_file_count: packets.reduce((sum, packet) => sum + (packet.git?.status?.length || 0), 0),
    body_chars: packets.reduce((sum, packet) => sum + (packet.body?.length || 0), 0),
    latest_packet: packets[0] ? dashboardPacketSummary(packets[0]) : null,
    packets: packets.map(dashboardPacketSummary),
    workspaces,
  };
}

function dashboardPacketSummary(packet) {
  return {
    ...packetSummary(packet),
    notes: packet.notes || [],
    body_preview: packet.body ? truncateText(packet.body, 2600) : "",
    git: packet.git ? {
      branch: packet.git.branch || null,
      head: packet.git.head || null,
      status: packet.git.status || [],
    } : null,
  };
}

function renderDashboardHtml(state) {
  const stateJson = escapeScriptJson(JSON.stringify(state));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ACB Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --panel: #ffffff;
      --text: #1f2328;
      --muted: #59636e;
      --line: #d8dee4;
      --soft: #eef2f6;
      --accent: #0a7ea4;
      --accent-strong: #075f7a;
      --good: #1a7f37;
      --warn: #9a6700;
      --danger: #cf222e;
      --code: #f6f8fa;
      --shadow: 0 10px 30px rgba(31, 35, 40, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }
    button, input { font: inherit; }
    button { cursor: pointer; }
    .shell { max-width: 1440px; margin: 0 auto; padding: 20px; }
    .topbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: start;
      margin-bottom: 16px;
    }
    h1 { margin: 0 0 6px; font-size: 28px; line-height: 1.15; letter-spacing: 0; }
    h2 { margin: 0; font-size: 16px; letter-spacing: 0; }
    h3 { margin: 0; font-size: 15px; letter-spacing: 0; }
    p { margin: 0; color: var(--muted); }
    .meta, .small { color: var(--muted); font-size: 12px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .btn, .tab {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      border-radius: 6px;
      padding: 7px 10px;
      min-height: 34px;
    }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn:hover, .tab:hover { border-color: var(--accent); }
    .stats { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 10px; margin-bottom: 16px; }
    .stat, .panel, .empty {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      box-shadow: var(--shadow);
    }
    .stat strong { display: block; font-size: 23px; line-height: 1.2; }
    .stat span { color: var(--muted); font-size: 12px; }
    .grid {
      display: grid;
      grid-template-columns: 340px minmax(0, 1fr) 320px;
      gap: 14px;
      align-items: start;
    }
    .panel { min-width: 0; }
    .panel-header { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
    .search {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 9px 10px;
      background: var(--panel);
      color: var(--text);
      margin-bottom: 10px;
    }
    .packet-list { display: grid; gap: 8px; max-height: calc(100vh - 260px); overflow: auto; padding-right: 2px; }
    .packet-row {
      width: 100%;
      text-align: left;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 10px;
      color: var(--text);
    }
    .packet-row.active { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); background: #f0f9fb; }
    .packet-title { font-weight: 650; overflow-wrap: anywhere; }
    .packet-sub { color: var(--muted); font-size: 12px; margin-top: 3px; }
    .badge-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 1px solid var(--line);
      background: var(--soft);
      color: var(--text);
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 12px;
      max-width: 100%;
    }
    .badge.good { color: var(--good); border-color: rgba(26, 127, 55, 0.25); background: rgba(26, 127, 55, 0.08); }
    .badge.warn { color: var(--warn); border-color: rgba(154, 103, 0, 0.25); background: rgba(154, 103, 0, 0.08); }
    .detail-title { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .detail-title h2 { font-size: 22px; overflow-wrap: anywhere; }
    .tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
    .tab.active { background: var(--accent); border-color: var(--accent); color: white; }
    .kv {
      display: grid;
      grid-template-columns: 120px minmax(0, 1fr);
      gap: 7px 12px;
      margin: 12px 0;
      font-size: 13px;
    }
    .kv div:nth-child(odd) { color: var(--muted); }
    .kv div:nth-child(even) { overflow-wrap: anywhere; }
    .command-grid { display: grid; gap: 8px; margin-top: 10px; }
    .command {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      border: 1px solid var(--line);
      background: var(--code);
      border-radius: 8px;
      padding: 8px;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: var(--code);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      max-height: 360px;
      overflow: auto;
      font-size: 12px;
    }
    ul { list-style: none; padding: 0; margin: 0; }
    li { display: flex; justify-content: space-between; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--line); }
    li:last-child { border-bottom: 0; }
    li span { overflow-wrap: anywhere; color: var(--muted); font-size: 13px; }
    a { color: var(--accent); }
    .hidden { display: none !important; }
    .empty { color: var(--muted); }
    .toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      background: var(--text);
      color: white;
      padding: 9px 12px;
      border-radius: 8px;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 160ms ease, transform 160ms ease;
      pointer-events: none;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    @media (max-width: 1100px) {
      .grid { grid-template-columns: 300px minmax(0, 1fr); }
      .side { grid-column: 1 / -1; }
      .stats { grid-template-columns: repeat(3, minmax(120px, 1fr)); }
    }
    @media (max-width: 760px) {
      .shell { padding: 14px; }
      .topbar { grid-template-columns: 1fr; }
      .toolbar { justify-content: flex-start; }
      .grid { grid-template-columns: 1fr; }
      .stats { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
      .packet-list { max-height: none; }
      .kv { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <script id="acb-state" type="application/json">${stateJson}</script>
  <main class="shell">
    <header class="topbar">
      <div>
        <h1>ACB Dashboard</h1>
        <p>${escapeHtml(state.workspace || "All workspaces")} · read-only local control surface</p>
      </div>
      <div class="toolbar">
        <button class="btn" id="refresh">Refresh</button>
        <button class="btn" id="toggle-json">JSON</button>
        <a class="btn primary" href="/api/state">/api/state</a>
      </div>
    </header>
    <section class="stats" aria-label="summary">
      <div class="stat"><strong>${state.shown_packets}</strong><span>packets shown</span></div>
      <div class="stat"><strong>${state.total_packets}</strong><span>total packets</span></div>
      <div class="stat"><strong>${state.workspace_count}</strong><span>workspaces</span></div>
      <div class="stat"><strong>${state.dirty_file_count}</strong><span>dirty files captured</span></div>
      <div class="stat"><strong>${state.body_chars}</strong><span>body chars shown</span></div>
    </section>
    <section class="grid">
      <aside class="panel">
        <div class="panel-header">
          <h2>Packets</h2>
          <span class="small" id="packet-count"></span>
        </div>
        <input class="search" id="search" type="search" placeholder="Search summary, status, tags, notes">
        <div class="packet-list" id="packet-list"></div>
      </aside>
      <section class="panel" id="detail"></section>
      <aside class="panel side">
        <div class="panel-header">
          <h2>Workspace</h2>
          <span class="small">v${escapeHtml(state.version)}</span>
        </div>
        <div class="kv">
          <div>scope</div><div>${escapeHtml(state.scope)}</div>
          <div>generated</div><div>${escapeHtml(state.generated_at)}</div>
          <div>store</div><div>${escapeHtml(state.store_path)}</div>
          <div>limit</div><div>${escapeHtml(String(state.limit))}</div>
        </div>
        <h3>Workspace History</h3>
        <ul id="workspace-list"></ul>
      </aside>
    </section>
    <section class="panel hidden" id="json-panel" style="margin-top: 14px;">
      <div class="panel-header"><h2>Raw State</h2><span class="small">read-only</span></div>
      <pre id="raw-json"></pre>
    </section>
  </main>
  <div class="toast" id="toast">Copied</div>
  <script>
    const state = JSON.parse(document.getElementById("acb-state").textContent);
    let selectedId = state.latest_packet ? state.latest_packet.id : null;
    let activeTab = "overview";

    const el = (id) => document.getElementById(id);
    const fmt = (value) => value == null || value === "" ? "—" : String(value);
    const escape = (value) => String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
    const packetTitle = (packet) => packet.summary || packet.status || packet.id;

    function render() {
      renderPackets();
      renderDetail();
      renderWorkspaces();
      el("raw-json").textContent = JSON.stringify(state, null, 2);
    }

    function filteredPackets() {
      const query = el("search").value.trim().toLowerCase();
      if (!query) return state.packets;
      return state.packets.filter((packet) => [
        packet.id,
        packet.from,
        packet.workspace,
        packet.summary,
        packet.status,
        (packet.tags || []).join(" "),
        (packet.notes || []).join(" "),
        packet.body_preview,
      ].filter(Boolean).join("\\n").toLowerCase().includes(query));
    }

    function renderPackets() {
      const packets = filteredPackets();
      el("packet-count").textContent = packets.length + " shown";
      if (!packets.length) {
        el("packet-list").innerHTML = '<div class="empty">No packets match this filter.</div>';
        return;
      }
      if (!packets.some((packet) => packet.id === selectedId)) selectedId = packets[0].id;
      el("packet-list").innerHTML = packets.map((packet) => {
        const tags = (packet.tags || []).slice(0, 3).map((tag) => '<span class="badge">' + escape(tag) + '</span>').join("");
        const dirty = packet.git_dirty_files ? '<span class="badge warn">' + packet.git_dirty_files + ' dirty</span>' : '<span class="badge good">clean</span>';
        return '<button class="packet-row ' + (packet.id === selectedId ? 'active' : '') + '" data-id="' + escape(packet.id) + '">' +
          '<div class="packet-title">' + escape(packetTitle(packet)) + '</div>' +
          '<div class="packet-sub">' + escape(packet.from) + ' · ' + escape(packet.created_at) + '</div>' +
          '<div class="badge-row">' + dirty + tags + '</div>' +
        '</button>';
      }).join("");
      for (const row of document.querySelectorAll(".packet-row")) {
        row.addEventListener("click", () => {
          selectedId = row.dataset.id;
          activeTab = "overview";
          render();
        });
      }
    }

    function renderDetail() {
      const packet = state.packets.find((item) => item.id === selectedId);
      if (!packet) {
        el("detail").innerHTML = '<div class="empty">No handoff packet selected.</div>';
        return;
      }
      const tabs = ["overview", "commands", "body", "git"];
      const tabButtons = tabs.map((tab) => '<button class="tab ' + (tab === activeTab ? 'active' : '') + '" data-tab="' + tab + '">' + tab + '</button>').join("");
      el("detail").innerHTML =
        '<div class="detail-title">' +
          '<div><h2>' + escape(packetTitle(packet)) + '</h2><p>' + escape(packet.id) + '</p></div>' +
          '<button class="btn primary" data-copy="' + escape(packet.next_brief) + '">Copy brief command</button>' +
        '</div>' +
        '<div class="tabs">' + tabButtons + '</div>' +
        '<div id="tab-content">' + renderTab(packet) + '</div>';
      for (const tab of document.querySelectorAll(".tab")) {
        tab.addEventListener("click", () => {
          activeTab = tab.dataset.tab;
          renderDetail();
        });
      }
      wireCopyButtons();
    }

    function renderTab(packet) {
      if (activeTab === "commands") {
        return '<div class="command-grid">' + [
          ["Brief", packet.next_brief],
          ["Resume", packet.next_resume],
          ["Show prompt", packet.next_show_prompt],
          ["MCP full", packet.next_mcp_read],
          ["MCP brief", packet.next_mcp_brief],
        ].map(([label, command]) => '<div class="command"><code>' + escape(command) + '</code><button class="btn" data-copy="' + escape(command) + '">Copy</button></div>').join("") + '</div>';
      }
      if (activeTab === "body") {
        return packet.body_preview
          ? '<pre>' + escape(packet.body_preview) + '</pre>'
          : '<div class="empty">No body preview captured for this packet.</div>';
      }
      if (activeTab === "git") {
        if (!packet.git) return '<div class="empty">No Git snapshot captured.</div>';
        const status = packet.git.status && packet.git.status.length ? packet.git.status.join("\\n") : "No dirty files captured.";
        return '<div class="kv"><div>branch</div><div>' + escape(fmt(packet.git.branch)) + '</div><div>head</div><div>' + escape(fmt(packet.git.head)) + '</div></div><pre>' + escape(status) + '</pre>';
      }
      const notes = packet.notes && packet.notes.length
        ? '<ul>' + packet.notes.map((note) => '<li><span>' + escape(note) + '</span></li>').join("") + '</ul>'
        : '<div class="empty">No notes.</div>';
      const tags = packet.tags && packet.tags.length
        ? '<div class="badge-row">' + packet.tags.map((tag) => '<span class="badge">' + escape(tag) + '</span>').join("") + '</div>'
        : '<div class="empty">No tags.</div>';
      return '<div class="kv">' +
        '<div>from</div><div>' + escape(fmt(packet.from)) + '</div>' +
        '<div>workspace</div><div>' + escape(fmt(packet.workspace)) + '</div>' +
        '<div>created</div><div>' + escape(fmt(packet.created_at)) + '</div>' +
        '<div>updated</div><div>' + escape(fmt(packet.updated_at)) + '</div>' +
        '<div>status</div><div>' + escape(fmt(packet.status)) + '</div>' +
        '<div>body chars</div><div>' + escape(fmt(packet.body_chars)) + '</div>' +
        '</div><h3>Tags</h3>' + tags + '<h3 style="margin-top: 14px;">Notes</h3>' + notes;
    }

    function renderWorkspaces() {
      if (!state.workspaces.length) {
        el("workspace-list").innerHTML = '<li><span>No workspaces yet</span><strong>0</strong></li>';
        return;
      }
      el("workspace-list").innerHTML = state.workspaces.map((item) =>
        '<li><span>' + escape(item.workspace) + '</span><strong>' + escape(item.packets) + '</strong></li>'
      ).join("");
    }

    function wireCopyButtons() {
      for (const button of document.querySelectorAll("[data-copy]")) {
        button.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(button.dataset.copy);
            showToast("Copied");
          } catch {
            showToast("Copy failed");
          }
        });
      }
    }

    function showToast(message) {
      const toast = el("toast");
      toast.textContent = message;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 1200);
    }

    el("search").addEventListener("input", render);
    el("refresh").addEventListener("click", () => window.location.reload());
    el("toggle-json").addEventListener("click", () => el("json-panel").classList.toggle("hidden"));
    render();
  </script>
</body>
</html>
`;
}

function escapeScriptJson(value) {
  return value
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function exportCommand(args) {
  const scope = resolveHistoryScope(args);
  if (!scope.ok) {
    console.error(scope.error);
    return 2;
  }
  const { workspace } = scope;
  const limit = parseLimit(argValue(args, "--limit"));
  const format = argValue(args, "--format") || "markdown";
  const outPath = argValue(args, "--out");
  if (!limit) {
    console.error("--limit must be a positive integer.");
    return 2;
  }
  if (!["markdown", "json"].includes(format)) {
    console.error("--format must be markdown or json.");
    return 2;
  }

  const packets = loadStore().packets
    .filter((packet) => !workspace || packet.workspace === workspace)
    .slice(0, limit);
  const content = format === "json"
    ? `${JSON.stringify(packets, null, 2)}\n`
    : renderMarkdownExport(packets, { workspace });

  if (outPath) {
    const resolved = path.resolve(outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content);
    console.log(`[acb] exported ${packets.length} handoff packet(s) to ${resolved}`);
    return 0;
  }

  process.stdout.write(content);
  return 0;
}

function resolveHistoryScope(args) {
  if (args.includes("--workspace") && args.includes("--all")) {
    return { ok: false, error: "Use either --workspace or --all, not both." };
  }
  return {
    ok: true,
    workspace: args.includes("--all") ? null : normalizeWorkspace(argValue(args, "--workspace") || process.cwd()),
  };
}

function importCommand(args) {
  const filePath = argValue(args, "--file");
  const replace = args.includes("--replace");
  if (!filePath) {
    console.error("Usage: acb import --file <path> [--replace]");
    return 2;
  }

  const parsed = readImportFile(filePath);
  if (!parsed.ok) {
    console.error(parsed.error);
    return 2;
  }

  const packets = parsed.packets.map(normalizeImportedPacket);
  const invalid = packets.find((packet) => !isValidPacket(packet));
  if (invalid) {
    console.error(`Import file contains an invalid packet: ${invalid.id || "(missing id)"}`);
    return 2;
  }

  const store = loadStore();
  const existingIds = new Set(store.packets.map((packet) => packet.id));
  let imported = 0;
  let skipped = 0;
  for (const packet of packets) {
    if (existingIds.has(packet.id)) {
      if (!replace) {
        skipped += 1;
        continue;
      }
      store.packets = store.packets.filter((item) => item.id !== packet.id);
    }
    store.packets.unshift(packet);
    existingIds.add(packet.id);
    imported += 1;
  }
  store.packets.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  writeStore(store);
  console.log(`[acb] imported ${imported} handoff packet(s), skipped ${skipped} duplicate(s).`);
  return 0;
}

function deleteCommand(args) {
  const id = args[0] || argValue(args, "--id");
  if (!id) {
    console.error("Usage: acb delete <packet-id>");
    return 2;
  }
  const store = loadStore();
  const before = store.packets.length;
  store.packets = store.packets.filter((packet) => packet.id !== id);
  if (store.packets.length === before) {
    console.error(`No handoff packet found for id: ${id}`);
    return 1;
  }
  writeStore(store);
  console.log(`[acb] deleted handoff packet: ${id}`);
  return 0;
}

function readImportFile(filePath) {
  const resolved = path.resolve(filePath);
  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
    const packets = Array.isArray(parsed) ? parsed : parsed.packets;
    if (!Array.isArray(packets)) {
      return { ok: false, error: "Import file must be a JSON array or an object with a packets array." };
    }
    return { ok: true, packets };
  } catch (error) {
    return { ok: false, error: `Cannot read import file ${resolved}: ${error.message}` };
  }
}

function normalizeImportedPacket(packet) {
  return {
    id: packet?.id,
    version: packet?.version || STORE_VERSION,
    created_at: packet?.created_at,
    updated_at: packet?.updated_at || null,
    from: packet?.from || "imported",
    workspace: packet?.workspace,
    summary: packet?.summary || null,
    status: packet?.status || null,
    notes: Array.isArray(packet?.notes) ? packet.notes : [],
    tags: Array.isArray(packet?.tags) ? packet.tags : [],
    body: packet?.body || null,
    git: packet?.git || null,
  };
}

function isValidPacket(packet) {
  return Boolean(
    packet
    && typeof packet.id === "string"
    && packet.id
    && typeof packet.created_at === "string"
    && packet.created_at
    && typeof packet.workspace === "string"
    && packet.workspace
    && Array.isArray(packet.notes)
    && Array.isArray(packet.tags),
  );
}

function renderMarkdownExport(packets, { workspace = null } = {}) {
  const lines = [
    "# ACB Handoff Export",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Packet count: ${packets.length}`,
  ];
  if (workspace) lines.push(`Workspace: ${workspace}`);
  if (packets.length === 0) {
    lines.push("", "_No handoff packets matched this export._", "");
    return lines.join("\n");
  }

  for (const packet of packets) {
    lines.push(
      "",
      `## ${packet.summary || packet.status || packet.id}`,
      "",
      `- id: ${packet.id}`,
      `- from: ${packet.from}`,
      `- created_at: ${packet.created_at}`,
      `- workspace: ${packet.workspace}`,
    );
    if (packet.updated_at) lines.push(`- updated_at: ${packet.updated_at}`);
    if (packet.status) lines.push(`- status: ${packet.status}`);
    if (packet.tags?.length) lines.push(`- tags: ${packet.tags.join(", ")}`);
    if (packet.git) {
      lines.push("", "### Git", "", renderGitSnapshot(packet.git));
    }
    if (packet.notes?.length) {
      lines.push("", "### Notes");
      for (const note of packet.notes) lines.push(`- ${note}`);
    }
    if (packet.body) {
      lines.push("", "### Context Body", "", truncatePromptBody(packet.body));
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderPromptPreview(packet) {
  return [
    "# ACB Handoff Prompt Preview",
    "",
    `Packet: ${packet.id}`,
    `Workspace: ${packet.workspace}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "---",
    "",
    renderHandoffPrompt(packet).trimEnd(),
    "",
  ].join("\n");
}

function defaultViewPath(workspace = null) {
  const scope = workspace ? slugPath(workspace) : "all-workspaces";
  return path.join(os.tmpdir(), "acb", "views", `${scope}.html`);
}

function slugPath(value) {
  return String(value || "workspace")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "workspace";
}

function renderHtmlView(packets, { workspace = null, limit = DEFAULT_LIMIT } = {}) {
  const generatedAt = new Date().toISOString();
  const title = workspace ? `ACB Handoffs - ${workspace}` : "ACB Handoffs - All Workspaces";
  const workspaceCount = new Set(packets.map((packet) => packet.workspace)).size;
  const dirtyCount = packets.reduce((sum, packet) => sum + (packet.git?.status?.length || 0), 0);
  const bodyChars = packets.reduce((sum, packet) => sum + (packet.body?.length || 0), 0);
  const packetCards = packets.length
    ? packets.map(renderHtmlPacketCard).join("\n")
    : `<section class="empty">No handoff packets matched this view.</section>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f8fa;
      --panel: #ffffff;
      --text: #1f2328;
      --muted: #59636e;
      --line: #d0d7de;
      --accent: #0969da;
      --good: #1a7f37;
      --warn: #9a6700;
      --code: #f6f8fa;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0d1117;
        --panel: #161b22;
        --text: #e6edf3;
        --muted: #8b949e;
        --line: #30363d;
        --accent: #58a6ff;
        --good: #3fb950;
        --warn: #d29922;
        --code: #0d1117;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 48px; }
    header { margin-bottom: 24px; }
    h1 { margin: 0 0 8px; font-size: 32px; line-height: 1.15; letter-spacing: 0; }
    h2 { margin: 0 0 8px; font-size: 20px; letter-spacing: 0; }
    p { margin: 0; color: var(--muted); }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      margin: 22px 0;
    }
    .stat, .packet, .empty {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
    }
    .stat strong { display: block; font-size: 24px; line-height: 1.2; }
    .stat span { color: var(--muted); font-size: 13px; }
    .packet { margin: 12px 0; }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 10px 0 12px;
      color: var(--muted);
      font-size: 13px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 9px;
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .pill.good { color: var(--good); border-color: var(--good); }
    .pill.warn { color: var(--warn); border-color: var(--warn); }
    pre {
      overflow: auto;
      margin: 10px 0 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--code);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
      line-height: 1.45;
    }
    ul { margin: 8px 0 0; padding-left: 20px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .commands { margin-top: 12px; }
    .body-preview { max-height: 220px; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>ACB Handoff Viewer</h1>
      <p>${escapeHtml(workspace || "All workspaces")} - generated ${escapeHtml(generatedAt)}</p>
    </header>
    <section class="stats" aria-label="summary">
      <div class="stat"><strong>${packets.length}</strong><span>packets shown</span></div>
      <div class="stat"><strong>${workspaceCount}</strong><span>workspaces</span></div>
      <div class="stat"><strong>${dirtyCount}</strong><span>dirty files captured</span></div>
      <div class="stat"><strong>${bodyChars}</strong><span>context body chars</span></div>
      <div class="stat"><strong>${limit}</strong><span>limit</span></div>
    </section>
    ${packetCards}
  </main>
</body>
</html>
`;
}

function renderHtmlPacketCard(packet) {
  const title = packet.summary || packet.status || packet.id;
  const tags = (packet.tags || []).map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("");
  const gitDirty = packet.git?.status?.length || 0;
  const notes = packet.notes?.length
    ? `<ul>${packet.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
    : "";
  const git = packet.git ? `<div class="commands">
      <span class="pill ${gitDirty ? "warn" : "good"}">${gitDirty} dirty files</span>
      <span class="pill">branch ${escapeHtml(packet.git.branch || "unknown")}</span>
      <span class="pill">head ${escapeHtml(packet.git.head || "unknown")}</span>
      ${packet.git.status?.length ? `<pre>${escapeHtml(packet.git.status.join("\n"))}</pre>` : ""}
    </div>` : "";
  const body = packet.body ? `<pre class="body-preview">${escapeHtml(truncatePromptBody(packet.body))}</pre>` : "";
  return `<article class="packet">
    <h2>${escapeHtml(title)}</h2>
    <div class="meta">
      <span>${escapeHtml(packet.id)}</span>
      <span>${escapeHtml(packet.created_at)}</span>
      <span>from ${escapeHtml(packet.from)}</span>
      <span>${escapeHtml(packet.workspace)}</span>
    </div>
    <div>
      ${packet.status ? `<span class="pill good">${escapeHtml(packet.status)}</span>` : ""}
      ${tags}
    </div>
    ${notes}
    ${git}
    ${body}
    <div class="commands">
      <span class="pill"><code>${escapeHtml(`acb resume --id ${packet.id}`)}</code></span>
      <span class="pill"><code>${escapeHtml(`acb brief --id ${packet.id}`)}</code></span>
      <span class="pill"><code>${escapeHtml(`acb show ${packet.id} --prompt`)}</code></span>
    </div>
  </article>`;
}

function defaultPreviewPath(packet) {
  return path.join(os.tmpdir(), "acb", "previews", `${packet.id}.md`);
}

function printTimelinePacket(packet) {
  const summary = packet.summary || packet.status || "(no summary)";
  const facts = [];
  if (packet.body) facts.push(`body:${packet.body.length}`);
  if (packet.notes?.length) facts.push(`notes:${packet.notes.length}`);
  if (packet.git?.status?.length) facts.push(`dirty:${packet.git.status.length}`);
  if (packet.tags?.length) facts.push(`tags:${packet.tags.join(",")}`);
  console.log(`* ${packet.created_at}  ${packet.from}  ${packet.id}`);
  console.log(`  ${summary}`);
  console.log(`  workspace: ${packet.workspace}`);
  if (facts.length) console.log(`  ${facts.join("  ")}`);
}

function searchPackets({ query, workspace = null, limit = DEFAULT_LIMIT }) {
  const needle = query.toLowerCase();
  return loadStore().packets
    .filter((packet) => !workspace || packet.workspace === workspace)
    .filter((packet) => searchablePacketText(packet).includes(needle))
    .slice(0, limit)
    .map(packetSummary);
}

function searchablePacketText(packet) {
  return [
    packet.id,
    packet.from,
    packet.workspace,
    packet.summary,
    packet.status,
    ...(packet.notes || []),
    ...(packet.tags || []),
    packet.body,
    packet.git?.branch,
    packet.git?.head,
    ...(packet.git?.status || []),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function listWorkspaceSummaries(limit = DEFAULT_LIMIT) {
  const byWorkspace = new Map();
  for (const packet of loadStore().packets) {
    const current = byWorkspace.get(packet.workspace);
    if (!current) {
      byWorkspace.set(packet.workspace, {
        workspace: packet.workspace,
        packets: 1,
        latest_packet_id: packet.id,
        latest_created_at: packet.created_at,
        latest_from: packet.from,
        latest_summary: packet.summary,
        latest_status: packet.status,
        latest_tags: packet.tags || [],
        latest_body_chars: packet.body?.length || 0,
        latest_git_dirty_files: packet.git?.status?.length || 0,
        next_resume: `acb resume --id ${packet.id}`,
        next_brief: `acb brief --id ${packet.id}`,
      });
    } else {
      current.packets += 1;
    }
  }
  return [...byWorkspace.values()].slice(0, limit);
}

function buildStatusReport(workspace) {
  const store = loadStore();
  const packets = store.packets.filter((packet) => packet.workspace === workspace);
  const latest = packets[0] || null;
  const gitAvailable = commandExists("git");
  const gitRootResult = gitAvailable ? runGit(workspace, ["rev-parse", "--show-toplevel"]) : { status: 1 };
  const gitRoot = gitRootResult.status === 0 ? gitRootResult.stdout.trim() : null;
  const git = gitRoot ? {
    root: gitRoot,
    branch: runGit(gitRoot, ["branch", "--show-current"]).stdout.trim() || null,
    head: runGit(gitRoot, ["rev-parse", "--short", "HEAD"]).stdout.trim() || null,
    dirty_files: runGit(gitRoot, ["status", "--short"]).stdout.split("\n").filter(Boolean).length,
  } : null;

  return {
    workspace,
    store_path: storePath(),
    workspace_packets: packets.length,
    latest_packet: latest ? packetSummary(latest) : null,
    git,
    next: latest ? {
      resume: `acb resume --id ${latest.id}`,
      brief: `acb brief --id ${latest.id}`,
      copy_prompt: `acb prompt --id ${latest.id}`,
      show_prompt: `acb show ${latest.id} --prompt`,
      mcp_status: "get_workspace_status",
      mcp_read_latest: "read_latest_handoff",
      mcp_read_brief: "read_handoff_brief",
    } : {
      handoff: "acb handoff --summary \"...\" --git",
      save: "acb save --summary \"...\" --git",
      mcp_status: "get_workspace_status",
      mcp_save: "save_handoff",
    },
  };
}

function printStatusReport(report) {
  process.stdout.write(`${formatStatusReport(report)}\n`);
}

function formatStatusReport(report) {
  const lines = [
    "ACB Status",
    `workspace: ${report.workspace}`,
    `store: ${report.store_path}`,
    `workspace_packets: ${report.workspace_packets}`,
  ];
  if (report.git) {
    lines.push(`git_branch: ${report.git.branch || "unknown"}`);
    lines.push(`git_head: ${report.git.head || "unknown"}`);
    lines.push(`git_dirty_files: ${report.git.dirty_files}`);
  } else {
    lines.push("git: unavailable");
  }
  if (!report.latest_packet) {
    lines.push("latest_packet: none");
    lines.push(`next: ${report.next.handoff}`);
    lines.push(`next_mcp_save: ${report.next.mcp_save}`);
    return lines.join("\n");
  }
  lines.push(`latest_packet: ${report.latest_packet.id}`);
  lines.push(`latest_from: ${report.latest_packet.from}`);
  lines.push(`latest_created_at: ${report.latest_packet.created_at}`);
  if (report.latest_packet.summary) lines.push(`latest_summary: ${report.latest_packet.summary}`);
  if (report.latest_packet.status) lines.push(`latest_status: ${report.latest_packet.status}`);
  lines.push(`next_resume: ${report.next.resume}`);
  lines.push(`next_brief: ${report.next.brief}`);
  lines.push(`next_show_prompt: ${report.next.show_prompt}`);
  lines.push(`next_mcp_read_latest: ${report.next.mcp_read_latest}`);
  lines.push(`next_mcp_read_brief: ${report.next.mcp_read_brief}`);
  return lines.join("\n");
}

function clearCommand(args) {
  const clearAll = args.includes("--all");
  const workspace = clearAll ? null : normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const store = loadStore();
  const before = store.packets.length;

  if (clearAll) store.packets = [];
  else store.packets = store.packets.filter((packet) => packet.workspace !== workspace);

  const removed = before - store.packets.length;
  writeStore(store);
  if (clearAll) console.log(`[acb] cleared ${removed} handoff packet(s).`);
  else console.log(`[acb] cleared ${removed} handoff packet(s) for workspace: ${workspace}`);
  return 0;
}

function doctorCommand(args) {
  const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const report = buildDoctorReport(workspace);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  printDoctorReport(report);
  return report.ok ? 0 : 1;
}

function recipeCommand(args) {
  const wantsJson = args.includes("--json");
  const target = args.find((arg) => !arg.startsWith("--"));
  if (!target) {
    const recipes = RECIPE_TARGETS.map(recipeSummary);
    if (wantsJson) {
      process.stdout.write(`${JSON.stringify({ recipes }, null, 2)}\n`);
      return 0;
    }
    printRecipeList(recipes);
    return 0;
  }

  const recipe = findRecipe(target);
  if (!recipe) {
    console.error(`Unknown recipe target: ${target}`);
    console.error(`Available targets: ${RECIPE_TARGETS.map((item) => item.id).join(", ")}`);
    return 2;
  }

  if (wantsJson) {
    process.stdout.write(`${JSON.stringify(recipe, null, 2)}\n`);
    return 0;
  }
  printRecipe(recipe);
  return 0;
}

function findRecipe(target) {
  const normalized = target.toLowerCase();
  return RECIPE_TARGETS.find((recipe) => {
    if (recipe.id === normalized) return true;
    return recipe.aliases.includes(normalized);
  }) || null;
}

function recipeSummary(recipe) {
  return {
    id: recipe.id,
    title: recipe.title,
    aliases: recipe.aliases,
    mode: recipe.mode,
  };
}

function printRecipeList(recipes) {
  console.log("ACB Recipes");
  console.log("");
  console.log("Use a recipe to get an explicit, client-specific handoff path.");
  console.log("");
  for (const recipe of recipes) {
    console.log(`- ${recipe.id}: ${recipe.title} (${recipe.mode})`);
  }
  console.log("");
  console.log("Examples:");
  console.log("  acb recipe opencode");
  console.log("  acb recipe cline --json");
}

function printRecipe(recipe) {
  console.log(`ACB Recipe: ${recipe.title}`);
  console.log(`target: ${recipe.id}`);
  if (recipe.aliases.length) console.log(`aliases: ${recipe.aliases.join(", ")}`);
  console.log(`mode: ${recipe.mode}`);
  console.log("");
  console.log("Setup:");
  for (const command of recipe.setup) console.log(`  ${command}`);
  console.log("");
  console.log("Client prompt:");
  console.log(recipe.prompt);
  console.log("");
  console.log("Boundaries:");
  for (const note of recipe.notes) console.log(`- ${note}`);
}

function configCommand(args) {
  const target = args[0];
  if (target !== "mcp") {
    console.error("Usage: acb config mcp [--command <path-or-command>] [--name <server-name>] [--arg <value>...] [--out <path>]");
    return 2;
  }
  const command = argValue(args, "--command") || "acb";
  const name = argValue(args, "--name") || "acb";
  const commandArgs = argValues(args, "--arg");
  const outPath = argValue(args, "--out");
  const config = mcpServerConfig({ name, command, args: commandArgs.length ? commandArgs : ["serve"] });
  const content = `${JSON.stringify(config, null, 2)}\n`;
  if (outPath) {
    const resolved = path.resolve(outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content);
    console.log(`[acb] wrote MCP config to ${resolved}`);
    console.log(`[acb] next: acb verify mcp --config ${resolved} --name ${name}`);
    return 0;
  }
  process.stdout.write(content);
  return 0;
}

function verifyCommand(args) {
  const target = args[0];
  if (target === "workflow") return verifyWorkflowCommand(args.slice(1));
  if (target !== "mcp") {
    console.error("Usage: acb verify mcp [--config <path>] [--name <server-name>] [--json]\n       acb verify workflow <target> [--workspace <path>] [--json]");
    return 2;
  }

  const parsed = readMcpConfig(argValue(args, "--config"));
  if (!parsed.ok) {
    console.error(parsed.error);
    return 2;
  }

  const selected = selectMcpServer(parsed.config, argValue(args, "--name"));
  if (!selected.ok) {
    console.error(selected.error);
    return 2;
  }

  const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const report = verifyMcpServer(selected.name, selected.server, { workspace });
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printMcpVerifyReport(report);
  }
  return report.ok ? 0 : 1;
}

function verifyWorkflowCommand(args) {
  const target = args.find((arg) => !arg.startsWith("--"));
  if (!target) {
    console.error("Usage: acb verify workflow <target> [--workspace <path>] [--json]");
    return 2;
  }
  const recipe = findRecipe(target);
  if (!recipe) {
    console.error(`Unknown workflow target: ${target}`);
    console.error(`Available targets: ${RECIPE_TARGETS.map((item) => item.id).join(", ")}`);
    return 2;
  }

  const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const report = buildWorkflowVerifyReport(recipe, workspace, { keepArtifacts: args.includes("--keep-artifacts") });
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printWorkflowVerifyReport(report);
  }
  return report.ok ? 0 : 1;
}

function buildWorkflowVerifyReport(recipe, workspace, { keepArtifacts = false } = {}) {
  const oldStore = process.env.ACB_STORE;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-workflow-"));
  const tempStore = path.join(tempDir, "packets.json");
  let report = null;
  process.env.ACB_STORE = tempStore;
  try {
    const packet = createHandoffPacket({
      from: "acb-verify",
      workspace,
      summary: `Workflow smoke for ${recipe.title}`,
      status: "local verification",
      notes: [
        `Target recipe: ${recipe.id}`,
        "This verifies ACB-side handoff, brief, MCP, and dashboard surfaces without launching the third-party client.",
      ],
      tags: ["workflow", recipe.id],
      body: `Recommended client prompt:\n${recipe.prompt}\n`,
      git: null,
    });
    writeStore({ version: STORE_VERSION, packets: [packet] });

    const localBinPath = path.resolve(process.argv[1] || "bin/acb.js");
    const mcpConfig = mcpServerConfig({ name: "acb", command: process.execPath, args: [localBinPath, "serve"] });
    const mcpReport = verifyMcpServer("acb", mcpConfig.mcpServers.acb, {
      workspace,
      expectLatestPacketId: packet.id,
    });
    const resumePrompt = renderHandoffPrompt(packet);
    const brief = renderBriefPrompt(packet);
    const dashboardState = buildDashboardState({ workspace, limit: 5 });
    const dashboardHtml = renderDashboardHtml(dashboardState);
    const checks = {
      recipe_found: Boolean(recipe),
      save_handoff: findPacket({ id: packet.id })?.id === packet.id,
      resume_prompt: resumePrompt.includes(packet.summary) && resumePrompt.includes("Requested Behavior"),
      brief: brief.includes(packet.summary) && brief.includes("Full Context Commands"),
      mcp_config: Boolean(mcpConfig.mcpServers.acb.command),
      mcp_verify: mcpReport.ok,
      mcp_latest_handoff: mcpReport.checks.latest_handoff === true,
      dashboard_state: dashboardState.latest_packet?.id === packet.id,
      dashboard_html: dashboardHtml.includes("ACB Dashboard") && dashboardHtml.includes(packet.id),
    };
    report = {
      ok: Object.values(checks).every(Boolean),
      target: recipe.id,
      title: recipe.title,
      workspace,
      store_path: tempStore,
      artifacts_retained: keepArtifacts,
      packet: packetSummary(packet),
      checks,
      commands: {
        recipe: `acb recipe ${recipe.id}`,
        handoff: `acb handoff --from codex --summary "Ready for ${recipe.title}" --git`,
        brief: `acb brief --id ${packet.id}`,
        resume: `acb resume --id ${packet.id}`,
        dashboard: `acb dashboard --workspace ${workspace}`,
        mcp_verify: "acb verify mcp --config ./mcp.json --name acb",
      },
      mcp: mcpReport,
      limitation: "This verifies the ACB-side workflow only; it does not launch or mutate the third-party client.",
    };
    return report;
  } finally {
    if (oldStore === undefined) delete process.env.ACB_STORE;
    else process.env.ACB_STORE = oldStore;
    if (!keepArtifacts) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        if (report) report.artifacts_cleaned = true;
      } catch (error) {
        if (report) {
          report.artifacts_cleaned = false;
          report.cleanup_error = error.message;
        }
      }
    }
  }
}

function printWorkflowVerifyReport(report) {
  console.log("ACB Workflow Verify");
  console.log(`target: ${report.target}`);
  console.log(`title: ${report.title}`);
  console.log(`workspace: ${report.workspace}`);
  console.log(`store: ${report.store_path}${report.artifacts_cleaned ? " (cleaned)" : ""}`);
  for (const [name, ok] of Object.entries(report.checks)) {
    console.log(`${name}: ${ok ? "ok" : "failed"}`);
  }
  console.log(`ok: ${report.ok ? "yes" : "no"}`);
  console.log("next:");
  console.log(`  ${report.commands.recipe}`);
  console.log(`  ${report.commands.handoff}`);
  console.log(`  ${report.commands.brief}`);
  console.log(`  ${report.commands.resume}`);
  console.log(`  ${report.commands.dashboard}`);
  console.log(`limitation: ${report.limitation}`);
}

function storeCommand(args) {
  if (args[0] === "path") {
    console.log(storePath());
    return 0;
  }
  if (args[0] === "info") return storeInfoCommand(args.slice(1));
  if (args[0] === "backup") return storeBackupCommand(args.slice(1));
  console.error("Usage: acb store path\n       acb store info [--json]\n       acb store backup [--out <path>] [--force] [--json]");
  return 2;
}

function storeInfoCommand(args) {
  const filePath = storePath();
  const exists = fs.existsSync(filePath);
  const stat = exists ? fs.statSync(filePath) : null;
  const storeResult = readStore();
  const report = {
    path: filePath,
    exists,
    readable: storeResult.ok,
    error: storeResult.ok ? null : storeResult.error,
    version: storeResult.ok ? storeResult.store.version : null,
    packets: storeResult.ok ? storeResult.store.packets.length : null,
    bytes: stat?.size || 0,
    modified_at: stat ? stat.mtime.toISOString() : null,
  };

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  console.log("ACB Store");
  console.log(`path: ${report.path}`);
  console.log(`exists: ${report.exists ? "yes" : "no"}`);
  console.log(`readable: ${report.readable ? "yes" : "no"}`);
  if (report.error) console.log(`error: ${report.error}`);
  if (report.version !== null) console.log(`version: ${report.version}`);
  if (report.packets !== null) console.log(`packets: ${report.packets}`);
  console.log(`bytes: ${report.bytes}`);
  if (report.modified_at) console.log(`modified_at: ${report.modified_at}`);
  return report.readable ? 0 : 1;
}

function storeBackupCommand(args) {
  const source = storePath();
  const outPath = argValue(args, "--out") || defaultStoreBackupPath(source);
  const destination = path.resolve(outPath);
  if (!fs.existsSync(source)) {
    console.error(`No ACB store found at ${source}`);
    return 1;
  }
  if (fs.existsSync(destination) && !args.includes("--force")) {
    console.error(`Backup already exists: ${destination}`);
    console.error("Use --force to overwrite it.");
    return 2;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  const report = {
    source,
    destination,
    bytes: fs.statSync(destination).size,
  };
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  console.log(`[acb] backed up store to ${destination}`);
  console.log(`[acb] bytes: ${report.bytes}`);
  return 0;
}

function defaultStoreBackupPath(source) {
  const parsed = path.parse(source);
  return path.join(parsed.dir, `${parsed.name}.${timestampForFile()}.backup${parsed.ext || ".json"}`);
}

function mcpServerConfig({ name, command, args }) {
  return {
    mcpServers: {
      [name]: {
        command,
        args,
      },
    },
  };
}

function readMcpConfig(configPath) {
  if (!configPath) return { ok: true, config: mcpServerConfig({ name: "acb", command: "acb", args: ["serve"] }) };
  const resolved = path.resolve(configPath);
  try {
    return { ok: true, config: JSON.parse(fs.readFileSync(resolved, "utf8")) };
  } catch (error) {
    return { ok: false, error: `Cannot read MCP config ${resolved}: ${error.message}` };
  }
}

function selectMcpServer(config, requestedName) {
  const servers = config?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return { ok: false, error: "MCP config must contain an mcpServers object." };
  }
  const names = Object.keys(servers);
  if (names.length === 0) return { ok: false, error: "MCP config does not contain any servers." };
  const name = requestedName || names[0];
  const server = servers[name];
  if (!server) return { ok: false, error: `MCP server not found in config: ${name}` };
  if (!server.command || typeof server.command !== "string") {
    return { ok: false, error: `MCP server ${name} must define a string command.` };
  }
  if (server.args !== undefined && !Array.isArray(server.args)) {
    return { ok: false, error: `MCP server ${name} args must be an array when provided.` };
  }
  return { ok: true, name, server: { command: server.command, args: server.args || [] } };
}

function verifyMcpServer(name, server, { workspace = process.cwd(), expectLatestPacketId = null } = {}) {
  const resolvedWorkspace = normalizeWorkspace(workspace);
  const requests = [
    jsonRpcLine("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "acb-verify", version: VERSION },
    }, 1),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    jsonRpcLine("tools/list", {}, 2),
    jsonRpcLine("tools/call", { name: "get_workspace_status", arguments: { workspace: resolvedWorkspace } }, 3),
  ];
  if (expectLatestPacketId) {
    requests.push(jsonRpcLine("tools/call", { name: "read_latest_handoff", arguments: { workspace: resolvedWorkspace } }, 4));
  }
  const input = [
    ...requests,
    "",
  ].join("\n");

  const result = spawnSync(server.command, server.args, {
    encoding: "utf8",
    input,
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });

  const report = {
    ok: false,
    server: name,
    command: server.command,
    args: server.args,
    workspace: resolvedWorkspace,
    checks: {
      launch: false,
      initialize: false,
      tools_list: false,
      required_tools: false,
      workspace_status: false,
    },
    tools: [],
    error: null,
    stderr: result.stderr?.trim() || "",
  };

  if (result.error) {
    report.error = result.error.message;
    return report;
  }
  if (result.status !== 0) {
    report.error = `server exited with status ${result.status}`;
    return report;
  }
  if (expectLatestPacketId) report.checks.latest_handoff = false;

  report.checks.launch = true;
  const messages = parseJsonRpcLines(result.stdout || "");
  const initialize = messages.find((message) => message.id === 1);
  const toolsList = messages.find((message) => message.id === 2);
  const workspaceStatus = messages.find((message) => message.id === 3);
  const latestHandoff = messages.find((message) => message.id === 4);

  if (initialize?.result?.serverInfo?.name) report.checks.initialize = true;
  else if (initialize?.error) report.error = initialize.error.message || "initialize failed";

  if (Array.isArray(toolsList?.result?.tools)) {
    report.checks.tools_list = true;
    report.tools = toolsList.result.tools.map((tool) => tool.name).filter(Boolean);
  } else if (toolsList?.error) {
    report.error = toolsList.error.message || "tools/list failed";
  }

  const requiredTools = ["get_workspace_status", "read_latest_handoff", "read_handoff_brief", "save_handoff", "update_handoff", "read_handoff", "search_handoffs", "list_workspaces", "list_handoffs"];
  report.checks.required_tools = requiredTools.every((toolName) => report.tools.includes(toolName));
  if (workspaceStatus?.result?.isError === false && workspaceStatus.result.content?.[0]?.text?.includes("ACB Status")) {
    report.checks.workspace_status = true;
  } else if (workspaceStatus?.error) {
    report.error = workspaceStatus.error.message || "get_workspace_status failed";
  }
  if (expectLatestPacketId) {
    const packetId = latestHandoff?.result?.structuredContent?.packet?.id;
    if (latestHandoff?.result?.isError === false && packetId === expectLatestPacketId) {
      report.checks.latest_handoff = true;
    } else if (latestHandoff?.error) {
      report.error = latestHandoff.error.message || "read_latest_handoff failed";
    } else if (!report.error) {
      report.error = `read_latest_handoff did not return expected packet: ${expectLatestPacketId}`;
    }
  }
  report.ok = Object.values(report.checks).every(Boolean);
  if (!report.ok && !report.error) report.error = "MCP server did not expose the expected ACB tools.";
  return report;
}

function printMcpVerifyReport(report) {
  console.log("ACB MCP Verify");
  console.log(`server: ${report.server}`);
  console.log(`command: ${formatCommand(report.command, report.args)}`);
  console.log(`launch: ${report.checks.launch ? "ok" : "failed"}`);
  console.log(`initialize: ${report.checks.initialize ? "ok" : "failed"}`);
  console.log(`tools/list: ${report.checks.tools_list ? "ok" : "failed"}`);
  console.log(`required_tools: ${report.checks.required_tools ? "ok" : "failed"}`);
  console.log(`get_workspace_status: ${report.checks.workspace_status ? "ok" : "failed"}`);
  if (Object.prototype.hasOwnProperty.call(report.checks, "latest_handoff")) {
    console.log(`read_latest_handoff: ${report.checks.latest_handoff ? "ok" : "failed"}`);
  }
  console.log(`tools: ${report.tools.length ? report.tools.join(", ") : "none"}`);
  if (report.error) console.log(`error: ${report.error}`);
  if (report.stderr) console.log(`stderr: ${report.stderr}`);
}

function buildDoctorReport(workspace) {
  const storeResult = readStore();
  const store = storeResult.ok ? storeResult.store : { version: STORE_VERSION, packets: [] };
  const workspacePackets = store.packets.filter((packet) => packet.workspace === workspace);
  const clipboardCommands = clipboardCandidates().map(([command]) => ({
    command,
    available: commandExists(command),
  }));
  const acbCommandAvailable = commandExists("acb");
  const localBinPath = path.resolve(process.argv[1] || "bin/acb.js");
  const gitAvailable = commandExists("git");
  const gitRootResult = gitAvailable ? runGit(workspace, ["rev-parse", "--show-toplevel"]) : { status: 1 };
  const gitRoot = gitRootResult.status === 0 ? gitRootResult.stdout.trim() : null;

  return {
    ok: storeResult.ok,
    store_path: storePath(),
    store_error: storeResult.ok ? null : storeResult.error,
    total_packets: store.packets.length,
    workspace,
    workspace_packets: workspacePackets.length,
    latest_workspace_packet_id: workspacePackets[0]?.id || null,
    checks: {
      store_readable: storeResult.ok,
      git_available: gitAvailable,
      git_workspace: Boolean(gitRoot),
      clipboard_command_available: clipboardCommands.some((item) => item.available),
      acb_command_available: acbCommandAvailable,
    },
    git: {
      root: gitRoot,
      branch: gitRoot ? runGit(gitRoot, ["branch", "--show-current"]).stdout.trim() || null : null,
      head: gitRoot ? runGit(gitRoot, ["rev-parse", "--short", "HEAD"]).stdout.trim() || null : null,
    },
    clipboard: {
      platform: process.platform,
      commands: clipboardCommands,
    },
    mcp: {
      default_command_available: acbCommandAvailable,
      config_command: "acb config mcp --out ./mcp.json",
      verify_command: "acb verify mcp --config ./mcp.json --name acb",
      install_command: `npm install -g ${PACKAGE_NAME}`,
      local_config_command: formatCommand("acb", ["config", "mcp", "--command", "node", "--arg", localBinPath, "--arg", "serve", "--out", "./mcp.json"]),
    },
  };
}

function printDoctorReport(report) {
  console.log("ACB Doctor");
  console.log(`store: ${report.store_path}`);
  console.log(`store_readable: ${report.checks.store_readable ? "yes" : "no"}`);
  if (report.store_error) console.log(`store_error: ${report.store_error}`);
  console.log(`total_packets: ${report.total_packets}`);
  console.log(`workspace: ${report.workspace}`);
  console.log(`workspace_packets: ${report.workspace_packets}`);
  if (report.latest_workspace_packet_id) console.log(`latest_workspace_packet_id: ${report.latest_workspace_packet_id}`);
  console.log(`git_available: ${report.checks.git_available ? "yes" : "no"}`);
  console.log(`git_workspace: ${report.checks.git_workspace ? "yes" : "no"}`);
  if (report.git.root) {
    console.log(`git_root: ${report.git.root}`);
    console.log(`git_branch: ${report.git.branch || "unknown"}`);
    console.log(`git_head: ${report.git.head || "unknown"}`);
  }
  const availableClipboard = report.clipboard.commands.filter((item) => item.available).map((item) => item.command);
  console.log(`clipboard_commands: ${availableClipboard.length ? availableClipboard.join(", ") : "none"}`);
  if (!availableClipboard.length && process.platform === "linux") {
    console.log("clipboard_hint: install wl-clipboard, xclip, or xsel");
  }
  console.log(`mcp_default_command_available: ${report.mcp.default_command_available ? "yes" : "no"}`);
  if (!report.mcp.default_command_available) {
    console.log(`mcp_install_hint: ${report.mcp.install_command}`);
    console.log(`mcp_local_config_hint: ${report.mcp.local_config_command}`);
  }
  console.log(`mcp_config_command: ${report.mcp.config_command}`);
  console.log(`mcp_verify_command: ${report.mcp.verify_command}`);
}

function printQuickstartCheck(check, report) {
  const clipboardReady = check.checks.clipboard_command_available;
  const acbReady = check.checks.acb_command_available;
  console.log("ACB Quickstart Check");
  console.log(`version: acb ${check.version}`);
  console.log(`package: ${check.package}`);
  console.log(`command_path: ${check.command_path}`);
  console.log(`store: ${check.store_path}`);
  console.log(`store_readable: ${check.checks.store_readable ? "yes" : "no"}`);
  if (report.store_error) console.log(`store_error: ${report.store_error}`);
  console.log(`workspace: ${check.workspace}`);
  console.log(`git_available: ${check.checks.git_available ? "yes" : "no"}`);
  console.log(`git_workspace: ${check.checks.git_workspace ? "yes" : "no"}`);
  console.log(`clipboard_ready: ${clipboardReady ? "yes" : "no"}`);
  if (!clipboardReady) {
    console.log("clipboard_fallback: prompts will be printed to the terminal instead");
    if (process.platform === "linux") console.log("clipboard_hint: install wl-clipboard, xclip, or xsel");
  }
  console.log(`acb_on_path: ${acbReady ? "yes" : "no"}`);
  if (!acbReady) console.log(`install_hint: ${check.install_command}`);
  console.log(`next_handoff: ${check.next.handoff}`);
  console.log(`next_resume: ${check.next.resume}`);
  console.log(`next_brief: ${check.next.brief}`);
  console.log(`next_doctor: ${check.next.doctor}`);
  console.log(`next_mcp_config: ${check.next.mcp_config}`);
  console.log(`next_mcp_verify: ${check.next.mcp_verify}`);
}

function serveCommand(args) {
  if (args.length > 0) {
    console.error("Usage: acb serve");
    return 2;
  }
  const server = new McpStdioServer();
  server.start();
  return new Promise(() => {});
}

class McpStdioServer {
  constructor({ input = process.stdin, output = process.stdout } = {}) {
    this.input = input;
    this.output = output;
    this.buffer = "";
  }

  start() {
    this.input.setEncoding("utf8");
    this.input.on("data", (chunk) => this.receive(chunk));
    this.input.on("end", () => {
      if (this.buffer.trim()) this.handleLine(this.buffer);
    });
  }

  receive(chunk) {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) this.handleLine(line);
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.sendError(null, -32700, `Parse error: ${error.message}`);
      return;
    }

    if (Array.isArray(message)) {
      for (const item of message) this.handleMessage(item);
      return;
    }
    this.handleMessage(message);
  }

  handleMessage(message) {
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      this.sendError(message?.id ?? null, -32600, "Invalid Request");
      return;
    }

    if (message.id === undefined) {
      this.handleNotification(message);
      return;
    }

    try {
      const result = this.dispatchRequest(message.method, message.params || {});
      this.send({ jsonrpc: "2.0", id: message.id, result });
    } catch (error) {
      this.sendError(message.id, error.code || -32603, error.message || "Internal error");
    }
  }

  handleNotification(message) {
    if (message.method === "notifications/initialized") return;
    if (message.method === "notifications/cancelled") return;
    console.error(`[acb mcp] ignored notification: ${message.method}`);
  }

  dispatchRequest(method, params) {
    if (method === "initialize") return mcpInitialize(params);
    if (method === "ping") return {};
    if (method === "tools/list") return { tools: mcpTools() };
    if (method === "tools/call") return mcpCallTool(params);
    throw jsonRpcError(-32601, `Method not found: ${method}`);
  }

  send(message) {
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  sendError(id, code, message) {
    this.send({ jsonrpc: "2.0", id, error: { code, message } });
  }
}

function mcpInitialize(params) {
  const requested = params?.protocolVersion;
  return {
    protocolVersion: requested || MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
    serverInfo: {
      name: "acb",
      title: "AgentContextBus",
      version: VERSION,
    },
    instructions: "Use read_handoff_brief for a compact takeover summary or read_latest_handoff for the full explicit local handoff packet.",
  };
}

function mcpTools() {
  return [
    {
      name: "get_workspace_status",
      title: "Get Workspace Status",
      description: "Inspect local ACB handoff state for a workspace before deciding whether to read or save a handoff.",
      inputSchema: {
        type: "object",
        properties: {
          workspace: {
            type: "string",
            description: "Optional workspace path. Defaults to the MCP server process current working directory.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "read_latest_handoff",
      title: "Read Latest Handoff",
      description: "Read the newest local ACB handoff packet, optionally scoped to a workspace.",
      inputSchema: {
        type: "object",
        properties: {
          workspace: {
            type: "string",
            description: "Optional workspace path. Defaults to the MCP server process current working directory.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "read_handoff_brief",
      title: "Read Handoff Brief",
      description: "Read a compact ACB handoff brief by packet id, or the newest packet for a workspace.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Optional handoff packet id. When omitted, ACB reads the latest packet for workspace.",
          },
          workspace: {
            type: "string",
            description: "Optional workspace path. Ignored when id is provided.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "save_handoff",
      title: "Save Handoff",
      description: "Save an explicit local ACB handoff packet for another agent to read later.",
      inputSchema: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description: "Source agent or tool name. Defaults to mcp-client.",
          },
          workspace: {
            type: "string",
            description: "Workspace path. Defaults to the MCP server process current working directory.",
          },
          summary: {
            type: "string",
            description: "Short handoff summary.",
          },
          status: {
            type: "string",
            description: "Current state or progress status.",
          },
          notes: {
            type: "array",
            items: { type: "string" },
            description: "Important next steps, risks, or blockers.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional packet tags.",
          },
          body: {
            type: "string",
            description: "Optional longer handoff context body.",
          },
          include_git: {
            type: "boolean",
            description: "Attach a lightweight Git snapshot when the workspace is a Git repository.",
          },
          include_diff: {
            type: "boolean",
            description: "Attach tracked staged and unstaged Git diff text when the workspace is a Git repository.",
          },
          diff_limit: {
            type: "integer",
            minimum: 1,
            description: "Maximum diff body characters when include_diff is true. Defaults to 20000.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "read_handoff",
      title: "Read Handoff",
      description: "Read a specific local ACB handoff packet by id.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Handoff packet id.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    {
      name: "update_handoff",
      title: "Update Handoff",
      description: "Update an existing local ACB handoff packet without changing its original created_at timestamp.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Handoff packet id.",
          },
          summary: {
            type: "string",
            description: "Replacement short handoff summary.",
          },
          status: {
            type: "string",
            description: "Replacement current state or progress status.",
          },
          notes: {
            type: "array",
            items: { type: "string" },
            description: "Notes to append, or replacement notes when clear_notes is true.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags to append, or replacement tags when clear_tags is true.",
          },
          body: {
            type: "string",
            description: "Replacement longer handoff context body.",
          },
          clear_notes: {
            type: "boolean",
            description: "Clear existing notes before applying notes.",
          },
          clear_tags: {
            type: "boolean",
            description: "Clear existing tags before applying tags.",
          },
          include_git: {
            type: "boolean",
            description: "Refresh the lightweight Git snapshot when the packet workspace is a Git repository.",
          },
          include_diff: {
            type: "boolean",
            description: "Replace body with tracked staged and unstaged Git diff text and refresh Git snapshot.",
          },
          diff_limit: {
            type: "integer",
            minimum: 1,
            description: "Maximum diff body characters when include_diff is true. Defaults to 20000.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    {
      name: "search_handoffs",
      title: "Search Handoffs",
      description: "Search local ACB handoff packet summaries, notes, tags, body text, workspace paths, and lightweight Git metadata.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query.",
          },
          workspace: {
            type: "string",
            description: "Optional workspace path.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Maximum number of packets to return. Defaults to 10.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "list_workspaces",
      title: "List Workspaces",
      description: "List local workspaces with ACB handoff history and latest packet summaries.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Maximum number of workspaces to return. Defaults to 10.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "list_handoffs",
      title: "List Handoffs",
      description: "List recent local ACB handoff packets without expanding full context bodies.",
      inputSchema: {
        type: "object",
        properties: {
          workspace: {
            type: "string",
            description: "Optional workspace path.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Maximum number of packets to return. Defaults to 10.",
          },
        },
        additionalProperties: false,
      },
    },
  ];
}

function mcpCallTool(params) {
  const name = params?.name;
  const args = params?.arguments || {};
  if (name === "get_workspace_status") return mcpGetWorkspaceStatus(args);
  if (name === "read_latest_handoff") return mcpReadLatestHandoff(args);
  if (name === "read_handoff_brief") return mcpReadHandoffBrief(args);
  if (name === "save_handoff") return mcpSaveHandoff(args);
  if (name === "update_handoff") return mcpUpdateHandoff(args);
  if (name === "read_handoff") return mcpReadHandoff(args);
  if (name === "search_handoffs") return mcpSearchHandoffs(args);
  if (name === "list_workspaces") return mcpListWorkspaces(args);
  if (name === "list_handoffs") return mcpListHandoffs(args);
  throw jsonRpcError(-32602, `Unknown tool: ${name}`);
}

function mcpGetWorkspaceStatus(args) {
  const workspace = args.workspace ? normalizeWorkspace(args.workspace) : normalizeWorkspace(process.cwd());
  const report = buildStatusReport(workspace);
  return {
    content: [{ type: "text", text: formatStatusReport(report) }],
    structuredContent: { report },
    isError: false,
  };
}

function mcpReadLatestHandoff(args) {
  const workspace = args.workspace ? normalizeWorkspace(args.workspace) : normalizeWorkspace(process.cwd());
  const packet = findPacket({ workspace });
  if (!packet) {
    return {
      content: [{ type: "text", text: `No handoff packet found for workspace: ${workspace}` }],
      isError: true,
    };
  }

  const prompt = renderHandoffPrompt(packet);
  return {
    content: [{ type: "text", text: prompt }],
    structuredContent: { packet: packetWithNextSteps(packet), prompt },
    isError: false,
  };
}

function mcpReadHandoffBrief(args) {
  const id = typeof args.id === "string" && args.id.trim() ? args.id : null;
  const workspace = args.workspace ? normalizeWorkspace(args.workspace) : normalizeWorkspace(process.cwd());
  const packet = findPacket({ workspace: id ? null : workspace, id });
  if (!packet) {
    return {
      content: [{ type: "text", text: id ? `No handoff packet found for id: ${id}` : `No handoff packet found for workspace: ${workspace}` }],
      isError: true,
    };
  }

  const brief = renderBriefPrompt(packet);
  return {
    content: [{ type: "text", text: brief }],
    structuredContent: { packet: packetWithNextSteps(packet), brief },
    isError: false,
  };
}

function mcpSaveHandoff(args) {
  const workspace = args.workspace ? normalizeWorkspace(args.workspace) : normalizeWorkspace(process.cwd());
  const notes = normalizeStringArray(args.notes);
  const tags = normalizeStringArray(args.tags);
  const summary = typeof args.summary === "string" && args.summary.trim() ? args.summary : null;
  const status = typeof args.status === "string" && args.status.trim() ? args.status : null;
  let body = typeof args.body === "string" && args.body.trim() ? args.body : null;

  if (args.include_diff) {
    const diffResult = readGitDiffBody(workspace, args.diff_limit);
    if (!diffResult.ok) {
      return {
        content: [{ type: "text", text: diffResult.error }],
        isError: true,
      };
    }
    body = body ? `${body.trimEnd()}\n\n${diffResult.body}` : diffResult.body;
  }

  if (!summary && !status && notes.length === 0 && !body && !args.include_git && !args.include_diff) {
    return {
      content: [{ type: "text", text: "save_handoff requires summary, status, notes, body, include_git, or include_diff." }],
      isError: true,
    };
  }

  const gitResult = args.include_git || args.include_diff ? readGitSnapshot(workspace) : { ok: true, snapshot: null };
  if (!gitResult.ok) {
    return {
      content: [{ type: "text", text: gitResult.error }],
      isError: true,
    };
  }

  const packet = createHandoffPacket({
    from: typeof args.from === "string" && args.from.trim() ? args.from : "mcp-client",
    workspace,
    summary,
    status,
    notes,
    tags,
    body,
    git: gitResult.snapshot,
  });
  const store = loadStore();
  store.packets.unshift(packet);
  writeStore(store);

  return {
    content: [{ type: "text", text: `Saved ACB handoff packet: ${packet.id}` }],
    structuredContent: { packet },
    isError: false,
  };
}

function mcpReadHandoff(args) {
  const id = args.id;
  if (!id) {
    return {
      content: [{ type: "text", text: "id is required." }],
      isError: true,
    };
  }
  const packet = findPacket({ id });
  if (!packet) {
    return {
      content: [{ type: "text", text: `No handoff packet found for id: ${id}` }],
      isError: true,
    };
  }
  const prompt = renderHandoffPrompt(packet);
  return {
    content: [{ type: "text", text: prompt }],
    structuredContent: { packet: packetWithNextSteps(packet), prompt },
    isError: false,
  };
}

function mcpUpdateHandoff(args) {
  const id = typeof args.id === "string" ? args.id : "";
  if (!id) {
    return {
      content: [{ type: "text", text: "id is required." }],
      isError: true,
    };
  }
  const existing = findPacket({ id });
  if (!existing) {
    return {
      content: [{ type: "text", text: `No handoff packet found for id: ${id}` }],
      isError: true,
    };
  }
  if (!hasMcpUpdateArgs(args)) {
    return {
      content: [{ type: "text", text: "update_handoff requires at least one update field." }],
      isError: true,
    };
  }

  const packet = { ...existing };
  if (typeof args.summary === "string") packet.summary = args.summary.trim() ? args.summary : null;
  if (typeof args.status === "string") packet.status = args.status.trim() ? args.status : null;

  const notes = normalizeStringArray(args.notes);
  if (args.clear_notes) packet.notes = [];
  if (notes.length) packet.notes = [...(packet.notes || []), ...notes];

  const tags = normalizeStringArray(args.tags);
  if (args.clear_tags) packet.tags = [];
  if (tags.length) packet.tags = uniqueStrings([...(packet.tags || []), ...tags]);

  if (typeof args.body === "string") packet.body = args.body.trim() ? args.body : null;

  if (args.include_diff) {
    const diffResult = readGitDiffBody(packet.workspace, args.diff_limit);
    if (!diffResult.ok) {
      return {
        content: [{ type: "text", text: diffResult.error }],
        isError: true,
      };
    }
    packet.body = diffResult.body;
  }

  if (args.include_git || args.include_diff) {
    const gitResult = readGitSnapshot(packet.workspace);
    if (!gitResult.ok) {
      return {
        content: [{ type: "text", text: gitResult.error }],
        isError: true,
      };
    }
    packet.git = gitResult.snapshot;
  }

  packet.updated_at = new Date().toISOString();
  replacePacket(packet);

  return {
    content: [{ type: "text", text: `Updated ACB handoff packet: ${packet.id}` }],
    structuredContent: { packet },
    isError: false,
  };
}

function hasMcpUpdateArgs(args) {
  return typeof args.summary === "string"
    || typeof args.status === "string"
    || normalizeStringArray(args.notes).length > 0
    || normalizeStringArray(args.tags).length > 0
    || typeof args.body === "string"
    || Boolean(args.clear_notes)
    || Boolean(args.clear_tags)
    || Boolean(args.include_git)
    || Boolean(args.include_diff);
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.trim());
  return [];
}

function mcpListHandoffs(args) {
  const workspace = args.workspace ? normalizeWorkspace(args.workspace) : null;
  const limit = parseLimit(args.limit);
  if (!limit || limit > 50) {
    return {
      content: [{ type: "text", text: "limit must be an integer between 1 and 50." }],
      isError: true,
    };
  }
  const packets = loadStore().packets
    .filter((packet) => !workspace || packet.workspace === workspace)
    .slice(0, limit)
    .map(packetSummary);

  return {
    content: [{ type: "text", text: JSON.stringify(packets, null, 2) }],
    structuredContent: { packets },
    isError: false,
  };
}

function mcpSearchHandoffs(args) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    return {
      content: [{ type: "text", text: "query is required." }],
      isError: true,
    };
  }
  const workspace = args.workspace ? normalizeWorkspace(args.workspace) : null;
  const limit = parseLimit(args.limit);
  if (!limit || limit > 50) {
    return {
      content: [{ type: "text", text: "limit must be an integer between 1 and 50." }],
      isError: true,
    };
  }
  const packets = searchPackets({ query, workspace, limit });
  return {
    content: [{ type: "text", text: JSON.stringify(packets, null, 2) }],
    structuredContent: { packets },
    isError: false,
  };
}

function mcpListWorkspaces(args) {
  const limit = parseLimit(args.limit);
  if (!limit || limit > 50) {
    return {
      content: [{ type: "text", text: "limit must be an integer between 1 and 50." }],
      isError: true,
    };
  }
  const workspaces = listWorkspaceSummaries(limit);
  return {
    content: [{ type: "text", text: JSON.stringify(workspaces, null, 2) }],
    structuredContent: { workspaces },
    isError: false,
  };
}

function packetSummary(packet) {
  return {
    id: packet.id,
    created_at: packet.created_at,
    updated_at: packet.updated_at || null,
    from: packet.from,
    workspace: packet.workspace,
    summary: packet.summary,
    status: packet.status,
    tags: packet.tags || [],
    body_chars: packet.body?.length || 0,
    git_dirty_files: packet.git?.status?.length || 0,
    next_resume: `acb resume --id ${packet.id}`,
    next_brief: `acb brief --id ${packet.id}`,
    next_show_prompt: `acb show ${packet.id} --prompt`,
    next_mcp_read: "read_handoff",
    next_mcp_brief: "read_handoff_brief",
  };
}

function packetWithNextSteps(packet) {
  return {
    ...packet,
    next_resume: `acb resume --id ${packet.id}`,
    next_brief: `acb brief --id ${packet.id}`,
    next_show_prompt: `acb show ${packet.id} --prompt`,
    next_mcp_read: "read_handoff",
    next_mcp_brief: "read_handoff_brief",
  };
}

function jsonRpcError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function renderHandoffPrompt(packet) {
  const lines = [
    "You are taking over work from another local coding agent.",
    "",
    "Read this handoff context before acting. Do not assume hidden state beyond this packet.",
    "",
    "## Handoff Packet",
    "",
    `- id: ${packet.id}`,
    `- from: ${packet.from}`,
    `- created_at: ${packet.created_at}`,
    `- workspace: ${packet.workspace}`,
  ];
  if (packet.updated_at) lines.push(`- updated_at: ${packet.updated_at}`);
  if (packet.summary) lines.push(`- summary: ${packet.summary}`);
  if (packet.status) lines.push(`- status: ${packet.status}`);
  if (packet.tags?.length) lines.push(`- tags: ${packet.tags.join(", ")}`);
  if (packet.git) {
    lines.push("", "## Git Snapshot", "", renderGitSnapshot(packet.git));
  }
  if (packet.notes?.length) {
    lines.push("", "## Notes");
    for (const note of packet.notes) lines.push(`- ${note}`);
  }
  if (packet.body) {
    lines.push("", "## Context Body", "", truncatePromptBody(packet.body));
  }
  lines.push(
    "",
    "## Requested Behavior",
    "",
    "- Continue from this context instead of asking the user to repeat it.",
    "- If anything is ambiguous or risky, ask one concise question before making changes.",
    "- Preserve user edits and verify before proposing any release or publish step.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function renderBriefPrompt(packet) {
  const lines = [
    "You are taking over local coding work from an ACB brief.",
    "",
    "Use this as a compact starting point. If you need the full packet, ask the user to run the full resume command below or call the MCP read_handoff tool.",
    "",
    "## Brief",
    "",
    `- id: ${packet.id}`,
    `- from: ${packet.from}`,
    `- created_at: ${packet.created_at}`,
    `- workspace: ${packet.workspace}`,
  ];
  if (packet.updated_at) lines.push(`- updated_at: ${packet.updated_at}`);
  if (packet.summary) lines.push(`- summary: ${packet.summary}`);
  if (packet.status) lines.push(`- status: ${packet.status}`);
  if (packet.tags?.length) lines.push(`- tags: ${packet.tags.join(", ")}`);
  if (packet.git) {
    lines.push(
      `- git_branch: ${packet.git.branch || "unknown"}`,
      `- git_head: ${packet.git.head || "unknown"}`,
      `- git_dirty_files: ${packet.git.status?.length || 0}`,
    );
  }
  if (packet.notes?.length) {
    lines.push("", "## Notes");
    for (const note of packet.notes.slice(0, 8)) lines.push(`- ${note}`);
    if (packet.notes.length > 8) lines.push(`- ... ${packet.notes.length - 8} more note(s) omitted from brief`);
  }
  if (packet.body) {
    lines.push("", "## Context Excerpt", "", truncateText(packet.body, BRIEF_BODY_LIMIT));
  }
  lines.push(
    "",
    "## Full Context Commands",
    "",
    `- Full prompt: acb resume --id ${packet.id}`,
    `- Inspect packet: acb show ${packet.id}`,
    "- MCP full read: read_handoff",
    "",
    "## Requested Behavior",
    "",
    "- Continue from this brief without assuming hidden state.",
    "- Inspect the workspace before editing files.",
    "- Ask one concise question if the brief is insufficient.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function printPacket(packet) {
  console.log(`id: ${packet.id}`);
  console.log(`from: ${packet.from}`);
  console.log(`created_at: ${packet.created_at}`);
  if (packet.updated_at) console.log(`updated_at: ${packet.updated_at}`);
  console.log(`workspace: ${packet.workspace}`);
  if (packet.summary) console.log(`summary: ${packet.summary}`);
  if (packet.status) console.log(`status: ${packet.status}`);
  if (packet.tags?.length) console.log(`tags: ${packet.tags.join(", ")}`);
  if (packet.git) {
    console.log(`git_branch: ${packet.git.branch || "unknown"}`);
    console.log(`git_head: ${packet.git.head || "unknown"}`);
    console.log(`git_dirty_files: ${packet.git.status?.length || 0}`);
  }
  if (packet.body) console.log(`body: ${packet.body.length} chars`);
  console.log(`next_resume: acb resume --id ${packet.id}`);
  console.log(`next_brief: acb brief --id ${packet.id}`);
  console.log(`next_show_prompt: acb show ${packet.id} --prompt`);
  console.log("next_mcp_read: read_handoff");
  console.log("next_mcp_brief: read_handoff_brief");
  if (packet.notes?.length) {
    console.log("notes:");
    for (const note of packet.notes) console.log(`- ${note}`);
  }
}

function findPacket({ workspace = null, id = null } = {}) {
  const store = loadStore();
  return store.packets.find((packet) => {
    if (id && packet.id !== id) return false;
    if (workspace && packet.workspace !== workspace) return false;
    return true;
  }) || null;
}

function replacePacket(packet) {
  const store = loadStore();
  const index = store.packets.findIndex((item) => item.id === packet.id);
  if (index === -1) return false;
  store.packets[index] = packet;
  writeStore(store);
  return true;
}

function loadStore() {
  const result = readStore();
  if (!result.ok) throw storeError(result.error);
  return result.store;
}

function createPacketId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `pkt_${stamp}_${random}`;
}

function timestampForFile() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function readSaveBody(args, workspace) {
  const filePath = argValue(args, "--file");
  const wantsStdin = args.includes("--stdin");
  const wantsDiff = args.includes("--diff");
  const sources = [Boolean(filePath), wantsStdin, wantsDiff].filter(Boolean).length;

  if (sources > 1) {
    return { ok: false, error: "Use only one body source: --file, --stdin, or --diff." };
  }
  if (filePath) return readBodyFile(filePath);
  if (wantsStdin) return readBodyStdin();
  if (wantsDiff) return readGitDiffBody(workspace, argValue(args, "--diff-limit"));
  return { ok: true, body: "" };
}

function hasBodySource(args) {
  return Boolean(argValue(args, "--file") || args.includes("--stdin") || args.includes("--diff"));
}

function hasUpdateArgs(args) {
  return argValue(args, "--summary") !== undefined
    || argValue(args, "--status") !== undefined
    || argValues(args, "--note").length > 0
    || argValues(args, "--tag").length > 0
    || args.includes("--clear-notes")
    || args.includes("--clear-tags")
    || args.includes("--git")
    || hasBodySource(args);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function readBodyFile(filePath) {
  const resolved = path.resolve(filePath);
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { ok: false, error: `--file is not a file: ${resolved}` };
    const body = fs.readFileSync(resolved, "utf8");
    if (!body.trim()) return { ok: false, error: `--file is empty: ${resolved}` };
    return { ok: true, body };
  } catch (error) {
    return { ok: false, error: `Cannot read --file ${resolved}: ${error.message}` };
  }
}

function readBodyStdin() {
  try {
    const body = fs.readFileSync(0, "utf8");
    if (!body.trim()) return { ok: false, error: "--stdin did not receive any content." };
    return { ok: true, body };
  } catch (error) {
    return { ok: false, error: `Cannot read --stdin: ${error.message}` };
  }
}

function readGitDiffBody(workspace, limitValue) {
  const limit = limitValue === undefined ? DIFF_BODY_LIMIT : parseLimit(limitValue);
  if (!limit) return { ok: false, error: "--diff-limit must be a positive integer." };

  const rootResult = runGit(workspace, ["rev-parse", "--show-toplevel"]);
  if (rootResult.status !== 0) {
    return { ok: false, error: `--diff requires a Git workspace: ${workspace}` };
  }
  const root = rootResult.stdout.trim();
  const stat = runGit(root, ["diff", "--stat", "HEAD", "--"]);
  const diff = runGit(root, ["diff", "--no-ext-diff", "--unified=3", "HEAD", "--"]);
  const sections = [
    "## Git Diff",
    "",
    "Tracked staged and unstaged changes relative to HEAD. Untracked file contents are not included.",
  ];
  if (stat.stdout.trim()) sections.push("", "### Stat", "", "```text", stat.stdout.trimEnd(), "```");
  if (diff.stdout.trim()) sections.push("", "### Diff", "", "```diff", truncateDiff(diff.stdout.trimEnd(), limit), "```");
  if (!stat.stdout.trim() && !diff.stdout.trim()) sections.push("", "_No tracked diff relative to HEAD._");
  return { ok: true, body: `${sections.join("\n")}\n` };
}

function truncateDiff(diff, limit) {
  if (diff.length <= limit) return diff;
  return `${diff.slice(0, limit).trimEnd()}\n\n[acb: git diff truncated at ${limit} characters]`;
}

function readGitSnapshot(workspace) {
  const rootResult = runGit(workspace, ["rev-parse", "--show-toplevel"]);
  if (rootResult.status !== 0) {
    return { ok: false, error: `--git requires a Git workspace: ${workspace}` };
  }

  const root = rootResult.stdout.trim();
  const branch = runGit(root, ["branch", "--show-current"]).stdout.trim();
  const head = runGit(root, ["rev-parse", "--short", "HEAD"]).stdout.trim();
  const status = runGit(root, ["status", "--short"]).stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  return {
    ok: true,
    snapshot: {
      root,
      branch: branch || null,
      head: head || null,
      status,
    },
  };
}

function runGit(workspace, args) {
  return spawnSync("git", ["-C", workspace, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function renderGitSnapshot(git) {
  const lines = [
    `- root: ${git.root}`,
    `- branch: ${git.branch || "unknown"}`,
    `- head: ${git.head || "unknown"}`,
    `- dirty_files: ${git.status?.length || 0}`,
  ];
  if (git.status?.length) {
    lines.push("", "```text", ...git.status, "```");
  }
  return lines.join("\n");
}

function truncatePromptBody(body) {
  const normalized = String(body).replace(/\r\n/g, "\n").trimEnd();
  if (normalized.length <= PROMPT_BODY_LIMIT) return normalized;
  return `${normalized.slice(0, PROMPT_BODY_LIMIT).trimEnd()}\n\n[acb: context body truncated at ${PROMPT_BODY_LIMIT} characters]`;
}

function truncateText(text, limit) {
  const normalized = String(text).replace(/\r\n/g, "\n").trimEnd();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit).trimEnd()}\n\n[acb: text truncated at ${limit} characters]`;
}

function parseLimit(value) {
  if (value === undefined) return DEFAULT_LIMIT;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePort(value) {
  if (value === undefined) return 8765;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : null;
}

function argValue(args, name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function argValues(args, name) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith(`${name}=`)) values.push(arg.slice(name.length + 1));
    else if (arg === name && args[i + 1] !== undefined) {
      values.push(args[i + 1]);
      i += 1;
    }
  }
  return values;
}

function print(text) {
  process.stdout.write(text);
  return 0;
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync.native(process.argv[1]) === fs.realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  }
}

if (isDirectRun()) {
  Promise.resolve(main()).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    if (error.code === "ACB_STORE_ERROR") {
      console.error(error.message);
      console.error("Run `acb doctor` to inspect the store before retrying. ACB did not modify the store.");
      process.exitCode = 2;
      return;
    }
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

export { main, renderHandoffPrompt };
