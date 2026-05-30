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
import {
  createWorkspaceFingerprint,
  readWatchFingerprint,
  watchConfigPath,
} from "../lib/fingerprint.js";
import {
  readGitSnapshot,
  runGit,
} from "../lib/git.js";
import {
  buildFreshnessReport,
  buildReadyReport,
  buildSafetyReport,
  createAcknowledgement,
  evaluatePacketReadiness,
  packetFreshnessSummary,
  packetReadinessSummary,
  packetSafety,
  packetSummary,
  packetWithNextSteps,
} from "../lib/packet-state.js";
import {
  PROMPT_BODY_LIMIT,
  packetAcknowledgements,
  packetAcknowledgementSummary,
  renderBriefPrompt,
  renderHandoffPrompt,
  renderMcpTakeoverInstruction,
} from "../lib/prompts.js";
import {
  RECIPE_TARGETS,
  buildDashboardTargetGuides,
  buildSetupGuideForTarget,
  detectDashboardTargets,
  findDashboardTarget,
  findRecipe,
  recipeSummary,
  recommendDashboardTarget,
} from "../lib/setup-guides.js";

const PACKAGE_META = readPackageMeta();
const VERSION = PACKAGE_META.version;
const PACKAGE_NAME = PACKAGE_META.name;
const DEFAULT_LIMIT = 10;
const DIFF_BODY_LIMIT = 20000;
const MCP_PROTOCOL_VERSION = "2025-06-18";
const LANGUAGE_VALUE_FLAGS = new Set(["--workspace", "--lang"]);

const usage = `AgentContextBus (acb) ${VERSION}

Usage:
  acb handoff [--from <agent>] [--workspace <path>] [--summary <text>] [--status <text>] [--note <text>] [--tag <tag>] [--file <path> | --stdin | --diff] [--git] [--watch <path>...] [--diff-limit <chars>] [--no-copy | --print-prompt | --json]
  acb demo [--workspace <path>] [--from <agent>] [--lang en|zh-CN] [--json]
  acb demo freshness [--lang en|zh-CN] [--json]
  acb save [--from <agent>] [--workspace <path>] [--summary <text>] [--status <text>] [--note <text>] [--tag <tag>] [--file <path> | --stdin | --diff] [--git] [--watch <path>...] [--diff-limit <chars>] [--copy | --print-prompt | --json]
  acb update <packet-id> [--summary <text>] [--status <text>] [--note <text>] [--tag <tag>] [--file <path> | --stdin | --diff] [--git] [--watch <path>...] [--clear-notes] [--clear-tags] [--json]
  acb ack [packet-id|--latest] [--workspace <path>] [--by <agent>] [--note <text>] [--json]
  acb diff-preview [--workspace <path>] [--diff-limit <chars>] [--out <path>]
  acb latest [--workspace <path>] [--all] [--json]
  acb status [--workspace <path>] [--json]
  acb show <packet-id> [--json | --prompt]
  acb receive [packet-id|--latest] [--workspace <path>] [--brief] [--no-copy | --print-prompt | --json]
  acb resume [--workspace <path>] [--id <packet-id>] [--no-copy | --print-prompt | --json | --preview] [--out <path>] [--open]
  acb brief [--workspace <path>] [--id <packet-id>] [--no-copy | --print-brief | --json]
  acb prompt [--workspace <path>] [--id <packet-id>] [--no-copy]
  acb preview [--workspace <path>] [--id <packet-id>] [--out <path>] [--open]
  acb list [--workspace <path>] [--all] [--limit <n>] [--json]
  acb workspaces [--limit <n>] [--json]
  acb search <query> [--workspace <path>] [--all] [--limit <n>] [--json]
  acb timeline [--workspace <path>] [--all] [--limit <n>] [--json]
  acb safety [packet-id] [--workspace <path>] [--json]
  acb freshness [packet-id] [--workspace <path>] [--json]
  acb ready [packet-id] [--workspace <path>] [--json]
  acb view [--workspace <path>] [--all] [--limit <n>] [--out <path>] [--open]
  acb dashboard [--workspace <path>] [--all] [--limit <n>] [--host <host>] [--port <port>] [--lang en|zh-CN] [--open]
  acb export [--workspace <path>] [--all] [--limit <n>] [--format markdown|json] [--out <path>]
  acb import --file <path> [--replace]
  acb delete <packet-id>
  acb clear [--workspace <path>] [--all]
  acb doctor [--workspace <path>] [--json]
  acb recipe [target] [--json]
  acb setup [target] [--workspace <path>] [--check] [--keep-artifacts] [--lang en|zh-CN] [--json]
  acb config mcp [--command <path-or-command>] [--name <server-name>] [--arg <value>...] [--out <path>]
  acb verify first-run [--workspace <path>] [--target <target>] [--lang en|zh-CN] [--keep-artifacts] [--json]
  acb verify mcp [--config <path>] [--name <server-name>] [--workspace <path>] [--json]
  acb verify workflow <target|--all> [--workspace <path>] [--keep-artifacts] [--json]
  acb verify safety [--workspace <path>] [--keep-artifacts] [--json]
  acb serve
  acb store path
  acb store info [--json]
  acb store backup [--out <path>] [--force] [--json]
  acb quickstart [--check] [--workspace <path>] [--lang en|zh-CN] [--json]
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

Try a safe demo packet:
  acb demo

Show the freshness gate:
  acb demo freshness
  acb dashboard --workspace .

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

function readPackageMeta() {
  try {
    const packageUrl = new URL("../package.json", import.meta.url);
    const parsed = JSON.parse(fs.readFileSync(packageUrl, "utf8"));
    return {
      name: parsed.name || "@agentcontextbus/cli",
      version: parsed.version || "0.0.0",
    };
  } catch {
    return { name: "@agentcontextbus/cli", version: "0.0.0" };
  }
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || "help";
  const args = argv.slice(1);

  if (command === "help" || command === "--help" || command === "-h") return print(usage);
  if (command === "--version" || command === "-v" || command === "version") return print(`acb ${VERSION}\n`);
  if (command === "quickstart") return quickstartCommand(args);
  if (command === "handoff") return handoffCommand(args);
  if (command === "demo") return demoCommand(args);
  if (command === "save") return saveCommand(args);
  if (command === "update") return updateCommand(args);
  if (command === "ack" || command === "acknowledge") return ackCommand(args);
  if (command === "diff-preview") return diffPreviewCommand(args);
  if (command === "latest") return latestCommand(args);
  if (command === "status") return statusCommand(args);
  if (command === "show") return showCommand(args);
  if (command === "receive") return receiveCommand(args);
  if (command === "resume") return resumeCommand(args);
  if (command === "brief") return briefCommand(args);
  if (command === "prompt") return promptCommand(args);
  if (command === "preview") return previewCommand(args);
  if (command === "list") return listCommand(args);
  if (command === "workspaces") return workspacesCommand(args);
  if (command === "search") return searchCommand(args);
  if (command === "timeline") return timelineCommand(args);
  if (command === "safety") return safetyCommand(args);
  if (command === "freshness" || command === "fresh") return freshnessCommand(args);
  if (command === "ready" || command === "readiness") return readyCommand(args);
  if (command === "view") return viewCommand(args);
  if (command === "dashboard") return dashboardCommand(args);
  if (command === "export") return exportCommand(args);
  if (command === "import") return importCommand(args);
  if (command === "delete") return deleteCommand(args);
  if (command === "clear") return clearCommand(args);
  if (command === "doctor") return doctorCommand(args);
  if (command === "recipe" || command === "recipes") return recipeCommand(args);
  if (command === "setup") return setupCommand(args);
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

function resolveLanguage(args = []) {
  return normalizeLanguage(argValue(args, "--lang") || process.env.ACB_LANG || "en");
}

function normalizeLanguage(value) {
  const normalized = String(value || "en").toLowerCase().replace("_", "-");
  if (["zh", "zh-cn", "zh-hans", "cn", "chinese"].includes(normalized)) return "zh-CN";
  return "en";
}

function isChinese(lang) {
  return lang === "zh-CN";
}

function yesNo(value, lang) {
  if (isChinese(lang)) return value ? "是" : "否";
  return value ? "yes" : "no";
}

function quickstartCommand(args) {
  const lang = resolveLanguage(args);
  if (args.includes("--check")) {
    const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
    const report = buildDoctorReport(workspace);
    const setupResult = buildSetupGuideForTarget({ workspace });
    const check = {
      ok: report.ok,
      version: VERSION,
      package: PACKAGE_NAME,
      command_path: path.resolve(process.argv[1] || "bin/acb.js"),
      install_command: `npm install -g ${PACKAGE_NAME}`,
      workspace,
      store_path: report.store_path,
      checks: report.checks,
      setup: setupResult.ok ? setupResult.guide : null,
      detected_targets: setupResult.ok ? setupResult.guide.detected_targets : [],
      next: {
        handoff: "acb handoff --from codex --summary \"Ready for the next agent\" --git",
        receive: "acb receive --latest",
        resume: "acb resume",
        brief: "acb brief",
        doctor: "acb doctor",
        demo: formatCommand("acb", ["demo", "--workspace", workspace, ...(isChinese(lang) ? ["--lang", "zh-CN"] : [])]),
        setup: formatCommand("acb", ["setup", "--workspace", workspace, "--check", ...(isChinese(lang) ? ["--lang", "zh-CN"] : [])]),
        dashboard: formatCommand("acb", ["dashboard", "--workspace", workspace, ...(isChinese(lang) ? ["--lang", "zh-CN"] : [])]),
        workflow_verify: setupResult.ok ? setupResult.guide.workflow_verify_command : "acb verify workflow codex",
        mcp_config: report.mcp.config_command,
        mcp_verify: report.mcp.verify_command,
      },
    };
    check.actions = buildQuickstartActions(check, { lang });
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify(check, null, 2)}\n`);
      return check.ok ? 0 : 1;
    }
    printQuickstartCheck(check, report, { lang });
    return check.ok ? 0 : 1;
  }

  if (args.includes("--json")) {
    console.error("Usage: acb quickstart --check --json");
    return 2;
  }

  return print(quickstart);
}

function demoCommand(args) {
  const lang = resolveLanguage(args);
  if (args[0] === "freshness" || args.includes("--freshness")) return demoFreshnessCommand(args);
  const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const from = argValue(args, "--from") || "acb-demo";
  const packet = createDemoPacket({ workspace, from, lang });
  const store = loadStore();
  store.packets.unshift(packet);
  writeStore(store);

  const report = {
    ok: true,
    packet: packetSummary(packet),
    next: demoNextSteps(packet, lang),
  };
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  printDemoReport(report, { lang });
  return 0;
}

function demoFreshnessCommand(args) {
  const lang = resolveLanguage(args);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acb-freshness-demo-"));
  fs.writeFileSync(path.join(workspace, "README.md"), "# ACB freshness demo\n\nInitial handoff context.\n", "utf8");
  runGit(workspace, ["init"]);
  runGit(workspace, ["config", "user.email", "acb-demo@example.local"]);
  runGit(workspace, ["config", "user.name", "ACB Demo"]);
  runGit(workspace, ["add", "README.md"]);
  runGit(workspace, ["commit", "-m", "Initial demo workspace"]);

  const gitResult = readGitSnapshot(workspace);
  if (!gitResult.ok) {
    console.error(gitResult.error);
    return 1;
  }

  const packet = createHandoffPacket({
    from: "acb-demo",
    workspace,
    summary: isChinese(lang)
      ? "Freshness gate demo：接收端应该先检查 ACB"
      : "Freshness gate demo: receiving agents should check ACB first",
    status: isChinese(lang)
      ? "这条 packet 保存后，demo 会模拟人类又改了一行 README。"
      : "After this packet is saved, the demo simulates a human editing README again.",
    notes: isChinese(lang)
      ? ["接收端如果先调用 check_latest_handoff_ready，会看到 needs_refresh。"]
      : ["A receiving agent that calls check_latest_handoff_ready first will see needs_refresh."],
    tags: ["demo", "freshness", "needs-refresh"],
    body: isChinese(lang)
      ? "这是保存 handoff 时的上下文。下一步 demo 会修改 README，让 freshness gate 拦住旧上下文。"
      : "This is the context at handoff time. The demo now changes README so the freshness gate blocks stale context.",
    git: gitResult.snapshot,
  });

  fs.appendFileSync(path.join(workspace, "README.md"), "\nHuman edit after handoff: this should trigger needs_refresh.\n", "utf8");
  const freshness = buildFreshnessReport(packet);
  const readiness = buildReadyReport(packet);
  const report = {
    ok: freshness.status === "changed" && readiness.status === "needs_refresh",
    workspace,
    packet: packetSummary(packet),
    freshness: {
      status: freshness.status,
      reason: freshness.reason,
      changes: freshness.changes,
    },
    readiness: {
      ready: readiness.ready,
      status: readiness.status,
      reason: readiness.reason,
      blockers: readiness.blockers,
    },
    next: {
      inspect_workspace: formatCommand("cd", [workspace]),
      mcp_ready_tool: "check_latest_handoff_ready",
      refresh_handoff: readiness.next.refresh_handoff,
    },
  };

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  }
  printFreshnessDemoReport(report, { lang });
  return report.ok ? 0 : 1;
}

function createDemoPacket({ workspace, from, lang }) {
  if (isChinese(lang)) {
    return createHandoffPacket({
      from,
      workspace,
      summary: "ACB 示例 handoff：打开 dashboard 体验上下文交接",
      status: "示例数据，用于第一次熟悉 ACB 的 handoff、brief、setup 和 dashboard",
      notes: [
        "打开 dashboard 后，可以在首屏看到这条示例上下文包。",
        "点击“复制简短提示词”可以体验把上下文交给下一个 Agent 的过程。",
        "右侧目标客户端区域可以运行 ACB 侧检查，但不会启动或修改第三方客户端。",
      ],
      tags: ["demo", "onboarding", "zh-CN"],
      body: [
        "# ACB 示例上下文包",
        "",
        "这条 packet 由 `acb demo` 显式创建，只写入本地 ACB store。",
        "",
        "推荐体验顺序：",
        "",
        "1. 运行 `acb dashboard --workspace . --lang zh-CN`。",
        "2. 在 dashboard 中查看这条 packet。",
        "3. 点击复制简短提示词，粘贴给另一个 Agent。",
        "4. 运行 `acb setup --check --lang zh-CN` 查看推荐客户端路径。",
        "",
        "ACB 不会隐藏注入 prompt，也不会修改 OpenCode、Cline、Roo、Claude Desktop 或 Codex 的私有配置。",
      ].join("\n"),
      git: null,
    });
  }
  return createHandoffPacket({
    from,
    workspace,
    summary: "ACB demo handoff: open the dashboard and try context takeover",
    status: "Demo data for first-run handoff, brief, setup, and dashboard exploration",
    notes: [
      "Open the dashboard to inspect this sample packet.",
      "Click Copy Brief Prompt to try moving context into another agent.",
      "Run the ACB-side check from the target client panel before configuring a real client.",
    ],
    tags: ["demo", "onboarding"],
    body: [
      "# ACB Demo Packet",
      "",
      "This packet was explicitly created by `acb demo` and stored only in your local ACB store.",
      "",
      "Suggested first-run path:",
      "",
      "1. Run `acb dashboard --workspace .`.",
      "2. Inspect this packet in the dashboard.",
      "3. Copy the brief prompt and paste it into another agent.",
      "4. Run `acb setup --check` to see the recommended client path.",
      "",
      "ACB does not inject hidden prompts or mutate OpenCode, Cline, Roo, Claude Desktop, or Codex private configuration.",
    ].join("\n"),
    git: null,
  });
}

function demoNextSteps(packet, lang) {
  const langArgs = isChinese(lang) ? ["--lang", "zh-CN"] : [];
  return {
    dashboard: formatCommand("acb", ["dashboard", "--workspace", packet.workspace, ...langArgs]),
    brief: `acb brief --id ${packet.id}`,
    resume: `acb resume --id ${packet.id}`,
    setup: formatCommand("acb", ["setup", "--workspace", packet.workspace, "--check", ...langArgs]),
    show: `acb show ${packet.id}`,
  };
}

