import { resolve } from "node:path";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
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
	SpanStatusCode,
} from "./otel/index.js";
import type { AgentConfig } from "./schemas/config.js";
import { EvaluatorReportSchema } from "./schemas/evaluation.js";
import { FeatureListSchema } from "./schemas/feature.js";
import { PlanSchema } from "./schemas/plan.js";

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
			if (report.verdict === "pass") {
				return "complete";
			}
			// Evaluator failed — generator needs to fix issues
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
// Message handler
// ---------------------------------------------------------------------------

function handleMessage(message: SDKMessage): void {
	switch (message.type) {
		case "assistant":
			for (const block of message.message.content) {
				if (block.type === "text") process.stdout.write(block.text);
				if (block.type === "tool_use") console.log(`\n[Tool: ${block.name}]`);
			}
			break;
		case "result":
			console.log(`\nSession complete: ${message.subtype}`);
			if (message.total_cost_usd) {
				console.log(`Cost: $${message.total_cost_usd.toFixed(4)}`);
			}
			if (message.duration_ms) {
				console.log(`Duration: ${(message.duration_ms / 1000).toFixed(1)}s`);
			}
			break;
	}
}

// ---------------------------------------------------------------------------
// Session metrics recording
// ---------------------------------------------------------------------------

function recordSessionMetrics(
	otel: OtelContext,
	span: Span,
	result: SDKMessage & { type: "result" },
	agentType: string,
): void {
	if (result.total_cost_usd) {
		span.setAttribute("session.cost_usd", result.total_cost_usd);
		otel.meter
			.createHistogram("harness.session.cost_usd")
			.record(result.total_cost_usd, { agent_type: agentType });
	}

	if (result.duration_ms) {
		span.setAttribute("session.duration_ms", result.duration_ms);
		otel.meter
			.createHistogram("harness.session.duration_ms")
			.record(result.duration_ms, { agent_type: agentType });
	}

	if (result.usage) {
		span.setAttribute("session.tokens.input", result.usage.input_tokens);
		span.setAttribute("session.tokens.output", result.usage.output_tokens);
		span.setAttribute(
			"session.tokens.cache_read",
			result.usage.cache_read_input_tokens,
		);

		otel.meter
			.createHistogram("harness.session.tokens.input")
			.record(result.usage.input_tokens, { agent_type: agentType });
		otel.meter
			.createHistogram("harness.session.tokens.output")
			.record(result.usage.output_tokens, { agent_type: agentType });
	}

	otel.meter
		.createCounter("harness.sessions.total")
		.add(1, { agent_type: agentType });

	span.setAttribute("session.result", result.subtype);
	if (result.subtype.startsWith("error")) {
		span.setStatus({
			code: SpanStatusCode.ERROR,
			message: result.subtype,
		});
	}
}

// ---------------------------------------------------------------------------
// Agent sessions
// ---------------------------------------------------------------------------

async function runInitializerSession(
	config: AgentConfig,
	otel: OtelContext,
	parentSpan: Span,
): Promise<void> {
	const span = otel.startSpan("initializer_session", {
		parent: parentSpan,
	});

	const prompt = await getInitializerPrompt();

	console.log("\n--- Initializer Session ---\n");

	for await (const message of query({
		prompt,
		options: {
			model: config.model,
			cwd: config.projectDir,
			permissionMode: "bypassPermissions",
			allowDangerouslySkipPermissions: true,
			allowedTools: ["Read", "Write", "Bash", "Glob", "Grep"],
		},
	})) {
		handleMessage(message);
		if (message.type === "result") {
			recordSessionMetrics(otel, span, message, "initializer");
		}
	}

	// Validate that feature_list.json was written correctly
	const featureListPath = resolve(config.projectDir, "feature_list.json");
	if (await Bun.file(featureListPath).exists()) {
		const raw = await Bun.file(featureListPath).json();
		FeatureListSchema.parse(raw);
	}

	span.end();
}

