import { runCodingSession } from "./agents/coding.js";
import { runInitializerSession } from "./agents/initializer.js";
import {
	getEvaluatorPrompt,
	getGeneratorPrompt,
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
import { type AgentType, runAgentSession } from "./sdk-wrapper.js";
import {
	readAppSpec,
	readEvaluationReport,
	readFeatureList,
	readPlan,
} from "./state.js";

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
	// No feature list → needs initialization
	const features = await readFeatureList(config.projectDir);
	if (features === null) {
		return "needs_initialization";
	}

	// No plan → needs planning
	if ((await readPlan(config.projectDir)) === null) {
		return "needs_planning";
	}

	// Count passing features (reuse already-loaded list)
	const passing = features.filter((f) => f.passes).length;
	const total = features.length;
	const evalReport = await readEvaluationReport(config.projectDir);

	if (passing === total && total > 0) {
		// All features pass — but evaluator may still need to run
		if (config.enableEvaluator) {
			if (evalReport === null) {
				return "needs_evaluation";
			}
			if (
				evalReport.verdict === "pass" &&
				evalReport.overallScore >= config.passThreshold
			) {
				return "complete";
			}
			// Evaluator failed or did not meet pass threshold — generator needs to fix issues
			return "needs_generation";
		}
		return "complete";
	}

	// Check if evaluator gave failing feedback → generator should retry
	if (evalReport !== null && evalReport.verdict === "fail") {
		return "needs_generation";
	}

	return "needs_generation";
}

// ---------------------------------------------------------------------------
// Feature counting
// ---------------------------------------------------------------------------

export async function countPassingFeatures(
	projectDir: string,
): Promise<{ passing: number; total: number }> {
	const features = await readFeatureList(projectDir);

	if (features === null) {
		return { passing: 0, total: 0 };
	}

	const passing = features.filter((f) => f.passes).length;
	return { passing, total: features.length };
}

// ---------------------------------------------------------------------------
// Agent sessions
// ---------------------------------------------------------------------------

async function runPlannerSession(
	config: AgentConfig,
	otel: OtelContext,
	parentSpan: Span,
): Promise<void> {
	const appSpec = await readAppSpec(config.projectDir);
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
	const plan = await readPlan(config.projectDir);
	if (plan === null) {
		throw new Error(
			`Planner session completed without producing a valid "plan.json" in "${config.projectDir}".`,
		);
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
	const report = await readEvaluationReport(config.projectDir);
	let passed = false;

	if (report !== null) {
		passed =
			report.verdict === "pass" && report.overallScore >= config.passThreshold;

		// Preserve evaluator telemetry on the parent span
		parentSpan.setAttribute("evaluator.verdict", report.verdict);
		parentSpan.setAttribute("evaluator.overall_score", report.overallScore);
	}

	return passed;
}

// ---------------------------------------------------------------------------
// Single-agent override
// ---------------------------------------------------------------------------

export async function runSingleAgent(
	config: AgentConfig,
	agentType: AgentType,
): Promise<void> {
	const otel = config.enableOtel
		? createOtelContext(config)
		: createNoopOtelContext();
	const rootSpan = otel.startSpan("single_agent_run");
	rootSpan.setAttribute("agent.type", agentType);

	console.log(`\nRunning single agent: ${agentType}`);
	console.log(`Project: ${config.projectDir}`);

	try {
		switch (agentType) {
			case "initializer":
				await runInitializerSession(config, otel, rootSpan);
				break;
			case "planner":
				await runPlannerSession(config, otel, rootSpan);
				break;
			case "generator":
				await runGeneratorSession(config, otel, rootSpan, 1);
				break;
			case "evaluator":
				await runEvaluatorSession(config, otel, rootSpan);
				break;
			case "coding":
				await runCodingSession(config, otel, rootSpan, 1);
				break;
		}
	} finally {
		rootSpan.end();
		await otel.shutdown();
	}
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
