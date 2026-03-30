# Source Analysis — Claude Agent SDK Research

This document synthesizes findings from five Anthropic resources that inform the Claude Agent SDK Reference Architecture. It serves as the research foundation and literature review for the architecture decisions documented in the main reference architecture.

## 2.1 Resource 1: "Effective Harnesses for Long-Running Agents" (Nov 2025)

This foundational blog post by Justin Young introduces the two-agent pattern for long-running autonomous coding. The central metaphor: "a software project staffed by engineers working in shifts, where each new engineer arrives with no memory of what happened on the previous shift."

### The Context Window Gap Problem

Even frontier models fail at production-quality builds when given only high-level prompts like "build a clone of claude.ai" because compaction alone isn't sufficient. The problem isn't that the model can't write code — it's that multi-session work requires *structured memory* that survives context boundaries.

### Two Failure Modes

| Problem | Symptom | Countermeasure |
|---------|---------|----------------|
| Over-ambition | Agent exhausts context mid-feature, leaves undocumented half-finished work | Feature list forces one-at-a-time discipline; progress file documents state |
| Premature completion | Agent surveys work, declares victory despite incomplete requirements | Feature list with `"passes": false` entries is the source of truth, not the agent's judgment |

### Environment Management Artifacts

**`feature_list.json`** — The single source of truth for project progress. Uses JSON specifically because "the model is less likely to inappropriately change or overwrite JSON files compared to Markdown files." Each feature:

```json
{
  "category": "functional",
  "description": "New chat button creates a fresh conversation",
  "steps": [
    "Navigate to main interface",
    "Click the 'New Chat' button",
    "Verify a new conversation is created",
    "Check that chat area shows welcome state",
    "Verify conversation appears in sidebar"
  ],
  "passes": false
}
```

Critical enforcement: "It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality." Agents may only modify the `passes` field.

**`claude-progress.txt`** — Institutional memory. Each session appends what it accomplished, enabling the next session to quickly understand recent work without reading entire git histories.

**`init.sh`** — Repeatable bootstrap script for development servers. Eliminates the token cost of figuring out how to start the dev environment each session.

**Git history** — Descriptive commit messages enable agents to revert failed changes and recover known-good states.

### The Boot Sequence

Every coding session follows this prescribed startup:

1. `pwd` → confirm working directory
2. Read `claude-progress.txt` and `git log` → understand recent history
3. Read `feature_list.json` → select highest-priority incomplete feature
4. Run `init.sh` → start development server
5. Execute basic end-to-end test via agent-browser CLI → confirm app isn't broken
6. Begin implementation only after passing smoke test

This sequence "saves Claude some tokens in every session since it doesn't have to figure out how to test the code."

### Browser Automation for Testing

A critical failure mode: agents marking features complete without proper end-to-end verification. The solution: browser automation via agent-browser CLI. Agents "use browser automation tools and do all testing as a human user would" — navigating, clicking, taking screenshots. This catches bugs that unit tests and curl commands miss.

Note: The original post acknowledged that browser-native alert modals were undetectable with Puppeteer. agent-browser resolves this with explicit dialog handling (`agent-browser dialog accept/dismiss/status`).

### Security Model

Three layers of defense-in-depth:

1. **OS-level sandbox**: Bash commands run in isolated environment
2. **Filesystem restrictions**: File operations restricted to project directory
3. **Bash allowlist**: Only permitted commands (ls, cat, head, tail, wc, grep, cp, mkdir, chmod, npm, node, git, ps, lsof, sleep, pkill, init.sh)

## 2.2 Resource 2: "Harness Design for Long-Running Application Development" (Mar 2026)

This post builds on Resource 1 with a three-agent architecture inspired by Generative Adversarial Networks (GANs).

### The GAN-Inspired Architecture

**Planner Agent**: Takes 1-4 sentence prompts and expands them into full product specs. Prompted to be ambitious about scope, focus on product context and high-level technical design (not granular implementation details), and weave AI features into specs. Intentionally avoids over-specification to prevent downstream cascading errors.

**Generator Agent**: Implements features iteratively using React/Vite/FastAPI/SQLite. Works sprint-by-sprint, completing one feature before the next. Self-evaluates at sprint conclusion. Maintains git version control throughout.

**Evaluator Agent**: Tests the running application using agent-browser CLI, simulating user interactions. Grades against criteria with hard thresholds. Failure on any criterion triggers detailed feedback for generator revision.

### Context Anxiety

