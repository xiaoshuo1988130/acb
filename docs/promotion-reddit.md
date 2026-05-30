# Reddit Promotion Playbook

This page is the practical posting checklist for the first Reddit promotion step.

Start with one place only:

```text
r/ChatGPTCoding Self Promotion Thread
```

Do not post the same message across multiple subreddits on the same day. The goal of the first post is feedback, not traffic.

## Why This Channel First

`r/ChatGPTCoding` is close to ACB's target audience: people who use AI coding tools and run into workflow friction.

Its self-promotion threads are explicitly intended for project sharing. The thread rules commonly include:

- No selling access to models.
- Only promote once per project.
- Upvote the thread and fellow coders.
- Keep it community-friendly.

ACB fits this better than a general startup or side-project subreddit because it is open source, local-first, and specifically for coding-agent workflows.

## Where To Post

Open:

```text
https://www.reddit.com/r/ChatGPTCoding/
```

Then:

1. Search within the subreddit for `Self Promotion Thread`.
2. Sort by `New`.
3. Open the newest active self-promotion thread.
4. Post the text below as a comment.

If you cannot find a recent self-promotion thread, do not create a standalone post yet. Wait, or use the next channel in the promotion plan later.

## Exact Comment To Post

````text
I’m building AgentContextBus (acb), an open-source local-first CLI for handing workspace context between coding agents.

The problem I’m trying to solve: when switching between Codex, OpenCode, Cline, Claude Desktop, scripts, and terminals, I often have to re-explain the same project state again.

ACB saves a local handoff packet, then lets the next agent read it through:

- a paste-ready prompt
- a shorter brief prompt
- a local dashboard
- JSON output
- an explicit MCP pull path

What it intentionally does not do:

- no hidden prompt injection
- no third-party client config mutation
- no cloud sync
- no background daemon

If you use multiple coding agents, I’d really appreciate feedback on whether the first-run path makes sense:

```bash
npx @xiaoshuo1988/acb verify first-run
```

GitHub:
https://github.com/xiaoshuo1988130/acb

Main question: does this feel useful for your coding workflow, or is the handoff concept still unclear?
````

## Optional Shorter Version

Use this if the thread already has many long comments:

````text
I’m building AgentContextBus (acb), an open-source local-first CLI for handing workspace context between coding agents.

It is for switching between tools like Codex, OpenCode, Cline, Claude Desktop, scripts, and terminals without re-explaining the current project state each time.

It saves local handoff packets and can render brief/full prompts, show a local dashboard, expose JSON, or provide an explicit MCP pull path.

No hidden prompt injection, no client config mutation, no cloud sync, no background daemon.

Try:
```bash
npx @xiaoshuo1988/acb verify first-run
```

GitHub:
https://github.com/xiaoshuo1988130/acb

Looking for feedback from people who use multiple coding agents.
````

## After Posting

Reply to every real comment within 24 hours.

If someone asks whether ACB automatically injects prompts:

```text
No. ACB is intentionally explicit. It saves local packets and renders copyable prompts or MCP-readable context, but it does not intercept traffic or inject prompts into model requests.
```

If someone asks whether it edits Cline/OpenCode/Claude config:

```text
No. ACB shows setup guidance and copyable snippets, but it does not patch third-party app config or private storage.
```

If someone asks why not just paste manually:

```text
Manual paste works for one switch. ACB is useful when you want reusable handoff packets, brief/full prompts, local history, dashboard inspection, and an MCP-readable path without relying on hidden state.
```

If someone reports confusion:

```text
Thanks, that is exactly the kind of feedback I’m looking for. Which part was unclear first: the install command, the idea of a handoff packet, or where the next agent reads the context?
```

## What To Track

Record these manually after the post:

- Did anyone run `verify first-run`?
- Did they understand "handoff packet"?
- Did they ask for a specific client integration?
- Did anyone worry about prompt injection?
- Did anyone ask for a video or screenshot?
- What exact phrase confused people?

Do not argue with skeptical replies. Clarify the boundary once, ask for concrete feedback, then move on.
