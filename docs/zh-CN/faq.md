# 常见问题

## ACB 会自动启动吗？

不会。ACB 只会在你显式运行 CLI、MCP server 或 dashboard 命令时启动。

手动启动 dashboard：

```bash
acb dashboard --workspace . --lang zh-CN
```

用 `Ctrl+C` 停止。

## 为什么不自动启动 dashboard？

因为 ACB 的定位是显式本地交接工具，不是后台 Agent。自动启动会让用户更难判断当前到底运行了什么、localhost 暴露了什么、什么时候可以使用剪贴板复制按钮。

## ACB 会修改 Cline、Roo、OpenCode、VS Code 或 Claude Desktop 配置吗？

不会。ACB 不会 patch 客户端配置、扩展存储、私有数据库或应用状态。

它可以生成命令和 MCP 配置片段：

```bash
acb config mcp --out ./mcp.json
acb setup opencode --workspace . --check
```

是否粘贴到对应客户端，由你决定。

## 剪贴板不可用怎么办？

剪贴板不可用时，ACB 会把提示词打印到终端。

也可以强制输出到终端：

```bash
acb resume --print-prompt
acb brief --print-brief
acb show <packet-id> --prompt
```

## 怎么确认下一个 Agent 真的读到了 handoff？

让它在改文件前复述这些具体字段：

- Packet id。
- Workspace 路径。
- Summary 和 status。
- Notes。
- Safety level 和 warnings。
- 如果有 Git 快照，复述 branch 和 dirty file count。

如果它说不出 packet id，就让它停下，然后重新粘贴 `acb resume --id <packet-id>` 的完整输出。

## safety warning 会自动删内容吗？

不会。Safety hints 只是读取时的审阅提示。ACB 不会静默 redact、重写或删除 packet 内容。

检查安全提示：

```bash
acb safety
```

## 数据存在哪里？

默认在：

```text
~/.acb/packets.json
```

实验时可以用 `ACB_STORE`：

```bash
ACB_STORE=./tmp/acb-packets.json acb demo
```

## ACB 会云同步吗？

不会。当前产品没有托管 dashboard，也没有云同步。Dashboard 读取的是本地 store。

## 能和 MCP 一起用吗？

可以。先生成并验证本地 stdio MCP 配置：

```bash
acb config mcp --out ./mcp.json
acb verify mcp --config ./mcp.json --name acb
```

然后通过对应客户端支持的设置路径手动接入。

## 第一次应该跑什么？

快速可视化 demo：

```bash
npx @xiaoshuo1988/acb@latest quickstart --check --lang zh-CN
npx @xiaoshuo1988/acb@latest demo --lang zh-CN
npx @xiaoshuo1988/acb@latest dashboard --workspace . --lang zh-CN
```

完全不写真实 store 的 smoke test：

```bash
npx @xiaoshuo1988/acb@latest verify first-run --lang zh-CN
```
