import { z } from "zod";

export const CriterionScoreSchema = z.object({
	criterion: z.enum([
		"design_quality",
		"originality",
		"craft",
		"functionality",
	]),
	score: z.number().min(0).max(10),
	weight: z
		.number()
		.min(0)
		.max(1)
		.describe("How heavily this criterion is weighted in the overall score"),
	findings: z
		.string()
		.describe(
			"Detailed explanation of the score — specific observations, not vague praise",
		),
});

export type CriterionScore = z.infer<typeof CriterionScoreSchema>;

export const EvaluatorReportSchema = z.object({
	evaluatedAt: z.string().datetime(),
	sessionId: z.string(),
	sprintNumber: z.number().int().positive().optional(),
	scores: z.array(CriterionScoreSchema).length(4),
	overallScore: z.number().min(0).max(10),
	passThreshold: z.number().min(0).max(10).default(6),
	verdict: z.enum(["pass", "fail"]),
	summary: z.string().describe("2-3 sentence overall assessment"),
	criticalIssues: z
		.array(z.string())
		.describe(
			"Issues that must be fixed before passing — concrete, actionable",
		),
	suggestions: z
		.array(z.string())
		.describe("Nice-to-have improvements — not blocking"),
	testsPerformed: z.array(
		z.object({
			action: z.string(),
			expected: z.string(),
			actual: z.string(),
			passed: z.boolean(),
			screenshotPath: z
				.string()
				.optional()
				.describe("Path to annotated screenshot evidence for this test"),
			videoPath: z
				.string()
				.optional()
				.describe("Path to video recording of bug reproduction"),
		}),
	),
});

export type EvaluatorReport = z.infer<typeof EvaluatorReportSchema>;
