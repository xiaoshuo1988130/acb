# Workflow Verification

`acb verify workflow <target>` checks the ACB side of a client handoff before you wire the client manually.

```bash
acb verify workflow opencode
acb verify workflow cline --workspace .
acb verify workflow claude-desktop --json
acb verify workflow codex --keep-artifacts --json
```

Supported targets are the same targets as `acb recipe`:

- `opencode`
- `cline`
- `roo`
- `claude-desktop`
- `codex`
- `generic-mcp`

## What It Verifies

The command uses a temporary local store and checks:

- The target recipe exists.
- A handoff packet can be saved.
- A full resume prompt can be rendered.
- A compact brief can be rendered.
- An MCP config can be generated.
- The MCP server exposes the required tools and can read the smoke packet from the target workspace.
- Dashboard state and dashboard HTML can render the packet.

The temporary store is deleted by default after the report is built. Use `--keep-artifacts` only when you need to inspect the generated smoke-test store. The command prints next commands for the real workflow after the smoke test passes.

The dashboard exposes the same ACB-side check as `Run ACB-side Check` in the selected client's setup guide. That button calls local `/api/verify-workflow`, runs the temporary smoke test, and reports the same pass/fail checks without launching the client.

## What It Does Not Do

It does not launch OpenCode, Cline, Roo, Claude Desktop, Codex, or any other third-party client.

It also does not edit client config files. The command verifies that ACB's side of the handoff is ready, then leaves client setup explicit and auditable.

## Current Local Verification Snapshot

Last checked: 2026-05-28, workspace `/Users/xiaoshuo/CodeProject/acb`.

All recipe targets passed ACB-side smoke verification:

| Target | Recipe | Handoff save | Resume prompt | Brief | MCP tools | MCP latest handoff | Dashboard |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `opencode` | pass | pass | pass | pass | pass | pass | pass |
| `cline` | pass | pass | pass | pass | pass | pass | pass |
| `roo` | pass | pass | pass | pass | pass | pass | pass |
| `claude-desktop` | pass | pass | pass | pass | pass | pass | pass |
| `codex` | pass | pass | pass | pass | pass | pass | pass |
| `generic-mcp` | pass | pass | pass | pass | pass | pass | pass |

This confirms ACB can create a handoff packet, render both receiving prompts, start its MCP stdio server, expose the required tools, read the smoke packet through MCP for the selected workspace, render dashboard state, and clean temporary smoke-test artifacts.

This does not claim that the third-party clients themselves were launched or configured. Client setup remains an explicit manual step through each client's supported configuration path.
