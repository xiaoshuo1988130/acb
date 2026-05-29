# CLI Output Contract

ACB has two output audiences:

- Humans reading terminal output.
- Scripts, dashboards, and MCP clients reading JSON.

Before 1.0, the project treats these surfaces differently so the CLI can keep getting easier to use without breaking automation.

## Stable Machine Surfaces

Use these surfaces for automation:

- Commands with `--json`.
- `acb dashboard` `/api/state`.
- `acb dashboard` local POST APIs.
- MCP tool `structuredContent`.
- Store files that match [store-schema.md](store-schema.md).

Stable means:

- Existing top-level JSON keys should not be removed in a minor version.
- New optional JSON keys may be added.
- Existing field meanings should stay compatible.
- Human wording may change even when JSON stays stable.

## Human-Readable Surfaces

These are optimized for people and may be reworded before 1.0:

- Plain text command output.
- `Next actions` cards.
- Dashboard labels and helper text.
- Markdown exports.
- Documentation examples.

When a command supports both modes, prefer `--json` for scripts and plain output for humans.

## Current Stable JSON Entrypoints

The most important script-friendly commands are:

```bash
acb quickstart --check --json
acb demo --json
acb save --json
acb latest --json
acb list --json
acb workspaces --json
acb search <query> --json
acb timeline --json
acb brief --json
acb setup --json
acb verify workflow codex --json
acb store info --json
acb store backup --json
```

Dashboard JSON:

```bash
acb dashboard --workspace .
curl http://127.0.0.1:8765/api/state
```

## Additive Changes

Minor releases can add:

- New JSON fields.
- New commands.
- New dashboard endpoints.
- New MCP tools.
- New target client recipes.

Minor releases should avoid:

- Renaming existing JSON fields.
- Removing existing JSON fields.
- Changing packet ids or workspace normalization behavior.
- Changing `--json` from a single JSON document to mixed text.

## 1.0 Goal

By 1.0, ACB should have:

- A documented store schema.
- Stable JSON command contracts for daily automation.
- Clear human output that can keep improving without being treated as an API.
- Migration notes for any future schema version.
