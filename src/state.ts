import { rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { z } from "zod";
import {
	type EvaluatorReport,
	EvaluatorReportSchema,
	type FeatureList,
	FeatureListSchema,
	type Plan,
	PlanSchema,
	type ProgressLog,
	ProgressLogSchema,
	type SprintContract,
	SprintContractSchema,
} from "./schemas/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_FILES = {
	featureList: "feature_list.json",
	progress: "progress.json",
	plan: "plan.json",
	evaluationReport: "evaluation_report.json",
	sprintContract: "sprint_contract.json",
} as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readStateFile<T>(
	projectDir: string,
	filename: string,
	schema: z.ZodType<T>,
): Promise<T | null> {
	const filePath = resolve(projectDir, filename);
	const file = Bun.file(filePath);

	if (!(await file.exists())) {
		return null;
	}

	const raw = await file.json();
	return schema.parse(raw);
}

async function writeStateFile<T>(
	projectDir: string,
	filename: string,
	schema: z.ZodType<T>,
	data: T,
): Promise<void> {
	const validated = schema.parse(data);
	const targetPath = resolve(projectDir, filename);
	const tmpPath = `${targetPath}.tmp.${Date.now()}`;

	try {
		await Bun.write(tmpPath, JSON.stringify(validated, null, 2));
		await rename(tmpPath, targetPath);
	} catch (err) {
		try {
			await unlink(tmpPath);
		} catch {}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Feature list
// ---------------------------------------------------------------------------

export async function readFeatureList(
	projectDir: string,
): Promise<FeatureList | null> {
	return readStateFile(projectDir, STATE_FILES.featureList, FeatureListSchema);
}

export async function writeFeatureList(
	projectDir: string,
	data: FeatureList,
): Promise<void> {
	return writeStateFile(
		projectDir,
		STATE_FILES.featureList,
		FeatureListSchema,
		data,
	);
}

// ---------------------------------------------------------------------------
// Progress log
// ---------------------------------------------------------------------------

export async function readProgress(
	projectDir: string,
): Promise<ProgressLog | null> {
	return readStateFile(projectDir, STATE_FILES.progress, ProgressLogSchema);
}

export async function writeProgress(
	projectDir: string,
	data: ProgressLog,
): Promise<void> {
	return writeStateFile(
		projectDir,
		STATE_FILES.progress,
		ProgressLogSchema,
		data,
	);
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export async function readPlan(projectDir: string): Promise<Plan | null> {
	return readStateFile(projectDir, STATE_FILES.plan, PlanSchema);
}

export async function writePlan(projectDir: string, data: Plan): Promise<void> {
	return writeStateFile(projectDir, STATE_FILES.plan, PlanSchema, data);
}

// ---------------------------------------------------------------------------
// Evaluation report
// ---------------------------------------------------------------------------

export async function readEvaluationReport(
	projectDir: string,
): Promise<EvaluatorReport | null> {
	return readStateFile(
		projectDir,
		STATE_FILES.evaluationReport,
		EvaluatorReportSchema,
	);
}

export async function writeEvaluationReport(
	projectDir: string,
	data: EvaluatorReport,
): Promise<void> {
	return writeStateFile(
		projectDir,
		STATE_FILES.evaluationReport,
		EvaluatorReportSchema,
		data,
	);
}

// ---------------------------------------------------------------------------
// Sprint contract
// ---------------------------------------------------------------------------

export async function readSprintContract(
	projectDir: string,
): Promise<SprintContract | null> {
	return readStateFile(
		projectDir,
		STATE_FILES.sprintContract,
		SprintContractSchema,
	);
}

export async function writeSprintContract(
	projectDir: string,
	data: SprintContract,
): Promise<void> {
	return writeStateFile(
		projectDir,
		STATE_FILES.sprintContract,
		SprintContractSchema,
		data,
	);
}
