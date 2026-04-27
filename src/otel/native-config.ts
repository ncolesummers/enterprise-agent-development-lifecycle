import type { AgentConfig } from "../schemas/config.js";

/**
 * Build the env map that enables Claude Code's Layer 1 (native) OTel
 * instrumentation for a subprocess agent session. Returns `undefined` when
 * observability is disabled so callers can pass it straight through to the
 * SDK `env` option.
 */
export function getNativeOtelEnv(
	config: AgentConfig,
): Record<string, string> | undefined {
	if (!config.enableOtel) {
		return undefined;
	}
	return {
		CLAUDE_CODE_ENABLE_TELEMETRY: "1",
		OTEL_METRICS_EXPORTER: "otlp",
		OTEL_EXPORTER_OTLP_ENDPOINT: config.otelEndpoint,
	};
}
