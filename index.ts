import { resolve } from "node:path";
import { Command } from "commander";
import { runOrchestrator } from "./src/orchestrator.js";
import { AgentConfigSchema } from "./src/schemas/config.js";

const program = new Command()
	.name("adlc")
	.description(
		"Agent Development Lifecycle — orchestrate multi-agent autonomous coding",
	)
	.requiredOption("-p, --project-dir <path>", "Path to the project directory")
	.option(
		"-i, --max-iterations <n>",
		"Maximum orchestrator iterations (0 = unlimited)",
		"0",
	)
	.option("-m, --model <model>", "Generator model", "claude-sonnet-4-6")
	.option("--planner-model <model>", "Planner model", "claude-opus-4-6")
	.option("--evaluator-model <model>", "Evaluator model", "claude-opus-4-6")
	.option("--no-evaluator", "Disable the evaluator agent")
	.option("--no-biome", "Disable Biome lint hooks")
	.option("--no-otel", "Disable OpenTelemetry instrumentation")
	.option(
		"--otel-endpoint <url>",
		"OTel collector endpoint",
		"http://localhost:4317",
	)
	.option("--max-evaluator-retries <n>", "Max evaluator retry attempts", "3")
	.option("--pass-threshold <n>", "Evaluator pass/fail threshold (0-10)", "6");

program.parse();

const opts = program.opts();

const config = AgentConfigSchema.parse({
	projectDir: resolve(opts.projectDir),
	maxIterations: Number.parseInt(opts.maxIterations, 10),
	model: opts.model,
	plannerModel: opts.plannerModel,
	evaluatorModel: opts.evaluatorModel,
	enableEvaluator: opts.evaluator,
	enableBiomeHooks: opts.biome,
	enableOtel: opts.otel,
	otelEndpoint: opts.otelEndpoint,
	maxEvaluatorRetries: Number.parseInt(opts.maxEvaluatorRetries, 10),
	passThreshold: Number.parseFloat(opts.passThreshold),
});

await runOrchestrator(config);