function printDemoReport(report, { lang = "en" } = {}) {
  if (isChinese(lang)) {
    console.log("ACB 示例上下文包已创建");
    console.log(`id：${report.packet.id}`);
    console.log(`工作区：${report.packet.workspace}`);
    console.log(`summary：${report.packet.summary}`);
    console.log("下一步：");
    console.log(`  ${report.next.dashboard}`);
    console.log(`  ${report.next.brief}`);
    console.log(`  ${report.next.setup}`);
    return;
  }
  console.log("ACB demo handoff packet created");
  console.log(`id: ${report.packet.id}`);
  console.log(`workspace: ${report.packet.workspace}`);
  console.log(`summary: ${report.packet.summary}`);
  console.log("next:");
  console.log(`  ${report.next.dashboard}`);
  console.log(`  ${report.next.brief}`);
  console.log(`  ${report.next.setup}`);
}

function printFreshnessDemoReport(report, { lang = "en" } = {}) {
  if (isChinese(lang)) {
    console.log("ACB freshness gate demo");
    console.log(`临时工作区：${report.workspace}`);
    console.log(`packet：${report.packet.id}`);
    console.log(`freshness：${report.freshness.status}`);
    console.log(`readiness：${report.readiness.status}`);
    console.log(`原因：${report.readiness.reason}`);
    if (report.freshness.changes.length) {
      console.log("变化：");
      for (const change of report.freshness.changes) console.log(`- ${change}`);
    }
    console.log("接收端 Agent 应该先调用：check_latest_handoff_ready");
    console.log(`刷新命令：${report.next.refresh_handoff}`);
    return;
  }
  console.log("ACB freshness gate demo");
  console.log(`temporary_workspace: ${report.workspace}`);
  console.log(`packet: ${report.packet.id}`);
  console.log(`freshness: ${report.freshness.status}`);
  console.log(`readiness: ${report.readiness.status}`);
  console.log(`reason: ${report.readiness.reason}`);
  if (report.freshness.changes.length) {
    console.log("changes:");
    for (const change of report.freshness.changes) console.log(`- ${change}`);
  }
  console.log("receiving_agent_should_call: check_latest_handoff_ready");
  console.log(`refresh_handoff: ${report.next.refresh_handoff}`);
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
  const fingerprintResult = readWatchFingerprint(workspace, argValues(args, "--watch"));

  if (!bodyResult.ok) {
    console.error(bodyResult.error);
    return 2;
  }
  if (!gitResult.ok) {
    console.error(gitResult.error);
    return 2;
  }
  if (!fingerprintResult.ok) {
    console.error(fingerprintResult.error);
    return 2;
  }

  if (!summary && !status && notes.length === 0 && !bodyResult.body && !gitResult.snapshot && !fingerprintResult.fingerprint) {
    console.error("acb save needs at least --summary, --status, --note, --file, --stdin, --diff, --git, or --watch.");
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
    fingerprint: fingerprintResult.fingerprint,
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

function createHandoffPacket({ from, workspace, summary = null, status = null, notes = [], tags = [], body = null, git = null, fingerprint = null }) {
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
    fingerprint,
    acknowledgements: [],
  };
}

function updateCommand(args) {
  const id = args[0] || argValue(args, "--id");
  if (!id) {
    console.error("Usage: acb update <packet-id> [--summary <text>] [--status <text>] [--note <text>] [--tag <tag>] [--file <path> | --stdin | --diff] [--git] [--watch <path>...] [--clear-notes] [--clear-tags] [--json]");
    return 2;
  }
  if (!hasUpdateArgs(args)) {
    console.error("acb update needs at least one change: --summary, --status, --note, --tag, --file, --stdin, --diff, --git, --watch, --clear-notes, or --clear-tags.");
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

  if (argValues(args, "--watch").length || fs.existsSync(watchConfigPath(packet.workspace))) {
    const fingerprintResult = readWatchFingerprint(packet.workspace, argValues(args, "--watch"));
    if (!fingerprintResult.ok) {
      console.error(fingerprintResult.error);
      return 2;
    }
    packet.fingerprint = fingerprintResult.fingerprint;
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

function ackCommand(args) {
  const positions = positionalArgs(args, new Set(["--id", "--workspace", "--by", "--note"]));
  const id = argValue(args, "--id") || positions[0] || null;
  const wantsLatest = args.includes("--latest") || !id;
  if (id && args.includes("--latest")) {
    console.error("Use either a packet id or --latest, not both.");
    return 2;
  }

  const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const packet = wantsLatest ? findPacket({ workspace }) : findPacket({ id });
  if (!packet) {
    console.error(wantsLatest ? `No handoff packet found for workspace: ${workspace}` : `No handoff packet found for id: ${id}`);
    return 1;
  }

  const acknowledgement = createAcknowledgement({
    by: argValue(args, "--by") || process.env.ACB_AGENT || "unknown",
    note: argValue(args, "--note") || null,
  });
  const updated = {
    ...packet,
    acknowledgements: [...packetAcknowledgements(packet), acknowledgement],
    updated_at: new Date().toISOString(),
  };
  replacePacket(updated);

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ ok: true, packet: packetWithNextSteps(updated), acknowledgement }, null, 2)}\n`);
    return 0;
  }

  console.log(`[acb] acknowledged handoff packet: ${updated.id}`);
  console.log(`[acb] by: ${acknowledgement.by}`);
  if (acknowledgement.note) console.log(`[acb] note: ${acknowledgement.note}`);
  console.log(`[acb] next: acb show ${updated.id}`);
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

function receiveCommand(args) {
  if (receiveOutputModes(args).length > 1) {
    console.error("Use only one receive output mode: --no-copy, --print-prompt, or --json.");
    return 2;
  }

  const scope = resolveReceiveScope(args);
  if (!scope.ok) {
    console.error(scope.error);
    return 2;
  }

  const packet = findPacket({ workspace: scope.id ? null : scope.workspace, id: scope.id });
  if (!packet) {
    console.error(scope.id ? `No handoff packet found for id: ${scope.id}` : "No handoff packet found to receive.");
    return 1;
  }

  const readiness = buildReadyReport(packet);
  const mode = args.includes("--brief") ? "brief" : "full";
  const prompt = mode === "brief" ? renderBriefPrompt(packet) : renderHandoffPrompt(packet);
  if (!readiness.ready) {
    const payload = {
      ok: false,
      received: false,
      mode,
      packet: packetWithNextSteps(packet),
      readiness,
      prompt: null,
    };
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      printReceiveBlocked(readiness);
    }
    return 1;
  }

  const payload = {
    ok: true,
    received: true,
    mode,
    packet: packetWithNextSteps(packet),
    readiness,
    prompt,
    next_ack: `acb ack ${packet.id} --by <agent>`,
  };
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }
  if (args.includes("--no-copy") || args.includes("--print-prompt")) {
    process.stdout.write(prompt);
    return 0;
  }

  const copied = copyToClipboard(prompt);
  if (copied.ok) {
    console.log(`[acb] ${mode === "brief" ? "brief" : "receive prompt"} copied to clipboard.`);
    console.log("[acb] paste it into the receiving agent.");
    console.log(`[acb] after the receiving agent summarizes the packet, record receipt with: acb ack ${packet.id} --by <agent>`);
    return 0;
  }

  console.error(`[acb] clipboard unavailable: ${copied.error}`);
  console.error("[acb] printing receive prompt instead:\n");
  process.stdout.write(prompt);
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

function receiveOutputModes(args) {
  return ["--no-copy", "--print-prompt", "--json"].filter((flag) => args.includes(flag));
}

function resolveReceiveScope(args) {
  const positional = positionalArgs(args, new Set(["--workspace", "--id"]));
  const positionalId = positional.find(Boolean) || null;
  const flagId = argValue(args, "--id") || null;
  const wantsLatest = args.includes("--latest");
  const id = flagId || positionalId;
  if (flagId && positionalId) return { ok: false, error: "Use either a packet id or --id, not both." };
  if (id && wantsLatest) return { ok: false, error: "Use either a packet id or --latest, not both." };
  const workspace = id ? null : normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  return { ok: true, id, workspace };
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
    console.log(`  next_receive: ${item.next_receive}`);
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

function safetyCommand(args) {
  const id = positionalArgs(args, new Set(["--workspace"])).find(Boolean);
  const workspace = id
    ? null
    : normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const packet = findPacket({ id, workspace });
  if (!packet) {
    console.error(id ? `No handoff packet found for id: ${id}` : `No handoff packet found for workspace: ${workspace}`);
    return 1;
  }

  const report = buildSafetyReport(packet, { workspace });
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  printSafetyReport(report);
  return report.safety.level === "ok" ? 0 : 1;
}

function freshnessCommand(args) {
  const id = positionalArgs(args, new Set(["--workspace"])).find(Boolean);
  const workspace = id
    ? null
    : normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const packet = findPacket({ id, workspace });
  if (!packet) {
    console.error(id ? `No handoff packet found for id: ${id}` : `No handoff packet found for workspace: ${workspace}`);
    return 1;
  }

  const report = buildFreshnessReport(packet);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  printFreshnessReport(report);
  return 0;
}

function readyCommand(args) {
  const id = positionalArgs(args, new Set(["--workspace"])).find(Boolean);
  const workspace = id
    ? null
    : normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const packet = findPacket({ id, workspace });
  if (!packet) {
    console.error(id ? `No handoff packet found for id: ${id}` : `No handoff packet found for workspace: ${workspace}`);
    return 1;
  }

  const report = buildReadyReport(packet);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  printReadyReport(report);
  return report.ready ? 0 : 1;
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
  const lang = resolveLanguage(args);
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

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${host}`);
    if (request.method === "POST" && url.pathname === "/api/copy-prompt") {
      await handleDashboardCopyPrompt(request, response, { workspace });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/create-demo") {
      await handleDashboardCreateDemo(request, response, { workspace });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/verify-workflow") {
      await handleDashboardVerifyWorkflow(request, response, { workspace });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/ack") {
      await handleDashboardAck(request, response, { workspace });
      return;
    }
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
      const pageLang = normalizeLanguage(url.searchParams.get("lang") || lang);
      sendDashboardResponse(response, 200, "text/html; charset=utf-8", renderDashboardHtml(state, { lang: pageLang }));
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
      console.log(isChinese(lang)
        ? "[acb] 仅启用显式本地控制；按 Ctrl+C 停止。"
        : "[acb] explicit local controls only; press Ctrl+C to stop.");
      if (args.includes("--open")) {
        const opened = openFile(url);
        if (!opened.ok) console.error(`[acb] cannot open dashboard: ${opened.error}`);
      }
    });
  });
}

async function handleDashboardCopyPrompt(request, response, { workspace = null } = {}) {
  let payload;
  try {
    payload = await readJsonRequestBody(request, 4096);
  } catch (error) {
    sendDashboardJson(response, 400, { ok: false, error: error.message });
    return;
  }

  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const mode = ["brief", "full", "mcp"].includes(payload.mode) ? payload.mode : "brief";
  const dryRun = payload.dry_run === true;
  if (!id) {
    sendDashboardJson(response, 400, { ok: false, error: "id is required" });
    return;
  }

  const packet = findPacket({ id });
  if (!packet || (workspace && packet.workspace !== workspace)) {
    sendDashboardJson(response, 404, { ok: false, error: `No handoff packet found for id: ${id}` });
    return;
  }

  const targetId = typeof payload.target_id === "string" ? payload.target_id.trim() : "";
  const target = findDashboardTarget(targetId) || null;
  const prompt = mode === "full"
    ? renderHandoffPrompt(packet)
    : mode === "mcp"
      ? renderMcpTakeoverInstruction(packet, target)
      : renderBriefPrompt(packet);
  const label = dashboardCopyPromptLabel(mode, target);
  if (dryRun) {
    sendDashboardJson(response, 200, {
      ok: true,
      id: packet.id,
      mode,
      target: target?.id || null,
      copied: false,
      prompt_chars: prompt.length,
      message: `${label} is ready.`,
    });
    return;
  }

  const copied = copyToClipboard(prompt);
  if (!copied.ok) {
    sendDashboardJson(response, 500, {
      ok: false,
      id: packet.id,
      mode,
      target: target?.id || null,
      copied: false,
      error: copied.error,
      fallback_prompt: prompt,
    });
    return;
  }

  sendDashboardJson(response, 200, {
    ok: true,
    id: packet.id,
    mode,
    target: target?.id || null,
    copied: true,
    prompt_chars: prompt.length,
    message: `${label} copied to clipboard.`,
  });
}

async function handleDashboardAck(request, response, { workspace = null } = {}) {
  let payload;
  try {
    payload = await readJsonRequestBody(request, 4096);
  } catch (error) {
    sendDashboardJson(response, 400, { ok: false, error: error.message });
    return;
  }

  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) {
    sendDashboardJson(response, 400, { ok: false, error: "id is required" });
    return;
  }

  const packet = findPacket({ id });
  if (!packet || (workspace && packet.workspace !== workspace)) {
    sendDashboardJson(response, 404, { ok: false, error: `No handoff packet found for id: ${id}` });
    return;
  }

  const acknowledgement = createAcknowledgement({
    by: typeof payload.by === "string" && payload.by.trim() ? payload.by : "dashboard",
    note: typeof payload.note === "string" && payload.note.trim() ? payload.note : null,
  });
  const updated = {
    ...packet,
    acknowledgements: [...packetAcknowledgements(packet), acknowledgement],
    updated_at: new Date().toISOString(),
  };
  replacePacket(updated);
  sendDashboardJson(response, 200, {
    ok: true,
    id: updated.id,
    acknowledgement,
    packet: dashboardPacketSummary(updated),
    message: "Acknowledgement recorded.",
  });
}

async function handleDashboardCreateDemo(request, response, { workspace = null } = {}) {
  let payload;
  try {
    payload = await readJsonRequestBody(request, 4096);
  } catch (error) {
    sendDashboardJson(response, 400, { ok: false, error: error.message });
    return;
  }

  const lang = normalizeLanguage(payload.lang || "en");
  const from = typeof payload.from === "string" && payload.from.trim() ? payload.from.trim() : "acb-demo";
  const requestedWorkspace = typeof payload.workspace === "string" && payload.workspace.trim()
    ? normalizeWorkspace(payload.workspace)
    : null;
  if (workspace && requestedWorkspace && requestedWorkspace !== workspace) {
    sendDashboardJson(response, 403, { ok: false, error: "workspace is outside this dashboard scope" });
    return;
  }

  const targetWorkspace = workspace || requestedWorkspace || normalizeWorkspace(process.cwd());
  const packet = createDemoPacket({ workspace: targetWorkspace, from, lang });
  const dryRun = payload.dry_run === true;
  if (!dryRun) {
    const store = loadStore();
    store.packets.unshift(packet);
    writeStore(store);
  }

  sendDashboardJson(response, 200, {
    ok: true,
    created: !dryRun,
    packet: dashboardPacketSummary(packet),
    message: isChinese(lang) ? "示例上下文包已创建。" : "Demo packet created.",
  });
}

async function handleDashboardVerifyWorkflow(request, response, { workspace = null } = {}) {
  let payload;
  try {
    payload = await readJsonRequestBody(request, 4096);
  } catch (error) {
    sendDashboardJson(response, 400, { ok: false, error: error.message });
    return;
  }

  const detectedTargets = detectDashboardTargets(workspace);
  const fallbackTarget = recommendDashboardTarget(detectedTargets);
  const requestedTarget = typeof payload.target_id === "string" ? payload.target_id.trim() : "";
  const targetId = requestedTarget && requestedTarget !== "auto" ? requestedTarget : fallbackTarget.id;
  const recipe = findRecipe(targetId);
  if (!recipe) {
    sendDashboardJson(response, 400, { ok: false, error: `Unknown workflow target: ${targetId || requestedTarget}` });
    return;
  }

  const requestedWorkspace = typeof payload.workspace === "string" && payload.workspace.trim()
    ? payload.workspace.trim()
    : workspace || process.cwd();
  const verifyWorkspace = normalizeWorkspace(requestedWorkspace);
  const report = buildWorkflowVerifyReport(recipe, verifyWorkspace, { keepArtifacts: false });
  sendDashboardJson(response, report.ok ? 200 : 500, {
    ok: report.ok,
    target: recipe.id,
    title: recipe.title,
    workspace: verifyWorkspace,
    report,
    message: report.ok
      ? `ACB-side workflow check passed for ${recipe.title}.`
      : `ACB-side workflow check failed for ${recipe.title}.`,
  });
}

