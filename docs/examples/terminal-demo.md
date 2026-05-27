# Terminal Demo Transcript

This is a copyable transcript for the first ACB workflow. It is intentionally plain terminal output, not a marketing asset.

## Setup Check

```bash
$ acb quickstart --check
ACB Quickstart Check
version: acb 0.5.0
package: @xiaoshuo1988/acb
store: /Users/you/.acb/packets.json
store_readable: yes
workspace: /Users/you/project
git_available: yes
git_workspace: yes
clipboard_ready: yes
acb_on_path: yes
next_handoff: acb handoff --from codex --summary "Ready for the next agent" --git
next_resume: acb resume
next_doctor: acb doctor
next_mcp_config: acb config mcp --out ./mcp.json
next_mcp_verify: acb verify mcp --config ./mcp.json --name acb
```

## Save A Handoff

```bash
$ acb handoff --from codex --summary "Implemented parser cleanup" --status "Tests pass" --note "Next agent should review README wording" --git
[acb] saved handoff packet: pkt_20260527123000_ab12cd
[acb] handoff prompt copied to clipboard.
```

## Resume It

```bash
$ acb resume
[acb] resume prompt copied to clipboard.
```

Paste the prompt into the next agent.

## Inspect History

```bash
$ acb timeline
workspace: /Users/you/project

pkt_20260527123000_ab12cd
  created_at: 2026-05-27T12:30:00.000Z
  from: codex
  summary: Implemented parser cleanup
  status: Tests pass
  notes:
    - Next agent should review README wording
  next_resume: acb resume --id pkt_20260527123000_ab12cd
```

## MCP Readiness

```bash
$ acb config mcp --out ./mcp.json
[acb] wrote MCP config to /Users/you/project/mcp.json
[acb] next: acb verify mcp --config /Users/you/project/mcp.json --name acb

$ acb verify mcp --config ./mcp.json --name acb
ACB MCP Verify
server: acb
launch: ok
initialize: ok
tools/list: ok
required_tools: ok
get_workspace_status: ok
```
