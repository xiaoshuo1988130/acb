# Promotion Kit

This page collects copy, launch notes, and a practical feedback plan for AgentContextBus.

Use it as a source of truth when posting about ACB. Keep the tone specific, honest, and feedback-seeking. ACB is a developer tool, so the first promotion goal is not hype; it is getting real users to run the first-run check and report friction.

## Positioning

Short version:

> AgentContextBus is a local-first context handoff CLI for coding agents.

One-liner:

> ACB lets Codex, OpenCode, Cline, Claude Desktop, scripts, and terminals pass workspace context through local handoff packets, paste-ready prompts, a local dashboard, or explicit MCP tools.

Boundary:

> No hidden prompt injection, no client config mutation, no cloud sync, and no background daemon.

Primary call to action:

```bash
npx @xiaoshuo1988/acb verify first-run
```

Secondary call to action:

```bash
npx @xiaoshuo1988/acb quickstart --check
```

Repository:

```text
https://github.com/xiaoshuo1988130/acb
```

## Audience

Start with people who already feel the pain:

- Developers using more than one coding agent.
- Codex, OpenCode, Cline, Roo Code, Claude Desktop, and Claude Code users.
- MCP users who prefer explicit local tools.
- Developers who hand work between terminal scripts and chat-based coding agents.
- People building AI coding workflows and local-first tools.

Avoid broad AI/productivity audiences at first. They will ask for automation that ACB intentionally does not do.

## Message Pillars

Use these consistently:

- Local-first: packets stay in a local JSON store.
- Explicit: users choose when to copy, paste, or expose context.
- Agent-agnostic: works through prompts, dashboard, JSON, and MCP.
- Inspectable: store, dashboard state, and commands are visible.
- Safe boundary: no hidden injection, no third-party config edits.

## 30-Second Demo Script

Record a short terminal or screen capture with this flow:

```bash
npx @xiaoshuo1988/acb quickstart --check
npx @xiaoshuo1988/acb verify first-run
npm install -g @xiaoshuo1988/acb
acb demo
acb dashboard --workspace .
```

Show these moments:

- `Next actions` from quickstart.
- `ACB First-Run Verify` passing.
- Dashboard showing the demo packet.
- The `Copy Brief Prompt` button.
- The explicit local-control note.

Do not show a fake agent auto-switching. That would misrepresent the product.

## Direct Feedback Message

Use this for individual developers:

```text
Hey, I’m building AgentContextBus, a local-first CLI for passing workspace context between coding agents without hidden prompt injection or editing client configs.

If you use multiple coding agents, could you try this one command and tell me where it feels confusing?

npx @xiaoshuo1988/acb verify first-run

Repo: https://github.com/xiaoshuo1988130/acb
```

Chinese:

```text
我做了一个 ACB，本地优先的编码 Agent 上下文交接 CLI，不做隐藏 prompt 注入，也不改第三方客户端配置。

如果你平时会在 Codex / Cline / OpenCode / Claude Code 之间切换，能不能帮我跑一下这条命令，看首次体验哪里卡？

npx @xiaoshuo1988/acb verify first-run --lang zh-CN

仓库：https://github.com/xiaoshuo1988130/acb
```

## Short Social Post

English:

```text
I built AgentContextBus (acb), a local-first CLI for passing workspace context between coding agents.

It helps when switching between Codex, OpenCode, Cline, Claude Desktop, scripts, and terminals.

Try:
npx @xiaoshuo1988/acb verify first-run

Repo:
https://github.com/xiaoshuo1988130/acb

Looking for feedback from people who use multiple coding agents.
```

Chinese:

```text
我做了一个开源工具 AgentContextBus（acb），用于在多个编码 Agent 之间交接项目上下文。

适合在 Codex、Cline、OpenCode、Claude Desktop、终端脚本之间切换时使用。

试用：
npx @xiaoshuo1988/acb verify first-run --lang zh-CN

GitHub:
https://github.com/xiaoshuo1988130/acb

想找真实使用多个 coding agent 的朋友帮忙反馈首次体验。
```

