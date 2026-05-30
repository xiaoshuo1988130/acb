# Five-Minute Demo

This is the fastest way to understand ACB without wiring any third-party client.

The core situation is simple:

> You are switching coding agents, and you do not want to explain the same repo state again.

The demo proves four things:

- ACB can save local handoff context.
- ACB can show that context in a local dashboard.
- ACB can derive safety hints before you copy context.
- ACB can verify the ACB side of a target-client workflow without launching or editing that client.

## 1. Check The Install

```bash
npx @agentcontextbus/cli@latest quickstart --check
```

For a fully temporary smoke test:

```bash
npx @agentcontextbus/cli@latest verify first-run
```

## 2. Install For Daily Use

```bash
npm install -g @agentcontextbus/cli
acb quickstart --check
```

## 3. Create A Safe Packet

```bash
acb demo
```

This writes one demo packet to the local ACB store. It does not touch any third-party coding agent.

## 4. Open The Dashboard

```bash
acb dashboard --workspace .
```

In the dashboard, inspect the first viewport:

- `Next handoff` shows the currently selected packet and target.
- `First handoff flow` shows `Save`, `Safety`, `Verify`, and `Copy`.
- The packet detail panel has `overview`, `commands`, `ack`, `readiness`, `freshness`, `safety`, `body`, and `git` tabs.
- `Mark Received` records an explicit local acknowledgement after a receiving agent has read the packet.
- The target panel shows setup guidance for the detected or selected client.

Try the local-only buttons:

- `Copy Brief Prompt`
- `Copy Full Prompt`
- `Copy MCP Pull Instruction`
- `Run ACB-side Check`

## 5. Save Real Context

Run this inside a real project when an agent has useful context to hand off:

```bash
acb handoff --from codex --summary "Ready for the next agent" --git
acb receive --latest
acb safety
acb setup codex --workspace . --check
```

`receive` is the receiving-side entrypoint: it checks whether the packet is ready, then copies the takeover prompt when it is safe enough to hand off.

Then open the dashboard if you want a visual review:

```bash
acb dashboard --workspace .
```

## Boundary

ACB does not sync to a cloud service, start a background daemon, edit Cline/Roo/OpenCode/VS Code/Claude Desktop storage, or inject hidden prompt text. It creates local packets and gives you explicit commands, copy buttons, JSON, and MCP tools to move that context yourself.
