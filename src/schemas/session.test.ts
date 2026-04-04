import { describe, expect, test } from "bun:test";
import { SessionStateSchema, TokenUsageSchema } from "./session.js";

function makeTokenUsage(overrides?: Record<string, unknown>) {
	return {
		input: 1500,
		output: 800,
		cacheRead: 200,
		cacheCreation: 50,
		...overrides,
	};
}

function makeSession(overrides?: Record<string, unknown>) {
	return {
		sessionId: "session-abc-123",
		agentType: "generator",
		iteration: 1,
		startedAt: "2026-04-04T12:00:00Z",
		...overrides,
	};
}

describe("TokenUsageSchema", () => {
	test("parses valid token usage", () => {
		const result = TokenUsageSchema.safeParse(makeTokenUsage());
		expect(result.success).toBe(true);
	});

	test("accepts zero values for all fields", () => {
		const result = TokenUsageSchema.safeParse({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheCreation: 0,
		});
		expect(result.success).toBe(true);
	});

	test("rejects negative values", () => {
		expect(
			TokenUsageSchema.safeParse(makeTokenUsage({ input: -1 })).success,
		).toBe(false);
		expect(
			TokenUsageSchema.safeParse(makeTokenUsage({ output: -1 })).success,
		).toBe(false);
		expect(
			TokenUsageSchema.safeParse(makeTokenUsage({ cacheRead: -1 })).success,
		).toBe(false);
		expect(
			TokenUsageSchema.safeParse(makeTokenUsage({ cacheCreation: -1 })).success,
		).toBe(false);
	});

	test("rejects non-integer values", () => {
		expect(
			TokenUsageSchema.safeParse(makeTokenUsage({ input: 1.5 })).success,
		).toBe(false);
	});

	test("rejects missing fields", () => {
		const { cacheCreation, ...partial } = makeTokenUsage();
		expect(TokenUsageSchema.safeParse(partial).success).toBe(false);
	});
});

describe("SessionStateSchema", () => {
	test("parses a valid session with only required fields", () => {
		const result = SessionStateSchema.safeParse(makeSession());
		expect(result.success).toBe(true);
	});

	test("parses a fully populated session", () => {
		const result = SessionStateSchema.safeParse(
			makeSession({
				completedAt: "2026-04-04T12:30:00Z",
				costUsd: 0.15,
				tokensUsed: makeTokenUsage(),
				result: "success",
			}),
		);
		expect(result.success).toBe(true);
	});

	test("accepts all agentType values", () => {
		const types = ["initializer", "planner", "generator", "evaluator"];
		for (const agentType of types) {
			const result = SessionStateSchema.safeParse(makeSession({ agentType }));
			expect(result.success).toBe(true);
		}
	});

	test("rejects invalid agentType", () => {
		const result = SessionStateSchema.safeParse(
			makeSession({ agentType: "orchestrator" }),
		);
		expect(result.success).toBe(false);
	});

	test("accepts all result values", () => {
		const results = ["success", "error", "max_turns", "interrupted"];
		for (const result of results) {
			const parsed = SessionStateSchema.safeParse(makeSession({ result }));
			expect(parsed.success).toBe(true);
		}
	});

	test("rejects invalid result", () => {
		const result = SessionStateSchema.safeParse(
			makeSession({ result: "timeout" }),
		);
		expect(result.success).toBe(false);
	});

	test("completedAt is optional", () => {
		const without = SessionStateSchema.safeParse(makeSession());
		expect(without.success).toBe(true);

		const withIt = SessionStateSchema.safeParse(
			makeSession({ completedAt: "2026-04-04T13:00:00Z" }),
		);
		expect(withIt.success).toBe(true);
	});

	test("costUsd is optional", () => {
		const without = SessionStateSchema.safeParse(makeSession());
		expect(without.success).toBe(true);

		const withIt = SessionStateSchema.safeParse(makeSession({ costUsd: 0.05 }));
		expect(withIt.success).toBe(true);
	});

	test("costUsd rejects negative values", () => {
		const result = SessionStateSchema.safeParse(
			makeSession({ costUsd: -0.01 }),
		);
		expect(result.success).toBe(false);
	});

	test("tokensUsed is optional", () => {
		const without = SessionStateSchema.safeParse(makeSession());
		expect(without.success).toBe(true);

		const withIt = SessionStateSchema.safeParse(
			makeSession({ tokensUsed: makeTokenUsage() }),
		);
		expect(withIt.success).toBe(true);
	});

	test("result is optional", () => {
		const without = SessionStateSchema.safeParse(makeSession());
		expect(without.success).toBe(true);

		const withIt = SessionStateSchema.safeParse(
			makeSession({ result: "success" }),
		);
		expect(withIt.success).toBe(true);
	});

	test("iteration must be a positive integer", () => {
		expect(
			SessionStateSchema.safeParse(makeSession({ iteration: 0 })).success,
		).toBe(false);
		expect(
			SessionStateSchema.safeParse(makeSession({ iteration: -1 })).success,
		).toBe(false);
		expect(
			SessionStateSchema.safeParse(makeSession({ iteration: 1.5 })).success,
		).toBe(false);
		expect(
			SessionStateSchema.safeParse(makeSession({ iteration: 1 })).success,
		).toBe(true);
	});

	test("rejects invalid startedAt datetime", () => {
		const result = SessionStateSchema.safeParse(
			makeSession({ startedAt: "not-a-date" }),
		);
		expect(result.success).toBe(false);
	});

	test("rejects invalid completedAt datetime", () => {
		const result = SessionStateSchema.safeParse(
			makeSession({ completedAt: "not-a-date" }),
		);
		expect(result.success).toBe(false);
	});
});
