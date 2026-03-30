# Claude Agent SDK — API Reference

TypeScript API reference for the `@anthropic-ai/claude-agent-sdk` package. Covers core functions, options, message types, hooks, MCP server configuration, permission modes, and tool annotations.

---

## Core Functions

### `query()` — Primary Entry Point

Creates an async generator that streams messages from a Claude agent session.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query;
```

The `Query` object extends `AsyncGenerator<SDKMessage, void>` with:
- `setPermissionMode(mode: PermissionMode)`: Dynamically change permission mode
- `cancel()`: Abort the query

### `tool()` — Type-Safe MCP Tool Definition

Creates tool definitions with Zod schema validation.

```typescript
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

function tool<Schema extends AnyZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>,
  extras?: { annotations?: ToolAnnotations }
): SdkMcpToolDefinition<Schema>;
```

Handler return type:
```typescript
interface CallToolResult {
  content: (TextBlock | ImageBlock | ResourceBlock)[];
  isError?: boolean;  // true = agent sees error and can retry
}
```

### `createSdkMcpServer()` — In-Process MCP Server

Wraps tool definitions into an MCP server that runs in the same process.

```typescript
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

function createSdkMcpServer(params: {
  name: string;
  version?: string;
  tools: SdkMcpToolDefinition[];
}): SdkMcpServer;
```

## V2 Preview API

Unstable multi-turn session management:

```typescript
// Create new session
const session = unstable_v2_createSession({ model: "claude-sonnet-4-6" });

// Resume existing session
const session = unstable_v2_resumeSession(sessionId, { model: "claude-sonnet-4-6" });

// One-shot convenience
const result = await unstable_v2_prompt("Hello", { model: "claude-sonnet-4-6" });
```

## Options Interface

```typescript
interface Options {
  // Model
  model?: string;

  // Tool control
  allowedTools?: string[];         // Whitelist: ["Read", "Write", "mcp__weather__*"]
  disallowedTools?: string[];      // Blacklist

  // Permissions
  permissionMode?: "default" | "dontAsk" | "acceptEdits" | "bypassPermissions" | "plan";

  // Session management
  continue?: boolean;              // Continue last session
  resume?: string;                 // Resume by session ID
  forkSession?: boolean;           // Fork from existing session
  persistSession?: boolean;        // Keep session for later resume

  // MCP servers
  mcpServers?: Record<string, StdioServer | HttpServer | SdkMcpServer>;

  // Hooks (see Section 4.5)
  hooks?: Record<string, HookMatcher[]>;

  // Working directory
  cwd?: string;

  // System prompt
  systemPrompt?: string;

  // Limits
  maxTurns?: number;

  // Settings
  settingSources?: ("project" | "filesystem")[];

  // Subagent definitions
  agents?: Record<string, AgentDefinition>;

  // Environment variables (for OTel, etc.)
  env?: Record<string, string>;
}
```

## Message Types

```typescript
// Union of all message types streamed from query()
type SDKMessage =
  | SystemMessage        // Init, updates, notifications
  | AssistantMessage     // Model output (text + tool_use blocks)
  | ResultMessage        // Session completion
  | SDKCompactBoundaryMessage  // Context compaction event
  | SDKToolProgressMessage;    // Tool execution progress

interface AssistantMessage {
  type: "assistant";
  message: {
    role: "assistant";
    content: (TextBlock | ToolUseBlock)[];
    id: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  session_id: string;
}

interface ResultMessage {
  type: "result";
  subtype: "success" | "error_during_execution" | "error_max_turns" | "error_max_budget_usd";
  session_id: string;
  result: string;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  stop_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

interface SDKCompactBoundaryMessage {
  type: "system";
  subtype: "compact_boundary";
  compact_metadata: {
    trigger: "manual" | "auto";
    pre_tokens: number;
  };
  session_id: string;
}
```

## Hooks API

Hooks intercept agent lifecycle events and can modify behavior.

```typescript
interface HookMatcher {
  matcher?: string;         // Regex pattern matching tool_name
  hooks: HookCallback[];    // Array of callbacks
  timeout?: number;         // Seconds, default 60
}

type HookCallback = (
  input: HookInput,
  toolUseId: string | undefined,
  context: { signal: AbortSignal }
) => Promise<HookOutput>;

interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision?: "allow" | "deny" | "ask";
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
    additionalContext?: string;
  };
  systemMessage?: string;    // Injected into agent's conversation context
  continue?: boolean;
  async?: boolean;
  asyncTimeout?: number;
}
```

Available hook events and their input types:

| Hook Event | Key Fields | Can Block? |
|---|---|---|
| `PreToolUse` | `tool_name`, `tool_input`, `session_id`, `cwd`, `agent_id?`, `agent_type?` | Yes (`permissionDecision: "deny"`) |
| `PostToolUse` | `tool_name`, `tool_result`, `session_id`, `cwd` | No (but can inject `systemMessage`) |
| `PostToolUseFailure` | `tool_name`, `error`, `is_interrupt`, `session_id` | No |
| `Stop` | `session_id`, `reason` | Can inject `systemMessage` |
| `PreCompact` | `session_id`, `pre_tokens` | No |
| `SessionStart` | `session_id`, `source`, `agent_type?`, `model?` | No |
| `SessionEnd` | `session_id`, `reason` | No |
| `SubagentStart` | `agent_id`, `agent_type`, `session_id` | No |
| `SubagentStop` | `agent_id`, `agent_type`, `session_id` | No |
| `Notification` | `message`, `notification_type?`, `title?`, `session_id` | No |
| `TaskCompleted` | `tool_use_id`, `session_id` | No |

## MCP Server Configuration

```typescript
// Stdio (external process)
interface StdioServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// HTTP/SSE (remote server)
interface HttpServer {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
}

