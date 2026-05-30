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

ACB derives safety hints when packets are read, exported, or shown in the dashboard. The current hints flag secret-like text, sensitive-looking paths such as `.env`, `.npmrc`, private-key files, and large bodies that will be truncated in prompts. These hints are not stored in the packet and do not redact content; they are local review aids before the user copies context into another agent.

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

For the guarded receiving-side path, use `receive`:

```bash
acb receive --latest
acb receive --workspace /path/to/workspace --brief
acb receive pkt_20260527123000_abc123 --print-prompt
acb receive pkt_20260527123000_abc123 --json
```

`acb receive` combines `ready` with prompt rendering. It refuses packets that fail freshness, safety, or context coverage blockers before copying text. When the packet is ready, it copies the full takeover prompt by default, or a compact brief with `--brief`. It does not mutate the store, start clients, inject prompt text, or mark acknowledgement automatically; the receiving agent should still summarize the packet and then run `acb ack`.

For a shorter receiving-side first message, use `brief`:

```bash
acb brief
acb brief --workspace /path/to/workspace --print-brief
acb brief --id pkt_20260527123000_abc123 --json
```

`acb brief` copies a compact takeover prompt by default. It includes packet identity, summary, status, notes, Git facts, a bounded body excerpt, and commands for pulling the full context. It is useful when a client input box is small or when you want the next agent to decide whether it needs the complete prompt.

Existing packets can be corrected without deleting and recreating them:

```bash
acb update pkt_20260527123000_abc123 --status "ready" --note "Follow-up tests passed"
acb update pkt_20260527123000_abc123 --clear-tags --tag review
acb update pkt_20260527123000_abc123 --file ./updated-handoff.md
```

`acb update` preserves `created_at` and sets `updated_at`. Notes and tags are appended by default; use `--clear-notes` or `--clear-tags` when you intentionally want to replace those lists.

Receiving agents can close the loop explicitly:

```bash
acb ack pkt_20260527123000_abc123 --by opencode --note "Read packet and continuing from it."
```

`ack` appends an acknowledgement entry to the packet. It does not infer client behavior, watch third-party apps, or auto-mark packets as received.

Older packets can be checked against the current freshness snapshot before handoff:

```bash
acb freshness pkt_20260527123000_abc123
acb freshness --workspace .
```

Freshness is derived at read time. It does not watch files continuously or update the store. Packets without a Git snapshot or explicit workspace fingerprint report `unknown`; packets whose saved branch, HEAD, dirty status, or watched file fingerprint differs from the current workspace report `changed`.

`acb ready` is the combined pre-handoff gate:

```bash
acb ready pkt_20260527123000_abc123
acb ready --workspace .
```

It evaluates freshness, safety warnings, body coverage, and receiving-side acknowledgement state. Freshness drift, missing freshness snapshots, safety warnings, or empty context become blockers; summary-only bodies and pending acknowledgement become warnings. The command does not mutate the store, copy text, start clients, or mark acknowledgement automatically.

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
acb handoff --git
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

If `--summary` is omitted while saving with `--git`, ACB generates an `[Auto]` summary from the local Git snapshot and adds a compact body with branch, HEAD, `git status --short`, and bounded diff statistics. This keeps the sending side low-friction without forcing the receiving agent to spend extra tool calls just to rediscover the basic workspace shape.

## Workspace Fingerprint

Git is the default freshness guard, but some handoffs depend on explicit non-Git or ignored local files. ACB supports opt-in fingerprints for those paths:

```bash
acb save --summary "Ready for another agent" --watch README.md --watch package.json
```

You can also create `.acb/watch` in the workspace, one relative path per line:

```text
README.md
package.json
docs
```

ACB fingerprints only these explicit paths. It does not scan the whole workspace by default, and it does not auto-discover ignored sensitive files. Directory watches are bounded and skip `.git`, `node_modules`, and `.DS_Store`.

## Clipboard

ACB uses platform clipboard commands:

