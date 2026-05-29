# ACB 中文快速上手

这份文档面向第一次使用 ACB 的中文用户。目标是先跑通最小路径，再决定是否接入 dashboard 或 MCP。

## 1. 安装或直接运行

全局安装：

```bash
npm install -g @xiaoshuo1988/acb
acb quickstart --check
```

中文输出：

```bash
acb quickstart --check --lang zh-CN
```

不安装，直接试用：

```bash
npx @xiaoshuo1988/acb quickstart --check
```

`quickstart --check` 会检查本地 store、Git、剪贴板、`acb` 是否在 PATH 里，并给出推荐目标客户端和下一步命令，包括 `acb demo`、`acb setup --check`、`acb verify workflow` 和 `acb dashboard`。

## 2. 先看一条安全示例

如果你还没有真实上下文可保存，可以先创建一条只写入本地 store 的示例 packet：

```bash
acb demo --lang zh-CN
acb dashboard --workspace . --lang zh-CN
```

这条示例不会修改第三方客户端配置，只是让你先看到 dashboard、brief、resume 和 setup 的实际样子。

## 3. 保存当前上下文

在掌握当前上下文的 Agent 或终端里运行：

```bash
acb handoff --from codex --summary "Ready for next agent" --git
```

这会：

- 在本地保存一个 handoff packet。
- 记录当前 workspace。
- 附带轻量 Git 状态。
- 把接管提示词复制到剪贴板。

## 4. 让下一个 Agent 接管

在下一个 Agent 或终端里运行：

```bash
acb resume
```

然后把输出或剪贴板里的提示词粘贴给下一个 Agent。

如果你希望第一次消息更短：

```bash
acb brief
```

## 5. 用 setup 找到推荐接入路径

```bash
acb setup --check
acb setup --check --lang zh-CN
```

不指定目标时，ACB 会只读检测本地环境，并推荐一个目标客户端。`--check` 会顺手跑 ACB 侧 smoke test，确认 recipe、handoff、brief、MCP 和 dashboard state 都能工作。

指定目标也可以：

```bash
acb setup codex --check
acb setup opencode --workspace .
acb setup cline --json
```

## 6. 打开可视化面板

```bash
acb dashboard --workspace .
acb dashboard --workspace . --lang zh-CN
```

Dashboard 适合做这些事：

- 当前 workspace 为空时，一键创建本地 demo packet。
- 看当前 workspace 最近的 handoff。
- 搜索 packet。
- 点击复制 brief、full prompt 或 MCP pull instruction。
- 查看目标客户端 setup guide。
- 点击运行 ACB-side check。

Dashboard 默认只监听 `127.0.0.1`。它不会自动启动，不会改第三方客户端配置，也不会隐藏注入 prompt。

## 7. 发布前或大改后跑矩阵验证

```bash
acb verify workflow --all
```

这会对所有支持目标跑 ACB 侧检查：

- `opencode`
- `cline`
- `roo`
- `claude-desktop`
- `codex`
- `generic-mcp`

它只验证 ACB 自己这一侧，不启动也不修改这些客户端。

## 推荐首跑顺序

```bash
npx @xiaoshuo1988/acb quickstart --check
acb demo --lang zh-CN
acb handoff --from codex --summary "Ready for next agent" --git
acb resume
acb setup --check --lang zh-CN
acb dashboard --workspace . --lang zh-CN
```

如果你还没有全局安装，第一行之后可以先运行：

```bash
npm install -g @xiaoshuo1988/acb
```
