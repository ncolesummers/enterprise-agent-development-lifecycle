import { describe, expect, test } from "bun:test";
import {
	PlanSchema,
	SprintContractSchema,
	TechnicalDesignSchema,
} from "./plan.js";

function makeTechnicalDesign(overrides?: Record<string, unknown>) {
	return {
		stack: {
			runtime: "bun",
			framework: "react",
			testing: "bun:test",
			buildTool: "bun",
		},
		architecture:
			"Three-agent ADLC orchestration with planner, generator, and evaluator",
		aiFeatures: ["AI-powered code generation", "Automated evaluation scoring"],
		...overrides,
	};
}

function makeFeature(overrides?: Record<string, unknown>) {
	return {
		category: "functional",
		description: "User can log in with valid credentials",
		steps: [
			"Navigate to login page",
			"Enter valid email and password",
			"Click submit",
		],
		...overrides,
	};
}

function makePlan(overrides?: Record<string, unknown>) {
	return {
		projectName: "test-project",
		description: "A test project for validating plan schemas",
		createdAt: "2026-04-04T12:00:00Z",
		technicalDesign: makeTechnicalDesign(),
		features: [makeFeature()],
		...overrides,
	};
}

function makeSprintContract(overrides?: Record<string, unknown>) {
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
		...overrides,
	};
}

