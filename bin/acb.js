#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION = "0.0.1";
const STORE_VERSION = 1;
const DEFAULT_LIMIT = 10;
const PROMPT_BODY_LIMIT = 12000;
const DIFF_BODY_LIMIT = 20000;
const MCP_PROTOCOL_VERSION = "2025-06-18";

const usage = `AgentContextBus (acb) ${VERSION}

Usage:
  acb handoff [--from <agent>] [--workspace <path>] [--summary <text>] [--status <text>] [--note <text>] [--tag <tag>] [--file <path> | --stdin | --diff] [--git] [--diff-limit <chars>] [--no-copy | --print-prompt | --json]
  acb save [--from <agent>] [--workspace <path>] [--summary <text>] [--status <text>] [--note <text>] [--tag <tag>] [--file <path> | --stdin | --diff] [--git] [--diff-limit <chars>] [--copy | --print-prompt | --json]
  acb update <packet-id> [--summary <text>] [--status <text>] [--note <text>] [--tag <tag>] [--file <path> | --stdin | --diff] [--git] [--clear-notes] [--clear-tags] [--json]
  acb diff-preview [--workspace <path>] [--diff-limit <chars>] [--out <path>]
  acb latest [--workspace <path>] [--json]
  acb status [--workspace <path>] [--json]
  acb show <packet-id> [--json | --prompt]
  acb prompt [--workspace <path>] [--id <packet-id>] [--no-copy]
  acb preview [--workspace <path>] [--id <packet-id>] [--out <path>] [--open]
  acb list [--workspace <path>] [--limit <n>] [--json]
  acb workspaces [--limit <n>] [--json]
  acb search <query> [--workspace <path>] [--limit <n>] [--json]
  acb timeline [--workspace <path>] [--limit <n>] [--json]
  acb export [--workspace <path>] [--limit <n>] [--format markdown|json] [--out <path>]
  acb import --file <path> [--replace]
  acb delete <packet-id>
  acb clear [--workspace <path>] [--all]
  acb doctor [--workspace <path>] [--json]
  acb config mcp [--command <path-or-command>] [--name <server-name>] [--arg <value>...] [--out <path>]
  acb verify mcp [--config <path>] [--name <server-name>] [--json]
  acb serve
  acb store path
  acb store info [--json]
  acb store backup [--out <path>] [--force] [--json]
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
  if (command === "handoff") return handoffCommand(args);
  if (command === "save") return saveCommand(args);
  if (command === "update") return updateCommand(args);
  if (command === "diff-preview") return diffPreviewCommand(args);
  if (command === "latest") return latestCommand(args);
  if (command === "status") return statusCommand(args);
  if (command === "show") return showCommand(args);
  if (command === "prompt") return promptCommand(args);
  if (command === "preview") return previewCommand(args);
  if (command === "list") return listCommand(args);
  if (command === "workspaces") return workspacesCommand(args);
  if (command === "search") return searchCommand(args);
  if (command === "timeline") return timelineCommand(args);
  if (command === "export") return exportCommand(args);
  if (command === "import") return importCommand(args);
  if (command === "delete") return deleteCommand(args);
  if (command === "clear") return clearCommand(args);
  if (command === "doctor") return doctorCommand(args);
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
  console.log("[acb] next: acb prompt");
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

function previewCommand(args) {
  const workspace = args.includes("--workspace") ? normalizeWorkspace(argValue(args, "--workspace")) : null;
  const id = argValue(args, "--id");
  const packet = findPacket({ workspace, id });
  if (!packet) {
    console.error(id ? `No handoff packet found for id: ${id}` : "No handoff packet found.");
    return 1;
  }

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
  }
  return 0;
}

function searchCommand(args) {
  const query = args.find((arg) => !arg.startsWith("--"));
  if (!query) {
    console.error("Usage: acb search <query> [--workspace <path>] [--limit <n>] [--json]");
    return 2;
  }
  const workspace = args.includes("--workspace") ? normalizeWorkspace(argValue(args, "--workspace")) : null;
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
  if (workspace) console.log(`workspace: ${workspace}`);
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
      copy_prompt: `acb prompt --id ${latest.id}`,
      show_prompt: `acb show ${latest.id} --prompt`,
      mcp_pull: "Use acb to read the latest handoff for this workspace.",
    } : {
      save: "acb save --summary \"...\" --git",
    },
  };
}

function printStatusReport(report) {
  console.log("ACB Status");
  console.log(`workspace: ${report.workspace}`);
  console.log(`store: ${report.store_path}`);
  console.log(`workspace_packets: ${report.workspace_packets}`);
  if (report.git) {
    console.log(`git_branch: ${report.git.branch || "unknown"}`);
    console.log(`git_head: ${report.git.head || "unknown"}`);
    console.log(`git_dirty_files: ${report.git.dirty_files}`);
  } else {
    console.log("git: unavailable");
  }
  if (!report.latest_packet) {
    console.log("latest_packet: none");
    console.log(`next: ${report.next.save}`);
    return;
  }
  console.log(`latest_packet: ${report.latest_packet.id}`);
  console.log(`latest_from: ${report.latest_packet.from}`);
  console.log(`latest_created_at: ${report.latest_packet.created_at}`);
  if (report.latest_packet.summary) console.log(`latest_summary: ${report.latest_packet.summary}`);
  if (report.latest_packet.status) console.log(`latest_status: ${report.latest_packet.status}`);
  console.log(`next_copy_prompt: ${report.next.copy_prompt}`);
  console.log(`next_show_prompt: ${report.next.show_prompt}`);
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
  if (target !== "mcp") {
    console.error("Usage: acb verify mcp [--config <path>] [--name <server-name>] [--json]");
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

  const report = verifyMcpServer(selected.name, selected.server);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printMcpVerifyReport(report);
  }
  return report.ok ? 0 : 1;
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

function verifyMcpServer(name, server) {
  const input = [
    jsonRpcLine("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "acb-verify", version: VERSION },
    }, 1),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    jsonRpcLine("tools/list", {}, 2),
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
    checks: {
      launch: false,
      initialize: false,
      tools_list: false,
      required_tools: false,
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

  report.checks.launch = true;
  const messages = parseJsonRpcLines(result.stdout || "");
  const initialize = messages.find((message) => message.id === 1);
  const toolsList = messages.find((message) => message.id === 2);

  if (initialize?.result?.serverInfo?.name) report.checks.initialize = true;
  else if (initialize?.error) report.error = initialize.error.message || "initialize failed";

  if (Array.isArray(toolsList?.result?.tools)) {
    report.checks.tools_list = true;
    report.tools = toolsList.result.tools.map((tool) => tool.name).filter(Boolean);
  } else if (toolsList?.error) {
    report.error = toolsList.error.message || "tools/list failed";
  }

  const requiredTools = ["read_latest_handoff", "save_handoff", "update_handoff", "read_handoff", "search_handoffs", "list_workspaces", "list_handoffs"];
  report.checks.required_tools = requiredTools.every((toolName) => report.tools.includes(toolName));
  report.ok = Object.values(report.checks).every(Boolean);
  if (!report.ok && !report.error) report.error = "MCP server did not expose the expected ACB tools.";
  return report;
}

function jsonRpcLine(method, params, id) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function parseJsonRpcLines(stdout) {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function printMcpVerifyReport(report) {
  console.log("ACB MCP Verify");
  console.log(`server: ${report.server}`);
  console.log(`command: ${formatCommand(report.command, report.args)}`);
  console.log(`launch: ${report.checks.launch ? "ok" : "failed"}`);
  console.log(`initialize: ${report.checks.initialize ? "ok" : "failed"}`);
  console.log(`tools/list: ${report.checks.tools_list ? "ok" : "failed"}`);
  console.log(`required_tools: ${report.checks.required_tools ? "ok" : "failed"}`);
  console.log(`tools: ${report.tools.length ? report.tools.join(", ") : "none"}`);
  if (report.error) console.log(`error: ${report.error}`);
  if (report.stderr) console.log(`stderr: ${report.stderr}`);
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
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
  console.log(`mcp_config_command: ${report.mcp.config_command}`);
  console.log(`mcp_verify_command: ${report.mcp.verify_command}`);
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
  if (name === "read_latest_handoff") return mcpReadLatestHandoff(args);
  if (name === "save_handoff") return mcpSaveHandoff(args);
  if (name === "update_handoff") return mcpUpdateHandoff(args);
  if (name === "read_handoff") return mcpReadHandoff(args);
  if (name === "search_handoffs") return mcpSearchHandoffs(args);
  if (name === "list_workspaces") return mcpListWorkspaces(args);
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
    structuredContent: { packet, prompt },
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

function readStore() {
  const filePath = storePath();
  if (!fs.existsSync(filePath)) return { ok: true, store: { version: STORE_VERSION, packets: [] } };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: `ACB store is not a JSON object: ${filePath}` };
    }
    if (!Array.isArray(parsed.packets)) {
      return { ok: false, error: `ACB store does not contain a packets array: ${filePath}` };
    }
    return { ok: true, store: { version: parsed.version || STORE_VERSION, packets: parsed.packets } };
  } catch (error) {
    return { ok: false, error: `Cannot read ACB store ${filePath}: ${error.message}` };
  }
}

function storeError(message) {
  const error = new Error(message);
  error.code = "ACB_STORE_ERROR";
  return error;
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

function openFile(filePath) {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd.exe" : "xdg-open";
  const args = platform === "darwin"
    ? [filePath]
    : platform === "win32"
      ? ["/c", "start", "", filePath]
      : [filePath];
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status === 0) return { ok: true };
  return { ok: false, error: result.error?.message || result.stderr || `${command} exited ${result.status}` };
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
