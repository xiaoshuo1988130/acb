const PROMPT_BODY_LIMIT = 12000;
const BRIEF_BODY_LIMIT = 1800;

function renderHandoffPrompt(packet) {
  const acknowledgement = packetAcknowledgementSummary(packet);
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
  lines.push(`- acknowledged: ${acknowledgement.acknowledged ? "yes" : "no"}`);
  if (acknowledgement.latest) lines.push(`- latest_acknowledgement: ${acknowledgement.latest.by} at ${acknowledgement.latest.acknowledged_at}`);
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
    `- After you summarize this packet, record receipt with: acb ack ${packet.id} --by <agent>`,
    "- If anything is ambiguous or risky, ask one concise question before making changes.",
    "- Preserve user edits and verify before proposing any release or publish step.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function renderBriefPrompt(packet) {
  const acknowledgement = packetAcknowledgementSummary(packet);
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
  lines.push(`- acknowledged: ${acknowledgement.acknowledged ? "yes" : "no"}`);
  if (acknowledgement.latest) lines.push(`- latest_acknowledgement: ${acknowledgement.latest.by} at ${acknowledgement.latest.acknowledged_at}`);
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
    `- After you summarize this packet, record receipt with: acb ack ${packet.id} --by <agent>`,
    "- Inspect the workspace before editing files.",
    "- Ask one concise question if the brief is insufficient.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function renderMcpTakeoverInstruction(packet, target = null) {
  const client = target && target.id !== "auto" ? ` in ${target.title}` : "";
  return [
    `Use acb${client} to read this handoff before acting.`,
    "",
    `Call the ACB MCP tool read_handoff with id: ${packet.id}`,
    "",
    "After loading it, summarize the packet you read and continue from that context.",
    "Do not assume hidden state beyond the ACB packet.",
    "",
  ].join("\n");
}

function packetAcknowledgementSummary(packet) {
  const acknowledgements = packetAcknowledgements(packet);
  const latest = acknowledgements[acknowledgements.length - 1] || null;
  return {
    acknowledged: acknowledgements.length > 0,
    count: acknowledgements.length,
    latest,
  };
}

function packetAcknowledgements(packet) {
  if (!Array.isArray(packet?.acknowledgements)) return [];
  return packet.acknowledgements
    .filter((ack) => ack && typeof ack.acknowledged_at === "string" && typeof ack.by === "string")
    .map((ack) => ({
      id: typeof ack.id === "string" && ack.id ? ack.id : `ack_${String(ack.acknowledged_at).replace(/[^0-9]/g, "").slice(0, 14) || "legacy"}`,
      acknowledged_at: ack.acknowledged_at,
      by: ack.by,
      note: typeof ack.note === "string" && ack.note.trim() ? ack.note : null,
    }));
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

export {
  PROMPT_BODY_LIMIT,
  renderBriefPrompt,
  renderHandoffPrompt,
  renderMcpTakeoverInstruction,
  packetAcknowledgements,
  packetAcknowledgementSummary,
};
