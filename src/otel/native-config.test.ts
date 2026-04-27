import { describe, expect, test } from "bun:test";
import { AgentConfigSchema } from "../schemas/config.js";
import { getNativeOtelEnv } from "./native-config.js";

const baseConfig = AgentConfigSchema.parse({ projectDir: "/tmp/demo" });

describe("getNativeOtelEnv", () => {
	test("returns undefined when enableOtel is false", () => {
		const result = getNativeOtelEnv({ ...baseConfig, enableOtel: false });
		expect(result).toBeUndefined();
	});

	test("returns the three-key env map when enabled", () => {
		const result = getNativeOtelEnv({ ...baseConfig, enableOtel: true });
		expect(result).toEqual({
			CLAUDE_CODE_ENABLE_TELEMETRY: "1",
			OTEL_METRICS_EXPORTER: "otlp",
			OTEL_EXPORTER_OTLP_ENDPOINT: baseConfig.otelEndpoint,
		});
		expect(result).not.toHaveProperty("OTEL_LOGS_EXPORTER");
	});

	test("propagates a non-default otelEndpoint verbatim", () => {
		const endpoint = "http://collector.example:4318";
		const result = getNativeOtelEnv({
			...baseConfig,
			enableOtel: true,
			otelEndpoint: endpoint,
		});
		expect(result?.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(endpoint);
	});
});