function dashboardCopyPromptLabel(mode, target = null) {
  const suffix = target && target.id !== "auto" ? ` for ${target.title}` : "";
  if (mode === "full") return `Full takeover prompt${suffix}`;
  if (mode === "mcp") return `MCP pull instruction${suffix}`;
  return `Brief takeover prompt${suffix}`;
}

function readJsonRequestBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function sendDashboardJson(response, status, payload) {
  sendDashboardResponse(response, status, "application/json; charset=utf-8", `${JSON.stringify(payload, null, 2)}\n`);
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
  const targets = detectDashboardTargets(workspace);
  const recommendedTarget = recommendDashboardTarget(targets);
  const targetGuides = buildDashboardTargetGuides(workspace);
  return {
    version: VERSION,
    generated_at: new Date().toISOString(),
    scope: workspace ? "workspace" : "all",
    workspace,
    store_path: storePath(),
    store_schema: "acb.store.v1",
    store_supported_version: STORE_VERSION,
    limit,
    total_packets: scopedPackets.length,
    shown_packets: packets.length,
    workspace_count: new Set(scopedPackets.map((packet) => packet.workspace)).size,
    dirty_file_count: packets.reduce((sum, packet) => sum + (packet.git?.status?.length || 0), 0),
    body_chars: packets.reduce((sum, packet) => sum + (packet.body?.length || 0), 0),
    safety_warning_count: packets.reduce((sum, packet) => sum + packetSafety(packet).warnings.length, 0),
    acknowledged_packet_count: packets.filter((packet) => packetAcknowledgementSummary(packet).acknowledged).length,
    changed_packet_count: packets.filter((packet) => packetFreshnessSummary(packet).status === "changed").length,
    ready_packet_count: packets.filter((packet) => packetReadinessSummary(packet).ready).length,
    latest_packet: packets[0] ? dashboardPacketSummary(packets[0]) : null,
    packets: packets.map(dashboardPacketSummary),
    workspaces,
    targets,
    target_guides: targetGuides,
    recommended_target_id: recommendedTarget.id,
  };
}

function buildDashboardOnboarding(workspace = null, lang = "en") {
  const langArgs = isChinese(lang) ? ["--lang", "zh-CN"] : [];
  const workspaceArgs = workspace ? ["--workspace", workspace] : ["--workspace", "."];
  return {
    demo_command: formatCommand("acb", ["demo", ...workspaceArgs, ...langArgs]),
    handoff_command: formatCommand("acb", ["handoff", "--from", "codex", "--summary", "Ready for next agent", "--git"]),
    setup_command: formatCommand("acb", ["setup", ...workspaceArgs, "--check", ...langArgs]),
    dashboard_command: formatCommand("acb", ["dashboard", ...workspaceArgs, ...langArgs]),
  };
}

function dashboardPacketSummary(packet) {
  const readiness = evaluatePacketReadiness(packet);
  return {
    ...packetSummary(packet),
    ready_checks: readiness.checks,
    ready_blockers: readiness.blockers,
    ready_warnings: readiness.warnings,
    notes: packet.notes || [],
    acknowledgements: packetAcknowledgements(packet),
    body_preview: packet.body ? truncateText(packet.body, 2600) : "",
    git: packet.git ? {
      branch: packet.git.branch || null,
      head: packet.git.head || null,
      status: packet.git.status || [],
    } : null,
  };
}

function dashboardLabels(lang) {
  if (isChinese(lang)) {
    return {
      htmlLang: "zh-CN",
      title: "ACB 控制台",
      allWorkspaces: "所有工作区",
      tagline: "选择上下文包，复制上下文，粘贴给下一个 Agent",
      refresh: "刷新",
      packetsShown: "当前显示",
      totalPackets: "全部上下文包",
      workspaces: "工作区",
      dirtyFilesCaptured: "已记录改动文件",
      bodyCharsShown: "正文字符",
      safetyWarnings: "安全提示",
      acknowledgedPackets: "已确认交接",
      changedPackets: "已变化上下文",
      readyPackets: "可交接上下文",
      packets: "上下文包",
      searchPlaceholder: "搜索 summary、status、tags、notes",
      targetClient: "目标客户端",
      workspace: "工作区",
      workspaceHistory: "工作区历史",
      rawState: "原始状态",
      readOnly: "只读",
      copied: "已复制",
      copyFailed: "复制失败",
      copying: "复制中...",
      promptCopied: "提示词已复制",
      acknowledged: "已确认",
      unacknowledged: "待确认",
      fresh: "新鲜",
      changed: "已变化",
      unknownFreshness: "未知新鲜度",
      freshness: "新鲜度",
      ready: "可交接",
      notReady: "需处理",
      readiness: "交接状态",
      checks: "检查项",
      blockers: "阻塞项",
      warnings: "提示",
      noBlockers: "没有阻塞项。",
      noReadinessWarnings: "没有额外提示。",
      checkStatus: { ok: "通过", warn: "提示", fail: "未通过" },
      readyCheckNames: {
        freshness: "新鲜度",
        safety: "安全",
        context: "上下文",
        acknowledgement: "接收确认",
      },
      readyIssueDetails: {
        freshness_changed: "交接前需要刷新 handoff。",
        freshness_unknown: "请用 --git 保存或刷新 packet 后再交接。",
        safety_review: "复制给另一个 Agent 前需要先检查安全提示。",
        empty_context: "这个 packet 缺少可用上下文，请先补充 handoff 内容。",
        summary_only: "如果下一个 Agent 需要更多细节，建议刷新并加入正文或 notes。",
        body_truncated: "如果接收方需要完整正文，建议使用完整 packet 或 MCP 读取。",
        pending_ack: "接收方读完 packet 后，建议运行 acb ack 记录确认。",
      },
      markReceived: "标记已接收",
      acknowledging: "确认中...",
      ackRecorded: "已记录接收确认",
      ackFailed: "确认失败",
      shown: "个结果",
      noPacketMatch: "没有匹配的上下文包。",
      noPacketAvailable: "还没有可用的 handoff packet。",
      noPacketSelected: "未选择 handoff packet。",
      emptyTitle: "还没有上下文包",
      emptyBody: "先创建一条示例 packet，或保存真实工作上下文，然后刷新 dashboard。",
      createDemo: "复制 demo 命令",
      createDemoPacket: "创建 demo packet",
      creatingDemo: "正在创建...",
      demoCreated: "示例上下文包已创建",
      demoCreateFailed: "创建 demo 失败",
      saveRealHandoff: "保存真实 handoff",
      runSetup: "检查客户端接入",
      safetyTitle: "本地显式控制",
      safetyBody: "Dashboard 只会在你点击时复制文本、创建本地 demo packet、记录接收确认，或运行 ACB 侧检查；不会修改第三方客户端配置。",
      noTargets: "没有配置目标客户端。",
      noSetupGuide: "选择一个具体目标客户端后，会显示接入命令和验证。",
      clientSetup: "客户端接入",
      flowTitle: "第一次交接流程",
      flowBody: "按这 4 步完成一次可审计、可复制的本地 Agent handoff。",
      stepTitles: {
        "save-context": "保存上下文",
        "review-safety": "检查安全",
        "verify-workflow": "验证流程",
        handoff: "复制交接",
      },
      runCheck: "运行 ACB 侧检查",
      recipe: "Recipe",
      mcpConfig: "MCP 配置",
      mcpVerify: "MCP 验证",
      workflowCheck: "Workflow 检查",
      prompt: "提示词",
      copy: "复制",
      copyRecipe: "复制 Recipe",
      copyMcpConfig: "复制 MCP 配置",
      copyMcpVerify: "复制 MCP 验证",
      copyWorkflowCheck: "复制 Workflow 检查",
      copyPrompt: "复制提示词",
      nextHandoff: "下一步交接",
      inspectPacket: "查看上下文包",
      dirtyFiles: "个改动文件",
      cleanGitSnapshot: "Git 快照干净",
      clean: "干净",
      dirty: "改动",
      unknown: "未知",
      target: "目标",
      recommended: "推荐",
      high: "高匹配",
      detected: "已检测",
      available: "可选",
      bestFit: "最佳匹配",
      startHere: "从这里开始",
      safety: "安全",
      noSafetyWarnings: "没有明显安全提示。",
      safetyReview: "复制给下一个 Agent 前请检查这些提示。",
      moveContextInto: "把这个上下文交给",
      chooseTarget: "在右侧选择目标，然后复制推荐的接管文本。",
      recommendedPath: "推荐路径",
      optionalSetup: "可选接入命令",
      copyMcpInstruction: "复制 MCP 拉取指令",
      copyFullPrompt: "复制完整提示词",
      copyBriefPrompt: "复制简短提示词",
      forTarget: "给",
      fields: {
        from: "来源",
        workspace: "工作区",
        created: "创建时间",
        updated: "更新时间",
        status: "状态",
        reason: "原因",
        checked: "检查时间",
        acknowledged: "接收确认",
        ackCount: "确认次数",
        freshness: "新鲜度",
        bodyChars: "正文字符",
        branch: "分支",
        head: "HEAD",
      },
      tabs: { overview: "概览", commands: "命令", ack: "确认", readiness: "交接状态", freshness: "新鲜度", safety: "安全", body: "正文", git: "Git" },
      noBody: "这个上下文包没有正文预览。",
      noGit: "没有记录 Git 快照。",
      noDirtyFiles: "没有记录改动文件。",
      noNotes: "没有 notes。",
      noTags: "没有 tags。",
      tags: "标签",
      notes: "备注",
      noWorkspaces: "还没有工作区",
      checking: "检查中...",
      runningCheck: "正在运行 ACB 侧 workflow 检查...",
      checkPassed: "Workflow 检查通过",
      checkFailed: "Workflow 检查失败",
      checkPassedFor: "ACB 侧 workflow 检查通过：",
      checkFailedText: "Workflow 检查失败",
      lang: "zh-CN",
    };
  }
  return {
    htmlLang: "en",
    title: "ACB Dashboard",
    allWorkspaces: "All workspaces",
    tagline: "select a packet, copy context, paste into the next agent",
    refresh: "Refresh",
    packetsShown: "packets shown",
    totalPackets: "total packets",
    workspaces: "workspaces",
    dirtyFilesCaptured: "dirty files captured",
    bodyCharsShown: "body chars shown",
    safetyWarnings: "safety warnings",
    acknowledgedPackets: "acknowledged",
    changedPackets: "changed packets",
    readyPackets: "ready packets",
    packets: "Packets",
    searchPlaceholder: "Search summary, status, tags, notes",
    targetClient: "Target Client",
    workspace: "Workspace",
    workspaceHistory: "Workspace History",
    rawState: "Raw State",
    readOnly: "read-only",
    copied: "Copied",
    copyFailed: "Copy failed",
    copying: "Copying...",
    promptCopied: "Prompt copied",
    acknowledged: "acknowledged",
    unacknowledged: "pending ack",
    fresh: "fresh",
    changed: "changed",
    unknownFreshness: "freshness unknown",
    freshness: "freshness",
    ready: "ready",
    notReady: "not ready",
      readiness: "readiness",
      checks: "checks",
    blockers: "blockers",
    warnings: "warnings",
    noBlockers: "No blockers.",
    noReadinessWarnings: "No extra warnings.",
    checkStatus: { ok: "ok", warn: "warn", fail: "fail" },
    readyCheckNames: {
      freshness: "freshness",
      safety: "safety",
      context: "context",
      acknowledgement: "acknowledgement",
    },
    readyIssueDetails: {
      freshness_changed: "Refresh the handoff before passing it to another agent.",
      freshness_unknown: "Save the packet with --git or refresh it before handoff.",
      safety_review: "Review safety warnings before copying this packet to another agent.",
      empty_context: "Add useful handoff context before using this packet.",
      summary_only: "Consider refreshing with a body or notes if the next agent needs more detail.",
      body_truncated: "Use full packet reads or MCP if the receiver needs the complete body.",
      pending_ack: "Ask the receiving agent to run acb ack after it reads the packet.",
    },
    markReceived: "Mark Received",
    acknowledging: "Acknowledging...",
    ackRecorded: "Acknowledgement recorded",
    ackFailed: "Acknowledgement failed",
    shown: "shown",
    noPacketMatch: "No packets match this filter.",
    noPacketAvailable: "No handoff packet available yet.",
    noPacketSelected: "No handoff packet selected.",
    emptyTitle: "No handoff packets yet",
    emptyBody: "Create a demo packet or save real workspace context, then refresh the dashboard.",
    createDemo: "Copy demo command",
    createDemoPacket: "Create demo packet",
    creatingDemo: "Creating...",
    demoCreated: "Demo packet created",
    demoCreateFailed: "Demo creation failed",
    saveRealHandoff: "Save real handoff",
    runSetup: "Check client setup",
    safetyTitle: "Explicit local controls",
    safetyBody: "The dashboard only copies text, creates a local demo packet, records acknowledgement, or runs ACB-side checks when you click. It does not modify third-party client configuration.",
    noTargets: "No targets configured.",
    noSetupGuide: "Select a concrete target client to see setup commands and verification.",
    clientSetup: "Client setup",
    flowTitle: "First handoff flow",
    flowBody: "Follow these 4 steps for an auditable local agent handoff.",
    stepTitles: {
      "save-context": "Save",
      "review-safety": "Safety",
      "verify-workflow": "Verify",
      handoff: "Copy",
    },
    runCheck: "Run ACB-side Check",
    recipe: "Recipe",
    mcpConfig: "MCP config",
    mcpVerify: "MCP verify",
    workflowCheck: "Workflow check",
    prompt: "Prompt",
    copy: "Copy",
    copyRecipe: "Copy Recipe",
    copyMcpConfig: "Copy MCP config",
    copyMcpVerify: "Copy MCP verify",
    copyWorkflowCheck: "Copy Workflow check",
    copyPrompt: "Copy Prompt",
    nextHandoff: "Next handoff",
    inspectPacket: "Inspect packet",
    dirtyFiles: "dirty files",
    cleanGitSnapshot: "clean git snapshot",
    clean: "clean",
    dirty: "dirty",
    unknown: "unknown",
    target: "target",
    recommended: "recommended",
    high: "high",
    detected: "detected",
    available: "available",
    bestFit: "Best Fit",
    startHere: "Start here",
    safety: "safety",
    noSafetyWarnings: "No obvious safety warnings.",
    safetyReview: "Review these hints before copying context into another agent.",
    moveContextInto: "Move this context into",
    chooseTarget: "Choose a target on the right, then copy the recommended takeover text.",
    recommendedPath: "Recommended path",
    optionalSetup: "Optional setup commands",
    copyMcpInstruction: "Copy MCP Pull Instruction",
    copyFullPrompt: "Copy Full Prompt",
    copyBriefPrompt: "Copy Brief Prompt",
    forTarget: "for",
    fields: {
      from: "from",
      workspace: "workspace",
      created: "created",
      updated: "updated",
      status: "status",
      reason: "reason",
      checked: "checked",
      acknowledged: "acknowledged",
      ackCount: "ack count",
      freshness: "freshness",
      bodyChars: "body chars",
      branch: "branch",
      head: "head",
    },
    tabs: { overview: "overview", commands: "commands", ack: "ack", readiness: "readiness", freshness: "freshness", safety: "safety", body: "body", git: "git" },
    noBody: "No body preview captured for this packet.",
    noGit: "No Git snapshot captured.",
    noDirtyFiles: "No dirty files captured.",
    noNotes: "No notes.",
    noTags: "No tags.",
    tags: "Tags",
    notes: "Notes",
    noWorkspaces: "No workspaces yet",
    checking: "Checking...",
    runningCheck: "Running ACB-side workflow check...",
    checkPassed: "Workflow check passed",
    checkFailed: "Workflow check failed",
    checkPassedFor: "ACB-side workflow check passed for",
    checkFailedText: "Workflow check failed",
    lang: "en",
  };
}

