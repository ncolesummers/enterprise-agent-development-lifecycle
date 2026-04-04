import { z } from "zod";
import { FeatureListSchema } from "./feature.js";

export const TechnicalDesignSchema = z.object({
	stack: z.object({
		runtime: z.string(),
		framework: z.string(),
		database: z.string().optional(),
		testing: z.string(),
		buildTool: z.string(),
	}),
	architecture: z
		.string()
		.describe(
			"High-level architecture description — components, data flow, key abstractions",
		),
	aiFeatures: z
		.array(z.string())
		.describe("AI-powered features to incorporate where appropriate"),
});

export type TechnicalDesign = z.infer<typeof TechnicalDesignSchema>;

export const PlanSchema = z.object({
	projectName: z.string(),
	description: z.string().describe("1-3 sentence project summary"),
	createdAt: z.string().datetime(),
	technicalDesign: TechnicalDesignSchema,
	features: FeatureListSchema,
	sprintDecomposition: z
		.array(
			z.object({
				sprintNumber: z.number().int().positive(),
				goal: z.string().describe("What this sprint accomplishes"),
				featureIndices: z
					.array(z.number().int().nonnegative())
					.describe("Indices into the features array for this sprint"),
			}),
		)
		.optional()
		.describe(
			"Optional sprint decomposition. With Opus 4.6+, the model handles decomposition natively.",
		),
});

export type Plan = z.infer<typeof PlanSchema>;

export const SprintContractSchema = z.object({
	sprintNumber: z.number().int().positive(),
	featureScope: z
		.array(z.string())
		.describe("Feature descriptions to implement in this sprint"),
	acceptanceCriteria: z
		.array(
			z.object({
				criterion: z.string(),
				testableBy: z.enum(["browser", "api", "unit", "manual"]),
				description: z.string(),
			}),
		)
		.describe(
			"Specific, testable behaviors that define 'done' for this sprint",
		),
	negotiatedAt: z.string().datetime(),
	generatorAcknowledged: z.boolean().default(false),
});

export type SprintContract = z.infer<typeof SprintContractSchema>;
