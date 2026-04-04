import { describe, expect, test } from "bun:test";
import { BiomeDiagnosticSchema, BiomeReportSchema } from "./biome.js";

function makeBiomeDiagnostic(overrides?: Record<string, unknown>) {
	return {
		file: "src/index.ts",
		severity: "warning",
		category: "lint/suspicious/noDoubleEquals",
		message: "Use === instead of ==",
		line: 10,
		column: 5,
		endLine: 10,
		endColumn: 7,
		hasFix: true,
		...overrides,
	};
}

function makeBiomeReport(overrides?: Record<string, unknown>) {
	return {
		timestamp: "2026-04-04T12:00:00Z",
		filesChecked: 42,
		diagnostics: [makeBiomeDiagnostic()],
		summary: { errors: 0, warnings: 1, infos: 0 },
		...overrides,
	};
}

describe("BiomeDiagnosticSchema", () => {
	test("parses a valid diagnostic", () => {
		const result = BiomeDiagnosticSchema.safeParse(makeBiomeDiagnostic());
		expect(result.success).toBe(true);
	});

	test("accepts all three severity values", () => {
		for (const severity of ["error", "warning", "info"]) {
			const result = BiomeDiagnosticSchema.safeParse(
				makeBiomeDiagnostic({ severity }),
			);
			expect(result.success).toBe(true);
		}
	});

	test("rejects invalid severity", () => {
		const result = BiomeDiagnosticSchema.safeParse(
			makeBiomeDiagnostic({ severity: "critical" }),
		);
		expect(result.success).toBe(false);
	});

	test("line must be a positive integer", () => {
		expect(
			BiomeDiagnosticSchema.safeParse(makeBiomeDiagnostic({ line: 0 })).success,
		).toBe(false);
		expect(
			BiomeDiagnosticSchema.safeParse(makeBiomeDiagnostic({ line: -1 }))
				.success,
		).toBe(false);
		expect(
			BiomeDiagnosticSchema.safeParse(makeBiomeDiagnostic({ line: 1 })).success,
		).toBe(true);
	});

	test("column accepts zero (nonnegative)", () => {
		expect(
			BiomeDiagnosticSchema.safeParse(makeBiomeDiagnostic({ column: 0 }))
				.success,
		).toBe(true);
		expect(
			BiomeDiagnosticSchema.safeParse(makeBiomeDiagnostic({ column: -1 }))
				.success,
		).toBe(false);
	});

	test("endLine must be a positive integer", () => {
		expect(
			BiomeDiagnosticSchema.safeParse(makeBiomeDiagnostic({ endLine: 0 }))
				.success,
		).toBe(false);
		expect(
			BiomeDiagnosticSchema.safeParse(makeBiomeDiagnostic({ endLine: 1 }))
				.success,
		).toBe(true);
	});

	test("endColumn accepts zero (nonnegative)", () => {
		expect(
			BiomeDiagnosticSchema.safeParse(makeBiomeDiagnostic({ endColumn: 0 }))
				.success,
		).toBe(true);
		expect(
			BiomeDiagnosticSchema.safeParse(makeBiomeDiagnostic({ endColumn: -1 }))
				.success,
		).toBe(false);
	});

	test("hasFix must be a boolean", () => {
		expect(
			BiomeDiagnosticSchema.safeParse(makeBiomeDiagnostic({ hasFix: "yes" }))
				.success,
		).toBe(false);
	});

	test("rejects missing required fields", () => {
		const { file, ...without } = makeBiomeDiagnostic();
		const result = BiomeDiagnosticSchema.safeParse(without);
		expect(result.success).toBe(false);
	});
});

describe("BiomeReportSchema", () => {
	test("parses a valid report", () => {
		const result = BiomeReportSchema.safeParse(makeBiomeReport());
		expect(result.success).toBe(true);
	});

	test("rejects invalid timestamp", () => {
		const result = BiomeReportSchema.safeParse(
			makeBiomeReport({ timestamp: "not-a-date" }),
		);
		expect(result.success).toBe(false);
	});

	test("accepts empty diagnostics array", () => {
		const result = BiomeReportSchema.safeParse(
			makeBiomeReport({ diagnostics: [] }),
		);
		expect(result.success).toBe(true);
	});

	test("filesChecked must be nonnegative", () => {
		expect(
			BiomeReportSchema.safeParse(makeBiomeReport({ filesChecked: -1 }))
				.success,
		).toBe(false);
		expect(
			BiomeReportSchema.safeParse(makeBiomeReport({ filesChecked: 0 })).success,
		).toBe(true);
	});

	test("summary counts must be nonnegative", () => {
		expect(
			BiomeReportSchema.safeParse(
				makeBiomeReport({ summary: { errors: -1, warnings: 0, infos: 0 } }),
			).success,
		).toBe(false);
		expect(
			BiomeReportSchema.safeParse(
				makeBiomeReport({ summary: { errors: 0, warnings: -1, infos: 0 } }),
			).success,
		).toBe(false);
		expect(
			BiomeReportSchema.safeParse(
				makeBiomeReport({ summary: { errors: 0, warnings: 0, infos: -1 } }),
			).success,
		).toBe(false);
	});

	test("rejects diagnostic with invalid severity in array", () => {
		const result = BiomeReportSchema.safeParse(
			makeBiomeReport({
				diagnostics: [makeBiomeDiagnostic({ severity: "fatal" })],
			}),
		);
		expect(result.success).toBe(false);
	});
});