// In-process (from createSdkMcpServer)
// Pass SdkMcpServer directly

// Tool naming convention:
// mcp__{server_name}__{tool_name}
// Wildcard: mcp__{server_name}__*
```

## Permission Modes

| Mode | Behavior |
|---|---|
| `"default"` | No auto-approvals; unmatched tools trigger interactive prompt |
| `"dontAsk"` | Unlisted tools denied automatically (no prompt) |
| `"acceptEdits"` | File operations (Edit, Write, mkdir, rm, mv, cp) auto-approved |
| `"bypassPermissions"` | All tools run without permission prompts |
| `"plan"` | No tool execution; Claude plans only |

## Tool Annotations

```typescript
interface ToolAnnotations {
  readOnlyHint?: boolean;       // Tool doesn't modify environment
  destructiveHint?: boolean;    // Tool may perform destructive updates
  idempotentHint?: boolean;     // Repeated calls have no additional effect
  openWorldHint?: boolean;      // Tool reaches outside systems
}
```

---

## SDK Wrapper (`src/sdk-wrapper.ts`)

Type-safe wrapper around `query()` that consolidates the async generator loop, OTel instrumentation, message dispatch, and session metrics into a single function call.

### `runAgentSession()`

```typescript
import { runAgentSession } from "./sdk-wrapper.js";

const result = await runAgentSession({
  agentType: "generator",
  prompt: "Implement the login page",
  model: "claude-sonnet-4-6",
  cwd: "/path/to/project",
  allowedTools: ["Read", "Write", "Edit", "Bash"],
});

console.log(result.costUsd, result.numTurns, result.isError);
```

#### `AgentSessionOptions`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agentType` | `"initializer" \| "planner" \| "generator" \| "evaluator"` | required | Agent type label (used for OTel span naming and metrics) |
| `prompt` | `string` | required | The prompt to send to the agent |
| `model` | `string` | required | Claude model ID |
| `cwd` | `string` | required | Working directory for the agent |
| `allowedTools` | `string[]` | required | Tool whitelist |
| `permissionMode` | `PermissionMode` | `"bypassPermissions"` | SDK permission mode |
| `hooks` | `Partial<Record<HookEvent, HookCallbackMatcher[]>>` | — | Lifecycle hooks (PreToolUse, PostToolUse, etc.) |
| `env` | `Record<string, string>` | — | Environment variables passed to the agent |
| `session` | `SessionOptions` | — | Session management (continue, resume, fork) |
| `handlers` | `MessageHandlers` | `defaultHandlers` | Per-message-type callbacks |
| `maxTurns` | `number` | — | Maximum agentic turns |
| `otel` | `OtelContext` | — | OTel context for instrumentation |
| `parentSpan` | `Span` | — | Parent span for tracing |
| `spanAttributes` | `Record<string, string \| number>` | — | Extra attributes on the session span |

#### `AgentSessionResult`

Returned on completion:

```typescript
interface AgentSessionResult {
  sessionId: string;
  subtype: string;           // "success" | "error_during_execution" | ...
  isError: boolean;
  result?: string;           // present on success
  errors?: string[];         // present on error
  costUsd: number;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
  };
}
```

#### `SessionOptions`

Maps directly to SDK session management fields:

```typescript
interface SessionOptions {
  continue?: boolean;       // Continue last session
  resume?: string;          // Resume by session ID
  forkSession?: boolean;    // Fork from existing session
  persistSession?: boolean; // Keep session for later resume
}
```

#### `MessageHandlers`

Override message dispatch per type. Unset handlers are silently skipped. `onMessage` fires only for message types that don't have a dedicated handler (i.e., types other than `assistant`, `result`, `system`, and `tool_progress`).

```typescript
interface MessageHandlers {
  onAssistant?: (message: SDKAssistantMessage) => void;
  onResult?: (message: SDKResultMessage) => void;
  onSystem?: (message: SDKMessage & { type: "system" }) => void;  // all system subtypes
  onToolProgress?: (message: SDKToolProgressMessage) => void;
  onMessage?: (message: SDKMessage) => void;  // unhandled types only
}
```

### `defaultHandlers`

The built-in handlers that stream assistant text to stdout and log result summaries:

```typescript
import { defaultHandlers } from "./sdk-wrapper.js";

// Use as-is or extend:
await runAgentSession({
  ...options,
  handlers: {
    ...defaultHandlers,
    onResult(msg) {
      defaultHandlers.onResult?.(msg);
      myCustomLogger.info("Session done", { cost: msg.total_cost_usd });
    },
  },
});
```

---

> **See also**: [Main Reference Architecture](./claude-agent-sdk-reference-architecture.md)
