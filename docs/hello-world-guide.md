# Hello World Guide

A step-by-step walkthrough that validates the full Claude Agent SDK stack end-to-end: SDK integration, agent handoff, feature tracking, OTel instrumentation, and Biome hook feedback. This is the first project to build with the reference architecture.

## What This Validates

- Bun project initialization with Biome configuration
- Agent SDK TypeScript integration working end-to-end
- Initializer → coding agent handoff
- Feature list creation and progress tracking with Zod validation
- Git-based state persistence
- Basic security model (filesystem + command restrictions)
- OTel instrumentation: traces in Jaeger, metrics in Prometheus
- Biome PostToolUse hook: agent writes file with lint error → Biome catches it → systemMessage → agent fixes
- Biome git commit gate: agent cannot commit code with Biome errors

## Prerequisites

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Verify
bun --version  # 1.1+

# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Set API key
export ANTHROPIC_API_KEY="your-key"

# Install agent-browser (for browser-based testing)
npm i -g agent-browser && agent-browser install

# Start OTel collector (Jaeger all-in-one for dev)
docker run -d --name jaeger \
  -p 16686:16686 \  # Jaeger UI
  -p 4317:4317 \    # OTLP gRPC
  -p 4318:4318 \    # OTLP HTTP
  jaegertracing/all-in-one:latest
```

## Step 1: Project Scaffolding

```bash
mkdir -p agent-harness-hello-world && cd agent-harness-hello-world
bun init -y

# Install dependencies
bun add @anthropic-ai/claude-agent-sdk zod \
  @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/exporter-trace-otlp-grpc \
  @opentelemetry/exporter-metrics-otlp-grpc \
  @opentelemetry/resources @opentelemetry/semantic-conventions

bun add -d @biomejs/biome @types/bun

# Initialize Biome
bunx biome init
```

## Step 2: App Spec

Create `prompts/app_spec.txt`:

```
Build a Bun HTTP server with two endpoints:

1. GET / — Returns "Hello, World!" as plain text
2. GET /health — Returns JSON: { "status": "ok", "timestamp": "<ISO 8601>", "uptime": <seconds> }

Requirements:
- Use Bun.serve() for the HTTP server
- Listen on port 3000 (configurable via PORT env var)
- Include proper Content-Type headers
- Handle 404 for unknown routes with a JSON error response
- All code must pass Biome linting with zero errors
```

## Step 3: Feature List

Create `generations/hello-world/feature_list.json`:

```json
[
  {
    "category": "functional",
    "description": "GET / returns Hello, World! as plain text",
    "steps": [
      "Start the server with bun run src/index.ts",
      "Send GET request to http://localhost:3000/",
      "Verify response body is exactly 'Hello, World!'",
      "Verify Content-Type header is text/plain"
    ],
    "passes": false
  },
  {
    "category": "functional",
    "description": "GET /health returns JSON status",
    "steps": [
      "Send GET request to http://localhost:3000/health",
      "Verify response is valid JSON",
      "Verify JSON has 'status' field with value 'ok'",
      "Verify JSON has 'timestamp' field in ISO 8601 format",
      "Verify JSON has 'uptime' field as a positive number",
      "Verify Content-Type header is application/json"
    ],
    "passes": false
  },
  {
    "category": "functional",
    "description": "Unknown routes return 404 JSON error",
    "steps": [
      "Send GET request to http://localhost:3000/nonexistent",
      "Verify response status is 404",
      "Verify response is JSON with error message",
      "Verify Content-Type is application/json"
    ],
    "passes": false
  },
  {
    "category": "functional",
    "description": "PORT environment variable configures listen port",
    "steps": [
      "Set PORT=4000 environment variable",
      "Start the server",
      "Verify server listens on port 4000"
    ],
    "passes": false
  },
  {
    "category": "api",
    "description": "Server responds with correct Content-Type headers",
    "steps": [
      "GET / returns Content-Type: text/plain",
      "GET /health returns Content-Type: application/json",
      "GET /unknown returns Content-Type: application/json"
    ],
    "passes": false
  }
]
```

## Step 4: Simplified Harness for Hello World

For the hello world, we skip the planner and evaluator — just initializer + coding agent:

```typescript
// src/hello-world.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";
import { createBiomeHooks } from "./biome-hooks";
import { bashSecurityHook } from "./security";
import { featureListExists, countPassingTests, printProgress } from "./progress";
import { AgentConfigSchema } from "./schemas";

