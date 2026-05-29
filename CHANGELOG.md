# Changelog

## 0.11.0

First-run verification.

### Added

- Added `acb verify first-run` to smoke test the install-to-handoff path with a temporary local store.
- Added JSON and human output for first-run verification, including quickstart, demo packet, brief, dashboard state, and setup workflow checks.
- Documented the 5-minute verification path from `quickstart --check` to `verify first-run`.

## 0.10.0

1.0 stability groundwork.

### Added

- Added `docs/cli-contract.md` to distinguish stable JSON surfaces from human-readable output.
- Added `docs/store-schema.md` with the current `acb.store.v1` envelope, packet shape, backup behavior, and migration policy.
- Added store version metadata to `acb store info --json` and dashboard `/api/state`.
- Added an explicit dashboard safety note about local click-driven controls.

### Changed

- Refined the README opening positioning around local-first agent handoff and fastest first run.
- Store reads now reject future store versions instead of risking overwrite by an older ACB binary.

## 0.9.0

First-run dashboard actions.

### Added

- Added a local-only dashboard `Create demo packet` action so empty workspaces can become inspectable without leaving the page.
- Added `/api/create-demo` for explicit local demo packet creation with English and Chinese packet content.
- Added human-readable `Next actions` cards and JSON `actions` to `acb quickstart --check`.
- Added `docs/first-run.md` as the English install-to-first-handoff guide.
- Documented the dashboard demo creation path.

## 0.8.0

First-run onboarding.

### Added

- Added `acb demo` to create an explicit local sample handoff packet for first-run dashboard exploration.
- Added bilingual dashboard empty states that point users to `acb demo`, a real `acb handoff`, and `acb setup --check`.
- Added `next_demo` guidance to `acb quickstart --check` in both English and Chinese.

## 0.7.0

Chinese onboarding.

### Added

- Added `README.zh-CN.md` as a Simplified Chinese project overview and install guide.
- Added `docs/zh-CN/quickstart.md` for a shorter Chinese first-run path from `quickstart --check` to `handoff`, `resume`, `setup --check`, and `dashboard`.
- Added language links from the English README and included the Chinese README in the npm package.
- Added `--lang zh-CN` and `ACB_LANG=zh-CN` support for the first-run terminal path and dashboard UI.

## 0.6.0

Client setup guide.

### Added

- Added a dashboard client setup guide that shows target-specific setup commands, handoff prompts, and safety notes next to target detection.
- Added a local-only dashboard workflow verification endpoint so users can run ACB-side client readiness checks from the UI without launching or editing third-party clients.
- Added copy controls for recipe, MCP config, MCP verify, workflow verify, and client prompt commands in the dashboard.
- Added `acb setup [target]` to render the same client setup guide from the CLI as text or JSON, with automatic target selection when no target is provided.
- Added `acb setup --check` to run the ACB-side workflow smoke test from the setup guide before the user configures a third-party client.
- Added recommended setup, dashboard, and workflow verification next steps to `acb quickstart --check`.
- Added `acb verify workflow --all` to run the ACB-side smoke matrix across every supported client target before a release.

## 0.5.2

Dashboard takeover controls.

### Added

- Added explicit dashboard takeover buttons that render a brief or full handoff prompt and copy it to the system clipboard without editing the packet store or third-party client configuration.
- Added an MCP pull instruction button to reduce friction when the receiving client already has ACB MCP tools configured.
- Added read-only dashboard target detection for common local agent clients and target-specific primary copy actions.
- Added a top-level Next handoff action strip that auto-selects the best detected target and keeps the primary copy action visible in the first viewport.

## 0.5.1

Dashboard usability pass.

### Added

- Upgraded `acb dashboard` into a three-pane local audit workspace with packet search, packet detail tabs, command copy buttons, workspace metadata, and raw JSON inspection.
- Extended dashboard packet state with notes, tags, Git snapshot metadata, and a bounded body preview.

## 0.5.0

0.4.0+ completion candidate.

### Added

- Added `acb dashboard`, a read-only local dashboard with HTML and `/api/state` views.
- Added `acb verify workflow <target>` to smoke test recipe, handoff, brief, MCP, and dashboard surfaces for a client target without launching or mutating the third-party client.
- Added dashboard and workflow verification documentation.

## 0.4.0

Compact ingest release candidate.

### Added

- Added `acb brief` for compact receiving-side handoff prompts.
- Added `read_handoff_brief` to the MCP server for clients that want a short takeover summary before reading full context.
- Added brief next-step hints to status, workspace summaries, quickstart checks, and the local HTML viewer.

## 0.3.0

Client recipe release candidate.

### Added

- Added `acb recipe` to list supported client handoff paths.
- Added client-specific recipes for OpenCode, Cline, Roo Code, Claude Desktop, Codex, and generic MCP clients.
- Added recipe JSON output for scripts and documentation checks.

## 0.2.0

Local visual review release candidate.

### Added

- Added `acb view` to generate a standalone local HTML viewer for handoff history.
- Added local viewer docs covering scope, limits, and static-file boundaries.

## 0.1.0

First usable local handoff release candidate.

### Added

- Added `acb quickstart --check` for a short first-run readiness report.
- Reworked the README around the Codex/OpenCode/Cline handoff problem.
- Added example and MCP recipe docs for the first user-facing adoption path.
- Added a lightweight terminal demo SVG for the README.

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
