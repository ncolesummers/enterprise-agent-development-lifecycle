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
			sessionId: "sess_init_001",
			subtype: "success",
			isError: false,
			result: "Done",
			costUsd: 0.02,
			durationMs: 5000,
			durationApiMs: 4500,
			numTurns: 8,
			usage: {
				inputTokens: 1000,
				outputTokens: 600,
				cacheReadInputTokens: 200,
			},
		});
	},
}));

// Mutable return values for state functions
let mockFeatureList: unknown = [
	{
		category: "functional",
		description: "GET / returns Hello, World! as plain text",
		steps: ["Send GET request to /", "Verify response body"],
		passes: false,
	},
];
let mockProgress: unknown = {
	projectName: "test",
	startedAt: new Date().toISOString(),
	entries: [],
};

mock.module("../state.js", () => ({
	readFeatureList: async () => mockFeatureList,
	readProgress: async () => mockProgress,
}));

// Mock Bun.file for app_spec.txt
let mockAppSpecExists = true;
let mockAppSpecText = "Build a Hello World server";

const originalBunFile = Bun.file.bind(Bun);
// @ts-expect-error — override for testing
Bun.file = (path: string, ...args: unknown[]) => {
	if (typeof path === "string" && path.endsWith("app_spec.txt")) {
		return {
			exists: async () => mockAppSpecExists,
			text: async () => mockAppSpecText,
		};
	}
	return originalBunFile(path, ...args);
};

// Import after mocking
const { runInitializerSession } = await import("./initializer.js");

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

describe("runInitializerSession", () => {
	beforeEach(() => {
		capturedOptions = undefined;
		mockAppSpecExists = true;
		mockAppSpecText = "Build a Hello World server";
		mockFeatureList = [
			{
				category: "functional",
				description: "GET / returns Hello, World! as plain text",
				steps: ["Send GET request to /", "Verify response body"],
				passes: false,
			},
		];
		mockProgress = {
			projectName: "test",
			startedAt: new Date().toISOString(),
			entries: [],
		};
	});

	test("calls runAgentSession with agentType 'initializer'", async () => {
		const config = makeConfig();
		const otel = makeOtel();
		const span = makeSpan();

		await runInitializerSession(config, otel, span);

		expect(capturedOptions).toBeDefined();
		expect(capturedOptions?.agentType).toBe("initializer");
	});

	test("uses correct tools list (no Edit)", async () => {
		const config = makeConfig();
		const otel = makeOtel();
		const span = makeSpan();

		await runInitializerSession(config, otel, span);

		expect(capturedOptions?.allowedTools).toEqual([
			"Read",
			"Write",
			"Bash",
			"Glob",
			"Grep",
		]);
	});

	test("uses config.model", async () => {
		const config = makeConfig({ model: "claude-haiku-4-5-20251001" });
		const otel = makeOtel();
		const span = makeSpan();

		await runInitializerSession(config, otel, span);

		expect(capturedOptions?.model).toBe("claude-haiku-4-5-20251001");
	});

	test("sets cwd to config.projectDir", async () => {
		const config = makeConfig({ projectDir: "/custom/project" });
		const otel = makeOtel();
		const span = makeSpan();

		await runInitializerSession(config, otel, span);

		expect(capturedOptions?.cwd).toBe("/custom/project");
	});

	test("passes OTel env when enableOtel is true", async () => {
		const config = makeConfig({ enableOtel: true });
		const otel = makeOtel();
		const span = makeSpan();

		await runInitializerSession(config, otel, span);

		expect(capturedOptions?.env).toBeDefined();
		expect(capturedOptions?.env?.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
		expect(capturedOptions?.env?.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
			"http://localhost:4318",
		);
	});

	test("does not pass OTel env when enableOtel is false", async () => {
		const config = makeConfig({ enableOtel: false });
		const otel = makeOtel();
		const span = makeSpan();

		await runInitializerSession(config, otel, span);

		expect(capturedOptions?.env).toBeUndefined();
	});

	test("throws if app_spec.txt does not exist", async () => {
		mockAppSpecExists = false;
		const config = makeConfig();
		const otel = makeOtel();
		const span = makeSpan();

		expect(runInitializerSession(config, otel, span)).rejects.toThrow(
			"app_spec.txt",
		);
	});

	test("throws if app_spec.txt is empty", async () => {
		mockAppSpecText = "   ";
		const config = makeConfig();
		const otel = makeOtel();
		const span = makeSpan();

		expect(runInitializerSession(config, otel, span)).rejects.toThrow("empty");
	});

	test("throws if feature_list.json not produced", async () => {
		mockFeatureList = null;
		const config = makeConfig();
		const otel = makeOtel();
		const span = makeSpan();

		expect(runInitializerSession(config, otel, span)).rejects.toThrow(
			"feature_list.json",
		);
	});

	test("throws if progress.json not produced", async () => {
		mockProgress = null;
		const config = makeConfig();
		const otel = makeOtel();
		const span = makeSpan();

		expect(runInitializerSession(config, otel, span)).rejects.toThrow(
			"progress.json",
		);
	});

	test("does not include hooks (no biome/browser)", async () => {
		const config = makeConfig();
		const otel = makeOtel();
		const span = makeSpan();

		await runInitializerSession(config, otel, span);

		expect(capturedOptions?.hooks).toBeUndefined();
	});
});