function renderDashboardHtml(state, { lang = "en" } = {}) {
  const labels = dashboardLabels(lang);
  const renderState = {
    ...state,
    onboarding: buildDashboardOnboarding(state.workspace, labels.lang),
  };
  const stateJson = escapeScriptJson(JSON.stringify(renderState));
  const labelsJson = escapeScriptJson(JSON.stringify(labels));

  return `<!doctype html>
<html lang="${escapeHtml(labels.htmlLang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(labels.title)}</title>
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
      --focus: #ddf4ff;
      --selected: #fff8c5;
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
    .shell { max-width: 1440px; margin: 0 auto; padding: 18px; }
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
    .next-handoff {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      border: 1px solid rgba(10, 126, 164, 0.28);
      background: var(--focus);
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 12px;
      box-shadow: var(--shadow);
    }
    .next-title { font-size: 18px; font-weight: 750; line-height: 1.25; overflow-wrap: anywhere; }
    .next-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .next-actions {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      min-width: 260px;
    }
    .next-actions .primary { min-height: 42px; font-weight: 700; }
    .handoff-flow {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 12px;
      margin-bottom: 12px;
    }
    .flow-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 10px;
      margin-bottom: 10px;
    }
    .flow-steps {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .flow-step {
      border: 1px solid var(--line);
      background: var(--soft);
      border-radius: 8px;
      padding: 9px;
      min-width: 0;
    }
    .flow-step strong { display: block; font-size: 13px; overflow-wrap: anywhere; }
    .flow-step p { font-size: 12px; margin: 3px 0 8px; }
    .flow-step .btn { width: 100%; }
    .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .stat, .panel, .empty {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .stat {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 7px 10px;
      box-shadow: none;
    }
    .panel, .empty { padding: 14px; }
    .stat strong { display: inline; font-size: 15px; line-height: 1.2; }
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
    .badge.accent { color: var(--accent-strong); border-color: rgba(10, 126, 164, 0.25); background: rgba(10, 126, 164, 0.08); }
    .target-list { display: grid; gap: 6px; margin-bottom: 14px; }
    .target-card {
      width: 100%;
      text-align: left;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 8px 10px;
      color: var(--text);
    }
    .target-card.active { border-color: var(--accent); background: var(--selected); box-shadow: inset 3px 0 0 var(--accent); }
    .target-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .target-title { font-weight: 700; }
    .target-description { color: var(--muted); font-size: 12px; margin-top: 4px; }
    .target-card:not(.active) .target-description,
    .target-card:not(.active) .badge-row { display: none; }
    .setup-guide {
      border-bottom: 1px solid var(--line);
      padding-bottom: 14px;
      margin-bottom: 14px;
    }
    .setup-guide h3 { margin-bottom: 6px; }
    .setup-guide p { font-size: 13px; }
    .safety-note {
      border: 1px solid rgba(10, 126, 164, 0.24);
      background: var(--focus);
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 14px;
    }
    .safety-note h3 { margin-bottom: 4px; }
    .safety-note p { font-size: 13px; }
    .setup-actions {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      margin: 10px 0;
    }
    .setup-steps { display: grid; gap: 8px; margin: 8px 0 12px; }
    .setup-step {
      border: 1px solid var(--line);
      background: #fbfcfd;
      border-radius: 8px;
      padding: 8px;
      display: grid;
      gap: 7px;
    }
    .setup-step p { margin-top: 2px; font-size: 12px; }
    .setup-note-list { margin-top: 8px; }
    .setup-note-list li { display: block; font-size: 12px; color: var(--muted); padding: 6px 0; }
    .verify-result {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--code);
      padding: 10px;
      margin-top: 10px;
      font-size: 12px;
      white-space: pre-wrap;
    }
    .verify-result.ok { border-color: rgba(26, 127, 55, 0.25); background: rgba(26, 127, 55, 0.08); }
    .verify-result.fail { border-color: rgba(207, 34, 46, 0.25); background: rgba(207, 34, 46, 0.08); }
    .detail-title { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .detail-title h2 { font-size: 22px; overflow-wrap: anywhere; }
    .takeover {
      display: grid;
      gap: 12px;
      align-items: center;
      border: 1px solid rgba(10, 126, 164, 0.28);
      background: var(--focus);
      border-radius: 8px;
      padding: 12px;
      margin: 12px 0;
    }
    .takeover h3 { margin: 2px 0 4px; font-size: 17px; }
    .takeover-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      align-items: stretch;
    }
    .takeover-actions .btn { min-height: 40px; }
    .takeover-actions .wide { grid-column: 1 / -1; }
    .kicker {
      color: var(--accent-strong);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
    }
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
      grid-template-columns: minmax(0, 1fr) auto auto;
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
    .workspace-path {
      display: block;
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
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
      .next-handoff { grid-template-columns: 1fr; }
      .flow-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .next-actions { min-width: 0; }
    }
    @media (max-width: 760px) {
      .shell { padding: 14px; }
      .topbar { grid-template-columns: 1fr; }
      .toolbar { justify-content: flex-start; }
      .grid { grid-template-columns: 1fr; }
      .command { grid-template-columns: 1fr; }
      .packet-list { max-height: none; }
      .kv { grid-template-columns: 1fr; }
      .flow-steps { grid-template-columns: 1fr; }
      .takeover-actions { grid-template-columns: 1fr; }
      .takeover-actions .wide { grid-column: auto; }
    }
  </style>
</head>
<body>
  <script id="acb-state" type="application/json">${stateJson}</script>
  <script id="acb-labels" type="application/json">${labelsJson}</script>
  <main class="shell">
    <header class="topbar">
      <div>
        <h1>${escapeHtml(labels.title)}</h1>
        <p>${escapeHtml(state.workspace || labels.allWorkspaces)} · ${escapeHtml(labels.tagline)}</p>
      </div>
      <div class="toolbar">
        <button class="btn" id="refresh">${escapeHtml(labels.refresh)}</button>
        <button class="btn" id="toggle-json">JSON</button>
        <a class="btn primary" href="/api/state">/api/state</a>
      </div>
    </header>
    <section id="next-handoff"></section>
    <section id="handoff-flow"></section>
    <section class="stats" aria-label="summary">
      <div class="stat"><strong>${state.shown_packets}</strong><span>${escapeHtml(labels.packetsShown)}</span></div>
      <div class="stat"><strong>${state.total_packets}</strong><span>${escapeHtml(labels.totalPackets)}</span></div>
      <div class="stat"><strong>${state.workspace_count}</strong><span>${escapeHtml(labels.workspaces)}</span></div>
      <div class="stat"><strong>${state.dirty_file_count}</strong><span>${escapeHtml(labels.dirtyFilesCaptured)}</span></div>
      <div class="stat"><strong>${state.body_chars}</strong><span>${escapeHtml(labels.bodyCharsShown)}</span></div>
      <div class="stat"><strong>${state.safety_warning_count}</strong><span>${escapeHtml(labels.safetyWarnings)}</span></div>
      <div class="stat"><strong>${state.acknowledged_packet_count}</strong><span>${escapeHtml(labels.acknowledgedPackets)}</span></div>
      <div class="stat"><strong>${state.changed_packet_count}</strong><span>${escapeHtml(labels.changedPackets)}</span></div>
      <div class="stat"><strong>${state.ready_packet_count}</strong><span>${escapeHtml(labels.readyPackets)}</span></div>
    </section>
    <section class="grid">
      <aside class="panel">
        <div class="panel-header">
          <h2>${escapeHtml(labels.packets)}</h2>
          <span class="small" id="packet-count"></span>
        </div>
        <input class="search" id="search" type="search" placeholder="${escapeHtml(labels.searchPlaceholder)}">
        <div class="packet-list" id="packet-list"></div>
      </aside>
      <section class="panel" id="detail"></section>
      <aside class="panel side">
        <section class="safety-note" aria-label="dashboard safety boundary">
          <h3>${escapeHtml(labels.safetyTitle)}</h3>
          <p>${escapeHtml(labels.safetyBody)}</p>
        </section>
        <div class="panel-header">
          <h2>${escapeHtml(labels.targetClient)}</h2>
          <span class="small" id="target-count"></span>
        </div>
        <div id="setup-guide"></div>
        <div class="target-list" id="target-list"></div>
        <div class="panel-header">
          <h2>${escapeHtml(labels.workspace)}</h2>
          <span class="small">v${escapeHtml(state.version)}</span>
        </div>
        <div class="kv">
          <div>scope</div><div>${escapeHtml(state.scope)}</div>
          <div>generated</div><div>${escapeHtml(state.generated_at)}</div>
          <div>store</div><div>${escapeHtml(state.store_path)}</div>
          <div>limit</div><div>${escapeHtml(String(state.limit))}</div>
        </div>
        <h3>${escapeHtml(labels.workspaceHistory)}</h3>
        <ul id="workspace-list"></ul>
      </aside>
    </section>
    <section class="panel hidden" id="json-panel" style="margin-top: 14px;">
      <div class="panel-header"><h2>${escapeHtml(labels.rawState)}</h2><span class="small">${escapeHtml(labels.readOnly)}</span></div>
      <pre id="raw-json"></pre>
    </section>
  </main>
  <div class="toast" id="toast">${escapeHtml(labels.copied)}</div>
  <script>
    const state = JSON.parse(document.getElementById("acb-state").textContent);
    const labels = JSON.parse(document.getElementById("acb-labels").textContent);
    let selectedId = state.latest_packet ? state.latest_packet.id : null;
    let selectedTargetId = state.recommended_target_id || (state.targets || [])[0]?.id || "auto";
    let activeTab = "overview";

    const el = (id) => document.getElementById(id);
    const fmt = (value) => value == null || value === "" ? "—" : String(value);
    const shellArg = (value) => {
      const text = String(value || ".");
      return /^[A-Za-z0-9_@%+=:,./-]+$/.test(text) ? text : JSON.stringify(text);
    };
    const langFlag = () => labels.lang === "zh-CN" ? " --lang zh-CN" : "";
    const workspaceArg = () => shellArg(state.workspace || ".");
    const escape = (value) => String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
    const packetTitle = (packet) => packet.summary || packet.status || packet.id;

    function render() {
      renderPackets();
      renderNextHandoff();
      renderHandoffFlow();
      renderDetail();
      renderTargets();
      renderSetupGuide();
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
      el("packet-count").textContent = packets.length + " " + labels.shown;
      if (!packets.length) {
        el("packet-list").innerHTML = '<div class="empty">' + escape(labels.noPacketMatch) + '</div>';
        return;
      }
      if (!packets.some((packet) => packet.id === selectedId)) selectedId = packets[0].id;
      el("packet-list").innerHTML = packets.map((packet) => {
        const tags = (packet.tags || []).slice(0, 3).map((tag) => '<span class="badge">' + escape(tag) + '</span>').join("");
        const dirty = packet.git_dirty_files ? '<span class="badge warn">' + packet.git_dirty_files + ' ' + escape(labels.dirty) + '</span>' : '<span class="badge good">' + escape(labels.clean) + '</span>';
        const safety = packet.safety && packet.safety.warnings && packet.safety.warnings.length
          ? '<span class="badge warn">' + packet.safety.warnings.length + ' ' + escape(labels.safety) + '</span>'
          : '<span class="badge good">' + escape(labels.safety) + '</span>';
        const ack = packet.acknowledged
          ? '<span class="badge good">' + escape(labels.acknowledged) + '</span>'
          : '<span class="badge warn">' + escape(labels.unacknowledged) + '</span>';
        const freshness = freshnessBadge(packet);
        const readiness = readinessBadge(packet);
        return '<button class="packet-row ' + (packet.id === selectedId ? 'active' : '') + '" data-id="' + escape(packet.id) + '">' +
          '<div class="packet-title">' + escape(packetTitle(packet)) + '</div>' +
          '<div class="packet-sub">' + escape(packet.from) + ' · ' + escape(packet.created_at) + '</div>' +
          '<div class="badge-row">' + readiness + dirty + safety + ack + freshness + tags + '</div>' +
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

    function selectedTarget() {
      return (state.targets || []).find((target) => target.id === selectedTargetId) || (state.targets || [])[0] || { id: "auto", title: labels.bestFit, copy_mode: "brief" };
    }

    function copyModeForTarget(target) {
      return target && target.copy_mode ? target.copy_mode : "brief";
    }

    function targetCopyLabel(mode, target) {
      const name = target && target.id !== "auto" ? " " + labels.forTarget + " " + target.title : "";
      if (mode === "mcp") return labels.copyMcpInstruction + name;
      if (mode === "full") return labels.copyFullPrompt + name;
      return labels.copyBriefPrompt + name;
    }

    function selectedPacket() {
      return state.packets.find((item) => item.id === selectedId) || state.packets[0] || null;
    }

    function freshnessBadge(packet) {
      const status = packet.freshness ? packet.freshness.status : "unknown";
      if (status === "fresh") return '<span class="badge good">' + escape(labels.fresh) + '</span>';
      if (status === "changed") return '<span class="badge warn">' + escape(labels.changed) + '</span>';
      return '<span class="badge">' + escape(labels.unknownFreshness) + '</span>';
    }

    function readinessBadge(packet) {
      const readiness = packet.readiness || { ready: false, status: "unknown" };
      const label = readiness.ready ? labels.ready : labels.notReady;
      return '<span class="badge ' + (readiness.ready ? 'good' : 'warn') + '">' + escape(label) + '</span>';
    }

    function targetStatusLabel(target) {
      if (!target) return labels.target;
      if (target.id === state.recommended_target_id) return labels.recommended;
      return labels[target.confidence] || target.confidence || labels.available;
    }

    function setupGuideTarget() {
      const target = selectedTarget();
      if (target.id !== "auto") return target;
      return (state.targets || []).find((item) => item.id === state.recommended_target_id) || target;
    }

    function setupGuideForSelectedTarget() {
      const target = setupGuideTarget();
      return state.target_guides ? state.target_guides[target.id] : null;
    }

    function stepTitle(step) {
      return labels.stepTitles && labels.stepTitles[step.id] ? labels.stepTitles[step.id] : step.title;
    }

    function renderHandoffFlow() {
      const guide = setupGuideForSelectedTarget();
      const steps = guide && guide.steps ? guide.steps : [];
      if (!steps.length) {
        el("handoff-flow").innerHTML = "";
        return;
      }
      el("handoff-flow").innerHTML =
        '<section class="handoff-flow" aria-label="first handoff flow">' +
          '<div class="flow-head"><div><div class="kicker">' + escape(labels.flowTitle) + '</div><p>' + escape(labels.flowBody) + '</p></div><span class="badge accent">' + escape(guide.title) + '</span></div>' +
          '<div class="flow-steps">' + steps.map((step, index) =>
            '<div class="flow-step">' +
              '<strong>' + (index + 1) + '. ' + escape(stepTitle(step)) + '</strong>' +
              '<p>' + escape(step.description || '') + '</p>' +
              '<button class="btn" data-copy="' + escape(step.command) + '">' + escape(labels.copy) + '</button>' +
            '</div>'
          ).join("") + '</div>' +
        '</section>';
      wireCopyButtons();
    }

    function renderNextHandoff() {
      const packet = selectedPacket();
      if (!packet) {
        el("next-handoff").innerHTML = emptyOnboardingHtml();
        wireCopyButtons();
        wireCreateDemoButtons();
        return;
      }
      const target = selectedTarget();
      const targetMode = copyModeForTarget(target);
      const dirty = packet.git_dirty_files ? packet.git_dirty_files + " " + labels.dirtyFiles : labels.cleanGitSnapshot;
      el("next-handoff").innerHTML =
        '<section class="next-handoff" aria-label="next handoff">' +
          '<div>' +
            '<div class="kicker">' + escape(labels.nextHandoff) + '</div>' +
            '<div class="next-title">' + escape(packetTitle(packet)) + '</div>' +
            '<div class="next-meta">' +
              '<span class="badge accent">' + escape(target.title) + ' · ' + escape(targetStatusLabel(target)) + '</span>' +
              '<span class="badge">' + escape(packet.from || labels.unknown) + '</span>' +
              readinessBadge(packet) +
              '<span class="badge ' + (packet.git_dirty_files ? 'warn' : 'good') + '">' + escape(dirty) + '</span>' +
              '<span class="badge ' + (packet.acknowledged ? 'good' : 'warn') + '">' + escape(packet.acknowledged ? labels.acknowledged : labels.unacknowledged) + '</span>' +
              freshnessBadge(packet) +
            '</div>' +
          '</div>' +
          '<div class="next-actions">' +
            '<button class="btn primary" data-copy-prompt="' + escape(targetMode) + '" data-id="' + escape(packet.id) + '" data-target-id="' + escape(target.id) + '">' + escape(targetCopyLabel(targetMode, target)) + '</button>' +
            '<button class="btn" data-ack="' + escape(packet.id) + '" data-ack-by="' + escape(target.id === "auto" ? "dashboard" : target.title) + '">' + escape(labels.markReceived) + '</button>' +
            '<button class="btn" data-focus-packet="' + escape(packet.id) + '">' + escape(labels.inspectPacket) + '</button>' +
          '</div>' +
        '</section>';
      wirePromptButtons();
      wireAckButtons();
      for (const button of document.querySelectorAll("[data-focus-packet]")) {
        button.addEventListener("click", () => {
          selectedId = button.dataset.focusPacket;
          activeTab = "overview";
          document.getElementById("detail").scrollIntoView({ behavior: "smooth", block: "start" });
          render();
        });
      }
    }

    function renderDetail() {
      const packet = selectedPacket();
      if (!packet) {
        el("detail").innerHTML = emptyOnboardingHtml();
        wireCopyButtons();
        wireCreateDemoButtons();
        return;
      }
      const tabs = ["overview", "commands", "ack", "readiness", "freshness", "safety", "body", "git"];
      const tabButtons = tabs.map((tab) => '<button class="tab ' + (tab === activeTab ? 'active' : '') + '" data-tab="' + tab + '">' + escape(labels.tabs[tab] || tab) + '</button>').join("");
      const target = selectedTarget();
      const targetMode = copyModeForTarget(target);
      el("detail").innerHTML =
        '<div class="detail-title">' +
          '<div><h2>' + escape(packetTitle(packet)) + '</h2><p>' + escape(packet.id) + '</p></div>' +
        '</div>' +
        '<section class="takeover" aria-label="takeover actions">' +
          '<div><div class="kicker">' + escape(labels.startHere) + '</div><h3>' + escape(labels.moveContextInto) + ' ' + escape(target.title) + '</h3><p>' + escape(target.description || labels.chooseTarget) + '</p></div>' +
          '<div class="takeover-actions">' +
            '<button class="btn primary" data-copy-prompt="' + escape(targetMode) + '" data-id="' + escape(packet.id) + '" data-target-id="' + escape(target.id) + '">' + escape(targetCopyLabel(targetMode, target)) + '</button>' +
            '<button class="btn" data-ack="' + escape(packet.id) + '" data-ack-by="' + escape(target.id === "auto" ? "dashboard" : target.title) + '">' + escape(labels.markReceived) + '</button>' +
            '<button class="btn" data-copy-prompt="full" data-id="' + escape(packet.id) + '" data-target-id="' + escape(target.id) + '">' + escape(labels.copyFullPrompt) + '</button>' +
            '<button class="btn wide" data-copy-prompt="mcp" data-id="' + escape(packet.id) + '" data-target-id="' + escape(target.id) + '">' + escape(labels.copyMcpInstruction) + '</button>' +
          '</div>' +
        '</section>' +
        '<div class="tabs">' + tabButtons + '</div>' +
        '<div id="tab-content">' + renderTab(packet) + '</div>';
      for (const tab of document.querySelectorAll(".tab")) {
        tab.addEventListener("click", () => {
          activeTab = tab.dataset.tab;
          renderDetail();
        });
      }
      wireCopyButtons();
      wirePromptButtons();
      wireAckButtons();
    }

    function renderTargets() {
      const targets = state.targets || [];
      el("target-count").textContent = targets.filter((target) => target.signals && target.signals.length).length + " " + labels.detected;
      if (!targets.length) {
        el("target-list").innerHTML = '<div class="empty">' + escape(labels.noTargets) + '</div>';
        return;
      }
      el("target-list").innerHTML = targets.map((target) => {
        const signals = target.signals && target.signals.length
          ? '<div class="badge-row">' + target.signals.slice(0, 2).map((signal) => '<span class="badge good">' + escape(signal.replace(/^.*:/, "")) + '</span>').join("") + '</div>'
          : '';
        return '<button class="target-card ' + (target.id === selectedTargetId ? 'active' : '') + '" data-target="' + escape(target.id) + '">' +
          '<div class="target-top"><span class="target-title">' + escape(target.title) + '</span><span class="badge">' + escape(labels[target.confidence] || target.confidence) + '</span></div>' +
          '<div class="target-description">' + escape(target.description) + '</div>' +
          signals +
        '</button>';
      }).join("");
      for (const row of document.querySelectorAll(".target-card")) {
        row.addEventListener("click", () => {
          selectedTargetId = row.dataset.target;
          render();
        });
      }
    }

    function renderSetupGuide() {
      const target = setupGuideTarget();
      const guide = setupGuideForSelectedTarget();
      if (!guide) {
        el("setup-guide").innerHTML = '<div class="setup-guide"><h3>' + escape(labels.clientSetup) + '</h3><p>' + escape(labels.noSetupGuide) + '</p></div>';
        return;
      }
      const packet = selectedPacket();
      const verifyWorkspace = packet?.workspace || state.workspace || "";
      const commands = [
        [labels.mcpConfig, labels.copyMcpConfig, guide.mcp_config_command],
        [labels.mcpVerify, labels.copyMcpVerify, guide.mcp_verify_command],
        [labels.recipe, labels.copyRecipe, guide.recipe_command],
      ];
      const steps = (guide.steps || []).map((step, index) => '<div class="setup-step"><div><strong>' + (index + 1) + '. ' + escape(stepTitle(step)) + '</strong><p>' + escape(step.description || '') + '</p></div>' +
        '<div class="command"><code>' + escape(step.command) + '</code><button class="btn" data-copy="' + escape(step.command) + '">' + escape(labels.copy) + '</button></div></div>').join("");
      const notes = (guide.notes || []).slice(0, 3).map((note) => '<li>' + escape(note) + '</li>').join("");
      el("setup-guide").innerHTML =
        '<section class="setup-guide" aria-label="client setup guide">' +
          '<div class="kicker">' + escape(labels.clientSetup) + '</div>' +
          '<h3>' + escape(guide.title) + '</h3>' +
          '<p>' + escape(guide.mode) + '</p>' +
          '<div class="kicker" style="margin-top: 10px;">' + escape(labels.recommendedPath) + '</div>' +
          '<div class="setup-steps">' + steps + '</div>' +
          '<div class="setup-actions">' +
            '<button class="btn primary" data-verify-workflow="' + escape(target.id) + '" data-workspace="' + escape(verifyWorkspace) + '">' + escape(labels.runCheck) + '</button>' +
            '<div class="verify-result hidden" id="verify-result"></div>' +
            '<div class="kicker">' + escape(labels.optionalSetup) + '</div>' +
            commands.map(([label, copyLabel, command]) => '<div class="command"><code>' + escape(command) + '</code><button class="btn" data-copy="' + escape(command) + '">' + escape(copyLabel || (labels.copy + ' ' + label)) + '</button></div>').join("") +
            '<div class="command"><code>' + escape(guide.prompt) + '</code><button class="btn" data-copy="' + escape(guide.prompt) + '">' + escape(labels.copyPrompt) + '</button></div>' +
          '</div>' +
          '<ul class="setup-note-list">' + notes + '</ul>' +
        '</section>';
      wireCopyButtons();
      wireVerifyButtons();
    }

    function renderCheckList(checks) {
      if (!checks.length) return '<div class="empty">—</div>';
      return '<ul>' + checks.map((check) =>
        '<li><span><strong>' + escape(checkName(check.id)) + '</strong> · ' + escape(checkStatus(check.status)) + '<br>' + escape(checkDetail(check)) + '</span></li>'
      ).join("") + '</ul>';
    }

    function renderIssueList(items, emptyLabel) {
      if (!items.length) return '<div class="empty">' + escape(emptyLabel) + '</div>';
      return '<ul>' + items.map((item) => '<li><span><strong>' + escape(item.id) + '</strong><br>' + escape(issueDetail(item)) + '</span></li>').join("") + '</ul>';
    }

    function checkName(id) {
      return labels.readyCheckNames && labels.readyCheckNames[id] ? labels.readyCheckNames[id] : id;
    }

    function checkStatus(status) {
      return labels.checkStatus && labels.checkStatus[status] ? labels.checkStatus[status] : status;
    }

    function checkDetail(check) {
      if (labels.lang === "zh-CN") {
        if (check.id === "freshness" && check.status === "ok") return "当前 Git 快照与 packet 匹配。";
        if (check.id === "freshness" && check.status === "fail") return "workspace 在 packet 保存后发生了变化，或无法确认新鲜度。";
        if (check.id === "safety" && check.status === "ok") return "没有明显安全提示。";
        if (check.id === "safety" && check.status === "fail") return "存在需要检查的安全提示。";
        if (check.id === "context" && check.status === "ok") return "已记录上下文正文。";
        if (check.id === "context" && check.status === "warn") return "packet 没有正文，接收方会依赖 summary、notes 和 Git 元数据。";
        if (check.id === "context" && check.status === "fail") return "packet 缺少可用上下文。";
        if (check.id === "acknowledgement" && check.status === "ok") return "已有接收确认。";
        if (check.id === "acknowledgement" && check.status === "warn") return "还没有接收方确认。";
      }
      return check.detail;
    }

    function issueDetail(item) {
      return labels.readyIssueDetails && labels.readyIssueDetails[item.id] ? labels.readyIssueDetails[item.id] : item.detail;
    }

    function renderTab(packet) {
      if (activeTab === "commands") {
        return '<div class="command-grid">' + [
          ["Brief", packet.next_brief],
          ["Resume", packet.next_resume],
          ["Show prompt", packet.next_show_prompt],
          ["Ready", packet.next_ready],
          ["MCP full", packet.next_mcp_read],
          ["MCP brief", packet.next_mcp_brief],
          ["MCP ready", packet.next_mcp_ready],
        ].map(([label, command]) => '<div class="command"><code>' + escape(command) + '</code><button class="btn" data-copy="' + escape(command) + '">' + escape(labels.copy) + '</button></div>').join("") + '</div>';
      }
      if (activeTab === "body") {
        return packet.body_preview
          ? '<pre>' + escape(packet.body_preview) + '</pre>'
          : '<div class="empty">' + escape(labels.noBody) + '</div>';
      }
      if (activeTab === "ack") {
        const acknowledgements = packet.acknowledgements || [];
        if (!acknowledgements.length) {
          return '<div class="empty">' + escape(labels.unacknowledged) + '</div>';
        }
        return '<ul>' + acknowledgements.map((ack) =>
          '<li><span><strong>' + escape(ack.by) + '</strong> · ' + escape(ack.acknowledged_at) + (ack.note ? '<br>' + escape(ack.note) : '') + '</span></li>'
        ).join("") + '</ul>';
      }
      if (activeTab === "freshness") {
        const freshness = packet.freshness || { status: "unknown", reason: "unknown" };
        return '<div class="kv">' +
          '<div>' + escape(labels.fields.status) + '</div><div>' + escape(freshness.status) + '</div>' +
          '<div>' + escape(labels.fields.reason) + '</div><div>' + escape(fmt(freshness.reason)) + '</div>' +
          '<div>' + escape(labels.fields.checked) + '</div><div>' + escape(fmt(freshness.checked_at)) + '</div>' +
          '</div><div class="command" style="margin-top: 12px;"><code>' + escape(packet.next_freshness) + '</code><button class="btn" data-copy="' + escape(packet.next_freshness) + '">' + escape(labels.copy) + '</button></div>';
      }
      if (activeTab === "readiness") {
        const readiness = packet.readiness || { ready: false, status: "unknown", reason: "unknown" };
        const checks = packet.ready_checks || [];
        const blockers = packet.ready_blockers || [];
        const warnings = packet.ready_warnings || [];
        const reasonText = blockers.length ? issueDetail(blockers[0]) : warnings.length ? issueDetail(warnings[0]) : readiness.reason;
        return '<div class="kv">' +
          '<div>' + escape(labels.fields.status) + '</div><div>' + escape(readiness.status) + '</div>' +
          '<div>' + escape(labels.fields.reason) + '</div><div>' + escape(fmt(reasonText)) + '</div>' +
          '<div>' + escape(labels.ready) + '</div><div>' + escape(readiness.ready ? labels.ready : labels.notReady) + '</div>' +
          '</div><h3>' + escape(labels.checks) + '</h3>' + renderCheckList(checks) +
          '<h3 style="margin-top: 14px;">' + escape(labels.blockers) + '</h3>' + renderIssueList(blockers, labels.noBlockers) +
          '<h3 style="margin-top: 14px;">' + escape(labels.warnings) + '</h3>' + renderIssueList(warnings, labels.noReadinessWarnings) +
          '<div class="command" style="margin-top: 12px;"><code>' + escape(packet.next_ready) + '</code><button class="btn" data-copy="' + escape(packet.next_ready) + '">' + escape(labels.copy) + '</button></div>';
      }
      if (activeTab === "safety") {
        const warnings = packet.safety && packet.safety.warnings ? packet.safety.warnings : [];
        if (!warnings.length) return '<div class="empty">' + escape(labels.noSafetyWarnings) + '</div>';
        return '<p>' + escape(labels.safetyReview) + '</p><ul>' + warnings.map((warning) => '<li><span>' + escape(warning.title + ": " + warning.detail) + '</span></li>').join("") + '</ul>';
      }
      if (activeTab === "git") {
        if (!packet.git) return '<div class="empty">' + escape(labels.noGit) + '</div>';
        const status = packet.git.status && packet.git.status.length ? packet.git.status.join("\\n") : labels.noDirtyFiles;
        return '<div class="kv"><div>' + escape(labels.fields.branch) + '</div><div>' + escape(fmt(packet.git.branch)) + '</div><div>' + escape(labels.fields.head) + '</div><div>' + escape(fmt(packet.git.head)) + '</div></div><pre>' + escape(status) + '</pre>';
      }
      const notes = packet.notes && packet.notes.length
        ? '<ul>' + packet.notes.map((note) => '<li><span>' + escape(note) + '</span></li>').join("") + '</ul>'
        : '<div class="empty">' + escape(labels.noNotes) + '</div>';
      const tags = packet.tags && packet.tags.length
        ? '<div class="badge-row">' + packet.tags.map((tag) => '<span class="badge">' + escape(tag) + '</span>').join("") + '</div>'
        : '<div class="empty">' + escape(labels.noTags) + '</div>';
      const safetyWarnings = packet.safety && packet.safety.warnings && packet.safety.warnings.length
        ? '<p>' + escape(labels.safetyReview) + '</p><ul>' + packet.safety.warnings.map((warning) => '<li><span>' + escape(warning.title + ": " + warning.detail) + '</span></li>').join("") + '</ul>'
        : '<div class="empty">' + escape(labels.noSafetyWarnings) + '</div>';
      return '<div class="kv">' +
        '<div>' + escape(labels.fields.from) + '</div><div>' + escape(fmt(packet.from)) + '</div>' +
        '<div>' + escape(labels.fields.workspace) + '</div><div>' + escape(fmt(packet.workspace)) + '</div>' +
        '<div>' + escape(labels.fields.created) + '</div><div>' + escape(fmt(packet.created_at)) + '</div>' +
        '<div>' + escape(labels.fields.updated) + '</div><div>' + escape(fmt(packet.updated_at)) + '</div>' +
        '<div>' + escape(labels.fields.status) + '</div><div>' + escape(fmt(packet.status)) + '</div>' +
        '<div>' + escape(labels.fields.acknowledged) + '</div><div>' + escape(packet.acknowledged ? labels.acknowledged : labels.unacknowledged) + '</div>' +
        '<div>' + escape(labels.fields.ackCount) + '</div><div>' + escape(fmt(packet.acknowledgement_count)) + '</div>' +
        '<div>' + escape(labels.fields.freshness) + '</div><div>' + escape(packet.freshness ? packet.freshness.status : "unknown") + '</div>' +
        '<div>' + escape(labels.readiness) + '</div><div>' + escape(packet.readiness ? packet.readiness.status : "unknown") + '</div>' +
        '<div>' + escape(labels.fields.bodyChars) + '</div><div>' + escape(fmt(packet.body_chars)) + '</div>' +
        '</div><h3>' + escape(labels.safety) + '</h3>' + safetyWarnings + '<h3 style="margin-top: 14px;">' + escape(labels.tags) + '</h3>' + tags + '<h3 style="margin-top: 14px;">' + escape(labels.notes) + '</h3>' + notes;
    }

    function renderWorkspaces() {
      if (!state.workspaces.length) {
        el("workspace-list").innerHTML = '<li><span>' + escape(labels.noWorkspaces) + '</span><strong>0</strong></li>';
        return;
      }
      el("workspace-list").innerHTML = state.workspaces.map((item) =>
        '<li><span class="workspace-path">' + escape(item.workspace) + '</span><strong>' + escape(item.packets) + '</strong></li>'
      ).join("");
    }

    function emptyOnboardingHtml() {
      const demoCommand = state.onboarding?.demo_command || ("acb demo --workspace " + workspaceArg() + langFlag());
      const handoffCommand = state.onboarding?.handoff_command || ("acb handoff --from codex --summary " + JSON.stringify("Ready for next agent") + " --git");
      const setupCommand = state.onboarding?.setup_command || ("acb setup --workspace " + workspaceArg() + " --check" + langFlag());
      return '<section class="empty">' +
        '<h2>' + escape(labels.emptyTitle) + '</h2>' +
        '<p>' + escape(labels.emptyBody) + '</p>' +
        '<div class="command-grid">' +
          '<div class="command"><code>' + escape(demoCommand) + '</code><button class="btn primary" data-create-demo="true">' + escape(labels.createDemoPacket) + '</button><button class="btn" data-copy="' + escape(demoCommand) + '">' + escape(labels.createDemo) + '</button></div>' +
          '<div class="command"><code>' + escape(handoffCommand) + '</code><button class="btn" data-copy="' + escape(handoffCommand) + '">' + escape(labels.saveRealHandoff) + '</button></div>' +
          '<div class="command"><code>' + escape(setupCommand) + '</code><button class="btn" data-copy="' + escape(setupCommand) + '">' + escape(labels.runSetup) + '</button></div>' +
        '</div>' +
      '</section>';
    }

    function wireCopyButtons() {
      for (const button of document.querySelectorAll("[data-copy]")) {
        if (button.dataset.copyBound === "true") continue;
        button.dataset.copyBound = "true";
        button.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(button.dataset.copy);
            showToast(labels.copied);
          } catch {
            showToast(labels.copyFailed);
          }
        });
      }
    }

    function wireCreateDemoButtons() {
      for (const button of document.querySelectorAll("[data-create-demo]")) {
        if (button.dataset.createDemoBound === "true") continue;
        button.dataset.createDemoBound = "true";
        button.addEventListener("click", async () => {
          const previous = button.textContent;
          button.disabled = true;
          button.textContent = labels.creatingDemo;
          try {
            const response = await fetch("/api/create-demo", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ workspace: state.workspace, lang: labels.lang }),
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.error || labels.demoCreateFailed);
            showToast(payload.message || labels.demoCreated);
            window.location.reload();
          } catch (error) {
            showToast(error.message || labels.demoCreateFailed);
            button.disabled = false;
            button.textContent = previous;
          }
        });
      }
    }

    function wireVerifyButtons() {
      for (const button of document.querySelectorAll("[data-verify-workflow]")) {
        if (button.dataset.verifyBound === "true") continue;
        button.dataset.verifyBound = "true";
        button.addEventListener("click", async () => {
          const previous = button.textContent;
          const result = el("verify-result");
          button.disabled = true;
          button.textContent = labels.checking;
          result.className = "verify-result";
          result.textContent = labels.runningCheck;
          try {
            const response = await fetch("/api/verify-workflow", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ target_id: button.dataset.verifyWorkflow, workspace: button.dataset.workspace }),
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.error || payload.message || labels.checkFailedText);
            const checks = Object.entries(payload.report.checks)
              .map(([name, ok]) => name + ": " + (ok ? "ok" : "failed"))
              .join("\\n");
            result.className = "verify-result ok";
            result.textContent = labels.checkPassedFor + " " + payload.title + ".\\n" + checks;
            showToast(labels.checkPassed);
          } catch (error) {
            result.className = "verify-result fail";
            result.textContent = error.message || labels.checkFailedText;
            showToast(labels.checkFailed);
          } finally {
            button.disabled = false;
            button.textContent = previous;
          }
        });
      }
    }

    function wirePromptButtons() {
      for (const button of document.querySelectorAll("[data-copy-prompt]")) {
        if (button.dataset.copyPromptBound === "true") continue;
        button.dataset.copyPromptBound = "true";
        button.addEventListener("click", async () => {
          const previous = button.textContent;
          button.disabled = true;
          button.textContent = labels.copying;
          try {
            const response = await fetch("/api/copy-prompt", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id: button.dataset.id, mode: button.dataset.copyPrompt, target_id: button.dataset.targetId }),
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.error || labels.copyFailed);
            showToast(labels.promptCopied);
          } catch (error) {
            showToast(error.message || labels.copyFailed);
          } finally {
            button.disabled = false;
            button.textContent = previous;
          }
        });
      }
    }

    function wireAckButtons() {
      for (const button of document.querySelectorAll("[data-ack]")) {
        if (button.dataset.ackBound === "true") continue;
        button.dataset.ackBound = "true";
        button.addEventListener("click", async () => {
          const previous = button.textContent;
          button.disabled = true;
          button.textContent = labels.acknowledging;
          try {
            const response = await fetch("/api/ack", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id: button.dataset.ack, by: button.dataset.ackBy }),
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.error || labels.ackFailed);
            showToast(payload.message || labels.ackRecorded);
            window.location.reload();
          } catch (error) {
            showToast(error.message || labels.ackFailed);
            button.disabled = false;
            button.textContent = previous;
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
    fingerprint: packet?.fingerprint || null,
    acknowledgements: packetAcknowledgements(packet),
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
    const acknowledgement = packetAcknowledgementSummary(packet);
    lines.push(`- acknowledged: ${acknowledgement.acknowledged ? "yes" : "no"}`);
    if (acknowledgement.latest) {
      lines.push(`- latest_acknowledgement: ${acknowledgement.latest.by} at ${acknowledgement.latest.acknowledged_at}`);
    }
    const safety = packetSafety(packet);
    lines.push(`- safety: ${safety.level}`);
    if (safety.warnings.length) {
      lines.push("", "### Safety Hints");
      for (const warning of safety.warnings) lines.push(`- ${warning.title}: ${warning.detail}`);
    }
    if (packet.git) {
      lines.push("", "### Git", "", renderGitSnapshot(packet.git));
    }
    if (packet.fingerprint) {
      lines.push(
        "",
        "### Workspace Fingerprint",
        "",
        `- watch_paths: ${(packet.fingerprint.watch_paths || []).join(", ") || "none"}`,
        `- files: ${packet.fingerprint.file_count || 0}`,
      );
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
  const safetyWarnings = packets.reduce((sum, packet) => sum + packetSafety(packet).warnings.length, 0);
  const readyCount = packets.filter((packet) => packetReadinessSummary(packet).ready).length;
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
      <div class="stat"><strong>${safetyWarnings}</strong><span>safety warnings</span></div>
      <div class="stat"><strong>${readyCount}</strong><span>ready packets</span></div>
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
  const safety = packetSafety(packet);
  const acknowledgement = packetAcknowledgementSummary(packet);
  const freshness = packetFreshnessSummary(packet);
  const readiness = packetReadinessSummary(packet);
  const ackHtml = acknowledgement.acknowledged
    ? `<div class="commands"><span class="pill good">acknowledged by ${escapeHtml(acknowledgement.latest.by)}</span><span class="pill">${escapeHtml(acknowledgement.latest.acknowledged_at)}</span></div>`
    : `<div class="commands"><span class="pill warn">pending acknowledgement</span></div>`;
  const freshnessHtml = `<div class="commands"><span class="pill ${freshness.status === "changed" ? "warn" : freshness.status === "fresh" ? "good" : ""}">freshness ${escapeHtml(freshness.status)}</span></div>`;
  const readinessHtml = `<div class="commands"><span class="pill ${readiness.ready ? "good" : "warn"}">readiness ${escapeHtml(readiness.status)}</span></div>`;
  const safetyHtml = safety.warnings.length
    ? `<div class="commands">
      <span class="pill warn">${safety.warnings.length} safety warning(s)</span>
      <ul>${safety.warnings.map((warning) => `<li>${escapeHtml(`${warning.title}: ${warning.detail}`)}</li>`).join("")}</ul>
    </div>`
    : `<div class="commands"><span class="pill good">safety ok</span></div>`;
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
    ${readinessHtml}
    ${ackHtml}
    ${freshnessHtml}
    ${safetyHtml}
    ${git}
    ${body}
    <div class="commands">
      <span class="pill"><code>${escapeHtml(`acb resume --id ${packet.id}`)}</code></span>
      <span class="pill"><code>${escapeHtml(`acb brief --id ${packet.id}`)}</code></span>
      <span class="pill"><code>${escapeHtml(`acb show ${packet.id} --prompt`)}</code></span>
      <span class="pill"><code>${escapeHtml(`acb ready ${packet.id}`)}</code></span>
    </div>
  </article>`;
}

