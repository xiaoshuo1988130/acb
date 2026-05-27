#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION = "0.0.1";
const STORE_VERSION = 1;
const DEFAULT_LIMIT = 10;
const PROMPT_BODY_LIMIT = 12000;
const MCP_PROTOCOL_VERSION = "2025-06-18";

const usage = `AgentContextBus (acb) ${VERSION}

Usage:
  acb save [--from <agent>] [--workspace <path>] [--summary <text>] [--status <text>] [--note <text>] [--tag <tag>] [--file <path> | --stdin] [--git]
  acb latest [--workspace <path>] [--json]
  acb show <packet-id> [--json | --prompt]
  acb prompt [--workspace <path>] [--id <packet-id>] [--no-copy]
  acb list [--workspace <path>] [--limit <n>] [--json]
  acb timeline [--workspace <path>] [--limit <n>] [--json]
  acb export [--workspace <path>] [--limit <n>] [--format markdown|json] [--out <path>]
  acb delete <packet-id>
  acb clear [--workspace <path>] [--all]
  acb doctor [--workspace <path>] [--json]
  acb serve
  acb store path
  acb --version
  acb help

Purpose:
  Save a local handoff packet and turn it into a paste-ready prompt for another coding agent.
`;

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || "help";
  const args = argv.slice(1);

  if (command === "help" || command === "--help" || command === "-h") return print(usage);
  if (command === "--version" || command === "-v" || command === "version") return print(`acb ${VERSION}\n`);
  if (command === "save") return saveCommand(args);
  if (command === "latest") return latestCommand(args);
  if (command === "show") return showCommand(args);
  if (command === "prompt") return promptCommand(args);
  if (command === "list") return listCommand(args);
  if (command === "timeline") return timelineCommand(args);
  if (command === "export") return exportCommand(args);
  if (command === "delete") return deleteCommand(args);
  if (command === "clear") return clearCommand(args);
  if (command === "doctor") return doctorCommand(args);
  if (command === "serve") return serveCommand(args);
  if (command === "store") return storeCommand(args);

  console.error(`Unknown command: ${command}\n\n${usage}`);
  return 2;
}

function saveCommand(args) {
  const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const summary = argValue(args, "--summary") || "";
  const status = argValue(args, "--status") || "";
  const notes = argValues(args, "--note");
  const tags = argValues(args, "--tag");
  const from = argValue(args, "--from") || process.env.ACB_AGENT || "unknown";
  const bodyResult = readSaveBody(args);
  const gitResult = args.includes("--git") ? readGitSnapshot(workspace) : { ok: true, snapshot: null };

  if (!bodyResult.ok) {
    console.error(bodyResult.error);
    return 2;
  }
  if (!gitResult.ok) {
    console.error(gitResult.error);
    return 2;
  }

  if (!summary && !status && notes.length === 0 && !bodyResult.body && !gitResult.snapshot) {
    console.error("acb save needs at least --summary, --status, --note, --file, --stdin, or --git.");
    return 2;
  }

  const packet = {
    id: createPacketId(),
    version: STORE_VERSION,
    created_at: new Date().toISOString(),
    from,
    workspace,
    summary: summary || null,
    status: status || null,
    notes,
    tags,
    body: bodyResult.body || null,
    git: gitResult.snapshot,
  };

  const store = loadStore();
  store.packets.unshift(packet);
  writeStore(store);

  console.log(`[acb] saved handoff packet: ${packet.id}`);
  console.log(`[acb] workspace: ${packet.workspace}`);
  console.log("[acb] next: acb prompt");
  return 0;
}

function latestCommand(args) {
  const workspace = args.includes("--workspace") ? normalizeWorkspace(argValue(args, "--workspace")) : null;
  const packet = findPacket({ workspace });
  if (!packet) {
    console.error(workspace ? `No handoff packet found for workspace: ${workspace}` : "No handoff packets found.");
    return 1;
  }
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
    return 0;
  }
  printPacket(packet);
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
    process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
    return 0;
  }
  if (args.includes("--prompt")) {
    process.stdout.write(renderHandoffPrompt(packet));
    return 0;
  }
  printPacket(packet);
  return 0;
}

