# AgentContextBus

`acb` is a local-first context handoff tool for coding agents.

It starts with one plain problem:

> I switch between Codex, OpenCode, Cline, Claude Code, scripts, and local terminals, and I do not want to explain the same workspace context again.

ACB is intentionally explicit. It does not silently inject prompts, edit third-party tool storage, or intercept traffic by default.

## MVP

```bash
acb save --from codex --summary "Implemented probe report decision output" --status "tests pass" --note "Do not publish yet"
acb prompt
```

`acb prompt` copies a handoff prompt to your clipboard. Paste it into the next agent.

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

MCP clients can pull the same handoff explicitly:

```bash
acb serve
```

Expose it as a local stdio MCP server, then ask the next agent to use `read_latest_handoff` for the current workspace.

## Commands

```bash
acb save --from <agent> --summary <text> --status <text> --note <text> --tag <tag> --file <path>
acb save --from <agent> --summary <text> --stdin
acb save --from <agent> --summary <text> --git
acb status
acb latest
acb show <packet-id>
acb show <packet-id> --prompt
acb prompt
acb preview
acb list
acb timeline
acb export --format markdown --out ./handoffs.md
acb import --file ./handoffs.json
acb delete <packet-id>
acb clear --workspace .
acb clear --all
acb doctor
acb config mcp --out ./mcp.json
acb verify mcp --config ./mcp.json
acb serve
acb store path
```

Use `ACB_STORE=/path/to/packets.json` to keep test or project-specific handoff state outside the default `~/.acb/packets.json`.

`acb status` prints the current workspace handoff state and the next commands to copy or inspect the latest packet.

`acb preview` writes the latest handoff prompt to a Markdown file for review. Add `--open` when you want ACB to open it with the system default app.

`acb clear` only clears the current workspace by default. Use `--all` only when you intentionally want to remove every local handoff packet in the store.

`acb doctor` checks the local store, current workspace packet count, Git availability, clipboard command availability, and whether `acb` is visible on `PATH` for MCP clients.

`acb timeline` prints a compact terminal view of recent handoffs. It is the first visualization layer before any optional web viewer.

`acb export` writes recent handoffs as Markdown or JSON for sharing, review, or a future viewer.

`acb import` restores JSON exports into the local packet store. Duplicate packet ids are skipped unless `--replace` is used.

`acb config mcp` prints or writes a copyable stdio MCP server config for clients that support MCP.

`acb verify mcp` reads an MCP config, launches the selected stdio server, and checks that the ACB handoff tools are available before you paste that config into a client.

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
