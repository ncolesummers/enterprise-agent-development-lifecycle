import { describe, expect, test } from "bun:test";
import { AgentConfigSchema } from "./config.js";

function makeConfig(overrides?: Record<string, unknown>) {
	return {
		projectDir: "/tmp/my-project",
		...overrides,
	};
}

describe("AgentConfigSchema", () => {
	test("parses minimal config with only projectDir", () => {
		const result = AgentConfigSchema.safeParse(makeConfig());
		expect(result.success).toBe(true);
	});

	test("applies all defaults correctly", () => {
		const result = AgentConfigSchema.safeParse(makeConfig());
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.maxIterations).toBe(0);
			expect(result.data.model).toBe("claude-sonnet-4-6");
			expect(result.data.enableEvaluator).toBe(true);
			expect(result.data.evaluatorModel).toBe("claude-opus-4-6");
			expect(result.data.plannerModel).toBe("claude-opus-4-6");
			expect(result.data.passThreshold).toBe(6);
			expect(result.data.maxEvaluatorRetries).toBe(3);
			expect(result.data.enableBiomeHooks).toBe(true);
			expect(result.data.enableOtel).toBe(true);
			expect(result.data.otelEndpoint).toBe("http://localhost:4318");
		}
	});

	test("projectDir is required", () => {
		const result = AgentConfigSchema.safeParse({});
		expect(result.success).toBe(false);
	});

	test("projectDir rejects empty string", () => {
		const result = AgentConfigSchema.safeParse(makeConfig({ projectDir: "" }));
		expect(result.success).toBe(false);
	});

	test("maxIterations 0 means unlimited", () => {
		const result = AgentConfigSchema.safeParse(
			makeConfig({ maxIterations: 0 }),
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.maxIterations).toBe(0);
		}
	});

	test("maxIterations rejects negative values", () => {
		const result = AgentConfigSchema.safeParse(
			makeConfig({ maxIterations: -1 }),
		);
		expect(result.success).toBe(false);
	});

	test("maxIterations rejects non-integer values", () => {
		const result = AgentConfigSchema.safeParse(
			makeConfig({ maxIterations: 2.5 }),
		);
		expect(result.success).toBe(false);
	});

	test("passThreshold accepts boundary values 0 and 10", () => {
		expect(
			AgentConfigSchema.safeParse(makeConfig({ passThreshold: 0 })).success,
		).toBe(true);
		expect(
			AgentConfigSchema.safeParse(makeConfig({ passThreshold: 10 })).success,
		).toBe(true);
	});

	test("passThreshold rejects values outside 0-10", () => {
		expect(
			AgentConfigSchema.safeParse(makeConfig({ passThreshold: -1 })).success,
		).toBe(false);
		expect(
			AgentConfigSchema.safeParse(makeConfig({ passThreshold: 11 })).success,
		).toBe(false);
	});

	test("maxEvaluatorRetries rejects negative values", () => {
		const result = AgentConfigSchema.safeParse(
			makeConfig({ maxEvaluatorRetries: -1 }),
		);
		expect(result.success).toBe(false);
	});

	test("accepts fully overridden config", () => {
		const result = AgentConfigSchema.safeParse({
			projectDir: "/opt/project",
			maxIterations: 5,
			model: "claude-haiku-3",
			enableEvaluator: false,
			evaluatorModel: "claude-sonnet-4-6",
			plannerModel: "claude-sonnet-4-6",
			passThreshold: 8,
			maxEvaluatorRetries: 5,
			enableBiomeHooks: false,
			enableOtel: false,
			otelEndpoint: "http://otel.example.com:4318",
		});
		expect(result.success).toBe(true);
	});

	test("agentOverride accepts each valid agent type", () => {
		for (const agent of ["initializer", "planner", "generator", "evaluator"]) {
			const result = AgentConfigSchema.safeParse(
				makeConfig({ agentOverride: agent }),
			);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.agentOverride).toBe(agent);
			}
		}
	});

	test("agentOverride defaults to undefined when omitted", () => {
		const result = AgentConfigSchema.safeParse(makeConfig());
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.agentOverride).toBeUndefined();
		}
	});

	test("agentOverride rejects invalid agent types", () => {
		const result = AgentConfigSchema.safeParse(
			makeConfig({ agentOverride: "executor" }),
		);
		expect(result.success).toBe(false);
	});

	test("boolean flags accept both true and false", () => {
		const trueConfig = AgentConfigSchema.safeParse(
			makeConfig({
				enableEvaluator: true,
				enableBiomeHooks: true,
				enableOtel: true,
			}),
		);
		expect(trueConfig.success).toBe(true);

		const falseConfig = AgentConfigSchema.safeParse(
			makeConfig({
				enableEvaluator: false,
				enableBiomeHooks: false,
				enableOtel: false,
			}),
		);
		expect(falseConfig.success).toBe(true);
	});
});