async function runPlannerSession(
	config: AgentConfig,
	otel: OtelContext,
	parentSpan: Span,
): Promise<void> {
	const span = otel.startSpan("planner_session", { parent: parentSpan });

	const appSpecPath = resolve(config.projectDir, "app_spec.txt");
	const appSpec = await Bun.file(appSpecPath).text();
	const prompt = await getPlannerPrompt(appSpec);

	console.log("\n--- Planner Session ---\n");

	for await (const message of query({
		prompt,
		options: {
			model: config.plannerModel,
			cwd: config.projectDir,
			permissionMode: "bypassPermissions",
			allowDangerouslySkipPermissions: true,
			allowedTools: ["Read", "Write", "Bash"],
		},
	})) {
		handleMessage(message);
		if (message.type === "result") {
			recordSessionMetrics(otel, span, message, "planner");
		}
	}

	// Validate the plan was written correctly
	const planPath = resolve(config.projectDir, "plan.json");
	if (await Bun.file(planPath).exists()) {
		const raw = await Bun.file(planPath).json();
		PlanSchema.parse(raw);
	}

	span.end();
}

async function runGeneratorSession(
	config: AgentConfig,
	otel: OtelContext,
	parentSpan: Span,
	iteration: number,
): Promise<void> {
	const span = otel.startSpan("generator_session", {
		parent: parentSpan,
		attributes: { iteration },
	});

	const prompt = await getGeneratorPrompt();
	const biomeHooks = config.enableBiomeHooks
		? createBiomeHooks(config, otel)
		: { preToolUse: [], postToolUse: [], stop: [], preCompact: [] };
	const agentBrowserHooks = createAgentBrowserHooks();

	console.log(`\n--- Generator Session (iteration ${iteration}) ---\n`);

	for await (const message of query({
		prompt,
		options: {
			model: config.model,
			cwd: config.projectDir,
			permissionMode: "bypassPermissions",
			allowDangerouslySkipPermissions: true,
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
			env: {
				CLAUDE_CODE_ENABLE_TELEMETRY: "1",
				OTEL_METRICS_EXPORTER: "otlp",
				OTEL_LOGS_EXPORTER: "otlp",
				OTEL_EXPORTER_OTLP_ENDPOINT: config.otelEndpoint,
			},
		},
	})) {
		handleMessage(message);
		if (message.type === "result") {
			recordSessionMetrics(otel, span, message, "generator");
		}
	}

	span.end();
}

async function runEvaluatorSession(
	config: AgentConfig,
	otel: OtelContext,
	parentSpan: Span,
): Promise<boolean> {
	const span = otel.startSpan("evaluator_session", { parent: parentSpan });

	const prompt = await getEvaluatorPrompt();
	const agentBrowserHooks = createAgentBrowserHooks();

	console.log("\n--- Evaluator Session ---\n");

	for await (const message of query({
		prompt,
		options: {
			model: config.evaluatorModel,
			cwd: config.projectDir,
			permissionMode: "bypassPermissions",
			allowDangerouslySkipPermissions: true,
			allowedTools: ["Read", "Write", "Bash"],
			hooks: {
				PreToolUse: [{ matcher: "Bash", hooks: [bashSecurityHook] }],
				PostToolUse: [...agentBrowserHooks.postToolUse],
			},
		},
	})) {
		handleMessage(message);
		if (message.type === "result") {
			recordSessionMetrics(otel, span, message, "evaluator");
		}
	}

	// Read and validate the evaluation report
	const evalReportPath = resolve(config.projectDir, "evaluation_report.json");
	let passed = false;

	if (await Bun.file(evalReportPath).exists()) {
		const raw = await Bun.file(evalReportPath).json();
		const report = EvaluatorReportSchema.parse(raw);
		span.setAttribute("verdict", report.verdict);
		span.setAttribute("overall_score", report.overallScore);
		passed = report.verdict === "pass";
	}

	span.end();
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

	console.log(`\nOrchestrator started for: ${config.projectDir}`);
	console.log(
		`Model: ${config.model} | Evaluator: ${config.enableEvaluator} | Biome hooks: ${config.enableBiomeHooks} | OTel: ${config.enableOtel}`,
	);

	try {
		while (config.maxIterations === 0 || iteration < config.maxIterations) {
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
