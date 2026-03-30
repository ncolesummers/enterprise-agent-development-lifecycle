import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
	SDKAssistantMessage,
	SDKMessage,
	SDKResultError,
	SDKResultSuccess,
} from "@anthropic-ai/claude-agent-sdk";
import type { OtelContext, Span } from "./otel/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAssistantMessage(text = "Hello"): SDKAssistantMessage {
	return {
		type: "assistant",
		message: {
			id: "msg_001",
			role: "assistant",
			type: "message",
			model: "claude-sonnet-4-6",
			content: [{ type: "text", text }],
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: {
				input_tokens: 100,
				output_tokens: 50,
				cache_read_input_tokens: 10,
				cache_creation_input_tokens: 0,
			},
		},
		parent_tool_use_id: null,
		uuid: "00000000-0000-0000-0000-000000000001" as `${string}-${string}-${string}-${string}-${string}`,
		session_id: "sess_abc",
	} as SDKAssistantMessage;
}

function makeSuccessResult(): SDKResultSuccess {
	return {
		type: "result",
		subtype: "success",
		duration_ms: 5000,
		duration_api_ms: 4500,
		is_error: false,
		num_turns: 3,
		result: "Task completed successfully",
		stop_reason: "end_turn",
		total_cost_usd: 0.05,
		usage: {
			input_tokens: 1000,
			output_tokens: 500,
			cache_read_input_tokens: 200,
			cache_creation_input_tokens: 0,
			cache_creation: null,
			inference_geo: null,
			iterations: null,
			server_tool_use: null,
			service_tier: null,
			speed: null,
		},
		modelUsage: {},
		permission_denials: [],
		uuid: "00000000-0000-0000-0000-000000000002" as `${string}-${string}-${string}-${string}-${string}`,
		session_id: "sess_abc",
	} as unknown as SDKResultSuccess;
}

function makeErrorResult(): SDKResultError {
	return {
		type: "result",
		subtype: "error_during_execution",
		duration_ms: 2000,
		duration_api_ms: 1800,
		is_error: true,
		num_turns: 1,
		stop_reason: null,
		total_cost_usd: 0.01,
		usage: {
			input_tokens: 300,
			output_tokens: 100,
			cache_read_input_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_creation: null,
			inference_geo: null,
			iterations: null,
			server_tool_use: null,
			service_tier: null,
			speed: null,
		},
		modelUsage: {},
		permission_denials: [],
		errors: ["Something went wrong"],
		uuid: "00000000-0000-0000-0000-000000000003" as `${string}-${string}-${string}-${string}-${string}`,
		session_id: "sess_abc",
	} as unknown as SDKResultError;
}

// ---------------------------------------------------------------------------
// Mock query()
// ---------------------------------------------------------------------------

let capturedOptions: Record<string, unknown> | undefined;

function createMockQueryFn(messages: SDKMessage[]) {
	return (_params: { prompt: string; options?: Record<string, unknown> }) => {
		capturedOptions = _params.options;
		async function* gen() {
			for (const msg of messages) yield msg;
		}
		return gen();
	};
}

// Default mock — overridden per-test via mockQueryWith()
let mockQueryFn: ReturnType<typeof createMockQueryFn>;

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
	query: (...args: unknown[]) =>
		mockQueryFn(
			args[0] as { prompt: string; options?: Record<string, unknown> },
		),
}));

function mockQueryWith(messages: SDKMessage[]) {
	mockQueryFn = createMockQueryFn(messages);
	capturedOptions = undefined;
}

// Import after mocking
const { runAgentSession, defaultHandlers } = await import("./sdk-wrapper.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockOtel(): { otel: OtelContext; span: Span; childSpan: Span } {
	const childSpan: Span = {
		spanContext: () => ({
			traceId: "a".repeat(32),
			spanId: "b".repeat(16),
			traceFlags: 0,
		}),
		setAttribute: mock(() => childSpan),
		setAttributes: mock(() => childSpan),
		addEvent: mock(() => childSpan),
		addLink: mock(() => childSpan),
		addLinks: mock(() => childSpan),
		setStatus: mock(() => childSpan),
		updateName: mock(() => childSpan),
		end: mock(() => {}),
		isRecording: () => true,
		recordException: mock(() => {}),
	};

	const parentSpan: Span = {
		spanContext: () => ({
			traceId: "a".repeat(32),
			spanId: "c".repeat(16),
			traceFlags: 0,
		}),
		setAttribute: mock(() => parentSpan),
		setAttributes: mock(() => parentSpan),
		addEvent: mock(() => parentSpan),
		addLink: mock(() => parentSpan),
		addLinks: mock(() => parentSpan),
		setStatus: mock(() => parentSpan),
		updateName: mock(() => parentSpan),
		end: mock(() => {}),
		isRecording: () => true,
		recordException: mock(() => {}),
	};

	const otel: OtelContext = {
		tracer: {} as OtelContext["tracer"],
		meter: {
			createHistogram: () => ({ record: mock(() => {}) }),
			createCounter: () => ({ add: mock(() => {}) }),
		} as unknown as OtelContext["meter"],
		startSpan: mock(() => childSpan),
		shutdown: mock(async () => {}),
	};

	return { otel, span: parentSpan, childSpan };
}

