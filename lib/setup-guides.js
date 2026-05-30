import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandExists, formatCommand } from "./runtime.js";

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

const DASHBOARD_TARGETS = [
  {
    id: "auto",
    title: "Best Fit",
    description: "Recommended copy path for the selected packet.",
    copy_mode: "brief",
    aliases: [],
    detectors: [],
  },
  {
    id: "opencode",
    title: "OpenCode",
    description: "Terminal-first coding agent. Use MCP instruction when configured, otherwise paste a brief prompt.",
    copy_mode: "mcp",
    aliases: ["open-code"],
    detectors: [
      { type: "command", value: "opencode" },
      { type: "workspace-file", value: "opencode.json" },
      { type: "workspace-dir", value: ".opencode" },
    ],
  },
  {
    id: "cline",
    title: "Cline",
    description: "VS Code extension. Paste into chat or use Cline's supported MCP settings.",
    copy_mode: "brief",
    aliases: ["claude-dev"],
    detectors: [
      { type: "workspace-file", value: ".cline" },
      { type: "workspace-dir", value: ".cline" },
      { type: "home-dir", value: "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev" },
      { type: "home-dir", value: ".vscode/extensions", includes: "saoudrizwan.claude-dev" },
    ],
  },
  {
    id: "roo",
    title: "Roo Code",
    description: "VS Code extension. Paste into chat or use Roo's supported MCP settings.",
    copy_mode: "brief",
    aliases: ["roo-code", "roocode"],
    detectors: [
      { type: "workspace-file", value: ".roo" },
      { type: "workspace-dir", value: ".roo" },
      { type: "home-dir", value: "Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline" },
      { type: "home-dir", value: ".vscode/extensions", includes: "roo" },
    ],
  },
  {
    id: "claude-desktop",
    title: "Claude Desktop",
    description: "Desktop MCP client. Use MCP instruction once ACB is configured.",
    copy_mode: "mcp",
    aliases: ["claude", "claude-code", "claude-desktop-app"],
    detectors: [
      { type: "home-file", value: "Library/Application Support/Claude/claude_desktop_config.json" },
      { type: "home-dir", value: "Library/Application Support/Claude" },
    ],
  },
  {
    id: "codex",
    title: "Codex",
    description: "Paste a brief prompt into the next Codex thread.",
    copy_mode: "brief",
    aliases: ["openai-codex"],
    detectors: [
      { type: "command", value: "codex" },
      { type: "home-dir", value: ".codex" },
    ],
  },
  {
    id: "generic-mcp",
    title: "Generic MCP",
    description: "Any MCP-capable client with the ACB server configured.",
    copy_mode: "mcp",
    aliases: ["mcp", "generic", "mcp-client"],
    detectors: [
      { type: "workspace-file", value: "mcp.json" },
      { type: "workspace-file", value: ".mcp.json" },
    ],
  },
];

function detectDashboardTargets(workspace = null) {
  return DASHBOARD_TARGETS.map((target) => {
    const signals = target.detectors.flatMap((detector) => dashboardDetectorSignals(detector, workspace));
    const confidence = target.id === "auto"
      ? "recommended"
      : signals.length >= 2
        ? "high"
        : signals.length === 1
          ? "detected"
          : "available";
    return {
      id: target.id,
      title: target.title,
      description: target.description,
      copy_mode: target.copy_mode,
      confidence,
      signals,
    };
  });
}

function recommendDashboardTarget(targets) {
  const score = { high: 4, detected: 3, recommended: 2, available: 1 };
  const detectedTargets = targets.filter((target) => target.id !== "auto" && target.signals?.length);
  const fallback = targets.find((target) => target.id === "codex")
    || targets.find((target) => target.id === "generic-mcp")
    || targets.find((target) => target.id !== "auto")
    || targets.find((target) => target.id === "auto");
  return (detectedTargets.length ? detectedTargets : [fallback].filter(Boolean))
    .filter((target) => target.id !== "auto")
    .sort((left, right) => {
      const scoreDiff = (score[right.confidence] || 0) - (score[left.confidence] || 0);
      if (scoreDiff) return scoreDiff;
      return (right.signals?.length || 0) - (left.signals?.length || 0);
    })[0] || targets.find((target) => target.id === "auto") || {
    id: "auto",
    title: "Best Fit",
    copy_mode: "brief",
    confidence: "recommended",
    signals: [],
  };
}

function buildDashboardTargetGuides(workspace = null) {
  return Object.fromEntries(RECIPE_TARGETS.map((recipe) => [recipe.id, buildSetupGuide(recipe, workspace)]));
}

