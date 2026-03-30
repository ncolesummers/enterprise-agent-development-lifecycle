import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { countPassingFeatures, detectState } from "./orchestrator.js";
import type { AgentConfig } from "./schemas/config.js";

function makeConfig(
	projectDir: string,
	overrides?: Partial<AgentConfig>,
): AgentConfig {
	return {
		projectDir,
		maxIterations: 0,
		model: "claude-sonnet-4-6",
		plannerModel: "claude-opus-4-6",
		evaluatorModel: "claude-opus-4-6",
		enableEvaluator: true,
		enableBiomeHooks: true,
		enableOtel: false,
		otelEndpoint: "http://localhost:4317",
		maxEvaluatorRetries: 3,
		passThreshold: 6,
		...overrides,
	};
}

describe("detectState", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(resolve(tmpdir(), "adlc-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	test("returns needs_initialization when no feature_list.json", async () => {
		const config = makeConfig(tmpDir);
		const state = await detectState(config);
		expect(state).toBe("needs_initialization");
	});

	test("returns needs_planning when feature_list.json exists but no plan.json", async () => {
		const config = makeConfig(tmpDir);
		const features = [
			{
				category: "functional",
				description: "Hello world endpoint returns 200",
				steps: ["Send GET request to /", "Verify response status is 200"],
				passes: false,
			},
		];
		await Bun.write(
			resolve(tmpDir, "feature_list.json"),
			JSON.stringify(features),
		);

		const state = await detectState(config);
		expect(state).toBe("needs_planning");
	});

	test("returns needs_generation when plan exists with incomplete features", async () => {
		const config = makeConfig(tmpDir);
		const features = [
			{
				category: "functional",
				description: "Hello world endpoint returns 200",
				steps: ["Send GET request to /"],
				passes: false,
			},
		];
		const plan = {
			projectName: "test",
			description: "Test project",
			createdAt: new Date().toISOString(),
			technicalDesign: {
				stack: {
					runtime: "Bun",
					framework: "none",
					testing: "bun test",
					buildTool: "Bun",
				},
				architecture: "Simple HTTP server",
				aiFeatures: [],
			},
			features,
		};
		await Bun.write(
			resolve(tmpDir, "feature_list.json"),
			JSON.stringify(features),
		);
		await Bun.write(resolve(tmpDir, "plan.json"), JSON.stringify(plan));

		const state = await detectState(config);
		expect(state).toBe("needs_generation");
	});

	test("returns complete when all features pass and evaluator disabled", async () => {
		const config = makeConfig(tmpDir, { enableEvaluator: false });
		const features = [
			{
				category: "functional",
				description: "Hello world endpoint returns 200",
				steps: ["Send GET request to /"],
				passes: true,
			},
		];
		const plan = {
			projectName: "test",
			description: "Test project",
			createdAt: new Date().toISOString(),
			technicalDesign: {
				stack: {
					runtime: "Bun",
					framework: "none",
					testing: "bun test",
					buildTool: "Bun",
				},
				architecture: "Simple HTTP server",
				aiFeatures: [],
			},
			features,
		};
		await Bun.write(
			resolve(tmpDir, "feature_list.json"),
			JSON.stringify(features),
		);
		await Bun.write(resolve(tmpDir, "plan.json"), JSON.stringify(plan));

		const state = await detectState(config);
		expect(state).toBe("complete");
	});

	test("returns needs_evaluation when all features pass but no eval report", async () => {
		const config = makeConfig(tmpDir, { enableEvaluator: true });
		const features = [
			{
				category: "functional",
				description: "Hello world endpoint returns 200",
				steps: ["Send GET request to /"],
				passes: true,
			},
		];
		const plan = {
			projectName: "test",
			description: "Test project",
			createdAt: new Date().toISOString(),
			technicalDesign: {
				stack: {
					runtime: "Bun",
					framework: "none",
					testing: "bun test",
					buildTool: "Bun",
				},
				architecture: "Simple HTTP server",
				aiFeatures: [],
			},
			features,
		};
		await Bun.write(
			resolve(tmpDir, "feature_list.json"),
			JSON.stringify(features),
		);
		await Bun.write(resolve(tmpDir, "plan.json"), JSON.stringify(plan));

		const state = await detectState(config);
		expect(state).toBe("needs_evaluation");
	});

	test("returns complete when all features pass and eval report is pass", async () => {
		const config = makeConfig(tmpDir, { enableEvaluator: true });
		const features = [
			{
				category: "functional",
				description: "Hello world endpoint returns 200",
				steps: ["Send GET request to /"],
				passes: true,
			},
		];
		const plan = {
			projectName: "test",
			description: "Test project",
			createdAt: new Date().toISOString(),
			technicalDesign: {
				stack: {
					runtime: "Bun",
					framework: "none",
					testing: "bun test",
					buildTool: "Bun",
				},
				architecture: "Simple HTTP server",
				aiFeatures: [],
			},
			features,
		};
		const evalReport = {
			evaluatedAt: new Date().toISOString(),
			sessionId: "test-session",
			scores: [
				{
					criterion: "design_quality",
					score: 8,
					weight: 0.3,
					findings: "Good design",
				},
				{
					criterion: "originality",
					score: 7,
					weight: 0.25,
					findings: "Some original touches",
				},
				{ criterion: "craft", score: 8, weight: 0.2, findings: "Clean code" },
				{
					criterion: "functionality",
					score: 9,
					weight: 0.25,
					findings: "All features work",
				},
			],
			overallScore: 8,
			passThreshold: 6,
			verdict: "pass",
			summary: "Project passes evaluation.",
			criticalIssues: [],
			suggestions: [],
			testsPerformed: [],
		};
		await Bun.write(
			resolve(tmpDir, "feature_list.json"),
			JSON.stringify(features),
		);
		await Bun.write(resolve(tmpDir, "plan.json"), JSON.stringify(plan));
		await Bun.write(
			resolve(tmpDir, "evaluation_report.json"),
			JSON.stringify(evalReport),
		);

		const state = await detectState(config);
		expect(state).toBe("complete");
	});

	test("returns needs_generation when eval report verdict is fail", async () => {
		const config = makeConfig(tmpDir, { enableEvaluator: true });
		const features = [
			{
				category: "functional",
				description: "Hello world endpoint returns 200",
				steps: ["Send GET request to /"],
				passes: true,
			},
		];
		const plan = {
			projectName: "test",
			description: "Test project",
			createdAt: new Date().toISOString(),
			technicalDesign: {
				stack: {
					runtime: "Bun",
					framework: "none",
					testing: "bun test",
					buildTool: "Bun",
				},
				architecture: "Simple HTTP server",
				aiFeatures: [],
			},
			features,
		};
		const evalReport = {
			evaluatedAt: new Date().toISOString(),
			sessionId: "test-session",
			scores: [
				{
					criterion: "design_quality",
					score: 3,
					weight: 0.3,
					findings: "Poor design",
				},
				{
					criterion: "originality",
					score: 2,
					weight: 0.25,
					findings: "Generic",
				},
				{ criterion: "craft", score: 4, weight: 0.2, findings: "Sloppy" },
				{
					criterion: "functionality",
					score: 5,
					weight: 0.25,
					findings: "Partially works",
				},
			],
			overallScore: 3.5,
			passThreshold: 6,
			verdict: "fail",
			summary: "Project fails evaluation.",
			criticalIssues: ["Design needs complete overhaul"],
			suggestions: ["Add more tests"],
			testsPerformed: [],
		};
		await Bun.write(
			resolve(tmpDir, "feature_list.json"),
			JSON.stringify(features),
		);
		await Bun.write(resolve(tmpDir, "plan.json"), JSON.stringify(plan));
		await Bun.write(
			resolve(tmpDir, "evaluation_report.json"),
			JSON.stringify(evalReport),
		);

		const state = await detectState(config);
		expect(state).toBe("needs_generation");
	});
});

describe("countPassingFeatures", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(resolve(tmpdir(), "adlc-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	test("returns 0/0 when no feature_list.json", async () => {
		const result = await countPassingFeatures(tmpDir);
		expect(result).toEqual({ passing: 0, total: 0 });
	});

	test("counts passing and total features correctly", async () => {
		const features = [
			{
				category: "functional",
				description: "Feature one that works",
				steps: ["Test step one"],
				passes: true,
			},
			{
				category: "functional",
				description: "Feature two incomplete",
				steps: ["Test step two"],
				passes: false,
			},
			{
				category: "ui",
				description: "Feature three that works",
				steps: ["Test step three"],
				passes: true,
			},
		];
		await Bun.write(
			resolve(tmpDir, "feature_list.json"),
			JSON.stringify(features),
		);

		const result = await countPassingFeatures(tmpDir);
		expect(result).toEqual({ passing: 2, total: 3 });
	});
});
