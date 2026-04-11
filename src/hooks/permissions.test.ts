import { describe, expect, test } from "bun:test";
import type { AgentType } from "../sdk-wrapper.js";
import { AGENT_TOOL_PERMISSIONS, getAllowedTools } from "./permissions.js";

// ---------------------------------------------------------------------------
// AGENT_TOOL_PERMISSIONS
// ---------------------------------------------------------------------------

describe("AGENT_TOOL_PERMISSIONS", () => {
	test("covers all agent types", () => {
		const allTypes: AgentType[] = [
			"initializer",
			"planner",
			"generator",
			"evaluator",
			"coding",
		];
		for (const agentType of allTypes) {
			expect(AGENT_TOOL_PERMISSIONS[agentType]).toBeDefined();
			expect(Array.isArray(AGENT_TOOL_PERMISSIONS[agentType])).toBe(true);
		}
	});

	// initializer
	describe("initializer", () => {
		test("has Read, Write, Bash, Glob, Grep", () => {
			expect(AGENT_TOOL_PERMISSIONS.initializer).toContain("Read");
			expect(AGENT_TOOL_PERMISSIONS.initializer).toContain("Write");
			expect(AGENT_TOOL_PERMISSIONS.initializer).toContain("Bash");
			expect(AGENT_TOOL_PERMISSIONS.initializer).toContain("Glob");
			expect(AGENT_TOOL_PERMISSIONS.initializer).toContain("Grep");
		});

		test("does not have Edit", () => {
			expect(AGENT_TOOL_PERMISSIONS.initializer).not.toContain("Edit");
		});

		test("has exactly 5 tools", () => {
			expect(AGENT_TOOL_PERMISSIONS.initializer).toHaveLength(5);
		});
	});

	// planner
	describe("planner", () => {
		test("has Read, Write, Glob, Grep", () => {
			expect(AGENT_TOOL_PERMISSIONS.planner).toContain("Read");
			expect(AGENT_TOOL_PERMISSIONS.planner).toContain("Write");
			expect(AGENT_TOOL_PERMISSIONS.planner).toContain("Glob");
			expect(AGENT_TOOL_PERMISSIONS.planner).toContain("Grep");
		});

		test("does not have Bash (no code execution)", () => {
			expect(AGENT_TOOL_PERMISSIONS.planner).not.toContain("Bash");
		});

		test("does not have Edit", () => {
			expect(AGENT_TOOL_PERMISSIONS.planner).not.toContain("Edit");
		});

		test("has exactly 4 tools", () => {
			expect(AGENT_TOOL_PERMISSIONS.planner).toHaveLength(4);
		});
	});

	// generator
	describe("generator", () => {
		test("has Read, Write, Edit, Bash, Glob, Grep", () => {
			expect(AGENT_TOOL_PERMISSIONS.generator).toContain("Read");
			expect(AGENT_TOOL_PERMISSIONS.generator).toContain("Write");
			expect(AGENT_TOOL_PERMISSIONS.generator).toContain("Edit");
			expect(AGENT_TOOL_PERMISSIONS.generator).toContain("Bash");
			expect(AGENT_TOOL_PERMISSIONS.generator).toContain("Glob");
			expect(AGENT_TOOL_PERMISSIONS.generator).toContain("Grep");
		});

		test("has exactly 6 tools", () => {
			expect(AGENT_TOOL_PERMISSIONS.generator).toHaveLength(6);
		});
	});

	// evaluator
	describe("evaluator", () => {
		test("has Read, Bash, Glob, Grep", () => {
			expect(AGENT_TOOL_PERMISSIONS.evaluator).toContain("Read");
			expect(AGENT_TOOL_PERMISSIONS.evaluator).toContain("Bash");
			expect(AGENT_TOOL_PERMISSIONS.evaluator).toContain("Glob");
			expect(AGENT_TOOL_PERMISSIONS.evaluator).toContain("Grep");
		});

		test("does not have Write (read-only access)", () => {
			expect(AGENT_TOOL_PERMISSIONS.evaluator).not.toContain("Write");
		});

		test("does not have Edit", () => {
			expect(AGENT_TOOL_PERMISSIONS.evaluator).not.toContain("Edit");
		});

		test("has exactly 4 tools", () => {
			expect(AGENT_TOOL_PERMISSIONS.evaluator).toHaveLength(4);
		});
	});

	// coding
	describe("coding", () => {
		test("has Read, Write, Edit, Bash, Glob, Grep", () => {
			expect(AGENT_TOOL_PERMISSIONS.coding).toContain("Read");
			expect(AGENT_TOOL_PERMISSIONS.coding).toContain("Write");
			expect(AGENT_TOOL_PERMISSIONS.coding).toContain("Edit");
			expect(AGENT_TOOL_PERMISSIONS.coding).toContain("Bash");
			expect(AGENT_TOOL_PERMISSIONS.coding).toContain("Glob");
			expect(AGENT_TOOL_PERMISSIONS.coding).toContain("Grep");
		});

		test("has exactly 6 tools", () => {
			expect(AGENT_TOOL_PERMISSIONS.coding).toHaveLength(6);
		});

		test("mirrors generator tool set", () => {
			expect(AGENT_TOOL_PERMISSIONS.coding.slice().sort()).toEqual(
				AGENT_TOOL_PERMISSIONS.generator.slice().sort(),
			);
		});
	});
});

// ---------------------------------------------------------------------------
// getAllowedTools
// ---------------------------------------------------------------------------

describe("getAllowedTools", () => {
	test("returns the correct array for initializer", () => {
		expect(getAllowedTools("initializer")).toEqual(
			AGENT_TOOL_PERMISSIONS.initializer,
		);
	});

	test("returns the correct array for planner", () => {
		expect(getAllowedTools("planner")).toEqual(AGENT_TOOL_PERMISSIONS.planner);
	});

	test("returns the correct array for generator", () => {
		expect(getAllowedTools("generator")).toEqual(
			AGENT_TOOL_PERMISSIONS.generator,
		);
	});

	test("returns the correct array for evaluator", () => {
		expect(getAllowedTools("evaluator")).toEqual(
			AGENT_TOOL_PERMISSIONS.evaluator,
		);
	});

	test("returns the correct array for coding", () => {
		expect(getAllowedTools("coding")).toEqual(AGENT_TOOL_PERMISSIONS.coding);
	});

	test("returns an array (not undefined)", () => {
		const types: AgentType[] = [
			"initializer",
			"planner",
			"generator",
			"evaluator",
			"coding",
		];
		for (const agentType of types) {
			const tools = getAllowedTools(agentType);
			expect(Array.isArray(tools)).toBe(true);
			expect(tools.length).toBeGreaterThan(0);
		}
	});
});
