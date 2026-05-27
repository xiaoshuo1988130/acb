# Dashboard

`acb dashboard` starts a read-only local dashboard for handoff history.

```bash
acb dashboard --workspace .
acb dashboard --all --limit 50
acb dashboard --workspace . --host 127.0.0.1 --port 8765 --open
```

The dashboard serves:

- `/` as a lightweight HTML view.
- `/api/state` as machine-readable JSON.
- `/health` as a small readiness check.

It reads the current ACB store on each request, so refreshing the browser shows newer packets.

The HTML view is a three-pane local audit workspace:

- Packet list with search.
- Packet detail tabs for overview, copyable commands, body preview, and Git snapshot.
- Workspace metadata and raw `/api/state` inspection.

## Boundaries

The dashboard is intentionally local and read-only:

- No cloud sync.
- No login.
- No writes to the packet store.
- No mutation of Cline, Roo, OpenCode, VS Code, Claude Desktop, or other client storage.

It still exposes local ACB metadata to anyone who can reach the server. The default host is `127.0.0.1`; avoid `--host 0.0.0.0` unless you are on a trusted network. In `--workspace` mode, the dashboard scopes packet data and workspace summaries to that workspace. Use `--all` only when you intentionally want to inspect every workspace in the local store.

Use `Ctrl+C` to stop it.

## When To Use It

Use the dashboard when you want to inspect:

- Which workspace has the latest handoff.
- Whether a packet has a compact `acb brief` path.
- Whether recent packets carry Git state or long body context.
- The JSON shape a script or client could consume from `/api/state`.
