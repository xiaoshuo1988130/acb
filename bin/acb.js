#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION = "0.0.1";
const STORE_VERSION = 1;
const DEFAULT_LIMIT = 10;

const usage = `AgentContextBus (acb) ${VERSION}

Usage:
  acb save [--from <agent>] [--workspace <path>] [--summary <text>] [--status <text>] [--note <text>] [--tag <tag>]
  acb latest [--workspace <path>] [--json]
  acb prompt [--workspace <path>] [--id <packet-id>] [--no-copy]
  acb list [--workspace <path>] [--limit <n>] [--json]
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
  if (command === "prompt") return promptCommand(args);
  if (command === "list") return listCommand(args);
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

  if (!summary && !status && notes.length === 0) {
    console.error("acb save needs at least --summary, --status, or --note.");
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

function storeCommand(args) {
  if (args[0] !== "path") {
    console.error("Usage: acb store path");
    return 2;
  }
  console.log(storePath());
  return 0;
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
  if (packet.notes?.length) {
    lines.push("", "## Notes");
    for (const note of packet.notes) lines.push(`- ${note}`);
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
  const platform = process.platform;
  const candidates = [];
  if (platform === "darwin") candidates.push(["pbcopy", []]);
  else if (platform === "win32") candidates.push(["clip.exe", []]);
  else {
    candidates.push(["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]);
  }

  const errors = [];
  for (const [cmd, args] of candidates) {
    const result = spawnSync(cmd, args, { input: text, encoding: "utf8" });
    if (result.status === 0) return { ok: true };
    errors.push(result.error?.message || result.stderr || `${cmd} exited ${result.status}`);
  }
  return { ok: false, error: errors.join("; ") || "no clipboard command available" };
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