"Models like Claude Sonnet 4.5 begin wrapping up work prematurely as they approach what they believe is their context limit." This manifests as rushing through implementation, cutting corners, and declaring victory early.

**Context resets vs. compaction**: Compaction summarizes earlier conversation in-place, preserving continuity but leaving context anxiety unresolved. Context resets clear the window entirely, providing "a clean slate, at the cost of the handoff artifact having enough state for the next agent to pick up the work cleanly."

Testing revealed "Claude Sonnet 4.5 exhibited context anxiety strongly enough that compaction alone wasn't sufficient to enable strong long task performance, so context resets became essential." Opus 4.5 largely eliminated this behavior.

### Self-Evaluation Bias

"Agents tend to respond by confidently praising the work — even when, to a human observer, the quality is obviously mediocre." The key insight: "Tuning a standalone evaluator to be skeptical turns out to be far more tractable than making a generator critical of its own work."

This is why the evaluator is a separate agent, not a self-check step within the generator.

### Four Grading Criteria

| Criterion | What It Measures |
|-----------|-----------------|
| **Design Quality** | Does the design feel like a coherent whole rather than a collection of parts? Colors, typography, layout, imagery combining to create distinct mood and identity. |
| **Originality** | Evidence of custom decisions vs. template layouts, library defaults, and AI-generated patterns. |
| **Craft** | Technical execution — typography hierarchy, spacing, color harmony, contrast ratios. Competence check. |
| **Functionality** | Usability independent of aesthetics. Can users understand the interface, find primary actions, complete tasks without guessing? |

**Weighting strategy**: Design quality and originality weighted more heavily than craft and functionality, because Claude naturally scored well on technical competence. This "penalized highly generic 'AI slop' patterns" and "pushed the model toward more aesthetic risk-taking."

### Sprint Contracts

Before implementation, generator and evaluator negotiate what "done" looks like — specific testable behaviors. Example specificity: "Sprint 3 alone had 27 criteria covering the level editor." This bridges high-level specs and testable implementation without premature over-specification.

### File-Based Inter-Agent Communication

"One agent would write a file, another agent would read it and respond either within that file or with a new file that the previous agent would read in turn." This structured handoff maintains context and prevents misalignment across agent boundaries.

### Simplification with Opus 4.6

Rather than adding complexity, the author systematically *removed* components. Opus 4.6 "plans more carefully, sustains agentic tasks for longer, can operate more reliably in larger codebases, and has better code review and debugging skills."

Changes:
- Sprint construct removed — model handled decomposition natively
- Single evaluator pass — evaluation occurred once at completion instead of per-sprint
- Continuous session — eliminated need for context resets; automatic compaction handled context growth

Critical realization: "The evaluator is not a fixed yes-or-no decision. It is worth the cost when the task sits beyond what the current model does reliably solo."

### The Foundational Principle

> "Every component in a harness encodes an assumption about what the model can't do on its own, and those assumptions are worth stress testing, both because they may be incorrect, and because they can quickly go stale as models improve."

Practical guidance: "Find the simplest solution possible, and only increase complexity when needed."

### Cost/Duration Data

| Harness Type | Duration | Cost | Notes |
|---|---|---|---|
| Solo run | 20 min | $9 | Non-functional core gameplay |
| Full harness (Opus 4.5) | 6 hr | $200 | Working game with AI features |
| Simplified v2 (Opus 4.6) | 3 hr 50 min | $124.70 | DAW with evaluator feedback |

Detailed breakdown for the DAW (Opus 4.6):

| Phase | Duration | Cost |
|---|---|---|
| Planner | 4.7 min | $0.46 |
| Build Round 1 | 2 hr 7 min | $71.08 |
| QA Round 1 | 8.8 min | $3.24 |
| Build Round 2 | 1 hr 2 min | $36.89 |
| QA Round 2 | 6.8 min | $3.09 |
| Build Round 3 | 10.9 min | $5.88 |
| QA Round 3 | 9.6 min | $4.06 |

Generator ran "coherently for over two hours without the sprint decomposition that Opus 4.5 had needed."

### QA Tuning Lessons

Initial evaluator behavior: "It would identify legitimate issues, then talk itself into deciding they weren't a big deal and approve the work anyway. It also tended to test superficially, rather than probing edge cases."

Fix: Iterative prompt tuning. Read evaluator logs, identify judgment divergences from human standards, update QA prompts. "It took several rounds of this development loop before the evaluator was grading in a way that I found reasonable."