## Longer Launch Post

English:

```text
I built AgentContextBus (acb), a local-first context handoff CLI for coding agents.

The problem: I often switch between Codex, OpenCode, Cline, Claude Desktop, scripts, and terminals. Each switch usually means re-explaining the current workspace state.

ACB gives the current agent a clean way to leave a local handoff packet, then gives the next agent a paste-ready prompt, local dashboard action, JSON surface, or explicit MCP tool to read it.

What it does:
- saves local handoff packets
- renders brief and full takeover prompts
- provides a local dashboard
- supports explicit MCP pull mode
- verifies the first-run path with one command

What it does not do:
- no hidden prompt injection
- no third-party client config mutation
- no cloud sync
- no background daemon

Try:
npx @xiaoshuo1988/acb verify first-run

Repo:
https://github.com/xiaoshuo1988130/acb

I’d especially like feedback from people who regularly use more than one coding agent.
```

Chinese:

```text
我做了一个开源工具 AgentContextBus（acb），用于在多个编码 Agent 之间交接项目上下文。

我遇到的问题是：在 Codex、OpenCode、Cline、Claude Desktop、脚本和终端之间切换时，经常要重复解释当前项目做到哪里了。

ACB 的做法是：当前 Agent 留下一个本地 handoff packet，下一个 Agent 可以通过可复制提示词、本地 dashboard、JSON 或显式 MCP 工具读取它。

它做什么：
- 保存本地上下文包
- 生成简短/完整接管提示词
- 提供本地 dashboard
- 支持显式 MCP pull
- 一条命令验证首次路径

它不做什么：
- 不隐藏注入 prompt
- 不修改第三方客户端配置
- 不云同步
- 不后台自动化

试用：
npx @xiaoshuo1988/acb verify first-run --lang zh-CN

GitHub:
https://github.com/xiaoshuo1988130/acb

想找真实使用多个 coding agent 的朋友帮忙反馈首次体验哪里不顺。
```

## Show HN Draft

Title:

```text
Show HN: AgentContextBus – local-first context handoff for coding agents
```

Body:

```text
Hi HN,

I built AgentContextBus (acb), a local-first CLI for handing workspace context between coding agents.

The use case is switching between tools like Codex, OpenCode, Cline, Claude Desktop, scripts, and terminals without re-explaining the current project state each time.

ACB saves a local handoff packet, then lets the next agent read it through a paste-ready prompt, brief prompt, local dashboard, JSON, or explicit MCP tool.

It intentionally does not do hidden prompt injection, traffic interception, third-party config edits, cloud sync, or background automation.

Try:
npx @xiaoshuo1988/acb verify first-run

Repo:
https://github.com/xiaoshuo1988130/acb

I’d love feedback on whether the first-run flow and boundaries are clear.
```

HN notes:

- Use it only after the README and `verify first-run` are clean.
- Reply calmly to skepticism about prompt injection and automation.
- Do not overclaim agent interoperability. ACB is an explicit handoff/control-plane tool.

## Reddit Draft

Use only in communities where self-promotion is allowed or when asking for feedback is clearly acceptable. Read the subreddit rules first.

Title:

```text
I built a local-first CLI for handing context between coding agents. Looking for feedback.
```

Post:

```text
I’m building AgentContextBus (acb), an open-source local-first CLI for passing workspace context between coding agents.

It is for people who switch between tools like Codex, OpenCode, Cline, Claude Desktop, scripts, and terminals and do not want to re-explain the same project state each time.

It saves local handoff packets and can render brief/full takeover prompts, expose JSON, show a local dashboard, or provide an explicit MCP pull path.

Boundaries:
- no hidden prompt injection
- no third-party client config mutation
- no cloud sync
- no background daemon

If you use multiple coding agents, I’d appreciate feedback on the first-run path:

npx @xiaoshuo1988/acb verify first-run

Repo:
https://github.com/xiaoshuo1988130/acb

Main question: does the first-run flow make sense, and would this fit your coding workflow?
```