function promptCommand(args) {
  const workspace = args.includes("--workspace") ? normalizeWorkspace(argValue(args, "--workspace")) : null;
  const id = argValue(args, "--id");
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

function listCommand(args) {
  const workspace = args.includes("--workspace") ? normalizeWorkspace(argValue(args, "--workspace")) : null;
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
  for (const packet of packets) {
    console.log(`${packet.id}  ${packet.created_at}  ${packet.from}  ${packet.workspace}`);
    if (packet.summary) console.log(`  ${packet.summary}`);
  }
  return 0;
}

function timelineCommand(args) {
  const workspace = args.includes("--workspace") ? normalizeWorkspace(argValue(args, "--workspace")) : null;
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
  if (workspace) console.log(`workspace: ${workspace}`);
  for (const packet of packets) printTimelinePacket(packet);
  return 0;
}

function exportCommand(args) {
  const workspace = args.includes("--workspace") ? normalizeWorkspace(argValue(args, "--workspace")) : null;
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

function storeCommand(args) {
  if (args[0] !== "path") {
    console.error("Usage: acb store path");
    return 2;
  }
  console.log(storePath());
  return 0;
}

function buildDoctorReport(workspace) {
  const store = loadStore();
  const workspacePackets = store.packets.filter((packet) => packet.workspace === workspace);
  const clipboardCommands = clipboardCandidates().map(([command]) => ({
    command,
    available: commandExists(command),
  }));
  const gitAvailable = commandExists("git");
  const gitRootResult = gitAvailable ? runGit(workspace, ["rev-parse", "--show-toplevel"]) : { status: 1 };
  const gitRoot = gitRootResult.status === 0 ? gitRootResult.stdout.trim() : null;

  return {
    ok: true,
    store_path: storePath(),
    total_packets: store.packets.length,
    workspace,
    workspace_packets: workspacePackets.length,
    latest_workspace_packet_id: workspacePackets[0]?.id || null,
    checks: {
      store_readable: true,
      git_available: gitAvailable,
      git_workspace: Boolean(gitRoot),
      clipboard_command_available: clipboardCommands.some((item) => item.available),
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
  };
}

function printDoctorReport(report) {
  console.log("ACB Doctor");
  console.log(`store: ${report.store_path}`);
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
    instructions: "Use read_latest_handoff to pull the newest explicit local handoff packet for the current workspace.",
  };
}

function mcpTools() {
  return [
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
  if (name === "read_latest_handoff") return mcpReadLatestHandoff(args);
  if (name === "read_handoff") return mcpReadHandoff(args);
  if (name === "list_handoffs") return mcpListHandoffs(args);
  throw jsonRpcError(-32602, `Unknown tool: ${name}`);
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
    structuredContent: { packet, prompt },
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
    structuredContent: { packet, prompt },
    isError: false,
  };
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

function packetSummary(packet) {
  return {
    id: packet.id,
    created_at: packet.created_at,
    from: packet.from,
    workspace: packet.workspace,
    summary: packet.summary,
    status: packet.status,
    tags: packet.tags || [],
    body_chars: packet.body?.length || 0,
    git_dirty_files: packet.git?.status?.length || 0,
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

function printPacket(packet) {
  console.log(`id: ${packet.id}`);
  console.log(`from: ${packet.from}`);
  console.log(`created_at: ${packet.created_at}`);
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

function loadStore() {
  const filePath = storePath();
  if (!fs.existsSync(filePath)) return { version: STORE_VERSION, packets: [] };
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed.packets)) return { version: STORE_VERSION, packets: [] };
  return { version: parsed.version || STORE_VERSION, packets: parsed.packets };
}

function writeStore(store) {
  const filePath = storePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`);
}

function storePath() {
  if (process.env.ACB_STORE) return path.resolve(process.env.ACB_STORE);
  return path.join(os.homedir(), ".acb", "packets.json");
}

function normalizeWorkspace(workspace) {
  return path.resolve(workspace || process.cwd());
}

function createPacketId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `pkt_${stamp}_${random}`;
}

function readSaveBody(args) {
  const filePath = argValue(args, "--file");
  const wantsStdin = args.includes("--stdin");

  if (filePath && wantsStdin) {
    return { ok: false, error: "Use either --file or --stdin, not both." };
  }
  if (filePath) return readBodyFile(filePath);
  if (wantsStdin) return readBodyStdin();
  return { ok: true, body: "" };
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

function parseLimit(value) {
  if (value === undefined) return DEFAULT_LIMIT;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

function copyToClipboard(text) {
  const errors = [];
  for (const [cmd, args] of clipboardCandidates()) {
    const result = spawnSync(cmd, args, { input: text, encoding: "utf8" });
    if (result.status === 0) return { ok: true };
    errors.push(result.error?.message || result.stderr || `${cmd} exited ${result.status}`);
  }
  return { ok: false, error: errors.join("; ") || "no clipboard command available" };
}

function clipboardCandidates() {
  const platform = process.platform;
  if (platform === "darwin") return [["pbcopy", []]];
  if (platform === "win32") return [["clip.exe", []]];
  return [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];
}

function commandExists(command) {
  const paths = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of paths) {
    for (const ext of extensions) {
      try {
        fs.accessSync(path.join(dir, `${command}${ext}`), fs.constants.X_OK);
        return true;
      } catch {
        // Try the next PATH candidate.
      }
    }
  }
  return false;
}

function print(text) {
  process.stdout.write(text);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  Promise.resolve(main()).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

export { main, renderHandoffPrompt };
