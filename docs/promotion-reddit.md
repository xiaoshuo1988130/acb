# Reddit 推广操作稿

这份文档只负责第一步 Reddit 推广：先在一个最匹配的社区里发一次，观察真实开发者反馈。

第一站：

```text
r/ChatGPTCoding Self Promotion Thread
```

不要同一天把同一段内容发到多个 subreddit。第一帖的目标不是流量，而是确认 ACB 的首次体验、定位和边界是否容易理解。

## 为什么先发这里

`r/ChatGPTCoding` 的用户更接近 ACB 的目标人群：他们本来就在使用 AI coding 工具，也更容易理解“多个编码 Agent 之间切换”的痛点。

它的 self-promotion thread 通常允许项目分享，但要注意这些常见规则：

- 不卖模型访问。
- 同一个项目只推广一次。
- 给 thread 和其他开发者一些正常互动。
- 保持社区友好，不要刷屏。

ACB 比较适合先发这里，因为它是开源、本地优先、面向 coding-agent workflow 的开发工具，比泛泛的创业/产品社区更精准。

## 具体发在哪里

打开：

```text
https://www.reddit.com/r/ChatGPTCoding/
```

然后这样做：

1. 在这个 subreddit 内搜索 `Self Promotion Thread`。
2. 排序选择 `New`。
3. 打开最新仍然活跃的 self-promotion thread。
4. 把下面的英文正文作为评论发出去。

如果找不到近期的 self-promotion thread，先不要单独开新帖。等下一期 thread，或者再转到推广计划里的下一个渠道。

## 直接复制发布的正文

下面这段直接复制到 Reddit 评论框里即可：

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

## 更短版本

如果那个 thread 里已经有很多长评论，或者你想更克制一点，就发这个短版：

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

## 发完之后怎么处理

24 小时内尽量回复每一条真实评论。

如果 AutoModerator 提示因为账号 karma 进入人工审核，不要重复发帖，也不要换标题重发。先等一段时间；如果想主动处理，可以点提示里的 `contact the moderators of this subreddit`，给版主发下面这段：

```text
Hi mods,

My post/comment was removed for manual review due to account karma.

I understand the anti-spam filter. I’m the maintainer of the open-source project I shared, AgentContextBus, and I posted it in the self-promotion thread to ask for feedback from developers who use AI coding tools.

Repo:
https://github.com/xiaoshuo1988130/acb

If the post does not fit the thread rules, no worries. If it is acceptable, could you please approve it when you have time?

Thanks.
```

如果有人问 ACB 是否会自动注入 prompt，可以回：

```text
No. ACB is intentionally explicit. It saves local packets and renders copyable prompts or MCP-readable context, but it does not intercept traffic or inject prompts into model requests.
```

如果有人问它是否会修改 Cline / OpenCode / Claude 配置，可以回：

```text
No. ACB shows setup guidance and copyable snippets, but it does not patch third-party app config or private storage.
```

如果有人问“为什么不直接手动复制粘贴”，可以回：

```text
Manual paste works for one switch. ACB is useful when you want reusable handoff packets, brief/full prompts, local history, dashboard inspection, and an MCP-readable path without relying on hidden state.
```

如果有人说不理解，可以回：

```text
Thanks, that is exactly the kind of feedback I’m looking for. Which part was unclear first: the install command, the idea of a handoff packet, or where the next agent reads the context?
```

## 需要记录什么

发完后手动记录这些反馈：

- 有没有人真的运行 `verify first-run`？
- 他们是否理解 `handoff packet`？
- 有没有人问某个具体客户端怎么接入？
- 有没有人担心 prompt injection？
- 有没有人要求视频、截图或 demo？
- 哪个词、哪句话最让人困惑？

遇到怀疑或反对时不要争论。解释一次边界，追问具体哪里不清楚，然后把反馈带回产品和文档里。
