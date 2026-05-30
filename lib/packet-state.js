import {
  createWorkspaceFingerprint,
  fingerprintSummary,
} from "./fingerprint.js";
import {
  PROMPT_BODY_LIMIT,
  packetAcknowledgements,
  packetAcknowledgementSummary,
} from "./prompts.js";
import { readGitSnapshot } from "./git.js";
import { formatCommand } from "./runtime.js";

function createAcknowledgement({ by, note = null }) {
  const stamp = new Date().toISOString();
  const random = Math.random().toString(36).slice(2, 8);
  return {
    id: `ack_${stamp.replace(/[-:.TZ]/g, "").slice(0, 14)}_${random}`,
    acknowledged_at: stamp,
    by: String(by || "unknown").trim() || "unknown",
    note: typeof note === "string" && note.trim() ? note.trim() : null,
  };
}

function packetSummary(packet) {
  const safety = packetSafety(packet);
  const acknowledgement = packetAcknowledgementSummary(packet);
  const freshness = packetFreshnessSummary(packet);
  const readiness = packetReadinessSummary(packet);
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
    fingerprint_file_count: packet.fingerprint?.file_count || 0,
    watch_paths: packet.fingerprint?.watch_paths || [],
    acknowledged: acknowledgement.acknowledged,
    acknowledgement_count: acknowledgement.count,
    latest_acknowledgement: acknowledgement.latest,
    freshness,
    readiness,
    safety,
    event: packetTraceEvent(packet, safety, acknowledgement, freshness, readiness),
    ...packetNextCommands(packet),
  };
}

function packetTraceEvent(packet, safety = packetSafety(packet), acknowledgement = packetAcknowledgementSummary(packet), freshness = packetFreshnessSummary(packet), readiness = packetReadinessSummary(packet)) {
  return {
    event_type: "handoff_packet",
    event_id: `evt_${packet.id}`,
    packet_id: packet.id,
    created_at: packet.created_at,
    workspace: packet.workspace,
    actor: packet.from,
    summary: packet.summary || packet.status || null,
    safety_level: safety.level,
    acknowledged: acknowledgement.acknowledged,
    acknowledgement_count: acknowledgement.count,
    freshness_status: freshness.status,
    readiness_status: readiness.status,
    ready: readiness.ready,
  };
}

function packetWithNextSteps(packet) {
  const acknowledgement = packetAcknowledgementSummary(packet);
  const freshness = packetFreshnessSummary(packet);
  const readiness = packetReadinessSummary(packet);
  return {
    ...packet,
    acknowledgements: packetAcknowledgements(packet),
    acknowledgement,
    acknowledged: acknowledgement.acknowledged,
    acknowledgement_count: acknowledgement.count,
    latest_acknowledgement: acknowledgement.latest,
    freshness,
    readiness,
    safety: packetSafety(packet),
    ...packetNextCommands(packet),
  };
}

function packetNextCommands(packet) {
  return {
    next_resume: `acb resume --id ${packet.id}`,
    next_receive: `acb receive ${packet.id}`,
    next_brief: `acb brief --id ${packet.id}`,
    next_show_prompt: `acb show ${packet.id} --prompt`,
    next_ack: `acb ack ${packet.id} --by <agent>`,
    next_freshness: `acb freshness ${packet.id}`,
    next_ready: `acb ready ${packet.id}`,
    next_mcp_read: "read_handoff",
    next_mcp_brief: "read_handoff_brief",
    next_mcp_ack: "acknowledge_handoff",
    next_mcp_ready: "check_handoff_ready",
  };
}

function packetSafety(packet) {
  const warnings = [];
  const textParts = [
    packet.summary,
    packet.status,
    ...(packet.notes || []),
    ...(packet.tags || []),
    packet.body,
    ...(packet.git?.status || []),
  ].filter(Boolean);
  const searchable = textParts.join("\n");
  const sensitivePaths = findSensitivePathHints(packet);

  if (looksSecretLike(searchable)) {
    warnings.push({
      id: "secret_like_content",
      title: "possible secret-like content",
      detail: "Packet text contains token, key, password, or private-key shaped content. Review before sharing outside your local workflow.",
    });
  }

  if (sensitivePaths.length) {
    warnings.push({
      id: "sensitive_path",
      title: "sensitive-looking path",
      detail: `Found ${sensitivePaths.length} path hint(s), including ${sensitivePaths.slice(0, 3).join(", ")}.`,
    });
  }

  if ((packet.body?.length || 0) > PROMPT_BODY_LIMIT) {
    warnings.push({
      id: "large_body",
      title: "large context body",
      detail: `Body has ${packet.body.length} chars; prompts truncate body text at ${PROMPT_BODY_LIMIT} chars.`,
    });
  }

  return {
    level: warnings.length ? "warn" : "ok",
    warnings,
  };
}