describe("TechnicalDesignSchema", () => {
	test("parses a valid technical design", () => {
		const result = TechnicalDesignSchema.safeParse(makeTechnicalDesign());
		expect(result.success).toBe(true);
	});

	test("accepts optional database field", () => {
		const result = TechnicalDesignSchema.safeParse(
			makeTechnicalDesign({
				stack: {
					runtime: "bun",
					framework: "react",
					database: "sqlite",
					testing: "bun:test",
					buildTool: "bun",
				},
			}),
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.stack.database).toBe("sqlite");
		}
	});

	test("database is undefined when omitted", () => {
		const result = TechnicalDesignSchema.safeParse(makeTechnicalDesign());
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.stack.database).toBeUndefined();
		}
	});

	test("rejects missing runtime", () => {
		const result = TechnicalDesignSchema.safeParse(
			makeTechnicalDesign({
				stack: { framework: "react", testing: "bun:test", buildTool: "bun" },
			}),
		);
		expect(result.success).toBe(false);
	});

	test("rejects missing framework", () => {
		const result = TechnicalDesignSchema.safeParse(
			makeTechnicalDesign({
				stack: { runtime: "bun", testing: "bun:test", buildTool: "bun" },
			}),
		);
		expect(result.success).toBe(false);
	});

	test("rejects missing testing", () => {
		const result = TechnicalDesignSchema.safeParse(
			makeTechnicalDesign({
				stack: { runtime: "bun", framework: "react", buildTool: "bun" },
			}),
		);
		expect(result.success).toBe(false);
	});

	test("rejects missing buildTool", () => {
		const result = TechnicalDesignSchema.safeParse(
			makeTechnicalDesign({
				stack: { runtime: "bun", framework: "react", testing: "bun:test" },
			}),
		);
		expect(result.success).toBe(false);
	});

	test("rejects missing architecture", () => {
		const { architecture, ...rest } = makeTechnicalDesign();
		const result = TechnicalDesignSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	test("rejects missing aiFeatures", () => {
		const { aiFeatures, ...rest } = makeTechnicalDesign();
		const result = TechnicalDesignSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	test("accepts empty aiFeatures array", () => {
		const result = TechnicalDesignSchema.safeParse(
			makeTechnicalDesign({ aiFeatures: [] }),
		);
		expect(result.success).toBe(true);
	});
});

describe("PlanSchema", () => {
	test("parses a valid plan without sprintDecomposition", () => {
		const result = PlanSchema.safeParse(makePlan());
		expect(result.success).toBe(true);
	});

	test("parses a valid plan with sprintDecomposition", () => {
		const result = PlanSchema.safeParse(
			makePlan({
				sprintDecomposition: [
					{
						sprintNumber: 1,
						goal: "Set up authentication",
						featureIndices: [0],
					},
				],
			}),
		);
		expect(result.success).toBe(true);
	});

	test("rejects missing projectName", () => {
		const { projectName, ...rest } = makePlan();
		const result = PlanSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	test("rejects missing description", () => {
		const { description, ...rest } = makePlan();
		const result = PlanSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	test("rejects non-ISO-8601 createdAt", () => {
		const result = PlanSchema.safeParse(makePlan({ createdAt: "not-a-date" }));
		expect(result.success).toBe(false);
	});

	test("rejects missing technicalDesign", () => {
		const { technicalDesign, ...rest } = makePlan();
		const result = PlanSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	test("rejects missing features", () => {
		const { features, ...rest } = makePlan();
		const result = PlanSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	test("rejects empty features array", () => {
		const result = PlanSchema.safeParse(makePlan({ features: [] }));
		expect(result.success).toBe(false);
	});

	test("sprintDecomposition is undefined when omitted", () => {
		const result = PlanSchema.safeParse(makePlan());
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.sprintDecomposition).toBeUndefined();
		}
	});

	test("rejects sprint with non-positive sprintNumber", () => {
		const result = PlanSchema.safeParse(
			makePlan({
				sprintDecomposition: [
					{ sprintNumber: 0, goal: "Invalid sprint", featureIndices: [0] },
				],
			}),
		);
		expect(result.success).toBe(false);
	});

	test("rejects sprint with negative featureIndex", () => {
		const result = PlanSchema.safeParse(
			makePlan({
				sprintDecomposition: [
					{ sprintNumber: 1, goal: "Valid sprint", featureIndices: [-1] },
				],
			}),
		);
		expect(result.success).toBe(false);
	});
});

describe("SprintContractSchema", () => {
	test("parses a valid sprint contract", () => {
		const result = SprintContractSchema.safeParse(makeSprintContract());
		expect(result.success).toBe(true);
	});

	test("generatorAcknowledged defaults to false when omitted", () => {
		const result = SprintContractSchema.safeParse(makeSprintContract());
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.generatorAcknowledged).toBe(false);
		}
	});

	test("accepts generatorAcknowledged: true", () => {
		const result = SprintContractSchema.safeParse(
			makeSprintContract({ generatorAcknowledged: true }),
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.generatorAcknowledged).toBe(true);
		}
	});

	test("rejects non-positive sprintNumber", () => {
		const result = SprintContractSchema.safeParse(
			makeSprintContract({ sprintNumber: 0 }),
		);
		expect(result.success).toBe(false);
	});

	test("rejects negative sprintNumber", () => {
		const result = SprintContractSchema.safeParse(
			makeSprintContract({ sprintNumber: -1 }),
		);
		expect(result.success).toBe(false);
	});

	test("rejects non-integer sprintNumber", () => {
		const result = SprintContractSchema.safeParse(
			makeSprintContract({ sprintNumber: 1.5 }),
		);
		expect(result.success).toBe(false);
	});

	test("accepts all valid testableBy values", () => {
		const validValues = ["browser", "api", "unit", "manual"];
		for (const testableBy of validValues) {
			const result = SprintContractSchema.safeParse(
				makeSprintContract({
					acceptanceCriteria: [
						{
							criterion: "Test criterion",
							testableBy,
							description: "Test description",
						},
					],
				}),
			);
			expect(result.success).toBe(true);
		}
	});

	test("rejects invalid testableBy value", () => {
		const result = SprintContractSchema.safeParse(
			makeSprintContract({
				acceptanceCriteria: [
					{
						criterion: "Test criterion",
						testableBy: "curl",
						description: "Test description",
					},
				],
			}),
		);
		expect(result.success).toBe(false);
	});

	test("rejects non-ISO-8601 negotiatedAt", () => {
		const result = SprintContractSchema.safeParse(
			makeSprintContract({ negotiatedAt: "April 4, 2026" }),
		);
		expect(result.success).toBe(false);
	});

	test("rejects missing acceptanceCriteria", () => {
		const { acceptanceCriteria, ...rest } = makeSprintContract();
		const result = SprintContractSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	test("accepts empty acceptanceCriteria array", () => {
		const result = SprintContractSchema.safeParse(
			makeSprintContract({ acceptanceCriteria: [] }),
		);
		expect(result.success).toBe(true);
	});

	test("rejects acceptanceCriteria with missing fields", () => {
		const result = SprintContractSchema.safeParse(
			makeSprintContract({
				acceptanceCriteria: [{ criterion: "Only criterion" }],
			}),
		);
		expect(result.success).toBe(false);
	});

	test("rejects missing featureScope", () => {
		const { featureScope, ...rest } = makeSprintContract();
		const result = SprintContractSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	test("accepts empty featureScope array", () => {
		const result = SprintContractSchema.safeParse(
			makeSprintContract({ featureScope: [] }),
		);
		expect(result.success).toBe(true);
	});
});