function defaultPreviewPath(packet) {
  return path.join(os.tmpdir(), "acb", "previews", `${packet.id}.md`);
}

function printTimelinePacket(packet) {
  const summary = packet.summary || packet.status || "(no summary)";
  const facts = [];
  facts.push("event:handoff_packet");
  if (packet.body) facts.push(`body:${packet.body.length}`);
  if (packet.notes?.length) facts.push(`notes:${packet.notes.length}`);
  if (packet.git?.status?.length) facts.push(`dirty:${packet.git.status.length}`);
  const safety = packetSafety(packet);
  if (safety.warnings.length) facts.push(`safety:${safety.warnings.length}`);
  const acknowledgement = packetAcknowledgementSummary(packet);
  if (acknowledgement.acknowledged) facts.push(`ack:${acknowledgement.count}`);
  facts.push(`freshness:${packetFreshnessSummary(packet).status}`);
  facts.push(`readiness:${packetReadinessSummary(packet).status}`);
  if (packet.tags?.length) facts.push(`tags:${packet.tags.join(",")}`);
  console.log(`* ${packet.created_at}  ${packet.from}  ${packet.id}`);
  console.log(`  ${summary}`);
  console.log(`  workspace: ${packet.workspace}`);
  if (facts.length) console.log(`  ${facts.join("  ")}`);
}

