# Claude Code Native OTel Reference

## Purpose

Layer 1 observability is Claude Code's built-in OpenTelemetry export. The harness
enables it automatically for every subprocess agent session by calling
`getNativeOtelEnv()` in `src/otel/native-config.ts` and passing the result as the
`env` option on the SDK `query()` call. When `config.enableOtel` is `true`, the
function returns a small env map that activates Claude Code's OTLP exporters inside
the subprocess; when it is `false` the function returns `undefined` and the session
runs without telemetry. No additional instrumentation code is required — Claude Code
handles collection internally.

---

## Environment Variables Set by `getNativeOtelEnv()`

| Variable | Value | Purpose |
|---|---|---|
| `CLAUDE_CODE_ENABLE_TELEMETRY` | `1` | Master switch; activates all native OTel collection |
| `OTEL_METRICS_EXPORTER` | `otlp` | Routes metrics to the OTLP HTTP exporter |
| `OTEL_LOGS_EXPORTER` | `otlp` | Routes log-based events to the OTLP HTTP exporter |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `config.otelEndpoint` (default `http://localhost:4318`) | Collector endpoint for all signals |

These are the only four variables the harness sets. Additional tuning variables
(`OTEL_METRIC_EXPORT_INTERVAL`, cardinality controls, etc.) are available directly
from the Claude Code documentation but are not set by the harness by default.

---

## Native Metrics Auto-Collected

Claude Code emits the following metrics automatically. Labels and attributes are
assigned by Claude Code; the harness does not configure them.

- Session count (sessions started)
- Lines of code changed, split by added and removed
- Pull request count
- Commit count
- Cost in USD, attributed per model
- Token usage split by input, output, cache-read, and cache-creation, attributed per model
- Tool call frequency (acceptance and rejection decisions by tool, language, and source)
- Tool call duration in milliseconds

---

## Native Events Emitted

Events arrive via the logs exporter. The following event names are emitted by Claude
Code during a session:

- `claude_code.user_prompt` — fired when the user or harness submits a prompt
- `claude_code.tool_result` — fired after each tool execution completes
- `claude_code.api_request` — fired for each model API call, including cost and token counts
- `claude_code.tool_decision` — fired when a tool use is permitted or denied

All events within a single prompt share a `prompt.id` attribute (UUID v4). This
enables end-to-end tracing of every tool call and API request triggered by one
prompt, without any harness-level correlation logic. The `prompt.id` is intentionally
excluded from metrics to avoid unbounded cardinality.

---

## Layer 1 vs. Layer 2

**Layer 1** is what this document describes: native, per-session telemetry produced
inside the Claude Code subprocess. It sees one session at a time and has no
knowledge of the surrounding multi-agent harness.

**Layer 2** is harness-level instrumentation, defined in `src/otel/index.ts` via
`createOtelContext()`. It produces hierarchical spans that connect planner, generator,
and evaluator sessions into a coherent trace, and records cross-session metrics such
as total cost per feature and evaluator retry counts.

Layer 2 is tracked in issue #19 and is not yet complete. This document covers
Layer 1 only. For the full two-layer architecture, see the relevant section in
`docs/claude-agent-sdk-reference-architecture.md`.

---

## Verifying Locally

Once the docker-compose observability stack (tracked in issue #20) is running, native
traces land in Jaeger at `http://localhost:16686` and metrics flow through the OTel
Collector to Prometheus at `http://localhost:9090`.

---

## References

- [Source Analysis — Resource 5: Claude Code Native OTel Monitoring](./source-analysis.md)
- [Claude Agent SDK Reference Architecture — Section 4: OpenTelemetry Observability Layer](./claude-agent-sdk-reference-architecture.md)
