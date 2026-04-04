import { z } from "zod";

export const BiomeDiagnosticSchema = z.object({
	file: z.string(),
	severity: z.enum(["error", "warning", "info"]),
	category: z.string().describe("e.g., lint/suspicious/noDoubleEquals"),
	message: z.string(),
	line: z.number().int().positive(),
	column: z.number().int().nonnegative(),
	endLine: z.number().int().positive(),
	endColumn: z.number().int().nonnegative(),
	hasFix: z.boolean().describe("Whether Biome can auto-fix this diagnostic"),
});

export type BiomeDiagnostic = z.infer<typeof BiomeDiagnosticSchema>;

export const BiomeReportSchema = z.object({
	timestamp: z.iso.datetime(),
	filesChecked: z.number().int().nonnegative(),
	diagnostics: z.array(BiomeDiagnosticSchema),
	summary: z.object({
		errors: z.number().int().nonnegative(),
		warnings: z.number().int().nonnegative(),
		infos: z.number().int().nonnegative(),
	}),
});

export type BiomeReport = z.infer<typeof BiomeReportSchema>;