function printSafetyReport(report) {
  console.log("ACB Safety");
  console.log(`packet: ${report.packet.id}`);
  console.log(`workspace: ${report.packet.workspace}`);
  console.log(`level: ${report.safety.level}`);
  console.log(`warnings: ${report.safety.warnings.length}`);
  if (report.safety.warnings.length) {
    for (const warning of report.safety.warnings) {
      console.log(`- ${warning.title}: ${warning.detail}`);
    }
  } else {
    console.log("- no obvious safety warnings");
  }
  console.log("next:");
  console.log(`  acb show ${report.packet.id}`);
  console.log(`  acb resume --id ${report.packet.id}`);
  console.log(`limitation: ${report.limitation}`);
}

function printFreshnessReport(report) {
  console.log("ACB Freshness");
  console.log(`packet: ${report.packet.id}`);
  console.log(`workspace: ${report.packet.workspace}`);
  console.log(`status: ${report.status}`);
  console.log(`acknowledged: ${report.acknowledged ? "yes" : "no"}`);
  if (report.reason) console.log(`reason: ${report.reason}`);
  console.log(`ok: ${report.ok ? "yes" : "no"}`);
  if (report.packet_git) {
    console.log(`packet_head: ${report.packet_git.head || "unknown"}`);
    console.log(`packet_dirty_files: ${report.packet_git.dirty_files}`);
  }
  if (report.current_git) {
    console.log(`current_head: ${report.current_git.head || "unknown"}`);
    console.log(`current_dirty_files: ${report.current_git.dirty_files}`);
  }
  if (report.packet_fingerprint) {
    console.log(`watch_paths: ${report.packet_fingerprint.watch_paths.join(", ") || "none"}`);
    console.log(`watch_files: ${report.packet_fingerprint.file_count}`);
  }
  if (report.changes.length) {
    console.log("changes:");
    for (const change of report.changes) console.log(`- ${change}`);
  }
  console.log("next:");
  console.log(`  ${report.next.show}`);
  console.log(`  ${report.next.refresh_handoff}`);
}

function printReadyReport(report) {
  process.stdout.write(`${formatReadyReport(report)}\n`);
}

function printReceiveBlocked(report) {
  console.log("ACB Receive");
  console.log(`packet: ${report.packet.id}`);
  console.log(`workspace: ${report.packet.workspace}`);
  console.log("received: no");
  console.log(`status: ${report.status}`);
  console.log(`reason: ${report.reason}`);
  if (report.blockers.length) {
    console.log("blockers:");
    for (const blocker of report.blockers) console.log(`- ${blocker.detail}`);
  }
  console.log("next:");
  console.log(`  show: ${report.next.show}`);
  console.log(`  refresh_handoff: ${report.next.refresh_handoff}`);
  console.log(`  inspect_ready: acb ready ${report.packet.id}`);
}

