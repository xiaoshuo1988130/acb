# Local-First Design

ACB starts as a local command-line tool.

## Storage

Default store:

```text
~/.acb/packets.json
```

Override for tests or per-project experiments:

```bash
ACB_STORE=./tmp/acb-packets.json acb save --summary "..."
```

## Packet Shape

```json
{
  "id": "pkt_20260527123000_abc123",
  "version": 1,
  "created_at": "2026-05-27T12:30:00.000Z",
  "updated_at": "2026-05-27T12:45:00.000Z",
  "from": "codex",
  "workspace": "/path/to/workspace",
  "summary": "What changed",
  "status": "Current state",
  "notes": ["Risks, blockers, next steps"],
  "tags": ["local", "handoff"],
  "body": "Optional longer context loaded from --file or --stdin",
  "git": {
    "root": "/path/to/workspace",
    "branch": "main",
    "head": "abc1234",
    "status": [" M README.md", "?? docs/notes.md"]
  }
}
```

## Context Body

Short handoffs can live in `--summary`, `--status`, and repeated `--note` flags.

Longer handoffs should use one explicit body source:

```bash
acb save --summary "Design handoff" --file ./handoff.md
cat ./agent-output.txt | acb save --summary "Prior agent output" --stdin
```

`--file` and `--stdin` are mutually exclusive. ACB stores the body locally, and `acb resume` includes it under `## Context Body`.

Prompt rendering caps the body section so a very large log does not accidentally flood the next agent context. The local packet still keeps the original body.

When the user is ready to move immediately, `save` can render the prompt in the same step:

```bash
acb handoff --summary "Ready for another agent" --git
acb save --summary "Ready for another agent" --git --copy
acb save --summary "Scripted handoff" --stdin --print-prompt
acb save --summary "Scripted handoff" --json
```

`acb handoff` is the primary one-step entrypoint and defaults to copying the rendered prompt. `--copy` writes the rendered handoff prompt to the system clipboard. If clipboard access fails, ACB prints the prompt instead. `--print-prompt` skips the clipboard and writes the rendered prompt to stdout. `--json` skips human output and writes the created packet as JSON.

The downstream side uses `resume`:

```bash
acb resume
acb resume --workspace /path/to/workspace --print-prompt
acb resume --id pkt_20260527123000_abc123 --json
acb resume --id pkt_20260527123000_abc123 --preview --open
```

`acb resume` copies the latest handoff prompt for the current workspace. `--preview` writes the same Markdown review file as `acb preview`, and `--open` opens it. It is a named entrypoint for the receiving side of the handoff; the older `acb prompt` command remains available.

Existing packets can be corrected without deleting and recreating them:

```bash
acb update pkt_20260527123000_abc123 --status "ready" --note "Follow-up tests passed"
acb update pkt_20260527123000_abc123 --clear-tags --tag review
acb update pkt_20260527123000_abc123 --file ./updated-handoff.md
```

`acb update` preserves `created_at` and sets `updated_at`. Notes and tags are appended by default; use `--clear-notes` or `--clear-tags` when you intentionally want to replace those lists.

`acb preview` writes the current workspace handoff prompt to a Markdown file:

```bash
acb preview
acb preview --id pkt_20260527123000_abc123 --out ./handoff-preview.md
acb preview --open
```

This is an explicit review path. It does not inject anything into another tool.

## Git Snapshot

Coding-agent handoff often needs one small fact: what files are dirty right now?

Use `--git` to attach a lightweight snapshot:

```bash
acb save --summary "Ready for another agent" --git
acb save --summary "Review current changes" --diff
acb diff-preview --out ./handoff-diff.md
```

ACB records:

- Repository root
- Current branch
- Short HEAD
- `git status --short`

It intentionally does not capture `git diff` by default. Use `--diff` when the next agent needs the tracked staged and unstaged diff relative to `HEAD`. `--diff` is bounded by `--diff-limit` and does not include untracked file contents.

## Clipboard

ACB uses platform clipboard commands:

- macOS: `pbcopy`
- Windows: `clip.exe`
- Linux Wayland: `wl-copy`
- Linux X11: `xclip` or `xsel`

If clipboard access fails, ACB prints the prompt. Linux users may need to install `wl-clipboard`, `xclip`, or `xsel`.

## Doctor

`acb status` is the quick workspace view.

It reports the current workspace, packet count, latest packet summary, Git state, and the next concrete CLI and MCP commands to resume, inspect, read, or save the handoff prompt.

`acb latest` also defaults to the current workspace. Use `acb latest --all` only when you explicitly want the newest packet across every workspace.