Specific bugs caught by tuned evaluator: route ordering preventing API matching ("FastAPI matches 'reorder' as a frame_id integer and returns 422"), condition logic errors, tool malfunction (rectangle fill only placing tiles at endpoints).

## 2.3 Resource 3: Autonomous Coding Quickstart (GitHub)

The reference implementation accompanies Resource 1. File-by-file analysis:

### `autonomous_agent_demo.py` — Main Entry Point

Orchestrates the multi-session workflow. Handles CLI arguments (`--project-dir`, `--max-iterations`, `--model`), validates API key, and manages project directory lifecycle. Default model: `claude-sonnet-4-5-20250929`. Projects placed in `generations/` directory.

### `agent.py` — Session Logic

Two key functions:

- `run_agent_session()`: Executes a single session with the Claude SDK. Streams responses, handles tool use blocks, text blocks, and tool results asynchronously.
- `run_autonomous_agent()`: Main loop controller. Detects fresh start vs. continuation, chooses initializer or coding prompt, auto-continues with 3-second delay between sessions.

The session detection logic is simple: if `feature_list.json` exists in the project directory, it's a continuation (coding agent). Otherwise, it's a fresh start (initializer agent).

### `client.py` — SDK Configuration

Creates the configured SDK client with three security layers: sandbox (OS-level bash isolation), permissions (filesystem restricted to project directory), and hooks (bash commands validated against allowlist). Tool access includes built-in tools (Read, Write, Edit, Glob, Grep, Bash) plus agent-browser CLI for browser automation (via Bash tool). Generates `.claude_settings.json` with security policies.

### `security.py` — Bash Allowlist

Implements command extraction and validation. Key functions:

- `extract_commands()`: Parses command strings handling pipes (`|`) and chaining (`&&`, `||`, `;`)
- `bash_security_hook()`: Main async validator — returns allow/deny decision
- Specialized validators for `pkill` (only dev processes), `chmod` (only `+x`), `init.sh` (only from project root)

Allowed commands: `ls`, `cat`, `head`, `tail`, `wc`, `grep`, `cp`, `mkdir`, `chmod`, `npm`, `node`, `git`, `ps`, `lsof`, `sleep`, `pkill`, `init.sh`.

### `progress.py` — Progress Tracking

- `count_passing_tests()`: Reads `feature_list.json`, counts entries where `passes === true`
- `print_session_header()`: Formats session headers for console output
- `print_progress_summary()`: Displays test completion percentage

### `prompts.py` — Prompt Management

- `load_prompt()`: Generic `.md` loader from prompts directory
- `get_initializer_prompt()`: Loads initializer template
- `get_coding_prompt()`: Loads coding agent template
- `copy_spec_to_project()`: Copies `app_spec.txt` into the project directory

### `prompts/initializer_prompt.md` — First Session

Instructs the agent to: read `app_spec.txt`, create `feature_list.json` with minimum 200 detailed test cases, create `init.sh`, initialize git repository, set up project structure. Critical constraint: never remove or edit features, only mark `passes` as true.

### `prompts/coding_prompt.md` — Continuation Sessions

A 10-step workflow:

1. Get bearings (`pwd`, `ls`, read specs, `git log`)
2. Start servers (`init.sh`)
3. Verification test — run existing passing tests
4. Choose one feature (highest priority)
5. Implement the feature
6. Verify with browser automation (critical — must use agent-browser, not just backend testing)
7. Update `feature_list.json` (only modify `passes` field)
8. Commit progress with git
9. Update `claude-progress.txt`
10. End session cleanly

## 2.4 Resource 4: Claude Code Hooks Multi-Agent Observability (GitHub)

A community implementation for real-time monitoring of Claude Code agents via hooks. Key patterns to adopt:

### Architecture

- **Bun-powered TypeScript server** on port 4000 with HTTP/WebSocket endpoints
- **SQLite with WAL mode** for concurrent event storage
- **Vue 3 dashboard** with real-time WebSocket updates
- **12 hook scripts** mapping to lifecycle events

### Hook-to-Event Mapping

| Hook Event | Emoji | Purpose |
|---|---|---|
| SessionStart | 🚀 | Session lifecycle begin |
| SessionEnd | 🏁 | Session lifecycle end |
| PreToolUse | 🔧 | Before tool execution — validation/blocking |
| PostToolUse | ✅ | After tool completion — result capture |
| PostToolUseFailure | ❌ | Tool execution failed |
| PermissionRequest | 🔐 | Permission requested |
| Notification | 🔔 | User interactions |
| Stop | 🛑 | Response complete |
| SubagentStart | 🟢 | Subagent started |
| SubagentStop | 👥 | Subagent finished |
| PreCompact | 📦 | Context compaction |
| UserPromptSubmit | 💬 | User prompt submitted |

