# Dashboard

`acb dashboard` starts an explicit local dashboard for handoff history and takeover prompts.

```bash
acb dashboard --workspace .
acb dashboard --all --limit 50
acb dashboard --workspace . --host 127.0.0.1 --port 8765 --open
```

The dashboard serves:

- `/` as a lightweight HTML view.
- `/api/state` as machine-readable JSON.
- `/api/copy-prompt` as a local-only POST endpoint used by the page's takeover buttons.
- `/health` as a small readiness check.

It reads the current ACB store on each request, so refreshing the browser shows newer packets.

The HTML view is a three-pane local audit workspace:

- Packet list with search.
- A top-level `Next handoff` strip that auto-selects the best detected target client and keeps the recommended copy action in the first viewport.
- Packet detail tabs for overview, copyable commands, body preview, and Git snapshot.
- A `Start here` takeover panel for copying a brief prompt, full prompt, or MCP pull instruction directly to the system clipboard.
- Detected target clients such as OpenCode, Cline, Roo Code, Claude Desktop, Codex, and generic MCP clients.
- Workspace metadata and raw `/api/state` inspection.

## Boundaries

The dashboard is intentionally local and explicit:

- No cloud sync.
- No login.
- No writes to the packet store.
- No hidden prompt injection.
- No mutation of Cline, Roo, OpenCode, VS Code, Claude Desktop, or other client storage.

The only state-changing control is clipboard copy. Clicking `Copy Brief Prompt`, `Copy Full Prompt`, or `Copy MCP Pull Instruction` asks the local ACB process to render the selected packet and write that text to your system clipboard. You still decide where to paste it.

Target detection is read-only. ACB checks the current workspace, PATH, and a small set of common local client locations. The dashboard uses those signals to choose the initial `Next handoff` target, but you can still switch targets manually. It does not patch client settings, edit extension storage, or open private client databases.

It still exposes local ACB metadata to anyone who can reach the server. The default host is `127.0.0.1`; avoid `--host 0.0.0.0` unless you are on a trusted network. In `--workspace` mode, the dashboard scopes packet data and workspace summaries to that workspace. Use `--all` only when you intentionally want to inspect every workspace in the local store.

Use `Ctrl+C` to stop it.

## When To Use It

Use the dashboard when you want to inspect:

- Which workspace has the latest handoff.
- Whether a packet has a compact `acb brief` path.
- Which packet you want to copy into the next agent as a brief or full takeover prompt.
- Which target client path looks most appropriate for the selected handoff.
- Whether recent packets carry Git state or long body context.
- The JSON shape a script or client could consume from `/api/state`.
