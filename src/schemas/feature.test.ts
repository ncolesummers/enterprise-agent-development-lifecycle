import { describe, expect, test } from "bun:test";
import { FeatureListSchema, FeatureSchema } from "./feature.js";

function makeFeature(overrides?: Record<string, unknown>) {
	return {
		category: "functional",
		description: "User can log in with valid credentials",
		steps: ["Navigate to login page", "Enter valid email and password", "Click submit"],
		...overrides,
	};
}

describe("FeatureSchema", () => {
	test("parses a valid feature", () => {
		const result = FeatureSchema.safeParse(makeFeature());
		expect(result.success).toBe(true);
	});

	test("passes defaults to false when omitted", () => {
		const result = FeatureSchema.safeParse(makeFeature());
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.passes).toBe(false);
		}
	});

	test("accepts passes: true when explicitly set", () => {
		const result = FeatureSchema.safeParse(makeFeature({ passes: true }));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.passes).toBe(true);
		}
	});

	test("rejects invalid category", () => {
		const result = FeatureSchema.safeParse(makeFeature({ category: "unknown" }));
		expect(result.success).toBe(false);
	});

	test("accepts all valid category values", () => {
		const categories = [
			"functional",
			"ui",
			"api",
			"integration",
			"performance",
			"security",
			"accessibility",
		];
		for (const category of categories) {
			const result = FeatureSchema.safeParse(makeFeature({ category }));
			expect(result.success).toBe(true);
		}
	});

	test("rejects description shorter than 10 characters", () => {
		const result = FeatureSchema.safeParse(makeFeature({ description: "Too short" }));
		expect(result.success).toBe(false);
	});

	test("accepts description of exactly 10 characters", () => {
		const result = FeatureSchema.safeParse(makeFeature({ description: "1234567890" }));
		expect(result.success).toBe(true);
	});

	test("rejects empty steps array", () => {
		const result = FeatureSchema.safeParse(makeFeature({ steps: [] }));
		expect(result.success).toBe(false);
	});

	test("rejects steps with strings shorter than 5 characters", () => {
		const result = FeatureSchema.safeParse(makeFeature({ steps: ["OK"] }));
		expect(result.success).toBe(false);
	});

	test("accepts steps with strings of exactly 5 characters", () => {
		const result = FeatureSchema.safeParse(makeFeature({ steps: ["Click"] }));
		expect(result.success).toBe(true);
	});

	test("rejects missing required fields", () => {
		const result = FeatureSchema.safeParse({ description: "A valid description here" });
		expect(result.success).toBe(false);
	});
});

describe("FeatureListSchema", () => {
	test("parses a valid list with one feature", () => {
		const result = FeatureListSchema.safeParse([makeFeature()]);
		expect(result.success).toBe(true);
	});

	test("parses a valid list with multiple features", () => {
		const result = FeatureListSchema.safeParse([
			makeFeature({ description: "First feature description" }),
			makeFeature({ category: "api", description: "Second feature description" }),
		]);
		expect(result.success).toBe(true);
	});

	test("rejects empty array", () => {
		const result = FeatureListSchema.safeParse([]);
		expect(result.success).toBe(false);
	});

	test("rejects list containing an invalid feature", () => {
		const result = FeatureListSchema.safeParse([
			makeFeature(),
			makeFeature({ category: "invalid" }),
		]);
		expect(result.success).toBe(false);
	});
});
