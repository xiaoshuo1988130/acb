# Local HTML Viewer

`acb view` generates a standalone local HTML file for reviewing handoff history.

It is the first visual layer in ACB. It deliberately stays simpler than a dashboard:

- No server.
- No background process.
- No sync.
- No mutation of third-party tools.

## Usage

Current workspace:

```bash
acb view --open
```

All workspaces:

```bash
acb view --all --limit 50 --open
```

Write to a specific file:

```bash
acb view --workspace . --out ./acb-view.html
```

## What The Viewer Shows

- Packet count and workspace scope.
- Recent packet cards.
- Summary, status, tags, notes, and body preview.
- Lightweight Git snapshot when present.
- Copyable next commands such as `acb resume --id ...` and `acb brief --id ...`.

## Why Static HTML

ACB keeps the visual layer inspectable and disposable. A static file is enough to validate whether handoff history is useful before adding a persistent dashboard.

If you need machine-readable output, use:

```bash
acb timeline --json
acb export --format json
```
