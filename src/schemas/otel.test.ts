import { describe, expect, test } from "bun:test";
import { OtelLogEntrySchema } from "./otel.js";

const ALL_EVENTS = [
	"session_start",
	"session_end",
	"tool_call_start",
	"tool_call_end",
	"tool_call_error",
	"feature_start",
	"feature_completed",
	"feature_fail",
	"evaluation_start",
	"evaluation_verdict",
	"biome_check",
	"biome_fix",
	"biome_commit_gate",
	"compaction",
	"subagent_start",
	"subagent_stop",
	"context_reset",
	"error",
	"cost_update",
] as const;

function makeOtelLogEntry(overrides?: Record<string, unknown>) {
	return {
		level: "info",
		event: "session_start",
		agentType: "generator",
		sessionId: "session-abc-123",
		attributes: { feature: "login-page" },
		timestamp: "2026-04-04T12:00:00Z",
		...overrides,
	};
}

describe("OtelLogEntrySchema", () => {
	test("parses a valid log entry", () => {
		const result = OtelLogEntrySchema.safeParse(makeOtelLogEntry());
		expect(result.success).toBe(true);
	});

	test("accepts all three level values", () => {
		for (const level of ["info", "warn", "error"]) {
			const result = OtelLogEntrySchema.safeParse(makeOtelLogEntry({ level }));
			expect(result.success).toBe(true);
		}
	});

	test("rejects invalid level", () => {
		const result = OtelLogEntrySchema.safeParse(
			makeOtelLogEntry({ level: "debug" }),
		);
		expect(result.success).toBe(false);
	});

	test("accepts all 19 event values", () => {
		for (const event of ALL_EVENTS) {
			const result = OtelLogEntrySchema.safeParse(makeOtelLogEntry({ event }));
			expect(result.success).toBe(true);
		}
	});

	test("rejects invalid event", () => {
		const result = OtelLogEntrySchema.safeParse(
			makeOtelLogEntry({ event: "unknown_event" }),
		);
		expect(result.success).toBe(false);
	});

	test("accepts all four agentType values", () => {
		for (const agentType of [
			"initializer",
			"planner",
			"generator",
			"evaluator",
		]) {
			const result = OtelLogEntrySchema.safeParse(
				makeOtelLogEntry({ agentType }),
			);
			expect(result.success).toBe(true);
		}
	});

	test("rejects invalid agentType", () => {
		const result = OtelLogEntrySchema.safeParse(
			makeOtelLogEntry({ agentType: "orchestrator" }),
		);
		expect(result.success).toBe(false);
	});

	test("traceId and spanId are optional", () => {
		const without = OtelLogEntrySchema.safeParse(makeOtelLogEntry());
		expect(without.success).toBe(true);

		const withIds = OtelLogEntrySchema.safeParse(
			makeOtelLogEntry({
				traceId: "abc123def456",
				spanId: "span-789",
			}),
		);
		expect(withIds.success).toBe(true);
	});

	test("attributes accepts string, number, and boolean values", () => {
		const result = OtelLogEntrySchema.safeParse(
			makeOtelLogEntry({
				attributes: {
					feature: "login",
					attempt: 3,
					cached: true,
				},
			}),
		);
		expect(result.success).toBe(true);
	});

	test("attributes rejects non-primitive values", () => {
		const result = OtelLogEntrySchema.safeParse(
			makeOtelLogEntry({
				attributes: { nested: { key: "value" } },
			}),
		);
		expect(result.success).toBe(false);
	});

	test("rejects invalid timestamp", () => {
		const result = OtelLogEntrySchema.safeParse(
			makeOtelLogEntry({ timestamp: "not-a-date" }),
		);
		expect(result.success).toBe(false);
	});

	test("rejects missing required fields", () => {
		const { sessionId, ...without } = makeOtelLogEntry();
		const result = OtelLogEntrySchema.safeParse(without);
		expect(result.success).toBe(false);
	});
});
