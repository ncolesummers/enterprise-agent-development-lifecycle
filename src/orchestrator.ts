import { resolve } from "node:path";
import {
	getEvaluatorPrompt,
	getGeneratorPrompt,
	getInitializerPrompt,
	getPlannerPrompt,
} from "./agents/prompts.js";
import { createAgentBrowserHooks } from "./hooks/agent-browser.js";
import { createBiomeHooks } from "./hooks/biome.js";
import { bashSecurityHook } from "./hooks/security.js";
import {
	createNoopOtelContext,
	createOtelContext,
	type OtelContext,
	type Span,
} from "./otel/index.js";
import type { AgentConfig } from "./schemas/config.js";
import { EvaluatorReportSchema } from "./schemas/evaluation.js";
import { FeatureListSchema } from "./schemas/feature.js";
import { PlanSchema } from "./schemas/plan.js";
import { runAgentSession } from "./sdk-wrapper.js";

// ---------------------------------------------------------------------------
// State detection
// ---------------------------------------------------------------------------

export type OrchestratorState =
	| "needs_initialization"
	| "needs_planning"
	| "needs_generation"
	| "needs_evaluation"
	| "complete";

export async function detectState(
	config: AgentConfig,
): Promise<OrchestratorState> {
	const featureListPath = resolve(config.projectDir, "feature_list.json");
	const planPath = resolve(config.projectDir, "plan.json");
	const evalReportPath = resolve(config.projectDir, "evaluation_report.json");

	// No feature list → needs initialization
	if (!(await Bun.file(featureListPath).exists())) {
		return "needs_initialization";
	}

	// No plan → needs planning
	if (!(await Bun.file(planPath).exists())) {
		return "needs_planning";
	}

	// Count passing features
	const { passing, total } = await countPassingFeatures(config.projectDir);
	if (passing === total && total > 0) {
		// All features pass — but evaluator may still need to run
		if (config.enableEvaluator) {
			const evalExists = await Bun.file(evalReportPath).exists();
			if (!evalExists) {
				return "needs_evaluation";
			}
			const raw = await Bun.file(evalReportPath).json();
			const report = EvaluatorReportSchema.parse(raw);
			if (
				report.verdict === "pass" &&
				report.overallScore >= config.passThreshold
			) {
				return "complete";
			}
			// Evaluator failed or did not meet pass threshold — generator needs to fix issues
			return "needs_generation";
		}
		return "complete";
	}

	// Check if evaluator gave failing feedback → generator should retry
	if (await Bun.file(evalReportPath).exists()) {
		const raw = await Bun.file(evalReportPath).json();
		const report = EvaluatorReportSchema.parse(raw);
		if (report.verdict === "fail") {
			return "needs_generation";
		}
	}

	return "needs_generation";
}

// ---------------------------------------------------------------------------
// Feature counting
// ---------------------------------------------------------------------------

export async function countPassingFeatures(
	projectDir: string,
): Promise<{ passing: number; total: number }> {
	const featureListPath = resolve(projectDir, "feature_list.json");
	const file = Bun.file(featureListPath);

	if (!(await file.exists())) {
		return { passing: 0, total: 0 };
	}

	const raw = await file.json();
	const features = FeatureListSchema.parse(raw);
	const passing = features.filter((f) => f.passes).length;
	return { passing, total: features.length };
}

// ---------------------------------------------------------------------------
// Agent sessions
// ---------------------------------------------------------------------------

async function runInitializerSession(
	config: AgentConfig,
	otel: OtelContext,
	parentSpan: Span,
): Promise<void> {
	const prompt = await getInitializerPrompt();

	console.log("\n--- Initializer Session ---\n");

	await runAgentSession({
		agentType: "initializer",
		prompt,
		model: config.model,
		cwd: config.projectDir,
		allowedTools: ["Read", "Write", "Bash", "Glob", "Grep"],
		otel,
		parentSpan,
	});

	// Validate that feature_list.json was written correctly
	const featureListPath = resolve(config.projectDir, "feature_list.json");
	if (await Bun.file(featureListPath).exists()) {
		const raw = await Bun.file(featureListPath).json();
		FeatureListSchema.parse(raw);
	}
}

async function runPlannerSession(
	config: AgentConfig,
	otel: OtelContext,
	parentSpan: Span,
): Promise<void> {
	const appSpecPath = resolve(config.projectDir, "app_spec.txt");
	const appSpecFile = Bun.file(appSpecPath);

	if (!(await appSpecFile.exists())) {
		throw new Error(
			`Expected an application spec file at "${appSpecPath}".\n\n` +
				`Create a text file named "app_spec.txt" in your project directory (${config.projectDir}) ` +
				`describing the application you want to build, then rerun the orchestrator.`,
		);
	}

	const appSpec = await appSpecFile.text();

	if (!appSpec.trim()) {
		throw new Error(
			`The application spec file at "${appSpecPath}" is empty.\n\n` +
				`Add a description of the application you want to build to "app_spec.txt", ` +
				`then rerun the orchestrator.`,
		);
	}

	const prompt = await getPlannerPrompt(appSpec);

	console.log("\n--- Planner Session ---\n");

	await runAgentSession({
		agentType: "planner",
		prompt,
		model: config.plannerModel,
		cwd: config.projectDir,
		allowedTools: ["Read", "Write", "Bash"],
		otel,
		parentSpan,
	});

	// Validate the plan was written correctly
	const planPath = resolve(config.projectDir, "plan.json");
	if (await Bun.file(planPath).exists()) {
		const raw = await Bun.file(planPath).json();
		PlanSchema.parse(raw);
	}
}

