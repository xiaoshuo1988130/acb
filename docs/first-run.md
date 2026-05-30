# First Run

This guide takes you from a fresh install to your first real agent handoff.

For a shorter copy-and-run walkthrough, see [examples/five-minute-demo.md](examples/five-minute-demo.md).

ACB stays local and explicit throughout this flow:

- It writes handoff packets to your local ACB store.
- It copies prompts only when you ask it to.
- It does not edit OpenCode, Cline, Roo Code, Claude Desktop, Codex, or VS Code private storage.
- It does not run as a background daemon.

## 1. Install Or Run With npx

Install globally if you expect to use ACB often:

```bash
npm install -g @xiaoshuo1988/acb
acb quickstart --check
```

Or try it without a global install:

```bash
npx @xiaoshuo1988/acb quickstart --check
npx @xiaoshuo1988/acb verify first-run
```

`quickstart --check` prints:

- Local store, Git, clipboard, and PATH readiness.
- The recommended local target client.
- A short `Next actions` list for humans.
- Stable `next_*` commands for scripts.

## 2. Try A Safe Demo

Before you save real project context, create one local demo packet:

```bash
acb demo
```

Then open the dashboard:

```bash
acb dashboard --workspace .
```

If the dashboard starts on an empty workspace, click `Create demo packet`. It creates a sample packet in the local ACB store and refreshes into an inspectable handoff view.

Use the dashboard to try:

- The top `First handoff flow`: `Save`, `Safety`, `Verify`, and `Copy`.
- `Copy Brief Prompt`
- `Copy Full Prompt`
- `Copy MCP Pull Instruction`
- `Run ACB-side Check`

These controls do not modify third-party client configuration. You still decide where to paste or configure the result.

## 3. Save Real Context

When the current agent has useful project context, save a real handoff:

```bash
acb handoff --from codex --summary "Ready for the next agent" --git
```

This stores a local packet and copies a paste-ready takeover prompt when the system clipboard is available. If clipboard access is not available, ACB prints the prompt to the terminal.

Add more detail when helpful:

```bash
acb handoff \
  --from codex \
  --summary "Ready for OpenCode to continue dashboard UX" \
  --status "Tests pass; next step is UI polish" \
  --note "Keep dashboard explicit and local-only" \
  --tag dashboard \
  --git
```

## 4. Resume From Another Agent

In the receiving agent or a terminal, run:

```bash
acb receive --latest
```

`receive` checks readiness first, then copies the takeover prompt when the packet is safe enough to receive. Paste the resulting prompt into the next coding agent.

For a shorter first message:

```bash
acb brief
```

The brief tells the receiving agent how to request the full packet if needed.

## 5. Pick A Client Path

Let ACB detect the best local target and print setup guidance:

```bash
acb setup --check
```

Or choose a target explicitly:

```bash
acb setup codex --check
acb setup opencode --workspace .
acb setup cline --json
```

`--check` runs ACB-side smoke tests only. It does not launch or mutate the target client.

## 6. Verify Before Sharing

To test the first-run path without touching your real ACB store:

```bash
acb verify first-run
```

This checks quickstart readiness, creates a temporary demo packet, renders brief and resume prompts, renders dashboard state, and runs a setup workflow check for the recommended target.

Before a release, demo, or bigger workflow change:

```bash
acb verify workflow --all
```

This checks the ACB-side recipe, handoff packet, brief, full resume prompt, MCP server, and dashboard state for every supported target.

## Recommended First Path

```bash
npx @xiaoshuo1988/acb quickstart --check
npm install -g @xiaoshuo1988/acb
acb verify first-run
acb demo
acb dashboard --workspace .
acb handoff --from codex --summary "Ready for the next agent" --git
acb receive --latest
acb setup --check
```

For Chinese output, add `--lang zh-CN` to `quickstart`, `demo`, `dashboard`, and `setup`, or set:

```bash
ACB_LANG=zh-CN
```

The Chinese quickstart is available at [docs/zh-CN/quickstart.md](zh-CN/quickstart.md).

For common questions about auto-start, clipboard behavior, client config edits, data location, and MCP setup, see the [FAQ](faq.md).
