import {
	type HookCallbackMatcher,
	type HookEvent,
	type Options,
	type PermissionMode,
	query,
	type SDKAssistantMessage,
	type SDKMessage,
	type SDKResultMessage,
	type SDKToolProgressMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { type OtelContext, type Span, SpanStatusCode } from "./otel/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentType = "initializer" | "planner" | "generator" | "evaluator";

export interface MessageHandlers {
	onAssistant?: (message: SDKAssistantMessage) => void;
	onResult?: (message: SDKResultMessage) => void;
	/** Called for all messages with type "system" (init, compact_boundary, etc.) */
	onSystem?: (message: SDKMessage & { type: "system" }) => void;
	onToolProgress?: (message: SDKToolProgressMessage) => void;
	/** Catch-all for message types without a dedicated handler above. */
	onMessage?: (message: SDKMessage) => void;
}

export interface SessionOptions {
	continue?: boolean;
	resume?: string;
	forkSession?: boolean;
	persistSession?: boolean;
}

export interface AgentSessionOptions {
	agentType: AgentType;
	prompt: string;
	model: string;
	cwd: string;
	permissionMode?: PermissionMode;
	allowedTools: string[];
	hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
	env?: Record<string, string>;
	session?: SessionOptions;
	handlers?: MessageHandlers;
	maxTurns?: number;
	otel?: OtelContext;
	parentSpan?: Span;
	spanAttributes?: Record<string, string | number>;
}

export interface AgentSessionResult {
	sessionId: string;
	subtype: string;
	isError: boolean;
	result?: string;
	errors?: string[];
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

// ---------------------------------------------------------------------------
// Default handlers (matches prior handleMessage behavior)
// ---------------------------------------------------------------------------

export const defaultHandlers: MessageHandlers = {
	onAssistant(message) {
		for (const block of message.message.content) {
			if (block.type === "text") process.stdout.write(block.text);
			if (block.type === "tool_use") console.log(`\n[Tool: ${block.name}]`);
		}
	},
	onResult(message) {
		console.log(`\nSession complete: ${message.subtype}`);
		if (message.total_cost_usd != null) {
			console.log(`Cost: $${message.total_cost_usd.toFixed(4)}`);
		}
		if (message.duration_ms != null) {
			console.log(`Duration: ${(message.duration_ms / 1000).toFixed(1)}s`);
		}
	},
};

// ---------------------------------------------------------------------------
// OTel metrics recording (moved from orchestrator)
// ---------------------------------------------------------------------------

function recordSessionMetrics(
	otel: OtelContext,
	span: Span,
	result: SDKResultMessage,
	agentType: string,
): void {
	span.setAttribute("session.cost_usd", result.total_cost_usd);
	otel.meter
		.createHistogram("harness.session.cost_usd")
		.record(result.total_cost_usd, { agent_type: agentType });

	span.setAttribute("session.duration_ms", result.duration_ms);
	otel.meter
		.createHistogram("harness.session.duration_ms")
		.record(result.duration_ms, { agent_type: agentType });

	span.setAttribute("session.tokens.input", result.usage.input_tokens);
	span.setAttribute("session.tokens.output", result.usage.output_tokens);
	span.setAttribute(
		"session.tokens.cache_read",
		result.usage.cache_read_input_tokens,
	);

	otel.meter
		.createHistogram("harness.session.tokens.input")
		.record(result.usage.input_tokens, { agent_type: agentType });
	otel.meter
		.createHistogram("harness.session.tokens.output")
		.record(result.usage.output_tokens, { agent_type: agentType });

	otel.meter
		.createCounter("harness.sessions.total")
		.add(1, { agent_type: agentType });

	span.setAttribute("session.result", result.subtype);
	if (result.subtype.startsWith("error")) {
		span.setStatus({
			code: SpanStatusCode.ERROR,
			message: result.subtype,
		});
	}
}

// ---------------------------------------------------------------------------
// Main wrapper
// ---------------------------------------------------------------------------

export async function runAgentSession(
	options: AgentSessionOptions,
): Promise<AgentSessionResult> {
	const {
		agentType,
		prompt,
		model,
		cwd,
		allowedTools,
		hooks,
		env,
		session,
		maxTurns,
		otel,
		parentSpan,
		spanAttributes,
	} = options;

	const permissionMode = options.permissionMode ?? "bypassPermissions";
	const handlers = options.handlers ?? defaultHandlers;

	// Create OTel span if instrumentation is provided
	const span = otel
		? otel.startSpan(`${agentType}_session`, {
				...(parentSpan && { parent: parentSpan }),
				...(spanAttributes && { attributes: spanAttributes }),
			})
		: undefined;

	try {
		// Build SDK options
		const sdkOptions: Options = {
			model,
			cwd,
			permissionMode,
			allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
			allowedTools,
			...(hooks && { hooks }),
			...(env && { env }),
			...(maxTurns != null && { maxTurns }),
			...(session?.continue != null && { continue: session.continue }),
			...(session?.resume != null && { resume: session.resume }),
			...(session?.forkSession != null && {
				forkSession: session.forkSession,
			}),
			...(session?.persistSession != null && {
				persistSession: session.persistSession,
			}),
		};

		let resultMessage: SDKResultMessage | undefined;

		for await (const message of query({ prompt, options: sdkOptions })) {
			switch (message.type) {
				case "assistant":
					handlers.onAssistant?.(message);
					break;
				case "result":
					resultMessage = message;
					handlers.onResult?.(message);
					break;
				case "system":
					handlers.onSystem?.(message);
					break;
				case "tool_progress":
					handlers.onToolProgress?.(message);
					break;
				default:
					handlers.onMessage?.(message);
					break;
			}
		}

		if (!resultMessage) {
			throw new Error(
				`Agent session "${agentType}" ended without a result message`,
			);
		}

		// Record OTel metrics
		if (otel && span) {
			recordSessionMetrics(otel, span, resultMessage, agentType);
		}

		// Build structured result
		const isError = resultMessage.subtype !== "success";
		const result: AgentSessionResult = {
			sessionId: resultMessage.session_id,
			subtype: resultMessage.subtype,
			isError,
			costUsd: resultMessage.total_cost_usd,
			durationMs: resultMessage.duration_ms,
			durationApiMs: resultMessage.duration_api_ms,
			numTurns: resultMessage.num_turns,
			usage: {
				inputTokens: resultMessage.usage.input_tokens,
				outputTokens: resultMessage.usage.output_tokens,
				cacheReadInputTokens: resultMessage.usage.cache_read_input_tokens,
			},
		};

		if (isError && "errors" in resultMessage) {
			result.errors = resultMessage.errors;
		}
		if (!isError && "result" in resultMessage) {
			result.result = resultMessage.result;
		}

		return result;
	} catch (err) {
		if (span) {
			span.recordException(err as Error);
			span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
		}
		throw err;
	} finally {
		span?.end();
	}
}
