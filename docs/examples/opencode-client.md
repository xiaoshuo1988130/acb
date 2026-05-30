# OpenCode Client Handoff

This page shows how to use ACB when OpenCode is the receiving agent.

The recommended path is copy/paste first, then MCP pull mode after you have verified the local ACB side.

## Fast Path

In the project workspace, have the current agent save context:

```bash
acb handoff \
  --from codex \
  --summary "Ready for OpenCode to continue" \
  --status "Local changes are ready for review" \
  --note "OpenCode should summarize the packet before editing" \
  --git
```

Review before sharing:

```bash
acb safety
acb setup opencode --workspace . --check
```

Open the same workspace in OpenCode and paste the prompt copied by `acb handoff`.

If needed, render the prompt again:

```bash
acb resume
```

## First Prompt For OpenCode

Use this wording in OpenCode:

```text
Continue from this explicit ACB handoff.

Before making changes, summarize the packet id, workspace, summary, status, notes, Git snapshot, and safety warnings.
If the packet is missing or the workspace does not match, stop and ask me for the correct handoff.
```

## Confirm OpenCode Read It

Ask OpenCode to confirm:

- It can name the packet id.
- It can name the source agent from `from`.
- It can restate the summary and status.
- It can list the notes.
- It can say whether safety is `ok` or `warn`.
- It can identify the workspace path.
- It can mention the Git branch or dirty file count when a Git snapshot exists.

Compare against:

```bash
acb latest
acb safety
acb show <packet-id>
```

If OpenCode summarizes only your prompt but cannot name the packet id, it has not really loaded the handoff. Paste the full `acb resume --id <packet-id>` output again.

## Dashboard Path

The dashboard is useful when you are unsure which packet to send:

```bash
acb dashboard --workspace .
```

Use:

- `First handoff flow` for the Save/Safety/Verify/Copy sequence.
- `Safety` tab to inspect warnings.
- `Copy Brief Prompt` for a shorter OpenCode first message.
- `Copy Full Prompt` when the receiving agent needs all packet details immediately.

## MCP Pull Mode

After copy/paste works, configure MCP through the OpenCode-supported config path for your installed version.

Generate and verify the ACB side first:

```bash
acb config mcp --out ./mcp.json
acb verify mcp --config ./mcp.json --name acb
acb verify workflow opencode --workspace .
```

Then ask OpenCode:

```text
Use the ACB MCP tool read_latest_handoff for this workspace.
Summarize the packet id, workspace, summary, safety level, and notes before acting.
```

ACB does not patch OpenCode config or private state. Keep MCP setup explicit and reviewable.
