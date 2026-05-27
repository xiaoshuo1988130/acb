# AgentContextBus

`acb` is a local-first context handoff tool for coding agents.

It starts with one plain problem:

> I switch between Codex, OpenCode, Cline, Claude Code, scripts, and local terminals, and I do not want to explain the same workspace context again.

ACB is intentionally explicit. It does not silently inject prompts, edit third-party tool storage, or intercept traffic by default.

## MVP

```bash
acb handoff --from codex --summary "Implemented probe report decision output" --status "tests pass" --note "Do not publish yet"
```

`acb handoff` saves a packet, copies a handoff prompt to your clipboard, and leaves the packet in local history. Paste it into the next agent.

On the next side, use:

```bash
acb resume
```

`acb resume` copies the latest handoff prompt for the current workspace.

For a one-step handoff, save and copy in the same command:

```bash
acb handoff --from codex --summary "Ready for the next agent" --git
```

If clipboard access is unavailable, ACB prints the prompt instead.

You can also hand off a real context body from a file or pipe:

```bash
acb save --from codex --summary "Proxy investigation context" --file ./handoff.md
git diff -- README.md | acb save --from opencode --summary "README diff to review" --stdin
```

For coding work, add a lightweight Git snapshot:

```bash
acb save --from codex --summary "Ready for review" --git
```

`--git` records the repository root, current branch, short HEAD, and `git status --short` output. It does not include a diff.

If a packet needs a follow-up correction, update it in place:

```bash
acb update <packet-id> --status "ready for review" --note "Added final test notes"
```

`acb update` preserves the original `created_at` and records `updated_at`.

MCP clients can pull the same handoff explicitly:

```bash
acb serve
```

Expose it as a local stdio MCP server. An upstream agent can call `save_handoff` or `update_handoff`, then the next agent can call `get_workspace_status`, `read_latest_handoff`, or `search_handoffs` for the current workspace.

## Commands

```bash
acb handoff --from <agent> --summary <text> --status <text> --note <text>
acb save --from <agent> --summary <text> --status <text> --note <text> --tag <tag> --file <path> --copy
acb save --from <agent> --summary <text> --stdin
acb save --from <agent> --summary <text> --git
acb save --from <agent> --summary <text> --diff
acb save --from <agent> --summary <text> --json
acb update <packet-id> --status <text> --note <text>
acb diff-preview
acb status
acb latest
acb latest --all
acb show <packet-id>
acb show <packet-id> --prompt
acb resume
acb resume --preview
acb prompt
acb preview
acb list
acb list --all
acb workspaces
acb search <query>
acb search <query> --all
acb timeline
acb timeline --all
acb export --format markdown --out ./handoffs.md
acb export --all --format markdown --out ./all-handoffs.md
acb import --file ./handoffs.json
acb delete <packet-id>
acb clear --workspace .
acb clear --all
acb doctor
acb config mcp --out ./mcp.json
acb verify mcp --config ./mcp.json
acb serve
acb store path
acb store info
acb store backup --out ./acb-store.backup.json
```

Use `ACB_STORE=/path/to/packets.json` to keep test or project-specific handoff state outside the default `~/.acb/packets.json`.

`acb status` prints the current workspace handoff state and the next commands to resume or inspect the latest packet.

`acb latest` reads the newest handoff for the current workspace. Use `--all` when you intentionally want the newest packet across every workspace.

`acb list`, `acb search`, `acb timeline`, and `acb export` also default to the current workspace. Add `--all` only when you intentionally want cross-workspace history.

Human `acb list`, `acb search`, and `acb timeline` output prints its active scope (`workspace: <path>` or `workspace: all`) so cross-project history views are visible at a glance.

`acb handoff` is the primary one-step entrypoint. It behaves like `acb save --copy` by default. Use `--print-prompt` or `--json` for deterministic script output, or `--no-copy` when you want a two-step `save` then `resume` flow.

`acb resume` is the downstream entrypoint. It copies the latest handoff prompt for the current workspace. Use `--print-prompt` to print it, `--json` to return both packet and prompt, or `--preview --open` to inspect the Markdown prompt before pasting.

`acb save --copy` saves the packet and immediately copies its rendered prompt. `acb save --print-prompt` is the deterministic terminal-only version for scripts and tests. `acb save --json` returns the created packet for automation.

`acb save --diff` stores a bounded tracked Git diff body and a lightweight Git snapshot. It is useful when the next agent needs to inspect current code changes.

`acb diff-preview` prints or writes the same bounded Git diff body without saving a packet.

`acb update` edits an existing local packet. Use it to correct summary/status, append notes/tags, reset notes/tags with `--clear-notes` or `--clear-tags`, replace the context body with `--file`, `--stdin`, or `--diff`, or refresh the lightweight Git snapshot with `--git`.

`acb preview` writes the current workspace handoff prompt to a Markdown file for review. Add `--id` to preview a specific packet, or `--open` when you want ACB to open it with the system default app.

`acb search` finds older handoff packets by text in summaries, status, notes, tags, body, workspace, or lightweight Git metadata.

`acb workspaces` shows which local workspaces have handoff history, the latest packet for each one, and a copyable `next_resume` command.

`acb clear` only clears the current workspace by default. Use `--all` only when you intentionally want to remove every local handoff packet in the store.

`acb doctor` checks the local store, current workspace packet count, Git availability, clipboard command availability, and whether `acb` is visible on `PATH` for MCP clients.

`acb timeline` prints a compact terminal view of recent handoffs. It is the first visualization layer before any optional web viewer.

`acb export` writes recent handoffs as Markdown or JSON for sharing, review, or a future viewer.

`acb import` restores JSON exports into the local packet store. Duplicate packet ids are skipped unless `--replace` is used.

`acb store info` prints the local store path, readability, packet count, file size, and modified time.

`acb store backup` copies the raw local store file without parsing it. It is useful before cleanup or import, and it still works when the store is malformed.

`acb config mcp` prints or writes a copyable stdio MCP server config for clients that support MCP.

`acb verify mcp` reads an MCP config, launches the selected stdio server, checks that the ACB handoff tools are available, and calls `get_workspace_status` once before you paste that config into a client.

## Boundaries

- Local JSON storage first.
- Explicit copy/paste handoff first.
- MCP server later.
- No black-box prompt injection.
- No VS Code extension storage mutation.
- No cross-agent automation until the handoff packet format earns trust.

## Relationship To DeepSeek CompatKit

DeepSeek CompatKit is diagnostics infrastructure for DeepSeek/OpenAI-compatible Agent traffic.

AgentContextBus is a separate local handoff project. It may eventually reuse lessons from CompatKit, but it should keep its own product boundary.
