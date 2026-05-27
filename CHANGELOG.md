# Changelog

## 0.0.3

### Added

- Added `acb quickstart --check` for a short first-run readiness report.

## 0.0.2

### Fixed

- Fixed npm-installed `acb` bin execution when npm invokes the CLI through a symlink.

## 0.0.1

Initial local alpha for AgentContextBus (`acb`).

### Added

- Local JSON handoff packet store with `ACB_STORE` override.
- `acb handoff` and `acb resume` as the primary copy/paste handoff flow.
- File, stdin, Git snapshot, and bounded Git diff capture.
- Workspace-scoped `latest`, `list`, `search`, `timeline`, and `export` commands.
- Packet update, delete, clear, import, export, preview, and store backup commands.
- `acb doctor` for local environment and MCP readiness checks.
- Explicit stdio MCP server with handoff read/write tools.
- `acb config mcp` and `acb verify mcp` for MCP setup smoke tests.
- `acb quickstart` for the shortest install-to-handoff path.

### Boundaries

- No hidden prompt injection.
- No traffic interception by default.
- No mutation of VS Code, Cline, Roo, OpenCode, or other private tool storage.
- No dashboard in the initial alpha.

### Notes

- Published package: `@xiaoshuo1988/acb`.
- Installed command: `acb`.
- The unscoped `acb` npm package name is already taken by another package.
