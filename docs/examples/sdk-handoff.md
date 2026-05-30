# SDK and LangChain Handoff

ACB is safest when context transfer stays explicit:

1. The current agent saves a packet.
2. Your app or next agent reads that packet.
3. You decide what text goes into the next model request.

```bash
acb handoff --from codex --summary "Ready for SDK continuation" --git
acb safety
acb latest --json
```

## Node SDK Shape

Use the CLI JSON output as the integration boundary. This keeps ACB independent of any one model SDK.

```js
import { spawnSync } from "node:child_process";

function readLatestHandoff(workspace = process.cwd()) {
  const result = spawnSync("acb", ["latest", "--workspace", workspace, "--json"], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || "acb latest failed");
  return JSON.parse(result.stdout);
}

const packet = readLatestHandoff();

if (packet.safety?.level === "warn") {
  console.error("Review ACB safety warnings before sending this context:");
  console.error(packet.safety.warnings);
  process.exit(1);
}

const handoffContext = [
  `ACB packet: ${packet.id}`,
  `Workspace: ${packet.workspace}`,
  `Summary: ${packet.summary || ""}`,
  `Status: ${packet.status || ""}`,
  packet.body ? `Body:\n${packet.body}` : "",
].filter(Boolean).join("\n\n");

// Pass handoffContext into your own SDK call explicitly.
```

## OpenAI-Compatible Prompt Pattern

Keep ACB as visible context, not hidden prompt injection:

```js
const messages = [
  {
    role: "system",
    content: "Continue from the explicit ACB handoff context. Do not assume hidden state.",
  },
  {
    role: "user",
    content: handoffContext,
  },
];
```

## LangChain-Style Context Document

For LangChain or similar orchestration, load the packet as a normal document-like object:

```js
const packet = readLatestHandoff();

const acbDocument = {
  pageContent: [
    packet.summary,
    packet.status,
    ...(packet.notes || []),
    packet.body || "",
  ].filter(Boolean).join("\n\n"),
  metadata: {
    source: "acb",
    packet_id: packet.id,
    workspace: packet.workspace,
    safety_level: packet.safety?.level || "unknown",
  },
};
```

Review `acbDocument.metadata.safety_level` before adding the document to a chain or retriever. ACB safety hints are review aids only; they do not replace a dedicated secret scanner.

## MCP Pull Alternative

If the receiving client supports MCP, configure ACB once and ask the next agent to call the tool:

```bash
acb config mcp --out ./mcp.json
acb verify mcp --config ./mcp.json --name acb
```

Then paste:

```text
Use acb to read the latest handoff for this workspace, then continue from it.
```
