# Codex To OpenCode Handoff

This example shows the lowest-friction ACB workflow: one agent saves the current workspace context, then another agent receives a paste-ready prompt.

The same pattern works for Codex, OpenCode, Cline, Claude Code, local scripts, and terminals. ACB does not need private integration with any of them.

## 1. Check Your Setup

```bash
acb quickstart --check
```

You should see:

```text
ACB Quickstart Check
version: acb 0.5.0
package: @agentcontextbus/cli
store_readable: yes
clipboard_ready: yes
next_handoff: acb handoff --from codex --summary "Ready for the next agent" --git
next_resume: acb resume
```

If `clipboard_ready` is `no`, ACB will print prompts to the terminal instead.

## 2. Save The Handoff From Codex

Run this in the project workspace:

```bash
acb handoff \
  --from codex \
  --summary "Finished local store and quickstart check" \
  --status "Tests pass; ready for OpenCode to review docs" \
  --note "Do not publish until README wording is reviewed" \
  --git
```

ACB will:

- Save a local packet in `~/.acb/packets.json`.
- Capture the workspace path.
- Capture branch, short HEAD, and `git status --short`.
- Copy the rendered handoff prompt to your clipboard.

## 3. Resume In OpenCode

Open the same workspace in OpenCode.

Paste the prompt that ACB copied, or run:

```bash
acb resume
```

Then paste the copied resume prompt into OpenCode.

The receiving agent sees a concise packet with the summary, status, notes, workspace, and Git snapshot. It does not need to infer hidden state from the prior conversation.

## 4. Inspect Or Correct The Packet

Show the latest packet:

```bash
acb latest
```

Preview the exact prompt:

```bash
acb preview --open
```

Add a correction without recreating the packet:

```bash
acb update <packet-id> --note "Also check docs/recipes/mcp-clients.md"
```

Resume a specific packet:

```bash
acb resume --id <packet-id>
```

## 5. When To Use MCP Instead

Use copy/paste mode first. It works everywhere.

Use MCP pull mode when the receiving client supports MCP and you want the downstream agent to explicitly call ACB:

```bash
acb config mcp --out ./mcp.json
acb verify mcp --config ./mcp.json --name acb
```

Then ask the receiving agent:

```text
Use acb to read the latest handoff for this workspace, then continue from it.
```
