import { resolve } from "node:path";
import { Command } from "commander";
import {
	formatValidationErrors,
	loadConfigFile,
	mergeConfigs,
} from "./config-loader.js";
import { runOrchestrator, runSingleAgent } from "./orchestrator.js";
import { AgentConfigSchema } from "./schemas/config.js";

// ---------------------------------------------------------------------------
// Commander program
// ---------------------------------------------------------------------------

const program = new Command()
	.name("adlc")
	.description(
		"Agent Development Lifecycle — orchestrate multi-agent autonomous coding",
	)
	.option(
		"-d, --project-dir <path>",
		"Path to the project directory",
		process.cwd(),
	)
	.option(
		"-a, --agent <type>",
		"Run a single agent instead of the full orchestrator loop",
	)
	.option("-m, --model <model>", "Generator model", "claude-sonnet-4-6")
	.option("--planner-model <model>", "Planner model", "claude-opus-4-6")
	.option("--evaluator-model <model>", "Evaluator model", "claude-opus-4-6")
	.option(
		"--max-iterations <n>",
		"Maximum orchestrator iterations (0 = unlimited)",
		"0",
	)
	.option("--no-evaluator", "Disable the evaluator agent")
	.option("--no-biome", "Disable Biome lint hooks")
	.option("--no-otel", "Disable OpenTelemetry instrumentation")
	.option(
		"--otel-endpoint <url>",
		"OTel collector endpoint",
		"http://localhost:4318",
	)
	.option("--max-evaluator-retries <n>", "Max evaluator retry attempts", "3")
	.option("--pass-threshold <n>", "Evaluator pass/fail threshold (0-10)", "6");

// ---------------------------------------------------------------------------
// Build config from CLI options + config file
// ---------------------------------------------------------------------------

/** Field mapping from Commander option names to AgentConfigSchema field names. */
const fieldMap: Record<string, string> = {
	biome: "enableBiomeHooks",
	evaluator: "enableEvaluator",
	otel: "enableOtel",
};

/**
 * Build a validated AgentConfig from Commander options and an optional
 * config file. Exported for testing.
 */
export async function buildConfig(prog: Command): Promise<
	| {
			success: true;
			config: ReturnType<typeof AgentConfigSchema.parse>;
	  }
	| {
			success: false;
			error: string;
	  }
> {
	const opts = prog.opts();
	const projectDir = resolve(opts.projectDir);

	// Load config file from project directory
	const configPath = resolve(projectDir, "agent-config.json");
	let fileConfig: Record<string, unknown> | null;
	try {
		fileConfig = await loadConfigFile(configPath);
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}

	// Build CLI values with schema field name mapping
	const cliValues: Record<string, unknown> = {
		projectDir,
		agentOverride: opts.agent,
		model: opts.model,
		plannerModel: opts.plannerModel,
		evaluatorModel: opts.evaluatorModel,
		maxIterations: Number.parseInt(opts.maxIterations, 10),
		enableEvaluator: opts.evaluator,
		enableBiomeHooks: opts.biome,
		enableOtel: opts.otel,
		otelEndpoint: opts.otelEndpoint,
		maxEvaluatorRetries: Number.parseInt(opts.maxEvaluatorRetries, 10),
		passThreshold: Number.parseFloat(opts.passThreshold),
	};

	// Build source map: Commander option name → "cli" | "default" | etc.
	// Map to schema field names using fieldMap.
	const cliSources: Record<string, string> = {};
	for (const optName of Object.keys(opts)) {
		const schemaField = fieldMap[optName] ?? optName;
		const source = prog.getOptionValueSource(optName);
		if (source) {
			cliSources[schemaField] = source;
		}
	}
	// projectDir is derived from the --project-dir flag
	cliSources.projectDir = prog.getOptionValueSource("projectDir") ?? "default";
	// agentOverride is derived from the --agent flag
	if (opts.agent !== undefined) {
		cliSources.agentOverride = "cli";
	}

	const merged = mergeConfigs(fileConfig, cliValues, cliSources);
	const result = AgentConfigSchema.safeParse(merged);

	if (!result.success) {
		return {
			success: false,
			error: formatValidationErrors(result.error),
		};
	}

	return { success: true, config: result.data };
}

// ---------------------------------------------------------------------------
// Main execution (only when run directly, not when imported by tests)
// ---------------------------------------------------------------------------

if (import.meta.main) {
	program.parse();

	const result = await buildConfig(program);

	if (!result.success) {
		console.error(result.error);
		process.exit(1);
	}

	const config = result.config;

	if (config.agentOverride) {
		await runSingleAgent(config, config.agentOverride);
	} else {
		await runOrchestrator(config);
	}
}