function formatReadyReport(report) {
  const lines = [
    "ACB Ready",
    `packet: ${report.packet.id}`,
    `workspace: ${report.packet.workspace}`,
    `ready: ${report.ready ? "yes" : "no"}`,
    `status: ${report.status}`,
    `reason: ${report.reason}`,
    "checks:",
  ];
  for (const check of report.checks) lines.push(`- ${check.id}: ${check.status} (${check.detail})`);
  if (report.blockers.length) {
    lines.push("blockers:");
    for (const blocker of report.blockers) lines.push(`- ${blocker.detail}`);
  }
  if (report.warnings.length) {
    lines.push("warnings:");
    for (const warning of report.warnings) lines.push(`- ${warning.detail}`);
  }
  lines.push("next:");
  for (const [name, command] of Object.entries(report.next)) lines.push(`  ${name}: ${command}`);
  return lines.join("\n");
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
    packetReadinessSummary(packet).status,
    ...packetAcknowledgements(packet).flatMap((ack) => [ack.by, ack.note]),
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
    const acknowledgement = packetAcknowledgementSummary(packet);
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
      latest_acknowledged: acknowledgement.acknowledged,
      latest_acknowledgement_count: acknowledgement.count,
      latest_acknowledgement: acknowledgement.latest,
      next_receive: `acb receive ${packet.id}`,
      next_resume: `acb resume --id ${packet.id}`,
      next_brief: `acb brief --id ${packet.id}`,
      next_ack: `acb ack ${packet.id} --by <agent>`,
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
      receive: `acb receive ${latest.id}`,
      resume: `acb resume --id ${latest.id}`,
      brief: `acb brief --id ${latest.id}`,
      ack: `acb ack ${latest.id} --by <agent>`,
      copy_prompt: `acb prompt --id ${latest.id}`,
      show_prompt: `acb show ${latest.id} --prompt`,
      mcp_status: "get_workspace_status",
      mcp_read_latest: "read_latest_handoff",
      mcp_read_brief: "read_handoff_brief",
      mcp_check_latest_ready: "check_latest_handoff_ready",
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
  lines.push(`latest_acknowledged: ${report.latest_packet.acknowledged ? "yes" : "no"}`);
  if (report.latest_packet.latest_acknowledgement) {
    lines.push(`latest_ack_by: ${report.latest_packet.latest_acknowledgement.by}`);
    lines.push(`latest_ack_at: ${report.latest_packet.latest_acknowledgement.acknowledged_at}`);
  }
  lines.push(`next_receive: ${report.next.receive}`);
  lines.push(`next_resume: ${report.next.resume}`);
  lines.push(`next_brief: ${report.next.brief}`);
  lines.push(`next_ack: ${report.next.ack}`);
  lines.push(`next_show_prompt: ${report.next.show_prompt}`);
  lines.push(`next_mcp_read_latest: ${report.next.mcp_read_latest}`);
  lines.push(`next_mcp_read_brief: ${report.next.mcp_read_brief}`);
  lines.push(`next_mcp_check_latest_ready: ${report.next.mcp_check_latest_ready}`);
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

function setupCommand(args) {
  const wantsJson = args.includes("--json");
  const wantsCheck = args.includes("--check");
  const lang = resolveLanguage(args);
  const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const target = positionalArgs(args, LANGUAGE_VALUE_FLAGS).find(Boolean);
  const result = buildSetupGuideForTarget({ target, workspace });
  if (!result.ok) {
    console.error(result.error);
    console.error(`Available targets: ${RECIPE_TARGETS.map((item) => item.id).join(", ")}`);
    return 2;
  }

  const guide = wantsCheck
    ? {
        ...result.guide,
        workflow_check: buildWorkflowVerifyReport(result.recipe, workspace, {
          keepArtifacts: args.includes("--keep-artifacts"),
        }),
      }
    : result.guide;
  if (guide.workflow_check) guide.workflow_check_ok = guide.workflow_check.ok;
  if (wantsJson) {
    process.stdout.write(`${JSON.stringify(guide, null, 2)}\n`);
    return guide.workflow_check ? (guide.workflow_check.ok ? 0 : 1) : 0;
  }
  printSetupGuide(guide, workspace, { lang });
  if (guide.workflow_check) {
    console.log("");
    printSetupWorkflowCheck(guide.workflow_check, { lang });
  }
  return guide.workflow_check ? (guide.workflow_check.ok ? 0 : 1) : 0;
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

function printSetupGuide(guide, workspace, { lang = "en" } = {}) {
  if (isChinese(lang)) {
    console.log(`ACB 接入指南：${guide.title}`);
    console.log(`目标：${guide.id}`);
    console.log(`工作区：${workspace}`);
    if (guide.auto_selected) {
      const confidence = guide.detected_target?.confidence || "fallback";
      const signals = guide.detected_target?.signals?.length
        ? ` (${guide.detected_target.signals.join(", ")})`
        : "";
      console.log(`选择：自动 (${confidence})${signals}`);
    }
    console.log(`模式：${guide.mode}`);
    console.log("");
    console.log("推荐路径：");
    guide.steps.forEach((step, index) => {
      const command = step.id === "handoff"
        ? formatCommand("acb", ["dashboard", "--workspace", workspace, "--lang", "zh-CN"])
        : step.command;
      console.log(`${index + 1}. ${setupStepTitle(step, lang)}`);
      console.log(`   ${command}`);
    });
    console.log("");
    console.log("可选接入命令：");
    console.log(`  ${guide.setup_check_command}`);
    console.log(`  ${guide.mcp_config_command}`);
    console.log(`  ${guide.mcp_verify_command}`);
    console.log(`  ${guide.recipe_command}`);
    console.log("");
    console.log("给客户端的提示词：");
    console.log(guide.prompt);
    console.log("");
    console.log("给客户端的长期指令补丁：");
    console.log(guide.agent_instruction_patch);
    console.log("");
    console.log("边界：");
    for (const note of guide.notes) console.log(`- ${note}`);
    return;
  }
  console.log(`ACB Setup: ${guide.title}`);
  console.log(`target: ${guide.id}`);
  console.log(`workspace: ${workspace}`);
  if (guide.auto_selected) {
    const confidence = guide.detected_target?.confidence || "fallback";
    const signals = guide.detected_target?.signals?.length
      ? ` (${guide.detected_target.signals.join(", ")})`
      : "";
    console.log(`selection: auto (${confidence})${signals}`);
  }
  console.log(`mode: ${guide.mode}`);
  console.log("");
  console.log("Recommended path:");
  guide.steps.forEach((step, index) => {
    console.log(`${index + 1}. ${step.title}`);
    console.log(`   ${step.command}`);
  });
  console.log("");
  console.log("Optional setup commands:");
  console.log(`  ${guide.setup_check_command}`);
  console.log(`  ${guide.mcp_config_command}`);
  console.log(`  ${guide.mcp_verify_command}`);
  console.log(`  ${guide.recipe_command}`);
  console.log("");
  console.log("Client prompt:");
  console.log(guide.prompt);
  console.log("");
  console.log("Agent instruction patch:");
  console.log(guide.agent_instruction_patch);
  console.log("");
  console.log("Boundaries:");
  for (const note of guide.notes) console.log(`- ${note}`);
}

function setupStepTitle(step, lang = "en") {
  if (!isChinese(lang)) return step.title;
  const titles = {
    "save-context": "保存当前上下文",
    "review-safety": "检查安全提示",
    "verify-workflow": "验证 ACB 侧流程",
    handoff: "交接给目标客户端",
  };
  return titles[step.id] || step.title;
}

function printSetupWorkflowCheck(report, { lang = "en" } = {}) {
  if (isChinese(lang)) {
    console.log("ACB 侧检查：");
    console.log(`  目标：${report.target}`);
    console.log(`  通过：${yesNo(report.ok, lang)}`);
    for (const [name, ok] of Object.entries(report.checks)) {
      console.log(`  ${name}: ${ok ? "ok" : "failed"}`);
    }
    console.log(`  store: ${report.store_path}${report.artifacts_cleaned ? " (已清理)" : ""}`);
    console.log(`  边界：${report.limitation}`);
    return;
  }
  console.log("ACB-side check:");
  console.log(`  target: ${report.target}`);
  console.log(`  ok: ${report.ok ? "yes" : "no"}`);
  for (const [name, ok] of Object.entries(report.checks)) {
    console.log(`  ${name}: ${ok ? "ok" : "failed"}`);
  }
  console.log(`  store: ${report.store_path}${report.artifacts_cleaned ? " (cleaned)" : ""}`);
  console.log(`  limitation: ${report.limitation}`);
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
  if (target === "first-run") return verifyFirstRunCommand(args.slice(1));
  if (target === "workflow") return verifyWorkflowCommand(args.slice(1));
  if (target === "safety") return verifySafetyCommand(args.slice(1));
  if (target !== "mcp") {
    console.error("Usage: acb verify first-run [--workspace <path>] [--target <target>] [--keep-artifacts] [--json]\n       acb verify mcp [--config <path>] [--name <server-name>] [--json]\n       acb verify workflow <target|--all> [--workspace <path>] [--keep-artifacts] [--json]\n       acb verify safety [--workspace <path>] [--keep-artifacts] [--json]");
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

function verifySafetyCommand(args) {
  const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const report = buildSafetyVerifyReport({
    workspace,
    keepArtifacts: args.includes("--keep-artifacts"),
  });
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printSafetyVerifyReport(report);
  }
  return report.ok ? 0 : 1;
}

function verifyFirstRunCommand(args) {
  const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  const lang = resolveLanguage(args);
  const target = argValue(args, "--target") || null;
  const setupResult = buildSetupGuideForTarget({ target, workspace });
  if (!setupResult.ok) {
    console.error(setupResult.error);
    console.error(`Available targets: ${RECIPE_TARGETS.map((item) => item.id).join(", ")}`);
    return 2;
  }

  const report = buildFirstRunVerifyReport({
    workspace,
    lang,
    setupResult,
    keepArtifacts: args.includes("--keep-artifacts"),
  });
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printFirstRunVerifyReport(report, { lang });
  }
  return report.ok ? 0 : 1;
}

function verifyWorkflowCommand(args) {
  const target = args.find((arg) => !arg.startsWith("--"));
  const workspace = normalizeWorkspace(argValue(args, "--workspace") || process.cwd());
  if (args.includes("--all")) {
    const report = buildWorkflowMatrixReport(RECIPE_TARGETS, workspace, {
      keepArtifacts: args.includes("--keep-artifacts"),
    });
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printWorkflowMatrixReport(report);
    }
    return report.ok ? 0 : 1;
  }
  if (!target) {
    console.error("Usage: acb verify workflow <target|--all> [--workspace <path>] [--keep-artifacts] [--json]");
    return 2;
  }
  const recipe = findRecipe(target);
  if (!recipe) {
    console.error(`Unknown workflow target: ${target}`);
    console.error(`Available targets: ${RECIPE_TARGETS.map((item) => item.id).join(", ")}`);
    return 2;
  }

  const report = buildWorkflowVerifyReport(recipe, workspace, { keepArtifacts: args.includes("--keep-artifacts") });
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printWorkflowVerifyReport(report);
  }
  return report.ok ? 0 : 1;
}