Reddit notes:

- Disclose that you built it.
- Do not post the same link across many subreddits.
- Comment on other posts before posting your own.
- Prefer feedback-oriented posts over promotional language.

## V2EX / Chinese Community Draft

Title:

```text
做了一个本地优先的编码 Agent 上下文交接工具，想找人试一下首次体验
```

Body:

```text
我做了一个开源工具 AgentContextBus（acb），用于在多个编码 Agent 之间交接项目上下文。

场景是：你在 Codex、Cline、OpenCode、Claude Desktop、终端脚本之间切换，不想每次都重新解释项目做到哪了。

ACB 会保存一个本地 handoff packet，然后可以生成 brief/full 接管提示词，也可以通过本地 dashboard、JSON 或显式 MCP 工具读取。

边界：
- 不隐藏注入 prompt
- 不修改第三方客户端配置
- 不云同步
- 不后台自动化

首次验证命令：

npx @xiaoshuo1988/acb verify first-run --lang zh-CN

GitHub：
https://github.com/xiaoshuo1988130/acb

想问问大家：这个首次路径是否清楚？如果你使用多个 coding agent，会不会需要这种 handoff 工具？
```

## Product Hunt Draft

Do this later, after 5-10 real developer feedback conversations.

Name:

```text
AgentContextBus
```

Tagline:

```text
Local-first context handoff for coding agents
```

Description:

```text
AgentContextBus helps developers pass workspace context between coding agents through local handoff packets, paste-ready prompts, a local dashboard, JSON, and explicit MCP tools.
```

Maker comment:

```text
I built AgentContextBus because switching between coding agents often means re-explaining the same workspace context.

ACB keeps the handoff local and explicit: it saves local packets, renders brief/full takeover prompts, exposes a local dashboard and JSON, and supports an MCP pull path.

It intentionally avoids hidden prompt injection, third-party client config mutation, cloud sync, and background automation.

I’d love feedback from developers who use multiple coding agents in their daily workflow.

Try:
npx @xiaoshuo1988/acb verify first-run
```

## Seven-Day Plan

Day 1:

- Polish README top section.
- Record a 30-60 second demo.
- Prepare the English and Chinese posts.

Day 2:

- Send direct feedback requests to 10-20 developers.
- Ask one question: where does the first-run flow feel confusing?

Day 3:

- Fix the top 1-2 repeated friction points.
- Add FAQ entries if needed.

Day 4:

- Post one English public launch post.
- Post one Chinese public launch post.

Day 5:

- Reply to every comment.
- Collect objections and repeated questions.

Day 6:

- Ship a small bugfix or docs update if feedback reveals confusion.

Day 7:

- Decide whether the project is ready for Show HN.
- Do not launch on Product Hunt yet unless there is already real usage feedback.

## Feedback Tracker

Track these manually at first:

- Did they run `verify first-run`?
- Did it pass?
- Did they understand “handoff packet”?
- Did they open the dashboard?
- Did they ask how to connect a specific client?
- Did they worry about prompt injection or config mutation?
- What phrase confused them?
- Would they use this again?

## Reply Templates

When someone asks whether ACB injects prompts automatically:

```text
No. ACB is intentionally explicit. It saves local packets and renders copyable prompts or MCP-readable context, but it does not intercept traffic or inject prompts into model requests.
```

When someone asks whether it edits Cline/OpenCode/Claude config:

```text
No. ACB shows setup guidance and copyable snippets, but it does not patch third-party app config or private storage.
```

When someone asks why not just paste manually:

```text
Manual paste works for one switch. ACB is useful when you want reusable handoff packets, brief/full prompts, local history, dashboard inspection, and an MCP-readable path without relying on hidden state.
```

When someone asks how to try it safely:

```text
Run:
npx @xiaoshuo1988/acb verify first-run

It uses a temporary local store and does not touch your real ACB store.
```