Single-packet reads (`acb latest --json`, `acb show --json`, `read_latest_handoff`, and `read_handoff`) return the stored packet plus derived `next_resume`, `next_show_prompt`, and `next_mcp_read` fields. These fields are not written back into the packet store.

`acb doctor` is a read-only local environment check.

It reports:

- Store path
- Total packet count
- Current workspace packet count
- Git command availability and workspace detection
- Clipboard command availability
- Whether the default `acb` command is visible on `PATH` for MCP clients
- Copyable MCP config and verify commands

It does not copy anything to the clipboard and does not modify the packet store.

If the local store is malformed, ACB fails closed: write commands do not overwrite the file. `acb doctor` reports `store_readable: no` and prints the parse or shape error so the user can inspect or restore the file manually.

Use `acb store backup` before destructive maintenance:

```bash
acb store info
acb store backup
acb store backup --out ./acb-store.backup.json
```

`acb store info` prints path, readability, packet count, byte size, and modified time. The backup command copies the raw store file without parsing it, so it can still preserve a malformed store before manual repair.

## Terminal Timeline

`acb workspaces` lists local workspaces that have handoff history:

```bash
acb workspaces
acb workspaces --json
```

This is the first multi-project view. It shows packet counts, the latest packet per workspace, and a copyable `next_resume` command without assuming any third-party client integration.

`acb search` keeps local history useful once packets accumulate:

```bash
acb search "schema"
acb search "handoff" --workspace .
acb search "blocked" --all --json
```

It searches packet ids, source agent names, workspace paths, summaries, statuses, notes, tags, body text, and lightweight Git metadata. It defaults to the current workspace; use `--all` for cross-workspace search.

JSON packet summaries include `next_resume`, `next_show_prompt`, and `next_mcp_read` so scripts and MCP-capable clients can move from discovery to ingestion without reconstructing commands.

`acb timeline` is the first visualization layer.

It prints recent handoff packets with:

- Timestamp
- Source agent
- Packet id
- Summary or status
- Workspace
- Compact facts such as note count, body size, dirty file count, and tags

This deliberately comes before a web dashboard. It validates whether handoff history is useful in daily work without adding frontend complexity.

`acb list`, `acb timeline`, and `acb export` also default to the current workspace. Use `--all` when you intentionally want to inspect or export cross-workspace history.

## Export

`acb export` is a read-only bridge from local packets to portable artifacts.

Examples:

```bash
acb export --workspace . --format markdown --out ./handoffs.md
acb export --workspace . --format json --out ./handoffs.json
acb export --all --format markdown --out ./all-handoffs.md
```

Markdown export is for human review and copy/paste sharing. JSON export is for future viewers, scripts, or local analysis.

`acb import` restores JSON exports:

```bash
acb import --file ./handoffs.json
acb import --file ./handoffs.json --replace
```

Only JSON exports are importable. Markdown remains a human review format. By default, import skips duplicate packet ids; `--replace` overwrites existing packets with the imported version.

## MCP Pull

`acb serve` exposes the local packet store as a stdio MCP server.

Initial tools:

- `get_workspace_status`: reports current packet count, latest handoff, Git state, and next CLI/MCP commands for a workspace.
- `read_latest_handoff`: returns the newest handoff prompt for a workspace.
- `save_handoff`: saves an explicit local handoff packet from an MCP-capable agent.
- `update_handoff`: corrects an existing handoff packet while preserving its original creation time.
- `read_handoff`: returns a specific handoff prompt by packet id.
- `search_handoffs`: searches local handoff history.
- `list_workspaces`: lists local workspaces with handoff history.
- `list_handoffs`: returns recent packet summaries without expanding full body text.

This keeps both export and ingestion explicit. An upstream agent must call `save_handoff`; a downstream agent must call a read tool. ACB does not silently inject context into the model request.

Example MCP server config shape:

Generate it:

```bash
acb config mcp
acb config mcp --command /absolute/path/to/acb --name local-acb
acb config mcp --command node --arg /absolute/path/to/bin/acb.js --arg serve --name local-acb
acb config mcp --out ./mcp.json
```

Example output:

```json
{
  "mcpServers": {
    "acb": {
      "command": "acb",
      "args": ["serve"]
    }
  }
}
```

Before copying a config into an MCP client, smoke test it:

```bash
acb verify mcp --config ./mcp.json --name acb
acb verify mcp --config ./mcp.json --name acb --json
```

`verify mcp` launches the configured stdio server, sends `initialize`, checks `tools/list` for the expected ACB handoff tools, and calls `get_workspace_status` once. It does not modify any client config.

Recommended first message in a new session:

```text
Use acb to read the latest handoff for this workspace, then continue from it.
```