function buildSafetyVerifyReport({ workspace, keepArtifacts = false } = {}) {
  const oldStore = process.env.ACB_STORE;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-safety-"));
  const tempStore = path.join(tempDir, "packets.json");
  let report = null;
  process.env.ACB_STORE = tempStore;
  try {
    const riskyPacket = createHandoffPacket({
      from: "acb-verify",
      workspace,
      summary: "Safety smoke packet",
      status: "local verification",
      notes: [
        "Review API_KEY=sk_fakeSafetyVerifyToken1234567890 before sharing.",
        "Touched .env.local and certs/demo-private.pem.",
      ],
      tags: ["safety", "verify"],
      body: "NPM_TOKEN=npm_fakeSafetyVerifyToken123456\nFiles: .npmrc, keys/demo-private.pem\n",
      git: { branch: "verify", head: "0000000", status: ["?? .env.local", "?? keys/demo-private.pem"] },
    });
    const cleanPacket = createHandoffPacket({
      from: "acb-verify",
      workspace,
      summary: "Clean safety packet",
      status: "local verification",
      notes: ["No secrets or sensitive paths in this sample."],
      tags: ["safety", "clean"],
      body: "Small ordinary context body.\n",
      git: null,
    });
    writeStore({ version: STORE_VERSION, packets: [riskyPacket, cleanPacket] });

    const riskyReport = buildSafetyReport(riskyPacket, { workspace });
    const cleanReport = buildSafetyReport(cleanPacket, { workspace });
    const storedRisky = findPacket({ id: riskyPacket.id });
    const checks = {
      secret_like_content: riskyReport.safety.warnings.some((warning) => warning.id === "secret_like_content"),
      sensitive_path: riskyReport.safety.warnings.some((warning) => warning.id === "sensitive_path"),
      clean_packet_ok: cleanReport.safety.level === "ok",
      derived_not_stored: storedRisky && storedRisky.safety === undefined,
    };
    report = {
      ok: Object.values(checks).every(Boolean),
      workspace,
      store_path: tempStore,
      artifacts_retained: keepArtifacts,
      risky_packet: packetSummary(riskyPacket),
      clean_packet: packetSummary(cleanPacket),
      checks,
      limitation: "This verifies ACB's derived safety hints only; it is not a full secret scanner or compliance gate.",
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

function printSafetyVerifyReport(report) {
  console.log("ACB Safety Verify");
  console.log(`workspace: ${report.workspace}`);
  console.log(`store: ${report.store_path}${report.artifacts_cleaned ? " (cleaned)" : ""}`);
  for (const [name, ok] of Object.entries(report.checks)) {
    console.log(`${name}: ${ok ? "ok" : "failed"}`);
  }
  console.log(`ok: ${report.ok ? "yes" : "no"}`);
  console.log(`limitation: ${report.limitation}`);
}

function buildWorkflowMatrixReport(recipes, workspace, { keepArtifacts = false } = {}) {
  const reports = recipes.map((recipe) => buildWorkflowVerifyReport(recipe, workspace, { keepArtifacts }));
  const passed = reports.filter((report) => report.ok).length;
  const failed = reports.length - passed;
  return {
    ok: failed === 0,
    workspace,
    target_count: reports.length,
    passed,
    failed,
    targets: reports.map((report) => ({
      target: report.target,
      title: report.title,
      ok: report.ok,
      checks: report.checks,
      store_path: report.store_path,
      artifacts_retained: report.artifacts_retained,
      artifacts_cleaned: report.artifacts_cleaned,
      limitation: report.limitation,
    })),
    limitation: "This verifies ACB-side workflows only; it does not launch or mutate third-party clients.",
  };
}

function buildFirstRunVerifyReport({ workspace, lang = "en", setupResult, keepArtifacts = false }) {
  const oldStore = process.env.ACB_STORE;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-first-run-"));
  const tempStore = path.join(tempDir, "packets.json");
  let report = null;
  process.env.ACB_STORE = tempStore;
  try {
    const quickstart = buildDoctorReport(workspace);
    const packet = createDemoPacket({ workspace, from: "acb-verify", lang });
    writeStore({ version: STORE_VERSION, packets: [packet] });
    const latest = findPacket({ id: packet.id });
    const brief = renderBriefPrompt(packet);
    const resumePrompt = renderHandoffPrompt(packet);
    const dashboardState = buildDashboardState({ workspace, limit: 5 });
    const dashboardHtml = renderDashboardHtml(dashboardState, { lang });
    const workflow = buildWorkflowVerifyReport(setupResult.recipe, workspace, { keepArtifacts });
    const checks = {
      quickstart: quickstart.ok && quickstart.checks.store_readable,
      demo_packet: latest?.id === packet.id && packet.tags.includes("demo"),
      brief: brief.includes(packet.summary) && brief.includes("Full Context Commands"),
      resume_prompt: resumePrompt.includes(packet.summary) && resumePrompt.includes("Requested Behavior"),
      dashboard_state: dashboardState.latest_packet?.id === packet.id,
      dashboard_html: dashboardHtml.includes(packet.id) && dashboardHtml.includes("api/state"),
      setup_guide: setupResult.ok && setupResult.guide.workflow_verify_command.includes(setupResult.recipe.id),
      setup_workflow: workflow.ok,
    };
    report = {
      ok: Object.values(checks).every(Boolean),
      workspace,
      target: setupResult.recipe.id,
      title: setupResult.recipe.title,
      auto_selected: setupResult.guide.auto_selected,
      lang,
      store_path: tempStore,
      artifacts_retained: keepArtifacts,
      packet: packetSummary(packet),
      checks,
      commands: {
        quickstart: formatCommand("acb", ["quickstart", "--check", "--workspace", workspace, ...(isChinese(lang) ? ["--lang", "zh-CN"] : [])]),
        demo: formatCommand("acb", ["demo", "--workspace", workspace, ...(isChinese(lang) ? ["--lang", "zh-CN"] : [])]),
        dashboard: formatCommand("acb", ["dashboard", "--workspace", workspace, ...(isChinese(lang) ? ["--lang", "zh-CN"] : [])]),
        brief: `acb brief --id ${packet.id}`,
        setup: formatCommand("acb", ["setup", setupResult.recipe.id, "--workspace", workspace, "--check", ...(isChinese(lang) ? ["--lang", "zh-CN"] : [])]),
      },
      quickstart: {
        ok: quickstart.ok,
        checks: quickstart.checks,
      },
      workflow,
      limitation: "This verifies the local ACB first-run path only; it does not launch or mutate third-party clients.",
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
      mcp_latest_ready: mcpReport.checks.latest_ready === true,
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

function printFirstRunVerifyReport(report, { lang = "en" } = {}) {
  if (isChinese(lang)) {
    console.log("ACB 首次运行验证");
    console.log(`工作区：${report.workspace}`);
    console.log(`目标：${report.target} (${report.title})${report.auto_selected ? " 自动选择" : ""}`);
    console.log(`store：${report.store_path}${report.artifacts_cleaned ? " (已清理)" : ""}`);
    for (const [name, ok] of Object.entries(report.checks)) {
      console.log(`${name}: ${ok ? "ok" : "failed"}`);
    }
    console.log(`通过：${yesNo(report.ok, lang)}`);
    console.log("下一步：");
    console.log(`  ${report.commands.quickstart}`);
    console.log(`  ${report.commands.demo}`);
    console.log(`  ${report.commands.dashboard}`);
    console.log(`  ${report.commands.setup}`);
    console.log("边界：这只验证本地 ACB 首次运行路径；不会启动或修改第三方客户端。");
    return;
  }
  console.log("ACB First-Run Verify");
  console.log(`workspace: ${report.workspace}`);
  console.log(`target: ${report.target} (${report.title})${report.auto_selected ? " auto-selected" : ""}`);
  console.log(`store: ${report.store_path}${report.artifacts_cleaned ? " (cleaned)" : ""}`);
  for (const [name, ok] of Object.entries(report.checks)) {
    console.log(`${name}: ${ok ? "ok" : "failed"}`);
  }
  console.log(`ok: ${report.ok ? "yes" : "no"}`);
  console.log("next:");
  console.log(`  ${report.commands.quickstart}`);
  console.log(`  ${report.commands.demo}`);
  console.log(`  ${report.commands.dashboard}`);
  console.log(`  ${report.commands.setup}`);
  console.log(`limitation: ${report.limitation}`);
}

function printWorkflowMatrixReport(report) {
  console.log("ACB Workflow Matrix Verify");
  console.log(`workspace: ${report.workspace}`);
  console.log(`targets: ${report.passed}/${report.target_count} ok`);
  for (const target of report.targets) {
    console.log(`${target.target}: ${target.ok ? "ok" : "failed"}`);
    for (const [name, ok] of Object.entries(target.checks)) {
      console.log(`  ${name}: ${ok ? "ok" : "failed"}`);
    }
  }
  console.log(`ok: ${report.ok ? "yes" : "no"}`);
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
    supported_version: STORE_VERSION,
    schema: "acb.store.v1",
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
  console.log(`supported_version: ${report.supported_version}`);
  console.log(`schema: ${report.schema}`);
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
    requests.push(jsonRpcLine("tools/call", { name: "check_latest_handoff_ready", arguments: { workspace: resolvedWorkspace } }, 5));
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
  if (expectLatestPacketId) {
    report.checks.latest_handoff = false;
    report.checks.latest_ready = false;
  }

  report.checks.launch = true;
  const messages = parseJsonRpcLines(result.stdout || "");
  const initialize = messages.find((message) => message.id === 1);
  const toolsList = messages.find((message) => message.id === 2);
  const workspaceStatus = messages.find((message) => message.id === 3);
  const latestHandoff = messages.find((message) => message.id === 4);
  const latestReady = messages.find((message) => message.id === 5);

  if (initialize?.result?.serverInfo?.name) report.checks.initialize = true;
  else if (initialize?.error) report.error = initialize.error.message || "initialize failed";

  if (Array.isArray(toolsList?.result?.tools)) {
    report.checks.tools_list = true;
    report.tools = toolsList.result.tools.map((tool) => tool.name).filter(Boolean);
  } else if (toolsList?.error) {
    report.error = toolsList.error.message || "tools/list failed";
  }

  const requiredTools = ["get_workspace_status", "read_latest_handoff", "read_handoff_brief", "check_latest_handoff_ready", "check_handoff_ready", "save_handoff", "update_handoff", "acknowledge_handoff", "read_handoff", "search_handoffs", "list_workspaces", "list_handoffs"];
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
    const readyPacketId = latestReady?.result?.structuredContent?.report?.packet?.id;
    if (latestReady?.result?.isError === false && readyPacketId === expectLatestPacketId) {
      report.checks.latest_ready = true;
    } else if (latestReady?.error) {
      report.error = latestReady.error.message || "check_latest_handoff_ready failed";
    } else if (!report.error) {
      report.error = `check_latest_handoff_ready did not return expected packet: ${expectLatestPacketId}`;
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
  if (Object.prototype.hasOwnProperty.call(report.checks, "latest_ready")) {
    console.log(`check_latest_handoff_ready: ${report.checks.latest_ready ? "ok" : "failed"}`);
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

function printQuickstartCheck(check, report, { lang = "en" } = {}) {
  const clipboardReady = check.checks.clipboard_command_available;
  const acbReady = check.checks.acb_command_available;
  if (isChinese(lang)) {
    console.log("ACB 快速检查");
    console.log(`版本：acb ${check.version}`);
    console.log(`包名：${check.package}`);
    console.log(`命令路径：${check.command_path}`);
    console.log(`store：${check.store_path}`);
    console.log(`store 可读：${yesNo(check.checks.store_readable, lang)}`);
    if (report.store_error) console.log(`store 错误：${report.store_error}`);
    console.log(`工作区：${check.workspace}`);
    console.log(`Git 可用：${yesNo(check.checks.git_available, lang)}`);
    console.log(`Git 工作区：${yesNo(check.checks.git_workspace, lang)}`);
    console.log(`剪贴板可用：${yesNo(clipboardReady, lang)}`);
    if (!clipboardReady) {
      console.log("剪贴板兜底：提示词会打印到终端，方便手动复制");
      if (process.platform === "linux") console.log("剪贴板提示：安装 wl-clipboard、xclip 或 xsel");
    }
    console.log(`acb 在 PATH 中：${yesNo(acbReady, lang)}`);
    if (!acbReady) console.log(`安装提示：${check.install_command}`);
    if (check.setup) {
      console.log(`推荐目标：${check.setup.id}`);
      console.log(`推荐目标名称：${check.setup.title}`);
      printQuickstartActionCards(check.actions, { lang });
      console.log(`下一步 demo：${check.next.demo}`);
      console.log(`下一步 setup：${check.next.setup}`);
      console.log(`下一步 workflow 验证：${check.next.workflow_verify}`);
      console.log(`下一步 dashboard：${check.next.dashboard}`);
    }
    console.log(`下一步 handoff：${check.next.handoff}`);
    console.log(`下一步 receive：${check.next.receive}`);
    console.log(`下一步 resume：${check.next.resume}`);
    console.log(`下一步 brief：${check.next.brief}`);
    console.log(`下一步 doctor：${check.next.doctor}`);
    console.log(`下一步 MCP 配置：${check.next.mcp_config}`);
    console.log(`下一步 MCP 验证：${check.next.mcp_verify}`);
    return;
  }
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
  if (check.setup) {
    console.log(`recommended_target: ${check.setup.id}`);
    console.log(`recommended_target_title: ${check.setup.title}`);
    printQuickstartActionCards(check.actions, { lang });
    console.log(`next_demo: ${check.next.demo}`);
    console.log(`next_setup: ${check.next.setup}`);
    console.log(`next_workflow_verify: ${check.next.workflow_verify}`);
    console.log(`next_dashboard: ${check.next.dashboard}`);
  }
  console.log(`next_handoff: ${check.next.handoff}`);
  console.log(`next_receive: ${check.next.receive}`);
  console.log(`next_resume: ${check.next.resume}`);
  console.log(`next_brief: ${check.next.brief}`);
  console.log(`next_doctor: ${check.next.doctor}`);
  console.log(`next_mcp_config: ${check.next.mcp_config}`);
  console.log(`next_mcp_verify: ${check.next.mcp_verify}`);
}

function printQuickstartActionCards(actions, { lang = "en" } = {}) {
  if (!actions?.length) return;
  console.log(isChinese(lang) ? "推荐下一步：" : "Next actions:");
  for (const action of actions) {
    if (isChinese(lang)) {
      console.log(`- ${action.title}`);
      console.log(`  适合：${action.when}`);
      console.log(`  运行：${action.command}`);
    } else {
      console.log(`- ${action.title}`);
      console.log(`  when: ${action.when}`);
      console.log(`  run: ${action.command}`);
    }
  }
}

function buildQuickstartActions(check, { lang = "en" } = {}) {
  const targetTitle = check.setup?.title || check.setup?.id || "target client";
  if (isChinese(lang)) {
    return [
      {
        id: "demo",
        title: "1. 先体验安全 demo",
        when: "还没有真实 handoff 历史时使用；只在本地 store 创建一条示例 packet。",
        command: check.next.demo,
      },
      {
        id: "dashboard",
        title: "2. 打开可视化面板",
        when: "检查 packet、复制接管提示词、查看目标客户端接入建议。",
        command: check.next.dashboard,
      },
      {
        id: "handoff",
        title: "3. 保存真实上下文",
        when: "当前 Agent 已经掌握项目上下文，准备交给下一个 Agent 时使用。",
        command: check.next.handoff,
      },
      {
        id: "setup",
        title: `4. 验证 ${targetTitle} 接入路径`,
        when: "只跑 ACB 侧检查；不会启动或修改第三方客户端。",
        command: check.next.setup,
      },
    ];
  }
  return [
    {
      id: "demo",
      title: "1. Try the safe demo",
      when: "Use this before you have real handoff history; it creates one local sample packet.",
      command: check.next.demo,
    },
    {
      id: "dashboard",
      title: "2. Open the dashboard",
      when: "Inspect packets, copy takeover prompts, and review target-client setup guidance.",
      command: check.next.dashboard,
    },
    {
      id: "handoff",
      title: "3. Save real context",
      when: "Run this from the agent that currently has the project context.",
      command: check.next.handoff,
    },
    {
      id: "setup",
      title: `4. Verify the ${targetTitle} path`,
      when: "Runs ACB-side checks only; it does not launch or modify third-party clients.",
      command: check.next.setup,
    },
  ];
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
      name: "check_latest_handoff_ready",
      title: "Check Latest Handoff Ready",
      description: "Check whether the newest local ACB handoff packet is ready to hand off before a receiving agent continues.",
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
      name: "check_handoff_ready",
      title: "Check Handoff Ready",
      description: "Check whether a specific local ACB handoff packet is ready to hand off before a receiving agent continues.",
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
          watch_paths: {
            type: "array",
            items: { type: "string" },
            description: "Optional workspace-relative paths to fingerprint for freshness checks.",
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
          watch_paths: {
            type: "array",
            items: { type: "string" },
            description: "Optional workspace-relative paths to refresh as a fingerprint for freshness checks.",
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
      name: "acknowledge_handoff",
      title: "Acknowledge Handoff",
      description: "Record that a receiving agent explicitly read a local ACB handoff packet.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Handoff packet id.",
          },
          by: {
            type: "string",
            description: "Receiving agent or client name. Defaults to mcp-client.",
          },
          note: {
            type: "string",
            description: "Optional short confirmation note.",
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
  if (name === "check_latest_handoff_ready") return mcpCheckLatestHandoffReady(args);
  if (name === "check_handoff_ready") return mcpCheckHandoffReady(args);
  if (name === "save_handoff") return mcpSaveHandoff(args);
  if (name === "update_handoff") return mcpUpdateHandoff(args);
  if (name === "acknowledge_handoff") return mcpAcknowledgeHandoff(args);
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

function mcpCheckLatestHandoffReady(args) {
  const workspace = args.workspace ? normalizeWorkspace(args.workspace) : normalizeWorkspace(process.cwd());
  const packet = findPacket({ workspace });
  if (!packet) {
    return {
      content: [{ type: "text", text: `No handoff packet found for workspace: ${workspace}` }],
      isError: true,
    };
  }
  return mcpReadyResult(packet);
}

function mcpCheckHandoffReady(args) {
  const id = typeof args.id === "string" ? args.id : "";
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
  return mcpReadyResult(packet);
}

function mcpReadyResult(packet) {
  const report = buildReadyReport(packet);
  return {
    content: [{ type: "text", text: formatReadyReport(report) }],
    structuredContent: { report },
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

  const watchPaths = normalizeStringArray(args.watch_paths);
  if (!summary && !status && notes.length === 0 && !body && !args.include_git && !args.include_diff && !watchPaths.length) {
    return {
      content: [{ type: "text", text: "save_handoff requires summary, status, notes, body, include_git, include_diff, or watch_paths." }],
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
  const fingerprintResult = watchPaths.length ? createWorkspaceFingerprint(workspace, watchPaths) : { ok: true, fingerprint: null };
  if (!fingerprintResult.ok) {
    return {
      content: [{ type: "text", text: fingerprintResult.error }],
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
    fingerprint: fingerprintResult.fingerprint,
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

  const watchPaths = normalizeStringArray(args.watch_paths);
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
  if (watchPaths.length) {
    const fingerprintResult = createWorkspaceFingerprint(packet.workspace, watchPaths);
    if (!fingerprintResult.ok) {
      return {
        content: [{ type: "text", text: fingerprintResult.error }],
        isError: true,
      };
    }
    packet.fingerprint = fingerprintResult.fingerprint;
  }

  packet.updated_at = new Date().toISOString();
  replacePacket(packet);

  return {
    content: [{ type: "text", text: `Updated ACB handoff packet: ${packet.id}` }],
    structuredContent: { packet },
    isError: false,
  };
}

function mcpAcknowledgeHandoff(args) {
  const id = typeof args.id === "string" ? args.id : "";
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
  const acknowledgement = createAcknowledgement({
    by: typeof args.by === "string" && args.by.trim() ? args.by : "mcp-client",
    note: typeof args.note === "string" && args.note.trim() ? args.note : null,
  });
  const updated = {
    ...packet,
    acknowledgements: [...packetAcknowledgements(packet), acknowledgement],
    updated_at: new Date().toISOString(),
  };
  replacePacket(updated);

  return {
    content: [{ type: "text", text: `Acknowledged ACB handoff packet: ${updated.id}` }],
    structuredContent: { packet: packetWithNextSteps(updated), acknowledgement },
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
    || Boolean(args.include_diff)
    || normalizeStringArray(args.watch_paths).length > 0;
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

function jsonRpcError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function printPacket(packet) {
  const acknowledgement = packetAcknowledgementSummary(packet);
  console.log(`id: ${packet.id}`);
  console.log(`from: ${packet.from}`);
  console.log(`created_at: ${packet.created_at}`);
  if (packet.updated_at) console.log(`updated_at: ${packet.updated_at}`);
  console.log(`workspace: ${packet.workspace}`);
  if (packet.summary) console.log(`summary: ${packet.summary}`);
  if (packet.status) console.log(`status: ${packet.status}`);
  if (packet.tags?.length) console.log(`tags: ${packet.tags.join(", ")}`);
  console.log(`acknowledged: ${acknowledgement.acknowledged ? "yes" : "no"}`);
  console.log(`acknowledgement_count: ${acknowledgement.count}`);
  if (acknowledgement.latest) {
    console.log(`latest_ack_by: ${acknowledgement.latest.by}`);
    console.log(`latest_ack_at: ${acknowledgement.latest.acknowledged_at}`);
    if (acknowledgement.latest.note) console.log(`latest_ack_note: ${acknowledgement.latest.note}`);
  }
  if (packet.git) {
    console.log(`git_branch: ${packet.git.branch || "unknown"}`);
    console.log(`git_head: ${packet.git.head || "unknown"}`);
    console.log(`git_dirty_files: ${packet.git.status?.length || 0}`);
  }
  if (packet.fingerprint) {
    console.log(`watch_paths: ${(packet.fingerprint.watch_paths || []).join(", ") || "none"}`);
    console.log(`watch_files: ${packet.fingerprint.file_count || 0}`);
  }
  const safety = packetSafety(packet);
  console.log(`safety: ${safety.level}`);
  if (safety.warnings.length) {
    console.log("safety_warnings:");
    for (const warning of safety.warnings) console.log(`- ${warning.title}: ${warning.detail}`);
  }
  if (packet.body) console.log(`body: ${packet.body.length} chars`);
  console.log(`next_receive: acb receive ${packet.id}`);
  console.log(`next_resume: acb resume --id ${packet.id}`);
  console.log(`next_brief: acb brief --id ${packet.id}`);
  console.log(`next_show_prompt: acb show ${packet.id} --prompt`);
  console.log(`next_ack: acb ack ${packet.id} --by <agent>`);
  console.log(`next_freshness: acb freshness ${packet.id}`);
  console.log(`next_ready: acb ready ${packet.id}`);
  console.log("next_mcp_read: read_handoff");
  console.log("next_mcp_brief: read_handoff_brief");
  console.log("next_mcp_ack: acknowledge_handoff");
  console.log("next_mcp_ready: check_handoff_ready");
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
    || argValues(args, "--watch").length > 0
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

function positionalArgs(args, valueFlags = new Set()) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      if (!arg.includes("=") && valueFlags.has(arg)) i += 1;
      continue;
    }
    values.push(arg);
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
