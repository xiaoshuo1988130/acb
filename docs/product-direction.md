# Product Direction

AgentContextBus should validate one daily pain first:

> When switching between local coding agents, I want the next agent to understand the current workspace state without asking me to repeat everything.

## First Wedge

- Save a small handoff packet.
- Allow a no-summary handoff when the user still explicitly runs ACB, especially `acb handoff --git`.
- Generate a paste-ready prompt.
- Copy it to clipboard by default.
- Generate a compact brief for lower-friction receiving-side starts.
- Keep storage local and inspectable.
- Expose explicit MCP pull mode for clients that can call local tools.
- Provide a terminal timeline and static local HTML viewer before investing in a dashboard.
- Productize client-specific recipes so users can choose OpenCode, Cline, Roo, Claude Desktop, Codex, or generic MCP without guessing the setup path.
- Add a read-only local dashboard and workflow smoke tests once the core handoff path is stable.

## Current UX Calibration

ACB keeps an explicit-first trust boundary: users or agents must deliberately save, read, or acknowledge a handoff. The next product work should reduce friction inside that boundary rather than add hidden automation.

- **Zero-text handoff:** if a user runs `acb handoff --git` without `--summary`, ACB should generate an `[Auto]` summary locally and include compact Git status/stat context in the packet. The receiving agent should not need extra tool calls just to discover the basic diff shape.
- **Soft missing-handoff warning:** if an MCP receiving client checks a dirty workspace with no packet, ACB should warn that no explicit handoff exists instead of blocking unrelated questions. Stale saved packets remain a hard `needs_refresh` gate.
- **Interactive setup helper:** setup automation may be useful, but only when it is explicit, previewable, backed up, and confirmed by the user. Dry-run, print, and copy modes remain required fallbacks.

## Not In The MVP

- Hidden traffic interception.
- Automatic prompt injection.
- Silently editing Cline/Roo/OpenCode private storage.
- Auto-patching client configuration files without user confirmation, backup, and a dry-run path.
- Cloud dashboard, sync, or background daemon.
- Multi-agent collaboration signals.

## Later

- SQLite storage.
- Workspace-aware handoff history.
- Richer dashboard after read-only local dashboard usage proves useful.
- Agent-to-agent context packets, only through explicit tools or protocols.
