import { resolve } from "node:path";

const PROMPTS_DIR = resolve(import.meta.dir, "../../prompts");

export async function loadPrompt(filename: string): Promise<string> {
	const path = resolve(PROMPTS_DIR, filename);
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new Error(`Prompt template not found: ${path}`);
	}
	return file.text();
}

export async function getInitializerPrompt(): Promise<string> {
	return loadPrompt("initializer_prompt.md");
}

export async function getPlannerPrompt(appSpec: string): Promise<string> {
	const template = await loadPrompt("planner_prompt.md");
	return template.replace("{{APP_SPEC}}", appSpec);
}

export async function getGeneratorPrompt(): Promise<string> {
	return loadPrompt("generator_prompt.md");
}

export async function getEvaluatorPrompt(): Promise<string> {
	return loadPrompt("evaluator_prompt.md");
}

export async function getCodingPrompt(): Promise<string> {
	return loadPrompt("coding_prompt.md");
}