- macOS: `pbcopy`
- Windows: `clip.exe`
- Linux Wayland: `wl-copy`
- Linux X11: `xclip` or `xsel`

If clipboard access fails, ACB prints the prompt. Linux users may need to install `wl-clipboard`, `xclip`, or `xsel`.

## Doctor

`acb status` is the quick workspace view.

It reports the current workspace, packet count, latest packet summary, Git state, and the next concrete CLI and MCP commands to resume, brief, inspect, read, or save the handoff prompt.

`acb latest` also defaults to the current workspace. Use `acb latest --all` only when you explicitly want the newest packet across every workspace.

Single-packet reads (`acb latest --json`, `acb show --json`, `read_latest_handoff`, `read_handoff_brief`, and `read_handoff`) return the stored packet plus derived `acknowledgement`, `freshness`, `readiness`, `next_receive`, `next_resume`, `next_brief`, `next_ack`, `next_freshness`, `next_ready`, `next_show_prompt`, `next_mcp_read`, `next_mcp_brief`, `next_mcp_ack`, and `next_mcp_ready` fields. These fields are not written back into the packet store.

`acb doctor` is a read-only local environment check.

It reports:

- Store path
- Total packet count
- Current workspace packet count
- Git command availability and workspace detection
- Clipboard command availability
- Whether the default `acb` command is visible on `PATH` for MCP clients
- Copyable MCP config and verify commands
- Install and local MCP config hints when `acb` is not available on `PATH`

It does not copy anything to the clipboard and does not modify the packet store.

`acb quickstart --check` is the new-user version of the same readiness check. It keeps the output short and reports the installed version, store readability, clipboard fallback status, current workspace, recommended target client, and the next `setup`, `handoff`, `resume`, `dashboard`, `verify workflow`, `doctor`, and MCP commands. `acb setup --check` then turns that recommendation into a guided setup page plus the same ACB-side workflow smoke test, without launching or mutating the selected client.

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

This is the first multi-project view. It shows packet counts, the latest packet per workspace, and copyable `next_receive` and `next_resume` commands without assuming any third-party client integration.

`acb search` keeps local history useful once packets accumulate:

```bash
acb search "schema"
acb search "handoff" --workspace .
acb search "blocked" --all --json
```

It searches packet ids, source agent names, workspace paths, summaries, statuses, notes, tags, body text, and lightweight Git metadata. It defaults to the current workspace; use `--all` for cross-workspace search.

JSON packet summaries include `next_receive`, `next_resume`, `next_show_prompt`, and `next_mcp_read` so scripts and MCP-capable clients can move from discovery to ingestion without reconstructing commands.

`acb timeline` is the first visualization layer.

It prints recent handoff packets with:

- Timestamp
- Source agent
- Packet id
- Summary or status
- Workspace
- Compact facts such as note count, body size, dirty file count, and tags

Timeline JSON also includes an additive `event` object with `event_type: "handoff_packet"`, packet id, workspace, source agent, summary, and safety level. This gives scripts a lightweight trace surface without introducing a daemon or external event log.

This deliberately comes before a web dashboard. It validates whether handoff history is useful in daily work without adding frontend complexity.

`acb view` is the next visual step. It writes a static local HTML file with recent handoff cards:

```bash
acb view --open
acb view --all --limit 50 --out ./acb-view.html
```

This is still not a dashboard. It does not start a server, watch files, or sync data. The goal is to make local handoff history easier to scan while keeping the storage and review path inspectable.

`acb dashboard` is the lightweight local control-surface step:

```bash
acb dashboard --workspace .
acb dashboard --all --limit 50 --port 8765
```

