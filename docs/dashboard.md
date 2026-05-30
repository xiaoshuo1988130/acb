# Dashboard

`acb dashboard` starts an explicit local dashboard for handoff history and takeover prompts.

```bash
acb dashboard --workspace .
acb dashboard --all --limit 50
acb dashboard --workspace . --host 127.0.0.1 --port 8765 --open
```

If the current workspace has no handoff packets yet, the dashboard shows first-run commands for a safe local demo, a real handoff, and setup verification:

```bash
acb demo --workspace .
acb handoff --from codex --summary "Ready for next agent" --git
acb setup --workspace . --check
```

The dashboard serves:

- `/` as a lightweight HTML view.
- `/api/state` as machine-readable JSON.
- `/api/copy-prompt` as a local-only POST endpoint used by the page's takeover buttons.
- `/api/create-demo` as a local-only POST endpoint used by the empty state `Create demo packet` action.
- `/api/verify-workflow` as a local-only POST endpoint that runs the same ACB-side smoke test as `acb verify workflow <target>`.
- `/health` as a small readiness check.

It reads the current ACB store on each request, so refreshing the browser shows newer packets.

The HTML view is a three-pane local audit workspace:

- Packet list with search.
- An empty-state onboarding panel that can create a safe local demo packet, copy a real handoff command, or copy setup verification.
- A top-level `Next handoff` strip that auto-selects the best detected target client and keeps the recommended copy action in the first viewport.
- A first-viewport `First handoff flow` strip with copyable `Save`, `Safety`, `Verify`, and `Copy` steps.
- Packet detail tabs for overview, copyable commands, safety review, body preview, and Git snapshot.
- Derived packet safety hints for secret-like content, sensitive-looking paths, and large context bodies.
- A `Start here` takeover panel for copying a brief prompt, full prompt, or MCP pull instruction directly to the system clipboard.
- Detected target clients such as OpenCode, Cline, Roo Code, Claude Desktop, Codex, and generic MCP clients.
- A client setup guide with a compact checklist for saving context, reviewing safety, verifying the ACB-side workflow, and opening the handoff dashboard path.
- Copyable recipe, MCP config, MCP verify, setup-check, and first-prompt text for the selected target.
- Workspace metadata and raw `/api/state` inspection.

## Boundaries

The dashboard is intentionally local and explicit:

- No cloud sync.
- No login.
- No hidden writes to the packet store.
- No hidden prompt injection.
- No mutation of Cline, Roo, OpenCode, VS Code, Claude Desktop, or other client storage.

The only state-changing controls are explicit local actions: clipboard copy, demo packet creation, and temporary local workflow verification. Clicking `Create demo packet` writes one sample packet to the local ACB store for the selected workspace. Clicking `Copy Brief Prompt`, `Copy Full Prompt`, or `Copy MCP Pull Instruction` asks the local ACB process to render the selected packet and write that text to your system clipboard. Clicking `Run ACB-side Check` creates a temporary smoke-test store, verifies ACB recipe/handoff/brief/MCP/dashboard surfaces, and cleans the temporary artifacts. You still decide where to paste or configure the result.

Target detection is read-only. ACB checks the current workspace, PATH, and a small set of common local client locations. The dashboard uses those signals to choose the initial `Next handoff` target, but you can still switch targets manually. It does not patch client settings, edit extension storage, or open private client databases.

Safety hints are also read-only. They are derived from packet text and Git metadata when the dashboard renders; they do not redact, rewrite, or delete stored packet content. The Safety tab mirrors the CLI `acb safety` review so users can inspect warnings before copying a handoff into another agent.

It still exposes local ACB metadata to anyone who can reach the server. The default host is `127.0.0.1`; avoid `--host 0.0.0.0` unless you are on a trusted network. In `--workspace` mode, the dashboard scopes packet data and workspace summaries to that workspace. Use `--all` only when you intentionally want to inspect every workspace in the local store.

Use `Ctrl+C` to stop it.

## When To Use It

Use the dashboard when you want to inspect:

- Which workspace has the latest handoff.
- Whether a packet has a compact `acb brief` path.
- Which packet you want to copy into the next agent as a brief or full takeover prompt.
- Which target client path looks most appropriate for the selected handoff.
- Which setup commands and first prompt apply to a target client.
- Whether the ACB side of a target workflow passes before touching the client.
- Whether the selected packet has secret-like text, sensitive-looking paths, or a large body that will be truncated in prompts.
- Whether recent packets carry Git state or long body context.
- The JSON shape a script or client could consume from `/api/state`.

For machine consumers, `/api/state` is treated as an additive JSON surface: existing fields should not be removed in a minor version, but new optional fields may appear. See [cli-contract.md](cli-contract.md).

The same setup guide is available without the dashboard:

```bash
acb setup
acb setup --check
acb setup codex
acb setup opencode --workspace . --json
```

The setup guide's JSON includes a `steps` array. UI and script consumers can render that as a first-run checklist without parsing human-readable terminal text.
