import { describe, expect, test } from "bun:test";
import {
	CriterionScoreSchema,
	EvaluatorReportSchema,
} from "./evaluator.js";

function makeCriterionScore(overrides?: Record<string, unknown>) {
	return {
		criterion: "design_quality",
		score: 8,
		weight: 0.25,
		findings: "Clean component hierarchy with good separation of concerns",
		...overrides,
	};
}

function makeScores() {
	return [
		makeCriterionScore({ criterion: "design_quality" }),
		makeCriterionScore({ criterion: "originality" }),
		makeCriterionScore({ criterion: "craft" }),
		makeCriterionScore({ criterion: "functionality" }),
	];
}

function makeEvaluatorReport(overrides?: Record<string, unknown>) {
	return {
		evaluatedAt: "2026-04-04T12:00:00Z",
		sessionId: "session-abc-123",
		scores: makeScores(),
		overallScore: 7.5,
		verdict: "pass",
		summary: "Strong implementation with clean architecture. Minor style issues remain.",
		criticalIssues: [],
		suggestions: ["Consider adding dark mode support"],
		testsPerformed: [
			{
				action: "Click login button",
				expected: "Redirect to dashboard",
				actual: "Redirect to dashboard",
				passed: true,
			},
		],
		...overrides,
	};
}

describe("CriterionScoreSchema", () => {
	test("parses a valid criterion score", () => {
		const result = CriterionScoreSchema.safeParse(makeCriterionScore());
		expect(result.success).toBe(true);
	});

	test("accepts all four criterion values", () => {
		const criteria = ["design_quality", "originality", "craft", "functionality"];
		for (const criterion of criteria) {
			const result = CriterionScoreSchema.safeParse(makeCriterionScore({ criterion }));
			expect(result.success).toBe(true);
		}
	});

	test("rejects invalid criterion", () => {
		const result = CriterionScoreSchema.safeParse(makeCriterionScore({ criterion: "speed" }));
		expect(result.success).toBe(false);
	});

	test("rejects score below 0", () => {
		const result = CriterionScoreSchema.safeParse(makeCriterionScore({ score: -1 }));
		expect(result.success).toBe(false);
	});

	test("rejects score above 10", () => {
		const result = CriterionScoreSchema.safeParse(makeCriterionScore({ score: 11 }));
		expect(result.success).toBe(false);
	});

	test("accepts score boundary values 0 and 10", () => {
		expect(CriterionScoreSchema.safeParse(makeCriterionScore({ score: 0 })).success).toBe(true);
		expect(CriterionScoreSchema.safeParse(makeCriterionScore({ score: 10 })).success).toBe(true);
	});

	test("rejects weight below 0", () => {
		const result = CriterionScoreSchema.safeParse(makeCriterionScore({ weight: -0.1 }));
		expect(result.success).toBe(false);
	});

	test("rejects weight above 1", () => {
		const result = CriterionScoreSchema.safeParse(makeCriterionScore({ weight: 1.1 }));
		expect(result.success).toBe(false);
	});

	test("accepts weight boundary values 0 and 1", () => {
		expect(CriterionScoreSchema.safeParse(makeCriterionScore({ weight: 0 })).success).toBe(true);
		expect(CriterionScoreSchema.safeParse(makeCriterionScore({ weight: 1 })).success).toBe(true);
	});

	test("findings is required — rejects when omitted", () => {
		const { findings, ...without } = makeCriterionScore();
		const result = CriterionScoreSchema.safeParse(without);
		expect(result.success).toBe(false);
	});

	test("findings rejects non-string types", () => {
		const result = CriterionScoreSchema.safeParse(makeCriterionScore({ findings: 42 }));
		expect(result.success).toBe(false);
	});
});

describe("EvaluatorReportSchema", () => {
	test("parses a valid evaluator report", () => {
		const result = EvaluatorReportSchema.safeParse(makeEvaluatorReport());
		expect(result.success).toBe(true);
	});

	test("verdict accepts only pass and fail", () => {
		expect(
			EvaluatorReportSchema.safeParse(makeEvaluatorReport({ verdict: "pass" })).success,
		).toBe(true);
		expect(
			EvaluatorReportSchema.safeParse(makeEvaluatorReport({ verdict: "fail" })).success,
		).toBe(true);
		expect(
			EvaluatorReportSchema.safeParse(makeEvaluatorReport({ verdict: "partial" })).success,
		).toBe(false);
	});

	test("passThreshold defaults to 6 when omitted", () => {
		const result = EvaluatorReportSchema.safeParse(makeEvaluatorReport());
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.passThreshold).toBe(6);
		}
	});

	test("rejects invalid evaluatedAt datetime", () => {
		const result = EvaluatorReportSchema.safeParse(
			makeEvaluatorReport({ evaluatedAt: "not-a-date" }),
		);
		expect(result.success).toBe(false);
	});

	test("rejects scores array with wrong length", () => {
		const tooFew = EvaluatorReportSchema.safeParse(
			makeEvaluatorReport({ scores: makeScores().slice(0, 3) }),
		);
		expect(tooFew.success).toBe(false);

		const tooMany = EvaluatorReportSchema.safeParse(
			makeEvaluatorReport({
				scores: [...makeScores(), makeCriterionScore()],
			}),
		);
		expect(tooMany.success).toBe(false);
	});

	test("overallScore rejects values outside 0-10", () => {
		expect(
			EvaluatorReportSchema.safeParse(makeEvaluatorReport({ overallScore: -1 })).success,
		).toBe(false);
		expect(
			EvaluatorReportSchema.safeParse(makeEvaluatorReport({ overallScore: 11 })).success,
		).toBe(false);
	});

	test("sprintNumber is optional", () => {
		const without = EvaluatorReportSchema.safeParse(makeEvaluatorReport());
		expect(without.success).toBe(true);

		const withSprint = EvaluatorReportSchema.safeParse(
			makeEvaluatorReport({ sprintNumber: 2 }),
		);
		expect(withSprint.success).toBe(true);
	});

	test("sprintNumber must be a positive integer", () => {
		expect(
			EvaluatorReportSchema.safeParse(makeEvaluatorReport({ sprintNumber: 0 })).success,
		).toBe(false);
		expect(
			EvaluatorReportSchema.safeParse(makeEvaluatorReport({ sprintNumber: -1 })).success,
		).toBe(false);
		expect(
			EvaluatorReportSchema.safeParse(makeEvaluatorReport({ sprintNumber: 1.5 })).success,
		).toBe(false);
	});

	test("testsPerformed accepts optional screenshotPath and videoPath", () => {
		const result = EvaluatorReportSchema.safeParse(
			makeEvaluatorReport({
				testsPerformed: [
					{
						action: "Submit form",
						expected: "Success message",
						actual: "Success message",
						passed: true,
						screenshotPath: "/tmp/screenshot.png",
						videoPath: "/tmp/video.mp4",
					},
				],
			}),
		);
		expect(result.success).toBe(true);
	});

	test("testsPerformed allows empty array", () => {
		const result = EvaluatorReportSchema.safeParse(
			makeEvaluatorReport({ testsPerformed: [] }),
		);
		expect(result.success).toBe(true);
	});

	test("criticalIssues and suggestions allow empty arrays", () => {
		const result = EvaluatorReportSchema.safeParse(
			makeEvaluatorReport({ criticalIssues: [], suggestions: [] }),
		);
		expect(result.success).toBe(true);
	});
});