### Key Patterns to Adopt

- **Universal event sender** (`send_event.py`): Single module handling all 12 event types with event-specific field forwarding
- **`stop_hook_active` guard**: Prevents infinite hook loops when the stop hook itself triggers tool use
- **Tool-type emoji mapping**: Visual categorization of tool operations (Bash: 💻, Read: 📖, Write: ✍️, Edit: ✏️, MCP: 🔌)
- **Dual-color session visualization**: Correlates events to specific sessions
- **Security hooks**: Deny patterns for dangerous commands, sensitive file guards
- **Stop hook validators**: Enforce spec compliance before session completion

### Important Distinction

This repo uses Claude Code's CLI hook system (shell command hooks invoked via `settings.json`), not the SDK's programmatic hook callbacks. Our architecture uses the SDK hooks — but the *what to capture* decisions transfer directly. The difference is *how* we register hooks (callback functions vs. shell scripts).

## 2.5 Resource 5: Claude Code Native OTel Monitoring

Claude Code has built-in OpenTelemetry export. This is "Layer 1" — the free telemetry we get without writing any instrumentation code.

### Enabling Native Telemetry

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp          # otlp | prometheus | console | none
export OTEL_LOGS_EXPORTER=otlp             # otlp | console | none
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc    # grpc | http/json | http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer your-token"
export OTEL_METRIC_EXPORT_INTERVAL=60000   # default 60s
export OTEL_LOGS_EXPORT_INTERVAL=5000      # default 5s
```

### Available Metrics

| Metric | Description | Unit |
|---|---|---|
| `claude_code.session.count` | Sessions started | count |
| `claude_code.lines_of_code.count` | Lines modified (by type: added/removed) | count |
| `claude_code.pull_request.count` | PRs created | count |
| `claude_code.commit.count` | Commits created | count |
| `claude_code.cost.usage` | Session cost (by model) | USD |
| `claude_code.token.usage` | Tokens used (by type: input/output/cacheRead/cacheCreation, by model) | tokens |
| `claude_code.code_edit_tool.decision` | Edit tool permission decisions (by tool, decision, source, language) | count |
| `claude_code.active_time.total` | Active time (by type: user/cli) | seconds |

### Available Events (via Logs Exporter)

| Event | Key Attributes |
|---|---|
| `claude_code.user_prompt` | prompt_length, prompt (if `OTEL_LOG_USER_PROMPTS=1`) |
| `claude_code.tool_result` | tool_name, success, duration_ms, error, decision_type, decision_source |
| `claude_code.api_request` | model, cost_usd, duration_ms, input_tokens, output_tokens, cache_read_tokens |
| `claude_code.api_error` | model, error, status_code, duration_ms, attempt |
| `claude_code.tool_decision` | tool_name, decision, source |

### Event Correlation

All events within a single prompt share a `prompt.id` (UUID v4), enabling end-to-end tracing of all activity triggered by one user prompt. This is excluded from metrics (unbounded cardinality) but invaluable for event-level analysis.

### Standard Attributes on All Signals

`session.id`, `organization.id`, `user.account_uuid`, `user.account_id`, `user.id` (anonymous device ID), `user.email` (OAuth), `terminal.type`, `app.version` (opt-in).

### Cardinality Control

| Variable | Controls | Default |
|---|---|---|
| `OTEL_METRICS_INCLUDE_SESSION_ID` | session.id on metrics | true |
| `OTEL_METRICS_INCLUDE_VERSION` | app.version on metrics | false |
| `OTEL_METRICS_INCLUDE_ACCOUNT_UUID` | user.account_uuid on metrics | true |

### Enabling for SDK-Spawned Agents

Pass environment variables via the `env` option on `query()`:

```typescript
for await (const msg of query({
  prompt: "...",
  options: {
    env: {
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4317",
    }
  }
})) { /* ... */ }
```

### What Native Telemetry Doesn't Cover

Claude Code's native telemetry sees individual sessions. It doesn't know about our multi-agent architecture — it can't connect planner → generator → evaluator into a coherent trace. That's what our harness-level instrumentation (Layer 2) provides.

---

> **See also**: [Main Reference Architecture](./claude-agent-sdk-reference-architecture.md)
