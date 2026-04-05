import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type {
	EvaluatorReport,
	FeatureList,
	Plan,
	ProgressLog,
	SprintContract,
} from "./schemas/index.js";
import {
	readEvaluationReport,
	readFeatureList,
	readPlan,
	readProgress,
	readSprintContract,
	writeEvaluationReport,
	writeFeatureList,
	writePlan,
	writeProgress,
	writeSprintContract,
} from "./state.js";

// ---------------------------------------------------------------------------
// Factories — return fully typed objects matching Zod output types
// ---------------------------------------------------------------------------

function makeFeature(
	overrides?: Partial<FeatureList[number]>,
): FeatureList[number] {
	return {
		category: "functional",
		description: "User can log in with valid credentials",
		steps: [
			"Navigate to login page",
			"Enter valid email and password",
			"Click submit",
		],
		passes: false,
		...overrides,
	};
}

function makeFeatureList(): FeatureList {
	return [makeFeature()];
}

function makeProgressLog(overrides?: Partial<ProgressLog>): ProgressLog {
	return {
		projectName: "hello-world",
		startedAt: "2026-04-04T10:00:00.000Z",
		entries: [],
		...overrides,
	};
}

function makeTechnicalDesign(): Plan["technicalDesign"] {
	return {
		stack: {
			runtime: "bun",
			framework: "react",
			testing: "bun:test",
			buildTool: "bun",
		},
		architecture:
			"Three-agent ADLC orchestration with planner, generator, and evaluator",
		aiFeatures: ["AI-powered code generation"],
	};
}

function makePlan(overrides?: Partial<Plan>): Plan {
	return {
		projectName: "test-project",
		description: "A test project for validating plan schemas",
		createdAt: "2026-04-04T12:00:00Z",
		technicalDesign: makeTechnicalDesign(),
		features: [makeFeature()],
		...overrides,
	};
}

function makeScores(): EvaluatorReport["scores"] {
	return [
		{
			criterion: "design_quality",
			score: 8,
			weight: 0.3,
			findings: "Clean component hierarchy with good separation of concerns",
		},
		{
			criterion: "originality",
			score: 7,
			weight: 0.25,
			findings: "Novel approach to state management",
		},
		{
			criterion: "craft",
			score: 8,
			weight: 0.2,
			findings: "Well-formatted code with consistent style",
		},
		{
			criterion: "functionality",
			score: 9,
			weight: 0.25,
			findings: "All features working as expected",
		},
	];
}