function packetFreshnessSummary(packet) {
  if (!packet?.git && !packet?.fingerprint) {
    return {
      status: "unknown",
      reason: "no_freshness_snapshot",
      checked_at: null,
    };
  }
  const current = packet.git ? readGitSnapshot(packet.workspace) : { ok: true, snapshot: null };
  const currentFingerprint = packet.fingerprint
    ? createWorkspaceFingerprint(packet.workspace, packet.fingerprint.watch_paths || [])
    : { ok: true, fingerprint: null };
  if (!current.ok || !currentFingerprint.ok) {
    return {
      status: "unknown",
      reason: current.error ? "git_unavailable" : "fingerprint_unavailable",
      checked_at: new Date().toISOString(),
    };
  }
  const changes = [];
  if (packet.git && current.snapshot) {
    const packetStatus = packet.git.status || [];
    const currentStatus = current.snapshot.status || [];
    if ((packet.git.branch || null) !== (current.snapshot.branch || null)) changes.push("branch");
    if ((packet.git.head || null) !== (current.snapshot.head || null)) changes.push("head");
    if (packetStatus.length !== currentStatus.length) changes.push("dirty_count");
    else {
      const currentSet = new Set(currentStatus);
      if (packetStatus.some((line) => !currentSet.has(line))) changes.push("dirty_status");
    }
  }
  if (packet.fingerprint && currentFingerprint.fingerprint) {
    const fingerprintChanges = compareWorkspaceFingerprint(fingerprintSummary(packet.fingerprint), fingerprintSummary(currentFingerprint.fingerprint));
    if (fingerprintChanges.length) changes.push("watch_fingerprint");
  }
  return {
    status: changes.length ? "changed" : "fresh",
    reason: changes.length ? changes.join(",") : "freshness_snapshot_match",
    checked_at: new Date().toISOString(),
  };
}

function packetReadinessSummary(packet) {
  const readiness = evaluatePacketReadiness(packet);
  return {
    ready: readiness.ready,
    status: readiness.status,
    reason: readiness.reason,
    blocker_count: readiness.blockers.length,
    warning_count: readiness.warnings.length,
  };
}

function evaluatePacketReadiness(packet) {
  const safety = packetSafety(packet);
  const freshness = packetFreshnessSummary(packet);
  const acknowledgement = packetAcknowledgementSummary(packet);
  const bodyChars = packet.body?.length || 0;
  const hasContext = Boolean(
    bodyChars
    || packet.summary
    || packet.status
    || packet.notes?.length
    || packet.git?.status?.length
  );
  const blockers = [];
  const warnings = [];
  const checks = [];

  const addCheck = (id, status, detail) => checks.push({ id, status, detail });
  const addBlocker = (id, detail) => blockers.push({ id, detail });
  const addWarning = (id, detail) => warnings.push({ id, detail });

  if (freshness.status === "fresh") {
    addCheck("freshness", "ok", "Current freshness signals match the packet.");
  } else if (freshness.status === "changed") {
    addCheck("freshness", "fail", `Workspace changed since packet save (${freshness.reason}).`);
    addBlocker("freshness_changed", "Refresh the handoff before passing it to another agent.");
  } else {
    addCheck("freshness", "fail", `Freshness is unknown (${freshness.reason}).`);
    addBlocker("freshness_unknown", "Save the packet with --git or --watch, or refresh it before handoff.");
  }

  if (safety.level === "ok") {
    addCheck("safety", "ok", "No obvious safety warnings.");
  } else {
    addCheck("safety", "fail", `${safety.warnings.length} safety warning(s) need review.`);
    addBlocker("safety_review", "Review safety warnings before copying this packet to another agent.");
  }

  if (!hasContext) {
    addCheck("context", "fail", "Packet has no summary, status, notes, body, or Git status.");
    addBlocker("empty_context", "Add useful handoff context before using this packet.");
  } else if (!bodyChars) {
    addCheck("context", "warn", "Packet has no body; receiver will rely on summary, notes, and Git metadata.");
    addWarning("summary_only", "Consider refreshing with a body or notes if the next agent needs more detail.");
  } else if (bodyChars > PROMPT_BODY_LIMIT) {
    addCheck("context", "warn", `Body has ${bodyChars} chars and prompts may truncate it.`);
    addWarning("body_truncated", "Use full packet reads or MCP if the receiver needs the complete body.");
  } else {
    addCheck("context", "ok", `${bodyChars} body chars captured.`);
  }

  if (acknowledgement.acknowledged) {
    addCheck("acknowledgement", "ok", `Latest acknowledgement by ${acknowledgement.latest.by}.`);
  } else {
    addCheck("acknowledgement", "warn", "No receiving-side acknowledgement yet.");
    addWarning("pending_ack", "Ask the receiving agent to run acb ack after it reads the packet.");
  }

  const status = blockers.length
    ? blockers.some((blocker) => blocker.id.startsWith("freshness")) ? "needs_refresh" : "needs_review"
    : warnings.length ? "ready_with_notes" : "ready";
  const reason = blockers[0]?.detail
    || warnings[0]?.detail
    || "Packet is ready for handoff.";

  return {
    ready: blockers.length === 0,
    status,
    reason,
    checks,
    blockers,
    warnings,
    next: {
      show: `acb show ${packet.id}`,
      safety: `acb safety ${packet.id}`,
      freshness: `acb freshness ${packet.id}`,
      resume: `acb resume --id ${packet.id}`,
      ack: `acb ack ${packet.id} --by <agent>`,
      refresh_handoff: refreshHandoffCommand(packet),
    },
  };
}

