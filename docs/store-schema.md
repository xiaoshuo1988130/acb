# Store Schema

ACB stores local handoff packets in one JSON file.

Default path:

```text
~/.acb/packets.json
```

Override path:

```bash
ACB_STORE=./tmp/acb-packets.json acb handoff --summary "Test handoff"
```

## Store Envelope

The current schema is `acb.store.v1`.

```json
{
  "version": 1,
  "packets": []
}
```

Rules:

- `version` is the store schema version.
- Missing `version` is treated as version `1` for compatibility with early local stores.
- A store with a version newer than the installed ACB supports is rejected instead of overwritten.
- `packets` must be an array.

`acb store info --json` reports both the store version and the supported version:

```bash
acb store info --json
```

## Packet Shape

Each packet currently has this shape:

```json
{
  "id": "pkt_20260529120000_abc123",
  "version": 1,
  "created_at": "2026-05-29T12:00:00.000Z",
  "updated_at": null,
  "from": "codex",
  "workspace": "/absolute/workspace/path",
  "summary": "Ready for the next agent",
  "status": null,
  "notes": [],
  "tags": [],
  "body": null,
  "git": null,
  "acknowledgements": [
    {
      "id": "ack_20260529120500_def456",
      "acknowledged_at": "2026-05-29T12:05:00.000Z",
      "by": "opencode",
      "note": "Read packet and continuing from it."
    }
  ]
}
```

Required for valid imports:

- `id`
- `created_at`
- `workspace`
- `notes`
- `tags`

Optional fields may be `null` or absent in older exports. Import normalizes missing optional fields.

`acknowledgements` is optional in older stores. Newer ACB versions write it as an array of explicit receiving-side confirmations created by `acb ack`, the dashboard `Mark Received` action, or the MCP `acknowledge_handoff` tool.

Derived fields such as `safety`, `event`, `acknowledgement`, `freshness`, `readiness`, `next_resume`, `next_brief`, `next_ack`, `next_freshness`, `next_ready`, and `next_mcp_read` are read-time output helpers. They are not stored in `packets.json`.

## Write Safety

ACB writes stores with these safeguards:

- The parent directory is created if needed.
- Existing stores are copied to `<store>.bak` before overwrite.
- Writes go through a temporary file and atomic rename.
- Malformed stores are not overwritten by save/update/delete commands.

Use an explicit backup before larger changes:

```bash
acb store backup --out ./acb-store.backup.json
```

## Migration Strategy

For v1:

- ACB reads missing `version` as version `1`.
- ACB writes back `version: 1`.
- New packet fields should be optional.
- Unknown packet fields are not guaranteed to round-trip through every command unless they are part of the documented packet shape.

For future versions:

- ACB should reject stores with versions newer than it supports.
- ACB should migrate older supported versions explicitly before writing.
- Migrations should preserve a `.bak` copy through the existing write path.

## Import And Export

JSON export is intended for machine transfer:

```bash
acb export --format json --out ./handoffs.json
acb import --file ./handoffs.json
```

Markdown export is for human review and is not importable.
