import { z } from "zod";

export const AgentConfigSchema = z.object({
	projectDir: z.string().min(1),
	maxIterations: z
		.number()
		.int()
		.nonnegative()
		.default(0)
		.describe("0 = unlimited"),
	model: z.string().default("claude-sonnet-4-6"),
	enableEvaluator: z.boolean().default(true),
	evaluatorModel: z
		.string()
		.default("claude-opus-4-6")
		.describe("Evaluator should use a capable model for judgment tasks"),
	plannerModel: z.string().default("claude-opus-4-6"),
	passThreshold: z.number().min(0).max(10).default(6),
	maxEvaluatorRetries: z.number().int().nonnegative().default(3),
	enableBiomeHooks: z.boolean().default(true),
	enableOtel: z.boolean().default(true),
	otelEndpoint: z.string().default("http://localhost:4317"),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
