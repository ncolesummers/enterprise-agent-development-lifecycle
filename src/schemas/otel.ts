import { z } from "zod";

export const OtelLogEntrySchema = z.object({
	level: z.enum(["info", "warn", "error"]),
	event: z.enum([
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
	]),
	agentType: z.enum(["initializer", "planner", "generator", "evaluator", "coding"]),
	sessionId: z.string(),
	traceId: z.string().optional(),
	spanId: z.string().optional(),
	attributes: z.record(
		z.string(),
		z.union([z.string(), z.number(), z.boolean()]),
	),
	timestamp: z.iso.datetime(),
});

export type OtelLogEntry = z.infer<typeof OtelLogEntrySchema>;
