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
  "from": "codex",
  "workspace": "/path/to/workspace",
  "summary": "What changed",
  "status": "Current state",
  "notes": ["Risks, blockers, next steps"],
  "tags": ["local", "handoff"],
  "body": "Optional longer context loaded from --file or --stdin"
}
```

## Context Body

Short handoffs can live in `--summary`, `--status`, and repeated `--note` flags.

Longer handoffs should use one explicit body source:

```bash
acb save --summary "Design handoff" --file ./handoff.md
cat ./agent-output.txt | acb save --summary "Prior agent output" --stdin
```

`--file` and `--stdin` are mutually exclusive. ACB stores the body locally, and `acb prompt` includes it under `## Context Body`.

Prompt rendering caps the body section so a very large log does not accidentally flood the next agent context. The local packet still keeps the original body.

## Clipboard

ACB uses platform clipboard commands:

- macOS: `pbcopy`
- Windows: `clip.exe`
- Linux Wayland: `wl-copy`
- Linux X11: `xclip` or `xsel`

If clipboard access fails, ACB prints the prompt. Linux users may need to install `wl-clipboard`, `xclip`, or `xsel`.
