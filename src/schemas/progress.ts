import { z } from "zod";

export const ProgressEntrySchema = z.object({
	timestamp: z.string().datetime().describe("ISO 8601 timestamp"),
	sessionId: z.string().describe("Agent SDK session ID"),
	sessionType: z.enum(["initializer", "planner", "generator", "evaluator"]),
	iteration: z.number().int().positive(),
	featuresAttempted: z
		.array(z.string())
		.describe("Feature descriptions attempted this session"),
	featuresCompleted: z
		.array(z.string())
		.describe("Feature descriptions marked as passing this session"),
	notes: z
		.string()
		.describe(
			"Free-form notes about what happened, issues encountered, decisions made",
		),
	costUsd: z.number().nonnegative().optional(),
	durationMs: z.number().nonnegative().optional(),
});

export type ProgressEntry = z.infer<typeof ProgressEntrySchema>;

export const ProgressLogSchema = z.object({
	projectName: z.string(),
	startedAt: z.string().datetime(),
	entries: z.array(ProgressEntrySchema),
});

export type ProgressLog = z.infer<typeof ProgressLogSchema>;
