# AgentContextBus (`acb`)

[English](README.md) | 简体中文

AgentContextBus 是一个 local-first 的编码 Agent 上下文交接 CLI。

它解决一个很常见的问题：

> 我在 Codex、OpenCode、Cline、Claude Code、脚本和终端之间切换时，不想一遍遍解释当前项目做到哪里了。

ACB 让当前 Agent 留下一个本地上下文包，然后让下一个 Agent 通过可复制的提示词、dashboard 复制按钮或显式 MCP 工具读取它。

ACB 的边界很明确：

- 不做隐藏 prompt 注入。
- 默认不拦截网络流量。
- 不修改 Cline、Roo、OpenCode、VS Code、Claude Desktop 等客户端的私有存储。
- 不做后台跨 Agent 自动化。
- 不做云同步或托管 dashboard。

npm 包名是 `@xiaoshuo1988/acb`，安装后提供短命令 `acb`。请使用 scoped 包名；未加 scope 的 `acb` npm 包名已经被占用。

## 30 秒试用

```bash
npx @xiaoshuo1988/acb verify first-run --lang zh-CN
```

`verify first-run` 会用临时本地 store 检查 quickstart、demo packet、brief/resume、dashboard state 和 setup workflow。除非你自己传入 `ACB_STORE`，否则不会写入真实 ACB store。

![ACB terminal demo](docs/assets/terminal-demo.svg)

## 安装

```bash
npm install -g @xiaoshuo1988/acb
acb quickstart --check
```

中文终端输出：

```bash
acb quickstart --check --lang zh-CN
```

也可以设置环境变量：

```bash
ACB_LANG=zh-CN acb quickstart --check
```

也可以不安装，直接运行：

```bash
npx @xiaoshuo1988/acb quickstart --check
```

检查结果会给出推荐目标客户端、适合人看的“推荐下一步”，以及适合脚本读取的 `acb demo`、`acb setup --check`、`acb verify workflow` 和 `acb dashboard` 命令。

如果还没有真实 handoff 历史，可以先创建一条本地示例上下文包：

```bash
acb demo --lang zh-CN
acb dashboard --workspace . --lang zh-CN
```

如果想先验证完整首次路径但不写入真实 store：

```bash
acb verify first-run --lang zh-CN
```

## 60 秒流程

在掌握当前上下文的 Agent 里运行：

```bash
acb handoff --from codex --summary "Ready for OpenCode to continue" --git
```

ACB 会保存一个本地上下文包，并把交接提示词复制到剪贴板。

在下一个 Agent 或终端里运行：

```bash
acb resume
```

把复制出来的提示词粘贴给下一个编码 Agent。如果系统剪贴板不可用，ACB 会把提示词打印到终端，方便手动复制。

如果想先给下一个 Agent 一个更短的起步消息：

```bash
acb brief
```

`acb brief` 会复制一个精简接管摘要，并告诉接收方需要完整上下文时如何读取完整 packet。

想使用某个客户端的推荐路径：

```bash
acb recipe opencode
acb recipe cline
acb setup codex --workspace . --check
```

更具体的接收端示例见英文文档：

- [Codex client handoff](docs/examples/codex-client.md)
- [OpenCode client handoff](docs/examples/opencode-client.md)

想用可视化方式检查本地交接历史：

```bash
acb dashboard --workspace .
```

## 保存在哪里

默认情况下，ACB 把本地 JSON 存在：

```text
~/.acb/packets.json
```

每个上下文包可以包含：

- summary、status、notes、tags 和可选正文。
- workspace 路径。
- 轻量 Git 快照，包括 repo root、branch、short HEAD 和 `git status --short`。
- 当你显式传入 `--diff` 时，可附带有长度上限的 tracked diff。

实验时可以覆盖 store 路径：

```bash
ACB_STORE=./tmp/acb-packets.json acb handoff --summary "Test handoff"
```

## 复制粘贴模式

这是最安全的第一条路径，因为几乎所有客户端都有文本输入框。

