# Freshness Gate Demo

This demo shows the ACB "needs refresh" moment without touching your real project.

Run:

```bash
acb demo freshness
```

ACB creates a temporary Git workspace, saves an in-memory handoff packet with a Git snapshot, then simulates a human edit after the handoff. The resulting readiness report should show:

```text
freshness: changed
readiness: needs_refresh
receiving_agent_should_call: check_latest_handoff_ready
```

This is the core receiving-side gate:

1. The upstream agent saves a handoff.
2. The workspace changes after that handoff.
3. The receiving agent calls `check_latest_handoff_ready`.
4. ACB reports `needs_refresh`.
5. The receiving agent stops instead of continuing from stale context.

For JSON output:

```bash
acb demo freshness --json
```

For Chinese output:

```bash
acb demo freshness --lang zh-CN
```

The demo uses a temporary workspace under your system temp directory. It does not edit third-party client configuration, start a background daemon, or inject hidden prompt text.
