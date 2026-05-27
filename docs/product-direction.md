# Product Direction

AgentContextBus should validate one daily pain first:

> When switching between local coding agents, I want the next agent to understand the current workspace state without asking me to repeat everything.

## First Wedge

- Save a small handoff packet.
- Generate a paste-ready prompt.
- Copy it to clipboard by default.
- Keep storage local and inspectable.
- Expose explicit MCP pull mode for clients that can call local tools.

## Not In The MVP

- Hidden traffic interception.
- Automatic prompt injection.
- Editing Cline/Roo/OpenCode private storage.
- A dashboard.
- Multi-agent collaboration signals.

## Later

- SQLite storage.
- Workspace-aware handoff history.
- Optional web viewer.
- Agent-to-agent context packets, only through explicit tools or protocols.
