# Brief Mode

`acb brief` is the compact receiving-side path.

Use it when a downstream coding agent does not need the full handoff prompt immediately, or when you want the first message in a new chat to stay short.

```bash
acb brief
acb brief --id pkt_20260527123000_abc123
acb brief --print-brief
acb brief --json
```

By default, ACB copies the brief to the clipboard. If clipboard access fails, it prints the brief to the terminal.

The brief includes:

- Packet id, source, workspace, summary, status, and tags.
- Lightweight Git branch, head, and dirty-file count when available.
- Up to eight notes.
- A bounded context excerpt.
- Commands for pulling the full prompt or inspecting the packet.

MCP clients can use the same surface:

```text
read_handoff_brief
```

That tool accepts either a packet `id` or a `workspace`. If no id is provided, it returns the newest packet for the workspace.

Brief mode does not replace `acb resume`. It is a lower-friction first message. Use `acb resume --id ...` or `read_handoff` when the receiving agent needs the complete packet.