```bash
acb handoff --from codex --summary "Implemented local store" --status "tests pass" --note "Review docs next"
acb resume
```

常用变体：

```bash
acb handoff --from codex --summary "Ready for review" --git
acb save --from opencode --summary "Longer context" --file ./handoff.md --copy
git diff -- README.md | acb save --from script --summary "Review README diff" --stdin
```

## MCP 拉取模式

支持 MCP 的客户端可以显式读取和写入 handoff：

```bash
acb config mcp --out ./mcp.json
acb verify mcp --config ./mcp.json --name acb
```

把生成的配置接入你的客户端后，告诉下游 Agent：

```text
Use acb to read the latest handoff for this workspace, then continue from it.
```

MCP server 暴露这些工具：

- `get_workspace_status`
- `read_latest_handoff`
- `read_handoff_brief`
- `read_handoff`
- `save_handoff`
- `update_handoff`
- `search_handoffs`
- `list_handoffs`
- `list_workspaces`

## 客户端配方

`acb recipe` 会把安全边界变成具体客户端步骤：

```bash
acb recipe
acb recipe opencode
acb recipe cline
acb recipe roo
acb recipe claude-desktop
acb recipe codex
acb recipe generic-mcp
```

如果想要更完整、可复制的接入指南：

```bash
acb setup
acb setup --check
acb setup --check --lang zh-CN
acb setup codex
acb setup opencode --workspace . --json
```

不指定目标时，`acb setup` 会使用和 dashboard 相同的只读检测逻辑，选择最合适的本地目标客户端。加上 `--check` 后，它会在展示接入步骤后运行 ACB 侧 workflow smoke test。

`acb setup` 会优先打印一条紧凑的推荐路径：保存当前上下文、检查 safety、验证 ACB 侧 workflow，然后打开 dashboard，把推荐交接文本复制到目标客户端。JSON 输出里也有同样的 `steps` 数组，方便 dashboard 或脚本复用。

## Workflow 验证

在手动接入客户端之前，可以先验证 ACB 这一侧是否准备好：

```bash
acb verify workflow opencode
acb verify workflow cline --json
acb verify workflow --all
acb setup codex --check
```

它会验证 recipe、handoff packet、brief、完整 resume prompt、MCP server 和 dashboard state。`--all` 可以作为发布前的全目标矩阵检查。这个过程不会启动或修改第三方客户端。

## 可视化 Dashboard

```bash
acb dashboard --workspace .
acb dashboard --workspace . --lang zh-CN
```

Dashboard 是一个显式启动的本地控制面板：

- 查看当前 workspace 的 handoff 历史。
- 如果当前 workspace 还是空的，可以一键创建本地 demo packet。
- 搜索和检查 packet 细节。
- 一键复制 brief、full prompt 或 MCP pull instruction。
- 自动只读检测 OpenCode、Cline、Roo Code、Claude Desktop、Codex 和 generic MCP 等目标。
- 为目标客户端展示紧凑 setup checklist 和 ACB-side check。

默认监听 `127.0.0.1`。除非你明确知道自己在做什么，否则不要用 `--host 0.0.0.0` 暴露到局域网。

## 常用命令

```bash
acb quickstart --check
acb demo --lang zh-CN
acb handoff --from <agent> --summary <text> --git
acb resume
acb brief
acb dashboard --workspace .
acb setup --check
acb verify first-run --lang zh-CN
acb verify workflow --all
acb doctor
acb config mcp --out ./mcp.json
acb verify mcp --config ./mcp.json --name acb
acb store backup --out ./acb-store.backup.json
```

## 中文快速上手

更短的中文上手说明见 [docs/zh-CN/quickstart.md](docs/zh-CN/quickstart.md)。
英文首次运行完整路径见 [docs/first-run.md](docs/first-run.md)。
CLI 输出稳定性说明见 [docs/cli-contract.md](docs/cli-contract.md)，store schema 见 [docs/store-schema.md](docs/store-schema.md)。
