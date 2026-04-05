import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { buildConfig } from "./cli.js";

/**
 * Create a Commander program with the same options as src/cli.ts.
 * Parse the given argv array and return the program for use with buildConfig.
 */
function createProgram(argv: string[]): Command {
	const program = new Command()
		.exitOverride() // Prevent process.exit on --help or errors
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
		.option(
			"--pass-threshold <n>",
			"Evaluator pass/fail threshold (0-10)",
			"6",
		);

	program.parse(["node", "cli", ...argv]);
	return program;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildConfig", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "cli-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	test("defaults project dir to cwd", async () => {
		const prog = createProgram([]);
		const result = await buildConfig(prog);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.config.projectDir).toBe(resolve(process.cwd()));
		}
	});

	test("explicit --project-dir resolves to absolute path", async () => {
		const prog = createProgram(["-d", tempDir]);
		const result = await buildConfig(prog);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.config.projectDir).toBe(resolve(tempDir));
		}
	});

	test("--agent maps to agentOverride", async () => {
		const prog = createProgram(["--agent", "planner"]);
		const result = await buildConfig(prog);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.config.agentOverride).toBe("planner");
		}
	});

	test("--no-evaluator maps to enableEvaluator: false", async () => {
		const prog = createProgram(["--no-evaluator"]);
		const result = await buildConfig(prog);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.config.enableEvaluator).toBe(false);
		}
	});

	test("--no-biome maps to enableBiomeHooks: false", async () => {
		const prog = createProgram(["--no-biome"]);
		const result = await buildConfig(prog);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.config.enableBiomeHooks).toBe(false);
		}
	});

	test("--no-otel maps to enableOtel: false", async () => {
		const prog = createProgram(["--no-otel"]);
		const result = await buildConfig(prog);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.config.enableOtel).toBe(false);
		}
	});

	test("numeric options parsed correctly", async () => {
		const prog = createProgram([
			"--max-iterations",
			"5",
			"--pass-threshold",
			"7.5",
			"--max-evaluator-retries",
			"2",
		]);
		const result = await buildConfig(prog);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.config.maxIterations).toBe(5);
			expect(result.config.passThreshold).toBe(7.5);
			expect(result.config.maxEvaluatorRetries).toBe(2);
		}
	});

	test("config file values used as fallback for unset CLI options", async () => {
		await Bun.write(
			join(tempDir, "agent-config.json"),
			JSON.stringify({
				model: "claude-opus-4-6",
				passThreshold: 8,
				maxIterations: 10,
			}),
		);

		const prog = createProgram(["-d", tempDir]);
		const result = await buildConfig(prog);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.config.model).toBe("claude-opus-4-6");
			expect(result.config.passThreshold).toBe(8);
			expect(result.config.maxIterations).toBe(10);
		}
	});

	test("CLI args override config file values", async () => {
		await Bun.write(
			join(tempDir, "agent-config.json"),
			JSON.stringify({ model: "file-model", passThreshold: 8 }),
		);

		const prog = createProgram([
			"-d",
			tempDir,
			"-m",
			"cli-model",
			"--pass-threshold",
			"9",
		]);
		const result = await buildConfig(prog);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.config.model).toBe("cli-model");
			expect(result.config.passThreshold).toBe(9);
		}
	});

	test("invalid config produces formatted error", async () => {
		await Bun.write(
			join(tempDir, "agent-config.json"),
			JSON.stringify({ passThreshold: 99 }),
		);

		const prog = createProgram(["-d", tempDir]);
		const result = await buildConfig(prog);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toContain("Invalid configuration:");
			expect(result.error).toContain("passThreshold");
		}
	});

	test("invalid JSON in config file produces error", async () => {
		await Bun.write(join(tempDir, "agent-config.json"), "{ broken json");

		const prog = createProgram(["-d", tempDir]);
		const result = await buildConfig(prog);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toContain("invalid JSON");
		}
	});

	test("missing config file is silently skipped", async () => {
		const prog = createProgram(["-d", tempDir]);
		const result = await buildConfig(prog);
		expect(result.success).toBe(true);
	});

	test("all defaults applied when no args and no config file", async () => {
		const prog = createProgram([]);
		const result = await buildConfig(prog);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.config.model).toBe("claude-sonnet-4-6");
			expect(result.config.enableEvaluator).toBe(true);
			expect(result.config.enableBiomeHooks).toBe(true);
			expect(result.config.enableOtel).toBe(true);
			expect(result.config.maxIterations).toBe(0);
			expect(result.config.passThreshold).toBe(6);
			expect(result.config.agentOverride).toBeUndefined();
		}
	});
});