async function runGeneratorSession(
	config: AgentConfig,
	otel: OtelContext,
	parentSpan: Span,
	iteration: number,
): Promise<void> {
	const prompt = await getGeneratorPrompt();
	const biomeHooks = config.enableBiomeHooks
		? createBiomeHooks(config, otel)
		: { preToolUse: [], postToolUse: [], stop: [], preCompact: [] };
	const agentBrowserHooks = createAgentBrowserHooks();

	console.log(`\n--- Generator Session (iteration ${iteration}) ---\n`);

	await runAgentSession({
		agentType: "generator",
		prompt,
		model: config.model,
		cwd: config.projectDir,
		allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
		hooks: {
			PreToolUse: [
				{ matcher: "Bash", hooks: [bashSecurityHook] },
				...biomeHooks.preToolUse,
			],
			PostToolUse: [
				...biomeHooks.postToolUse,
				...agentBrowserHooks.postToolUse,
			],
			Stop: [...biomeHooks.stop],
			PreCompact: [...biomeHooks.preCompact],
		},
		env: config.enableOtel
			? {
					CLAUDE_CODE_ENABLE_TELEMETRY: "1",
					OTEL_METRICS_EXPORTER: "otlp",
					OTEL_LOGS_EXPORTER: "otlp",
					OTEL_EXPORTER_OTLP_ENDPOINT: config.otelEndpoint,
				}
			: undefined,
		otel,
		parentSpan,
		spanAttributes: { iteration },
	});
}

async function runEvaluatorSession(
	config: AgentConfig,
	otel: OtelContext,
	parentSpan: Span,
): Promise<boolean> {
	const prompt = await getEvaluatorPrompt();
	const agentBrowserHooks = createAgentBrowserHooks();

	console.log("\n--- Evaluator Session ---\n");

	await runAgentSession({
		agentType: "evaluator",
		prompt,
		model: config.evaluatorModel,
		cwd: config.projectDir,
		allowedTools: ["Read", "Write", "Bash"],
		hooks: {
			PreToolUse: [{ matcher: "Bash", hooks: [bashSecurityHook] }],
			PostToolUse: [...agentBrowserHooks.postToolUse],
		},
		otel,
		parentSpan,
	});

	// Read and validate the evaluation report
	const evalReportPath = resolve(config.projectDir, "evaluation_report.json");
	let passed = false;

	if (await Bun.file(evalReportPath).exists()) {
		const raw = await Bun.file(evalReportPath).json();
		const report = EvaluatorReportSchema.parse(raw);
		passed =
			report.verdict === "pass" && report.overallScore >= config.passThreshold;
	}

	return passed;
}

// ---------------------------------------------------------------------------
// Main orchestrator loop
// ---------------------------------------------------------------------------

export async function runOrchestrator(config: AgentConfig): Promise<void> {
	const otel = config.enableOtel
		? createOtelContext(config)
		: createNoopOtelContext();
	const rootSpan = otel.startSpan("harness_run");

	let iteration = 0;
	let evaluatorRetries = 0;
	let shouldStop = false;

	console.log(`\nOrchestrator started for: ${config.projectDir}`);
	console.log(
		`Model: ${config.model} | Evaluator: ${config.enableEvaluator} | Biome hooks: ${config.enableBiomeHooks} | OTel: ${config.enableOtel}`,
	);

	try {
		while (
			!shouldStop &&
			(config.maxIterations === 0 || iteration < config.maxIterations)
		) {
			const state = await detectState(config);

			console.log(`\n${"=".repeat(60)}`);
			console.log(`Iteration ${iteration + 1} | State: ${state}`);
			console.log(`${"=".repeat(60)}`);

			if (state === "complete") {
				console.log("\nAll features passing. Project complete.");
				break;
			}

			iteration++;

			switch (state) {
				case "needs_initialization":
					await runInitializerSession(config, otel, rootSpan);
					break;

				case "needs_planning":
					await runPlannerSession(config, otel, rootSpan);
					break;

				case "needs_generation":
					await runGeneratorSession(config, otel, rootSpan, iteration);
					if (config.enableEvaluator) {
						const passed = await runEvaluatorSession(config, otel, rootSpan);
						if (!passed) {
							evaluatorRetries++;
							if (evaluatorRetries >= config.maxEvaluatorRetries) {
								console.log(
									`\nMax evaluator retries (${config.maxEvaluatorRetries}) reached. Stopping.`,
								);
								shouldStop = true;
								break;
							}
							console.log(
								`\nEvaluator failed (retry ${evaluatorRetries}/${config.maxEvaluatorRetries}). Generator will see feedback on next loop.`,
							);
						} else {
							evaluatorRetries = 0;
						}
					}
					break;

				case "needs_evaluation": {
					const passed = await runEvaluatorSession(config, otel, rootSpan);
					if (!passed) {
						evaluatorRetries++;
						if (evaluatorRetries >= config.maxEvaluatorRetries) {
							console.log(
								`\nMax evaluator retries (${config.maxEvaluatorRetries}) reached. Stopping.`,
							);
							shouldStop = true;
							break;
						}
					} else {
						evaluatorRetries = 0;
					}
					break;
				}
			}

			// 3-second delay between sessions
			await Bun.sleep(3000);
		}

		if (config.maxIterations > 0 && iteration >= config.maxIterations) {
			console.log(
				`\nMax iterations (${config.maxIterations}) reached. Stopping.`,
			);
		}
	} finally {
		rootSpan.end();
		await otel.shutdown();
	}
}