It starts an explicit local HTTP server with an HTML dashboard, `/api/state`, `/api/copy-prompt`, `/api/ack`, `/api/create-demo`, `/api/verify-workflow`, and `/health`. It reads the packet store on each request, so refreshes show recent handoffs. The dashboard can render a brief takeover prompt, full takeover prompt, or MCP pull instruction and copy it to the system clipboard when the user clicks a button. It can also append an explicit acknowledgement when the user clicks `Mark Received`. If the current workspace is empty, the dashboard can create one explicit local demo packet after a click. It also detects likely target clients through read-only PATH, workspace, and common local config-location checks, then uses those signals to preselect the top `Next handoff` copy action and show a target-specific setup guide. The same guide is available from `acb setup [target]` for terminal and script users; without a target, it uses the same read-only local detection. The workflow verification endpoint runs a temporary ACB-side smoke test only; it does not launch or mutate the selected client. It shows derived safety hints, acknowledgement state, freshness state, readiness state, and a safety warning count for packet review. It does not sync data, silently inject context into model requests, or edit third-party client config.

Dashboard packet summaries include a derived `safety` object. This is the first lightweight safety-panel step from the original ACB plan without adding gateway interception or automatic redaction.

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
- `read_handoff_brief`: returns a compact brief by id or latest workspace packet.
- `check_latest_handoff_ready`: returns the combined readiness report for the newest workspace packet.
- `check_handoff_ready`: returns the combined readiness report for a specific packet id.
- `save_handoff`: saves an explicit local handoff packet from an MCP-capable agent.
- `update_handoff`: corrects an existing handoff packet while preserving its original creation time.
- `acknowledge_handoff`: records that a receiving MCP-capable agent explicitly read a packet.
- `read_handoff`: returns a specific handoff prompt by packet id.
- `search_handoffs`: searches local handoff history.
- `list_workspaces`: lists local workspaces with handoff history.
- `list_handoffs`: returns recent packet summaries without expanding full body text.

This keeps both export and ingestion explicit. An upstream agent must call `save_handoff`; a downstream agent must call a read tool. ACB does not silently inject context into the model request.

MCP tools still need agent-side instructions to be useful at session start. Copyable client instruction patches live in [agent-instructions.md](agent-instructions.md); they tell receiving agents to check readiness, read the packet, summarize it, and acknowledge it before editing.

If `check_latest_handoff_ready` finds no packet but the workspace is a dirty Git checkout, it returns a soft `warning_dirty_workspace` report instead of a hard error. This is not a handoff substitute; it lets the agent gently remind the user to run `acb handoff --git` while still allowing simple questions to proceed. A saved packet whose freshness signals changed remains a hard `needs_refresh` gate.

Example MCP server config shape:

Generate it:

```bash
acb config mcp
acb config mcp --command /absolute/path/to/acb --name local-acb
acb config mcp --command node --arg /absolute/path/to/bin/acb.js --arg serve --name local-acb
acb config mcp --out ./mcp.json
```

For supported local clients, `acb integrate <client>` is the explicit setup helper:

```bash
acb integrate cline --dry-run
acb integrate cline --print
acb integrate cline --config ./cline_mcp_settings.json --yes
```

The helper never writes silently. A real write requires `--yes` or an interactive `[y/N]` confirmation, creates a `.bak` backup when the target file already exists, and only updates the `mcpServers.acb` entry. `--print` shows the MCP entry and Agent instruction patch without editing anything.

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
acb verify mcp --config ./mcp.json --name acb --workspace .
acb verify mcp --config ./mcp.json --name acb --json
```

`verify mcp` launches the configured stdio server, sends `initialize`, checks `tools/list` for the expected ACB handoff tools, and calls `get_workspace_status` for the selected workspace. It does not modify any client config.

`verify workflow` checks the ACB side of a client recipe without launching the client:

```bash
acb verify workflow opencode
acb verify workflow cline --json
acb verify workflow --all
acb verify workflow codex --keep-artifacts --json
acb setup codex --check
```

It uses a temporary store and verifies recipe lookup, handoff save, full resume prompt, compact brief, MCP server readiness against the target workspace, dashboard state, and dashboard HTML. The temporary store is cleaned by default; use `--keep-artifacts` for debugging. `--all` runs the same ACB-side matrix across every supported recipe target. This is the project-level smoke test for real client workflows while keeping third-party app setup explicit.

Recommended first message in a new session:

```text
Use acb to read the latest handoff for this workspace, then continue from it.
```