const config = AgentConfigSchema.parse({
  projectDir: resolve(import.meta.dir, "../generations/hello-world"),
  maxIterations: 5,
  model: "claude-sonnet-4-6",
  enableEvaluator: false,
  enableBiomeHooks: true,
  enableOtel: true,
  otelEndpoint: "http://localhost:4317",
});

// Ensure project dir exists
await Bun.spawn(["mkdir", "-p", config.projectDir]).exited;

const biomeHooks = createBiomeHooks(config, /* otel */ null as any);

async function runSession(prompt: string): Promise<void> {
  for await (const message of query({
    prompt,
    options: {
      model: config.model,
      cwd: config.projectDir,
      permissionMode: "bypassPermissions",
      allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [bashSecurityHook] },
          ...(biomeHooks.preToolUse ?? []),
        ],
        PostToolUse: [
          ...(biomeHooks.postToolUse ?? []),
        ],
        Stop: [
          ...(biomeHooks.stop ?? []),
        ],
      },
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") process.stdout.write(block.text);
        if (block.type === "tool_use") console.log(`\n[Tool: ${block.name}]`);
      }
    }
    if (message.type === "result") {
      console.log(`\nSession complete: ${message.subtype}`);
      if (message.total_cost_usd) console.log(`Cost: $${message.total_cost_usd.toFixed(4)}`);
    }
  }
}

// Main loop
for (let i = 0; i < config.maxIterations; i++) {
  const isInit = !(await featureListExists(config.projectDir));

  if (!isInit) {
    const { passing, total } = await countPassingTests(config.projectDir);
    printProgress(passing, total);
    if (passing === total && total > 0) {
      console.log("\nAll features passing! Hello World complete.");
      break;
    }
  }

  const prompt = isInit
    ? `You are initializing a new project. Read the app_spec.txt and feature_list.json in this directory. Set up the project: run bun init, create biome.json, create init.sh that starts the server, initialize git. Do NOT implement features yet — just set up the project structure.`
    : `You are a coding agent. Read feature_list.json and git log. Pick the highest-priority incomplete feature. Implement it. Test it with curl. Mark it passing. Commit your work. Update progress.`;

  console.log(`\n${"=".repeat(50)}\nSession ${i + 1} (${isInit ? "init" : "coding"})\n${"=".repeat(50)}\n`);
  await runSession(prompt);
  await Bun.sleep(3000);
}
```

## Step 5: Run It

```bash
# Copy app_spec.txt and feature_list.json into generations/hello-world/
cp prompts/app_spec.txt generations/hello-world/
cp feature_list_template.json generations/hello-world/feature_list.json

# Run the harness
bun run src/hello-world.ts

# Watch Jaeger for traces
open http://localhost:16686
```

## What to Observe

1. **Session 1 (Initializer)**: Creates project structure, `package.json`, `biome.json`, `init.sh`, initial git commit. Does NOT implement features.
2. **Session 2+ (Coding)**: Picks first incomplete feature, implements it. When agent writes a file with a lint error (e.g., `let` instead of `const`, unused import), the Biome PostToolUse hook fires and injects a systemMessage. The agent self-corrects on the next turn.
3. **Git commit gate**: If the agent tries to commit with Biome errors, the PreToolUse hook blocks the commit and tells the agent why.
4. **Jaeger traces**: You should see `harness_run` → `session_1` → `tool:Write`, `tool:Bash`, etc.
5. **Completion**: After all 5 features pass, the harness exits.

---

> **See also**: [Main Reference Architecture](./claude-agent-sdk-reference-architecture.md) · [TDX MCP Server Design](./tdx-mcp-server-design.md)
