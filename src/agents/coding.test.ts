import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { OtelContext, Span } from "../otel/index.js";
import type { AgentConfig } from "../schemas/config.js";
import type { AgentSessionOptions } from "../sdk-wrapper.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let capturedOptions: AgentSessionOptions | undefined;

mock.module("../sdk-wrapper.js", () => ({
	runAgentSession: (opts: AgentSessionOptions) => {
		capturedOptions = opts;
		return Promise.resolve({
			sessionId: "sess_coding_001",
			subtype: "success",
			isError: false,
			result: "Done",
			costUsd: 0.03,
			durationMs: 4000,
			durationApiMs: 3500,
			numTurns: 5,
			usage: {
				inputTokens: 800,
				outputTokens: 400,
				cacheReadInputTokens: 100,
			},
		});
	},
}));

// Import after mocking
const { runCodingSession } = await import("./coding.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpan(): Span {
	const span: Span = {
		spanContext: () => ({
			traceId: "a".repeat(32),
			spanId: "b".repeat(16),
			traceFlags: 0,
		}),
		setAttribute: mock(() => span),
		setAttributes: mock(() => span),
		addEvent: mock(() => span),
		addLink: mock(() => span),
		addLinks: mock(() => span),
		setStatus: mock(() => span),
		updateName: mock(() => span),
		end: mock(() => {}),
		isRecording: () => true,
		recordException: mock(() => {}),
	};
	return span;
}

function makeOtel(): OtelContext {
	const childSpan = makeSpan();
	return {
		tracer: {} as OtelContext["tracer"],
		meter: {
			createHistogram: () => ({ record: mock(() => {}) }),
			createCounter: () => ({ add: mock(() => {}) }),
		} as unknown as OtelContext["meter"],
		startSpan: mock(() => childSpan),
		shutdown: mock(async () => {}),
	};
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		projectDir: "/tmp/test-project",
		maxIterations: 0,
		model: "claude-sonnet-4-6",
		enableEvaluator: true,
		evaluatorModel: "claude-opus-4-6",
		plannerModel: "claude-opus-4-6",
		passThreshold: 6,
		maxEvaluatorRetries: 3,
		enableBiomeHooks: true,
		enableOtel: true,
		otelEndpoint: "http://localhost:4318",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runCodingSession", () => {
	beforeEach(() => {
		capturedOptions = undefined;
	});

	test("calls runAgentSession with agentType 'coding'", async () => {
		const config = makeConfig();
		const otel = makeOtel();
		const span = makeSpan();

		await runCodingSession(config, otel, span, 1);

		expect(capturedOptions).toBeDefined();
		expect(capturedOptions!.agentType).toBe("coding");
	});

	test("uses correct tools list", async () => {
		const config = makeConfig();
		const otel = makeOtel();
		const span = makeSpan();

		await runCodingSession(config, otel, span, 1);

		expect(capturedOptions!.allowedTools).toEqual([
			"Read",
			"Write",
			"Edit",
			"Glob",
			"Grep",
			"Bash",
		]);
	});

	test("uses config.model, not plannerModel or evaluatorModel", async () => {
		const config = makeConfig({ model: "claude-haiku-4-5-20251001" });
		const otel = makeOtel();
		const span = makeSpan();

		await runCodingSession(config, otel, span, 1);

		expect(capturedOptions!.model).toBe("claude-haiku-4-5-20251001");
	});

	test("sets cwd to config.projectDir", async () => {
		const config = makeConfig({ projectDir: "/custom/project" });
		const otel = makeOtel();
		const span = makeSpan();

		await runCodingSession(config, otel, span, 1);

		expect(capturedOptions!.cwd).toBe("/custom/project");
	});

	test("includes bash security hook in PreToolUse", async () => {
		const config = makeConfig();
		const otel = makeOtel();
		const span = makeSpan();

		await runCodingSession(config, otel, span, 1);

		const preToolUse = capturedOptions!.hooks?.PreToolUse;
		expect(preToolUse).toBeDefined();
		expect(preToolUse!.length).toBeGreaterThan(0);
		expect(preToolUse![0].matcher).toBe("Bash");
	});

	test("passes OTel env when enableOtel is true", async () => {
		const config = makeConfig({ enableOtel: true });
		const otel = makeOtel();
		const span = makeSpan();

		await runCodingSession(config, otel, span, 1);

		expect(capturedOptions!.env).toBeDefined();
		expect(capturedOptions!.env!.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
		expect(capturedOptions!.env!.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
			"http://localhost:4318",
		);
	});

	test("does not pass OTel env when enableOtel is false", async () => {
		const config = makeConfig({ enableOtel: false });
		const otel = makeOtel();
		const span = makeSpan();

		await runCodingSession(config, otel, span, 1);

		expect(capturedOptions!.env).toBeUndefined();
	});

	test("passes iteration as span attribute", async () => {
		const config = makeConfig();
		const otel = makeOtel();
		const span = makeSpan();

		await runCodingSession(config, otel, span, 3);

		expect(capturedOptions!.spanAttributes).toEqual({ iteration: 3 });
	});
});
