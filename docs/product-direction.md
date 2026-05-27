# Product Direction

AgentContextBus should validate one daily pain first:

> When switching between local coding agents, I want the next agent to understand the current workspace state without asking me to repeat everything.

## First Wedge

- Save a small handoff packet.
- Generate a paste-ready prompt.
- Copy it to clipboard by default.
- Generate a compact brief for lower-friction receiving-side starts.
- Keep storage local and inspectable.
- Expose explicit MCP pull mode for clients that can call local tools.
- Provide a terminal timeline and static local HTML viewer before investing in a dashboard.
- Productize client-specific recipes so users can choose OpenCode, Cline, Roo, Claude Desktop, Codex, or generic MCP without guessing the setup path.
- Add a read-only local dashboard and workflow smoke tests once the core handoff path is stable.

## Not In The MVP

- Hidden traffic interception.
- Automatic prompt injection.
- Editing Cline/Roo/OpenCode private storage.
- Auto-patching client configuration files.
- Cloud dashboard, sync, or background daemon.
- Multi-agent collaboration signals.

## Later

- SQLite storage.
- Workspace-aware handoff history.
- Richer dashboard after read-only local dashboard usage proves useful.
- Agent-to-agent context packets, only through explicit tools or protocols.
