# MCP Client Recipes

ACB is explicit-first, with MCP as a first-class pull mode. It does not assume one client owns your workflow. The safest rule is:

1. Generate a local stdio config with ACB.
2. Verify it locally.
3. Paste the same server entry into any MCP-capable client.

```bash
acb config mcp --out ./mcp.json
acb verify mcp --config ./mcp.json --name acb
```

ACB also ships client recipes in the CLI:

```bash
acb recipe
acb recipe opencode
acb recipe cline
acb recipe claude-desktop --json
```

Use the recipe output as the current source of truth for the recommended command sequence. For the fuller setup guide that mirrors the dashboard, use:

```bash
acb setup
acb setup --check
acb setup opencode
acb setup codex --workspace . --json
```

Without a target, `acb setup` uses read-only local detection and selects the best available target. This document explains the same boundary in prose.

`acb setup` now prints the shortest recommended path first:

1. Save current context with `acb handoff`.
2. Review derived safety hints with `acb safety`.
3. Verify the ACB-side client workflow.
4. Open the dashboard and copy the recommended handoff text into the selected client.

The JSON form exposes the same checklist as `steps`, plus copyable command fields such as `handoff_command`, `safety_command`, `setup_check_command`, and `dashboard_command`.

The dashboard shows the same client setup information next to the detected target list:

```bash
acb dashboard --workspace .
```

Use the dashboard when you want copy buttons for the setup checklist, recipe/config/verify commands, or a click-driven ACB-side workflow check.

For copyable client/system prompt patches that teach receiving agents to check ACB before editing, see [../agent-instructions.md](../agent-instructions.md).

Before a release or larger recipe change, run the whole ACB-side matrix:

```bash
acb verify workflow --all
```

Before wiring a client manually, smoke-test the ACB side:

```bash
acb verify workflow opencode
acb verify workflow cline
```

This checks recipe, handoff, brief, MCP, and dashboard surfaces without launching or editing the client.

The generated config looks like this:

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

If a client cannot find `acb` on `PATH`, generate a config that points directly at this package's CLI file:

```bash
acb doctor
```

Look for `mcp_local_config_hint` in the output. It uses `node .../bin/acb.js serve` and avoids relying on global PATH.

## OpenCode

Use ACB in two possible ways:

- Copy/paste mode: run `acb handoff` and paste the prompt into OpenCode.
- MCP pull mode: add the generated `acb` MCP server entry to the OpenCode MCP config location supported by your installed OpenCode version.

```bash
acb recipe opencode
```

For a complete receiving-side walkthrough and confirmation checklist, see [../examples/opencode-client.md](../examples/opencode-client.md).

Recommended first prompt after connecting MCP:

```text
Use acb to read the latest handoff for this workspace, then call check_latest_handoff_ready.
If readiness is not ready, stop and explain the blocker before editing files.
If ready, summarize the packet id, workspace, summary, safety level, and notes before acting.
```

If you want a shorter first pass, ask the client to call `read_handoff_brief` first, then pull the full handoff only if the brief is insufficient.

## Codex

Use ACB in two possible ways:

- Copy/paste mode: run `acb handoff` from the current agent and paste the prompt into Codex.
- Scripted mode: use `acb latest --json` or `acb setup codex --json` when a wrapper should avoid parsing terminal prose.

```bash
acb recipe codex
```

For a complete receiving-side walkthrough and confirmation checklist, see [../examples/codex-client.md](../examples/codex-client.md).

Recommended first prompt:

```text
Continue from this explicit ACB handoff. Read the packet, then call check_handoff_ready or check_latest_handoff_ready.
If readiness is not ready, stop and explain the blocker before editing files.
If ready, summarize the packet id, workspace, safety level, and notes.
```

## Cline And Roo Code

Do not let ACB edit extension storage or private VS Code databases.

Use one of these explicit paths:

- Copy/paste mode: `acb resume`, then paste the prompt into the chat box.
- MCP pull mode: paste the generated `acb` server entry into the extension's MCP server configuration UI or file.

```bash
acb recipe cline
acb recipe roo
```

Recommended first prompt:

```text
Use acb to inspect this workspace status. If a latest handoff exists, read it and check readiness before making changes.
```

For small chat boxes, run `acb brief` and paste that compact summary first.

## Claude Desktop

Claude Desktop uses MCP servers through local configuration. Add the generated `acb` stdio server entry wherever your Claude Desktop version accepts MCP server definitions.

```bash
acb recipe claude-desktop
```

Recommended first prompt:

```text
Use acb to read the latest handoff for this workspace, then check readiness. Summarize what you loaded before acting.
```

Claude can also call `read_handoff_brief` before `read_handoff` when you want a compact takeover summary.

## Scripts And Local Tools

Scripts can avoid natural-language prompting and read JSON directly:

```bash
acb latest --json
acb status --json
acb search "migration" --json
```

For a deterministic prompt:

```bash
acb resume --print-prompt
```

## Safety Boundary

ACB recipes are intentionally manual. They do not:

- Patch client config files automatically.
- Mutate third-party state.
- Inject hidden context into model requests.

This keeps the handoff path debuggable when clients change their own config formats.
