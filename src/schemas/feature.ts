import { z } from "zod";

export const FeatureSchema = z.object({
	category: z.enum([
		"functional",
		"ui",
		"api",
		"integration",
		"performance",
		"security",
		"accessibility",
	]),
	description: z
		.string()
		.min(10)
		.describe("Human-readable description of what this feature does"),
	steps: z
		.array(z.string().min(5))
		.min(1)
		.describe(
			"Ordered steps to verify this feature works. Each step should be a concrete, testable action.",
		),
	passes: z
		.boolean()
		.default(false)
		.describe(
			"Whether this feature has been verified as working. Only the agent may set this to true after self-verification.",
		),
});

export type Feature = z.infer<typeof FeatureSchema>;

export const FeatureListSchema = z.array(FeatureSchema).min(1);
export type FeatureList = z.infer<typeof FeatureListSchema>;