const baseOptions = {
	agentType: "initializer" as const,
	prompt: "Do something",
	model: "claude-sonnet-4-6",
	cwd: "/tmp/test",
	allowedTools: ["Read", "Write"],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAgentSession", () => {
	beforeEach(() => {
		capturedOptions = undefined;
	});

	test("returns structured result on success", async () => {
		mockQueryWith([makeAssistantMessage(), makeSuccessResult()]);

		const result = await runAgentSession(baseOptions);

		expect(result.sessionId).toBe("sess_abc");
		expect(result.subtype).toBe("success");
		expect(result.isError).toBe(false);
		expect(result.result).toBe("Task completed successfully");
		expect(result.costUsd).toBe(0.05);
		expect(result.durationMs).toBe(5000);
		expect(result.durationApiMs).toBe(4500);
		expect(result.numTurns).toBe(3);
		expect(result.usage.inputTokens).toBe(1000);
		expect(result.usage.outputTokens).toBe(500);
		expect(result.usage.cacheReadInputTokens).toBe(200);
		expect(result.errors).toBeUndefined();
	});

	test("returns error result with errors array", async () => {
		mockQueryWith([makeErrorResult()]);

		const result = await runAgentSession(baseOptions);

		expect(result.isError).toBe(true);
		expect(result.subtype).toBe("error_during_execution");
		expect(result.errors).toEqual(["Something went wrong"]);
		expect(result.result).toBeUndefined();
	});

	test("invokes custom handlers", async () => {
		const assistantMsg = makeAssistantMessage();
		const resultMsg = makeSuccessResult();
		mockQueryWith([assistantMsg, resultMsg]);

		const onAssistant = mock(() => {});
		const onResult = mock(() => {});

		await runAgentSession({
			...baseOptions,
			handlers: { onAssistant, onResult },
		});

		expect(onAssistant).toHaveBeenCalledTimes(1);
		expect(onAssistant).toHaveBeenCalledWith(assistantMsg);
		expect(onResult).toHaveBeenCalledTimes(1);
		expect(onResult).toHaveBeenCalledWith(resultMsg);
	});

	test("uses default handlers when none provided", async () => {
		mockQueryWith([makeAssistantMessage("test output"), makeSuccessResult()]);

		const writeSpy = mock(() => true);
		const origWrite = process.stdout.write;
		process.stdout.write = writeSpy as unknown as typeof process.stdout.write;

		try {
			await runAgentSession(baseOptions);
			expect(writeSpy).toHaveBeenCalled();
		} finally {
			process.stdout.write = origWrite;
		}
	});

	test("creates and ends OTel span", async () => {
		mockQueryWith([makeAssistantMessage(), makeSuccessResult()]);
		const { otel, span, childSpan } = createMockOtel();

		await runAgentSession({
			...baseOptions,
			otel,
			parentSpan: span,
			spanAttributes: { iteration: 1 },
		});

		expect(otel.startSpan).toHaveBeenCalledWith("initializer_session", {
			parent: span,
			attributes: { iteration: 1 },
		});
		expect(childSpan.setAttribute).toHaveBeenCalled();
		expect(childSpan.end).toHaveBeenCalledTimes(1);
	});

	test("records OTel error on exception", async () => {
		// Mock query that throws
		mockQueryFn = () => {
			return {
				async next() {
					throw new Error("boom");
				},
				async return() {
					return { value: undefined, done: true as const };
				},
				async throw(e: unknown) {
					throw e;
				},
				[Symbol.asyncIterator]() {
					return this;
				},
				[Symbol.asyncDispose]() {
					return Promise.resolve();
				},
			} as unknown as AsyncGenerator<SDKMessage>;
		};

		const { otel, span, childSpan } = createMockOtel();

		await expect(
			runAgentSession({ ...baseOptions, otel, parentSpan: span }),
		).rejects.toThrow("boom");

		expect(childSpan.recordException).toHaveBeenCalled();
		expect(childSpan.setStatus).toHaveBeenCalled();
		expect(childSpan.end).toHaveBeenCalledTimes(1);
	});

	test("forwards session options to SDK", async () => {
		mockQueryWith([makeAssistantMessage(), makeSuccessResult()]);

		await runAgentSession({
			...baseOptions,
			session: {
				resume: "sess_123",
				forkSession: true,
				persistSession: true,
			},
		});

		expect(capturedOptions).toBeDefined();
		expect(capturedOptions?.resume).toBe("sess_123");
		expect(capturedOptions?.forkSession).toBe(true);
		expect(capturedOptions?.persistSession).toBe(true);
	});

	test("defaults permission mode to bypassPermissions", async () => {
		mockQueryWith([makeAssistantMessage(), makeSuccessResult()]);

		await runAgentSession(baseOptions);

		expect(capturedOptions).toBeDefined();
		expect(capturedOptions?.permissionMode).toBe("bypassPermissions");
		expect(capturedOptions?.allowDangerouslySkipPermissions).toBe(true);
	});

	test("respects custom permission mode", async () => {
		mockQueryWith([makeAssistantMessage(), makeSuccessResult()]);

		await runAgentSession({
			...baseOptions,
			permissionMode: "plan",
		});

		expect(capturedOptions?.permissionMode).toBe("plan");
		expect(capturedOptions?.allowDangerouslySkipPermissions).toBe(false);
	});
});

describe("defaultHandlers", () => {
	test("onAssistant is defined", () => {
		expect(defaultHandlers.onAssistant).toBeDefined();
	});

	test("onResult is defined", () => {
		expect(defaultHandlers.onResult).toBeDefined();
	});
});
