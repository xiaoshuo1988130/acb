# FAQ

## Does ACB start automatically?

No. ACB only runs when you invoke the CLI, MCP server, or dashboard command.

Start the dashboard explicitly:

```bash
acb dashboard --workspace .
```

Stop it with `Ctrl+C`.

## Why not auto-start the dashboard?

Because ACB is designed as an explicit local handoff tool, not a background agent. Auto-starting would make it harder to reason about what is running, what is exposed on localhost, and when clipboard-copy controls are available.

## Does ACB edit Cline, Roo, OpenCode, VS Code, or Claude Desktop settings?

No. ACB does not patch client config files, extension storage, private databases, or app state.

It can generate commands and MCP config snippets:

```bash
acb config mcp --out ./mcp.json
acb setup opencode --workspace . --check
```

You decide where to paste those settings.

## What if clipboard copy does not work?

ACB prints the prompt to the terminal when clipboard access is unavailable.

You can also force terminal output:

```bash
acb receive --latest --print-prompt
acb resume --print-prompt
acb brief --print-brief
acb show <packet-id> --prompt
```

## How do I know the next agent really read the handoff?

Ask it to summarize concrete packet fields before it edits files:

- Packet id.
- Workspace path.
- Summary and status.
- Notes.
- Safety level and warnings.
- Git branch and dirty file count, when available.

If it cannot name the packet id, paste the full `acb resume --id <packet-id>` output again.

## How do I know the handoff is still current?

If the packet was saved with `--git`, run:

```bash
acb freshness --latest
```

ACB compares the packet's saved Git snapshot with the current workspace. It reports `fresh`, `changed`, or `unknown`.

## Is this packet ready to hand off?

Run:

```bash
acb ready --latest
```

This is the combined pre-handoff gate. It checks freshness, safety warnings, context-body coverage, and acknowledgement state, then prints `ready: yes` or `ready: no` with the next command to run.

If you want the receiving-side one-step path, run `acb receive --latest`. It uses the same readiness gate and copies the prompt only when the packet is safe enough to receive.

## Are safety warnings redactions?

No. Safety hints are read-time review aids. ACB does not silently redact, rewrite, or delete packet content.

Review warnings with:

```bash
acb safety
```

## Where is the data stored?

By default:

```text
~/.acb/packets.json
```

Use `ACB_STORE` for experiments:

```bash
ACB_STORE=./tmp/acb-packets.json acb demo
```

## Does ACB sync to the cloud?

No. There is no hosted dashboard or cloud sync in the current product. Dashboard data is served from your local store.

## Can I use ACB with MCP?

Yes. Generate and verify a local stdio MCP config:

```bash
acb config mcp --out ./mcp.json
acb verify mcp --config ./mcp.json --name acb
```

Then configure your MCP-capable client through that client's supported settings path.

## Which command should I run first?

For a quick visual demo:

```bash
npx @xiaoshuo1988/acb@latest quickstart --check
npx @xiaoshuo1988/acb@latest demo
npx @xiaoshuo1988/acb@latest dashboard --workspace .
```

For a no-store smoke test:

```bash
npx @xiaoshuo1988/acb@latest verify first-run
```
