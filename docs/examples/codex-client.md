# Codex Client Handoff

This page shows how to use ACB when Codex is the receiving agent.

Use this when work started in another tool, terminal, or agent, and you want Codex to continue without relying on hidden conversation state.

## Fast Path

In the project workspace, have the current agent save context:

```bash
acb handoff \
  --from opencode \
  --summary "Ready for Codex to continue" \
  --status "Implementation is local; tests pass" \
  --note "Inspect the handoff before editing" \
  --git
```

Review the packet before sharing:

```bash
acb safety
acb latest
```

Then open Codex in the same workspace and paste the prompt copied by `acb handoff`.

If the clipboard was not available, run:

```bash
acb resume
```

Paste the printed prompt into Codex.

## First Prompt For Codex

Use this wording when you paste into Codex:

```text
Continue from this explicit ACB handoff.

First, summarize the packet id, workspace, summary, status, notes, and any safety warnings you loaded.
Then inspect the workspace before editing files.
Do not assume hidden state from another chat.
```

## Confirm Codex Read It

Before Codex edits files, ask it to report these exact checks:

- Packet id starts with `pkt_`.
- Workspace path matches the project you opened.
- Summary matches the `acb handoff --summary` text.
- Notes include the handoff notes you provided.
- Safety level is `ok`, or Codex names the warning and waits for your decision.
- Git branch and dirty file count match `acb show <packet-id>`.

You can verify from a terminal:

```bash
acb latest
acb safety
acb show <packet-id>
```

After Codex confirms those fields, record the closure:

```bash
acb ack <packet-id> --by codex --note "Codex summarized the packet and continued from it."
```

If Codex cannot name the packet id, ask it to stop and paste the `acb resume --id <packet-id>` output again.

## JSON Path For Scripts

If you are using a script around Codex, avoid parsing human text:

```bash
acb latest --json
acb setup codex --workspace . --json
```

The setup JSON contains:

- `steps`
- `handoff_command`
- `safety_command`
- `workflow_verify_command`
- `dashboard_command`

## MCP Pull Mode

If your Codex environment can use MCP tools, configure ACB explicitly:

```bash
acb config mcp --out ./mcp.json
acb verify mcp --config ./mcp.json --name acb
```

Then ask Codex:

```text
Use the ACB MCP tool read_latest_handoff for this workspace.
Before editing files, summarize the packet id, workspace, safety level, and notes you loaded.
```

ACB does not edit Codex settings or inject hidden prompt text. You decide where to paste the prompt or how to configure MCP.
