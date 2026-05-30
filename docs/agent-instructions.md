# Agent Instructions

ACB works best when the receiving coding agent knows it should check the local handoff before editing files.

This page gives you copyable instruction patches for MCP-capable clients. They do not modify client files automatically. Paste them into the client area where you normally keep custom instructions, system prompts, project rules, or agent profile instructions.

## What Changes After Setup

Without MCP-aware instructions, the receiving side is mostly manual: the user runs `acb receive`, copies the rendered prompt, pastes it into the next agent, and later records acknowledgement.

With MCP configured once and these instructions in place, the receiving agent can proactively check ACB at the start of a workspace session:

```text
old path: human runs handoff -> human switches tools -> human runs receive -> human pastes context -> agent continues
new path: human runs handoff -> human switches tools -> agent checks ACB -> agent reads the handoff -> agent summarizes it -> agent continues
```

This is not hidden automation. The setup is explicit, and the agent should not silently start editing. It should first report the packet id, workspace, freshness, safety status, and intended next action.

## Generic MCP Instruction

Use this with any client that can call the ACB MCP tools:

```text
When starting work in a workspace, check whether the ACB MCP tools are available.

If ACB tools are available:
1. Call check_latest_handoff_ready for the current workspace before editing files.
2. If the result is needs_refresh or needs_review, stop and tell the user the blocker. Do not continue from stale or unsafe handoff context.
3. If the handoff is ready, call read_latest_handoff or read_handoff_brief.
4. Summarize the packet id, workspace, summary, freshness, safety, and next action before making changes.
5. After you have read and summarized the packet, call acknowledge_handoff with the packet id and your agent name.

Do not assume hidden state beyond the ACB packet. If ACB is unavailable or no packet exists, say that clearly and continue only with the user's visible instructions.
```

## Cline And Roo Code

Paste this into the client instructions or rules area you already control. Do not let ACB edit VS Code extension storage or private client databases.

```text
Before editing files in a new task, check whether the ACB MCP server is available.

If available, call check_latest_handoff_ready for this workspace.

- If status is needs_refresh, stop and ask the user to refresh the ACB handoff.
- If status is needs_review, stop and summarize the safety or context blocker.
- If status is ready or ready_with_notes, call read_latest_handoff or read_handoff_brief.

Before making changes, summarize:
- packet id
- workspace
- summary/status
- freshness status
- safety level and warnings
- intended next action

After reading the handoff, call acknowledge_handoff with the packet id and the agent name.

Do not edit files based on stale ACB context. Do not assume ACB silently injected context; only use what you explicitly read from ACB.
```

## Claude Desktop

Claude Desktop can use ACB through a local MCP server configuration. After adding the generated `acb` server entry, paste this into project or chat instructions:

```text
At the beginning of this project chat, use the ACB MCP server if it is available.

First call check_latest_handoff_ready for the current workspace.
If the handoff is not ready, explain the blocker and ask whether the user wants to refresh it.
If the handoff is ready, call read_latest_handoff.

Before editing or proposing code changes, summarize the ACB packet id, workspace, summary, freshness, safety status, and any notes.

After reading the packet, call acknowledge_handoff with the packet id and your client name.
```

## OpenCode

OpenCode users can use copy/paste handoff or MCP pull mode. When using MCP, give the receiving agent this instruction:

```text
Use ACB before continuing this workspace.

1. Call check_latest_handoff_ready.
2. If the result is not ready, stop and explain the blocker.
3. If ready, call read_latest_handoff.
4. Summarize the handoff packet before editing files.
5. Call acknowledge_handoff with the packet id after reading.

Preserve user edits and do not publish, release, or push unless the user explicitly asks.
```

## Codex Or Scripted Clients

If your receiving environment cannot call MCP tools directly, use the CLI gate instead:

```bash
acb receive --latest
```

For a compact first message:

```bash
acb receive --latest --brief
```

For scripts:

```bash
acb ready --latest --json
acb latest --json
```

## Why This Matters

Without instructions, an MCP tool can sit idle: the client may know that the tool exists but not know when it should call it.

The safest ACB pattern is:

```text
explicit setup -> proactive readiness check -> explicit read -> summarize -> acknowledge
```

This lowers friction without hidden prompt injection, client config mutation, or a background gateway.
