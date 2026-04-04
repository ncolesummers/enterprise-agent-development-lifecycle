import { z } from "zod";

export const TokenUsageSchema = z.object({
	input: z.number().int().nonnegative(),
	output: z.number().int().nonnegative(),
	cacheRead: z.number().int().nonnegative(),
	cacheCreation: z.number().int().nonnegative(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const SessionStateSchema = z.object({
	sessionId: z.string(),
	agentType: z.enum(["initializer", "planner", "generator", "evaluator"]),
	iteration: z.number().int().positive(),
	startedAt: z.string().datetime(),
	completedAt: z.string().datetime().optional(),
	costUsd: z.number().nonnegative().optional(),
	tokensUsed: TokenUsageSchema.optional(),
	result: z
		.enum(["success", "error", "max_turns", "interrupted"])
		.optional(),
});

export type SessionState = z.infer<typeof SessionStateSchema>;
