import { describe, expect, test } from "bun:test";
import { ProgressEntrySchema, ProgressLogSchema } from "./progress.js";

function makeEntry(overrides?: Record<string, unknown>) {
	return {
		timestamp: "2026-04-04T12:00:00.000Z",
		sessionId: "sess_abc123",
		sessionType: "generator",
		iteration: 1,
		featuresAttempted: ["User can log in with valid credentials"],
		featuresCompleted: [],
		notes: "Implemented login endpoint and form validation.",
		...overrides,
	};
}

function makeLog(overrides?: Record<string, unknown>) {
	return {
		projectName: "hello-world",
		startedAt: "2026-04-04T10:00:00.000Z",
		entries: [],
		...overrides,
	};
}

describe("ProgressEntrySchema", () => {
	test("parses a valid entry", () => {
		const result = ProgressEntrySchema.safeParse(makeEntry());
		expect(result.success).toBe(true);
	});

	test("accepts all valid sessionType values", () => {
		const types = ["initializer", "planner", "generator", "evaluator"];
		for (const sessionType of types) {
			const result = ProgressEntrySchema.safeParse(makeEntry({ sessionType }));
			expect(result.success).toBe(true);
		}
	});

	test("rejects invalid sessionType", () => {
		const result = ProgressEntrySchema.safeParse(
			makeEntry({ sessionType: "unknown" }),
		);
		expect(result.success).toBe(false);
	});

	test("rejects non-ISO-8601 timestamp", () => {
		const result = ProgressEntrySchema.safeParse(
			makeEntry({ timestamp: "April 4 2026" }),
		);
		expect(result.success).toBe(false);
	});

	test("accepts ISO 8601 timestamp", () => {
		const result = ProgressEntrySchema.safeParse(
			makeEntry({ timestamp: "2026-04-04T12:00:00.000Z" }),
		);
		expect(result.success).toBe(true);
	});

	test("rejects iteration of 0", () => {
		const result = ProgressEntrySchema.safeParse(makeEntry({ iteration: 0 }));
		expect(result.success).toBe(false);
	});

	test("rejects negative iteration", () => {
		const result = ProgressEntrySchema.safeParse(makeEntry({ iteration: -1 }));
		expect(result.success).toBe(false);
	});

	test("rejects non-integer iteration", () => {
		const result = ProgressEntrySchema.safeParse(makeEntry({ iteration: 1.5 }));
		expect(result.success).toBe(false);
	});

	test("accepts iteration of 1", () => {
		const result = ProgressEntrySchema.safeParse(makeEntry({ iteration: 1 }));
		expect(result.success).toBe(true);
	});

	test("costUsd is optional", () => {
		const result = ProgressEntrySchema.safeParse(makeEntry());
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.costUsd).toBeUndefined();
		}
	});

	test("durationMs is optional", () => {
		const result = ProgressEntrySchema.safeParse(makeEntry());
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.durationMs).toBeUndefined();
		}
	});

	test("accepts costUsd when provided", () => {
		const result = ProgressEntrySchema.safeParse(makeEntry({ costUsd: 0.05 }));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.costUsd).toBe(0.05);
		}
	});

	test("rejects negative costUsd", () => {
		const result = ProgressEntrySchema.safeParse(makeEntry({ costUsd: -1 }));
		expect(result.success).toBe(false);
	});

	test("accepts costUsd of 0", () => {
		const result = ProgressEntrySchema.safeParse(makeEntry({ costUsd: 0 }));
		expect(result.success).toBe(true);
	});

	test("accepts durationMs when provided", () => {
		const result = ProgressEntrySchema.safeParse(
			makeEntry({ durationMs: 5000 }),
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.durationMs).toBe(5000);
		}
	});

	test("accepts empty featuresAttempted and featuresCompleted", () => {
		const result = ProgressEntrySchema.safeParse(
			makeEntry({ featuresAttempted: [], featuresCompleted: [] }),
		);
		expect(result.success).toBe(true);
	});
});

describe("ProgressLogSchema", () => {
	test("parses a valid log with no entries", () => {
		const result = ProgressLogSchema.safeParse(makeLog());
		expect(result.success).toBe(true);
	});

	test("parses a valid log with entries", () => {
		const result = ProgressLogSchema.safeParse(
			makeLog({ entries: [makeEntry()] }),
		);
		expect(result.success).toBe(true);
	});

	test("rejects non-ISO-8601 startedAt", () => {
		const result = ProgressLogSchema.safeParse(
			makeLog({ startedAt: "not a date" }),
		);
		expect(result.success).toBe(false);
	});

	test("rejects missing projectName", () => {
		const { projectName: _, ...rest } = makeLog();
		const result = ProgressLogSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	test("rejects log with invalid entry", () => {
		const result = ProgressLogSchema.safeParse(
			makeLog({ entries: [makeEntry({ iteration: 0 })] }),
		);
		expect(result.success).toBe(false);
	});
});