function buildSetupGuide(recipe, workspace = null) {
  const verifyArgs = workspace
    ? ["verify", "workflow", recipe.id, "--workspace", workspace]
    : ["verify", "workflow", recipe.id];
  const handoffArgs = [
    "handoff",
    "--from",
    "current-agent",
    "--summary",
    `Ready for ${recipe.title} to continue`,
    "--git",
  ];
  if (workspace) handoffArgs.splice(1, 0, "--workspace", workspace);
  const setupCheckArgs = workspace
    ? ["setup", recipe.id, "--workspace", workspace, "--check"]
    : ["setup", recipe.id, "--check"];
  const dashboardArgs = workspace
    ? ["dashboard", "--workspace", workspace]
    : ["dashboard", "--workspace", "."];
  const handoffCommand = formatCommand("acb", handoffArgs);
  const safetyCommand = workspace
    ? formatCommand("acb", ["safety", "--workspace", workspace])
    : "acb safety";
  const workflowVerifyCommand = formatCommand("acb", verifyArgs);
  const dashboardCommand = formatCommand("acb", dashboardArgs);
  const setupCheckCommand = formatCommand("acb", setupCheckArgs);
  return {
    id: recipe.id,
    title: recipe.title,
    aliases: recipe.aliases,
    mode: recipe.mode,
    setup: recipe.setup,
    prompt: recipe.prompt,
    agent_instructions_doc: "docs/agent-instructions.md",
    agent_instruction_patch: buildAgentInstructionPatch(recipe),
    notes: recipe.notes,
    steps: [
      {
        id: "save-context",
        title: "Save current context",
        command: handoffCommand,
        description: "Create an explicit packet from the agent that currently has context.",
      },
      {
        id: "review-safety",
        title: "Review safety hints",
        command: safetyCommand,
        description: "Check for secret-like text, sensitive paths, or large bodies before sharing.",
      },
      {
        id: "verify-workflow",
        title: "Verify ACB-side workflow",
        command: workflowVerifyCommand,
        description: "Smoke test the recipe, prompts, MCP server, and dashboard state without launching the client.",
      },
      {
        id: "handoff",
        title: `Move context into ${recipe.title}`,
        command: dashboardCommand,
        description: "Open the local dashboard, choose the packet, copy the recommended prompt, then paste it into the target client.",
      },
    ],
    recipe_command: `acb recipe ${recipe.id}`,
    handoff_command: handoffCommand,
    safety_command: safetyCommand,
    setup_check_command: setupCheckCommand,
    mcp_config_command: "acb config mcp --out ./mcp.json",
    mcp_verify_command: "acb verify mcp --config ./mcp.json --name acb",
    workflow_verify_command: workflowVerifyCommand,
    dashboard_command: dashboardCommand,
  };
}

function buildAgentInstructionPatch(recipe) {
  return [
    `Use ACB before continuing work in this workspace when the ACB MCP tools are available.`,
    "",
    "1. Call check_latest_handoff_ready before editing files.",
    "2. If the result is warning_dirty_workspace, do not refuse simple questions. For implementation work, ask whether the user wants you to recover the missed handoff; only after explicit confirmation call generate_missed_handoff, then read and summarize the generated packet.",
    "3. If the result is needs_refresh or needs_review, stop and explain the blocker to the user.",
    "4. If the handoff is ready, call read_latest_handoff or read_handoff_brief.",
    "5. If the packet summary starts with [Auto], use the captured packet body, Git status, and diff stat before spending extra tool calls re-reading the diff.",
    `6. Summarize the packet id, workspace, freshness, safety, and next action before making changes in ${recipe.title}.`,
    "7. After reading and summarizing the packet, call acknowledge_handoff with the packet id and your client or agent name.",
    "",
    "Do not assume hidden state beyond the ACB packet. Do not edit based on stale ACB context.",
  ].join("\n");
}

function buildSetupGuideForTarget({ target = null, workspace }) {
  const targets = detectDashboardTargets(workspace);
  const detectedTarget = target
    ? null
    : recommendDashboardTarget(targets);
  const targetId = target || detectedTarget.id;
  const recipe = findRecipe(targetId);
  if (!recipe) return { ok: false, error: `Unknown setup target: ${targetId}` };
  return {
    ok: true,
    recipe,
    guide: {
      ...buildSetupGuide(recipe, workspace),
      auto_selected: !target,
      detected_target: targets.find((item) => item.id === recipe.id) || null,
      detected_targets: targets.filter((item) => item.id !== "auto" && item.signals.length > 0),
    },
  };
}

function findDashboardTarget(targetId) {
  return DASHBOARD_TARGETS.find((target) => target.id === targetId || target.aliases.includes(targetId)) || null;
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

function dashboardDetectorSignals(detector, workspace) {
  if (detector.type === "command") {
    return commandExists(detector.value) ? [`command:${detector.value}`] : [];
  }

  const base = detector.type.startsWith("home-") ? os.homedir() : workspace;
  if (!base) return [];
  const targetPath = path.join(base, detector.value);
  if (detector.type.endsWith("file")) {
    return fileExists(targetPath) ? [`file:${targetPath}`] : [];
  }
  if (detector.type.endsWith("dir")) {
    if (detector.includes) {
      return dirIncludes(targetPath, detector.includes) ? [`dir:${targetPath}`] : [];
    }
    return dirExists(targetPath) ? [`dir:${targetPath}`] : [];
  }
  return [];
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function dirIncludes(dirPath, needle) {
  try {
    return fs.readdirSync(dirPath).some((entry) => entry.toLowerCase().includes(needle.toLowerCase()));
  } catch {
    return false;
  }
}

export {
  DASHBOARD_TARGETS,
  RECIPE_TARGETS,
  buildDashboardTargetGuides,
  buildSetupGuide,
  buildSetupGuideForTarget,
  detectDashboardTargets,
  findDashboardTarget,
  findRecipe,
  recipeSummary,
  recommendDashboardTarget,
};