function makeEvaluatorReport(
	overrides?: Partial<EvaluatorReport>,
): EvaluatorReport {
	return {
		evaluatedAt: "2026-04-04T12:00:00Z",
		sessionId: "session-abc-123",
		scores: makeScores(),
		overallScore: 7.5,
		passThreshold: 6,
		verdict: "pass",
		summary:
			"Strong implementation with clean architecture. Minor style issues remain.",
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

function makeSprintContract(
	overrides?: Partial<SprintContract>,
): SprintContract {
	return {
		sprintNumber: 1,
		featureScope: ["User authentication", "Dashboard layout"],
		acceptanceCriteria: [
			{
				criterion: "Login form validates email format",
				testableBy: "unit",
				description: "Email validation rejects malformed addresses",
			},
		],
		negotiatedAt: "2026-04-04T12:00:00Z",
		generatorAcknowledged: false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(resolve(tmpdir(), "adlc-state-test-"));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Read — returns null when file missing
// ---------------------------------------------------------------------------

describe("read returns null for missing files", () => {
	test("readFeatureList", async () => {
		expect(await readFeatureList(tmpDir)).toBeNull();
	});

	test("readProgress", async () => {
		expect(await readProgress(tmpDir)).toBeNull();
	});

	test("readPlan", async () => {
		expect(await readPlan(tmpDir)).toBeNull();
	});

	test("readEvaluationReport", async () => {
		expect(await readEvaluationReport(tmpDir)).toBeNull();
	});

	test("readSprintContract", async () => {
		expect(await readSprintContract(tmpDir)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Write + read round-trip
// ---------------------------------------------------------------------------

describe("write then read round-trips correctly", () => {
	test("feature list", async () => {
		const data = makeFeatureList();
		await writeFeatureList(tmpDir, data);
		const result = await readFeatureList(tmpDir);
		expect(result).not.toBeNull();
		if (result) {
			expect(result).toHaveLength(1);
			const first = result[0];
			if (first) {
				expect(first.description).toBe(
					"User can log in with valid credentials",
				);
				expect(first.passes).toBe(false);
			}
		}
	});

	test("progress log", async () => {
		const data = makeProgressLog();
		await writeProgress(tmpDir, data);
		const result = await readProgress(tmpDir);
		expect(result).not.toBeNull();
		expect(result?.projectName).toBe("hello-world");
		expect(result?.entries).toHaveLength(0);
	});

	test("plan", async () => {
		const data = makePlan();
		await writePlan(tmpDir, data);
		const result = await readPlan(tmpDir);
		expect(result).not.toBeNull();
		expect(result?.projectName).toBe("test-project");
		expect(result?.features).toHaveLength(1);
	});

	test("evaluation report", async () => {
		const data = makeEvaluatorReport();
		await writeEvaluationReport(tmpDir, data);
		const result = await readEvaluationReport(tmpDir);
		expect(result).not.toBeNull();
		expect(result?.verdict).toBe("pass");
		expect(result?.overallScore).toBe(7.5);
		expect(result?.scores).toHaveLength(4);
	});

	test("sprint contract", async () => {
		const data = makeSprintContract();
		await writeSprintContract(tmpDir, data);
		const result = await readSprintContract(tmpDir);
		expect(result).not.toBeNull();
		expect(result?.sprintNumber).toBe(1);
		expect(result?.generatorAcknowledged).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Read — throws ZodError on invalid data
// ---------------------------------------------------------------------------

describe("read throws ZodError on invalid data", () => {
	test("feature list with missing required fields", async () => {
		await Bun.write(
			resolve(tmpDir, "feature_list.json"),
			JSON.stringify([{ description: "too short" }]),
		);
		await expect(readFeatureList(tmpDir)).rejects.toThrow();
	});

	test("progress log with invalid sessionType", async () => {
		await Bun.write(
			resolve(tmpDir, "progress.json"),
			JSON.stringify({
				projectName: "hello-world",
				startedAt: "2026-04-04T10:00:00.000Z",
				entries: [
					{
						timestamp: "2026-04-04T12:00:00Z",
						sessionId: "s1",
						sessionType: "unknown_type",
						iteration: 1,
						featuresAttempted: [],
						featuresCompleted: [],
						notes: "test",
					},
				],
			}),
		);
		await expect(readProgress(tmpDir)).rejects.toThrow();
	});

	test("plan with missing technicalDesign", async () => {
		await Bun.write(
			resolve(tmpDir, "plan.json"),
			JSON.stringify({
				projectName: "test",
				description: "test",
				createdAt: "2026-04-04T12:00:00Z",
				features: [makeFeature()],
			}),
		);
		await expect(readPlan(tmpDir)).rejects.toThrow();
	});

	test("evaluation report with wrong number of scores", async () => {
		const singleScore = makeScores()[0];
		await Bun.write(
			resolve(tmpDir, "evaluation_report.json"),
			JSON.stringify({
				...makeEvaluatorReport(),
				scores: [singleScore],
			}),
		);
		await expect(readEvaluationReport(tmpDir)).rejects.toThrow();
	});

	test("sprint contract with invalid testableBy enum", async () => {
		await Bun.write(
			resolve(tmpDir, "sprint_contract.json"),
			JSON.stringify({
				...makeSprintContract(),
				acceptanceCriteria: [
					{
						criterion: "Test",
						testableBy: "invalid_method",
						description: "Desc",
					},
				],
			}),
		);
		await expect(readSprintContract(tmpDir)).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// Write — throws ZodError on invalid data (no file written)
// ---------------------------------------------------------------------------

describe("write throws ZodError on invalid data without writing", () => {
	test("feature list with empty array", async () => {
		await expect(
			writeFeatureList(tmpDir, [] as unknown as FeatureList),
		).rejects.toThrow();
		expect(await readFeatureList(tmpDir)).toBeNull();
	});

	test("progress log with missing projectName", async () => {
		await expect(
			writeProgress(tmpDir, {
				startedAt: "2026-04-04T10:00:00Z",
				entries: [],
			} as unknown as ProgressLog),
		).rejects.toThrow();
		expect(await readProgress(tmpDir)).toBeNull();
	});

	test("plan with invalid createdAt", async () => {
		await expect(
			writePlan(
				tmpDir,
				makePlan({ createdAt: "not-a-date" } as unknown as Partial<Plan>),
			),
		).rejects.toThrow();
		expect(await readPlan(tmpDir)).toBeNull();
	});

	test("evaluation report with out-of-range score", async () => {
		await expect(
			writeEvaluationReport(tmpDir, makeEvaluatorReport({ overallScore: 15 })),
		).rejects.toThrow();
		expect(await readEvaluationReport(tmpDir)).toBeNull();
	});

	test("sprint contract with non-positive sprintNumber", async () => {
		await expect(
			writeSprintContract(tmpDir, makeSprintContract({ sprintNumber: 0 })),
		).rejects.toThrow();
		expect(await readSprintContract(tmpDir)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Atomic write — no temp files left behind
// ---------------------------------------------------------------------------

describe("atomic write behavior", () => {
	test("no temp files remain after successful write", async () => {
		await writeFeatureList(tmpDir, makeFeatureList());
		const files = await readdir(tmpDir);
		const tmpFiles = files.filter((f) => f.includes(".tmp."));
		expect(tmpFiles).toHaveLength(0);
	});

	test("writes are pretty-printed JSON", async () => {
		await writeFeatureList(tmpDir, makeFeatureList());
		const content = await Bun.file(resolve(tmpDir, "feature_list.json")).text();
		expect(content).toContain("\n");
		expect(content).toContain("  ");
	});

	test("overwrite preserves atomicity", async () => {
		const original = makeFeatureList();
		await writeFeatureList(tmpDir, original);

		const updated: FeatureList = [
			makeFeature({ description: "Updated feature description here" }),
		];
		await writeFeatureList(tmpDir, updated);

		const result = await readFeatureList(tmpDir);
		if (result?.[0]) {
			expect(result[0].description).toBe("Updated feature description here");
		}

		const files = await readdir(tmpDir);
		const tmpFiles = files.filter((f) => f.includes(".tmp."));
		expect(tmpFiles).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	test("read malformed JSON throws", async () => {
		await Bun.write(resolve(tmpDir, "feature_list.json"), "not valid json {{{");
		await expect(readFeatureList(tmpDir)).rejects.toThrow();
	});

	test("multiple writes overwrite cleanly", async () => {
		await writePlan(tmpDir, makePlan({ projectName: "first" }));
		await writePlan(tmpDir, makePlan({ projectName: "second" }));
		const result = await readPlan(tmpDir);
		expect(result).not.toBeNull();
		if (result) {
			expect(result.projectName).toBe("second");
		}
	});
});