function buildSafetyReport(packet, { workspace = null } = {}) {
  return {
    ok: packetSafety(packet).level === "ok",
    workspace: workspace || packet.workspace,
    packet: packetSummary(packet),
    safety: packetSafety(packet),
    limitation: "Safety hints are local review aids only; ACB does not silently redact, rewrite, or delete packet content.",
  };
}

function buildFreshnessReport(packet) {
  const acknowledgement = packetAcknowledgementSummary(packet);
  const packetGit = packet.git ? {
    root: packet.git.root || null,
    branch: packet.git.branch || null,
    head: packet.git.head || null,
    dirty_files: packet.git.status?.length || 0,
    status: packet.git.status || [],
  } : null;
  const packetFingerprint = packet.fingerprint ? fingerprintSummary(packet.fingerprint) : null;
  const next = {
    show: `acb show ${packet.id}`,
    refresh_handoff: refreshHandoffCommand(packet),
  };
  if (!packetGit && !packetFingerprint) {
    return {
      ok: false,
      status: "unknown",
      reason: "Packet has no Git snapshot or workspace fingerprint. Save with --git or --watch to enable freshness checks.",
      packet: packetSummary(packet),
      acknowledged: acknowledgement.acknowledged,
      packet_git: null,
      current_git: null,
      packet_fingerprint: null,
      current_fingerprint: null,
      changes: [],
      next,
    };
  }

  const current = packetGit ? readGitSnapshot(packet.workspace) : { ok: true, snapshot: null };
  const currentFingerprint = packetFingerprint
    ? createWorkspaceFingerprint(packet.workspace, packet.fingerprint.watch_paths || [])
    : { ok: true, fingerprint: null };
  if (!current.ok || !currentFingerprint.ok) {
    return {
      ok: false,
      status: "unknown",
      reason: current.error || currentFingerprint.error,
      packet: packetSummary(packet),
      acknowledged: acknowledgement.acknowledged,
      packet_git: packetGit,
      current_git: null,
      packet_fingerprint: packetFingerprint,
      current_fingerprint: null,
      changes: [],
      next,
    };
  }

  const currentGit = current.snapshot ? {
    root: current.snapshot.root || null,
    branch: current.snapshot.branch || null,
    head: current.snapshot.head || null,
    dirty_files: current.snapshot.status?.length || 0,
    status: current.snapshot.status || [],
  } : null;
  const currentFingerprintSummary = currentFingerprint.fingerprint ? fingerprintSummary(currentFingerprint.fingerprint) : null;
  const changes = [];
  if (packetGit && currentGit) changes.push(...compareGitSnapshot(packetGit, currentGit));
  if (packetFingerprint && currentFingerprintSummary) changes.push(...compareWorkspaceFingerprint(packetFingerprint, currentFingerprintSummary));

  const status = changes.length ? "changed" : "fresh";
  return {
    ok: status === "fresh",
    status,
    reason: status === "fresh" ? "Current freshness signals match the packet snapshot." : "Current freshness signals differ from the packet snapshot.",
    packet: packetSummary(packet),
    acknowledged: acknowledgement.acknowledged,
    packet_git: packetGit,
    current_git: currentGit,
    packet_fingerprint: packetFingerprint,
    current_fingerprint: currentFingerprintSummary,
    changes,
    next,
  };
}

function buildReadyReport(packet) {
  const readiness = evaluatePacketReadiness(packet);
  return {
    ready: readiness.ready,
    ok: readiness.ready,
    status: readiness.status,
    reason: readiness.reason,
    packet: packetSummary(packet),
    checks: readiness.checks,
    blockers: readiness.blockers,
    warnings: readiness.warnings,
    next: readiness.next,
  };
}

function compareGitSnapshot(packetGit, currentGit) {
  const changes = [];
  if (packetGit.root && currentGit.root && packetGit.root !== currentGit.root) changes.push(`git root changed: ${packetGit.root} -> ${currentGit.root}`);
  if (packetGit.branch !== currentGit.branch) changes.push(`branch changed: ${packetGit.branch || "unknown"} -> ${currentGit.branch || "unknown"}`);
  if (packetGit.head !== currentGit.head) changes.push(`HEAD changed: ${packetGit.head || "unknown"} -> ${currentGit.head || "unknown"}`);
  if (packetGit.dirty_files !== currentGit.dirty_files) changes.push(`dirty file count changed: ${packetGit.dirty_files} -> ${currentGit.dirty_files}`);
  const packetStatus = new Set(packetGit.status);
  const currentStatus = new Set(currentGit.status);
  const added = currentGit.status.filter((line) => !packetStatus.has(line));
  const removed = packetGit.status.filter((line) => !currentStatus.has(line));
  if (added.length) changes.push(`new dirty status: ${added.slice(0, 5).join("; ")}`);
  if (removed.length) changes.push(`resolved dirty status: ${removed.slice(0, 5).join("; ")}`);
  return changes;
}

function compareWorkspaceFingerprint(packetFingerprint, currentFingerprint) {
  const changes = [];
  const packetEntries = new Map((packetFingerprint.entries || []).map((entry) => [entry.path, entry]));
  const currentEntries = new Map((currentFingerprint.entries || []).map((entry) => [entry.path, entry]));
  for (const [entryPath, current] of currentEntries) {
    const saved = packetEntries.get(entryPath);
    if (!saved) {
      changes.push(`watch path added: ${entryPath}`);
      continue;
    }
    if (saved.type !== current.type) changes.push(`watch path type changed: ${entryPath}`);
    else if (saved.type === "file" && saved.sha256 !== current.sha256) changes.push(`watch file changed: ${entryPath}`);
  }
  for (const entryPath of packetEntries.keys()) {
    if (!currentEntries.has(entryPath)) changes.push(`watch path removed: ${entryPath}`);
  }
  return changes.slice(0, 20);
}

function refreshHandoffCommand(packet) {
  const args = ["handoff", "--workspace", packet.workspace, "--summary", "Refresh handoff context"];
  if (packet.git) args.push("--git");
  const watchPaths = packet.fingerprint?.watch_paths || [];
  for (const watchPath of watchPaths) args.push("--watch", watchPath);
  if (!packet.git && !watchPaths.length) args.push("--git");
  return formatCommand("acb", args);
}

function looksSecretLike(text) {
  if (!text) return false;
  const patterns = [
    /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|private[_-]?key)\b\s*[:=]/i,
    /\b(?:npm|gh[pousr]|sk|pk|rk)_[A-Za-z0-9_=-]{16,}\b/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function findSensitivePathHints(packet) {
  const values = [
    packet.body,
    ...(packet.notes || []),
    ...(packet.git?.status || []),
  ].filter(Boolean);
  const matches = new Set();
  const patterns = [
    /(?:^|[/\\])\.env(?:\.[A-Za-z0-9_-]+)?\b/g,
    /(?:^|[/\\])\.npmrc\b/g,
    /(?:^|[/\\])\.netrc\b/g,
    /(?:^|[/\\])id_rsa\b/g,
    /(?:^|[/\\])[^/\s\\]+\.(?:pem|p8|key)\b/g,
  ];
  for (const value of values) {
    for (const pattern of patterns) {
      for (const match of String(value).matchAll(pattern)) {
        matches.add(match[0].replace(/^[\\/]/, ""));
      }
    }
  }
  return [...matches];
}

export {
  buildFreshnessReport,
  buildReadyReport,
  buildSafetyReport,
  compareGitSnapshot,
  compareWorkspaceFingerprint,
  createAcknowledgement,
  evaluatePacketReadiness,
  packetFreshnessSummary,
  packetReadinessSummary,
  packetSafety,
  packetSummary,
  packetTraceEvent,
  packetWithNextSteps,
  refreshHandoffCommand,
};
