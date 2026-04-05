import { resolve } from "node:path";
import type { OtelContext, Span } from "../otel/index.js";
import type { AgentConfig } from "../schemas/config.js";
import { runAgentSession } from "../sdk-wrapper.js";
import { readFeatureList, readProgress } from "../state.js";
import { getInitializerPrompt } from "./prompts.js";

export async function runInitializerSession(
	config: AgentConfig,
	otel: OtelContext,
	parentSpan: Span,
): Promise<void> {
	// Pre-validate: app_spec.txt must exist and be non-empty
	const appSpecPath = resolve(config.projectDir, "app_spec.txt");
	const appSpecFile = Bun.file(appSpecPath);

	if (!(await appSpecFile.exists())) {
		throw new Error(
			`Expected an application spec file at "${appSpecPath}".\n\n` +
				`Create a text file named "app_spec.txt" in your project directory (${config.projectDir}) ` +
				`describing the application you want to build, then rerun the orchestrator.`,
		);
	}

	const appSpec = await appSpecFile.text();

	if (!appSpec.trim()) {
		throw new Error(
			`The application spec file at "${appSpecPath}" is empty.\n\n` +
				`Add a description of the application you want to build to "app_spec.txt", ` +
				`then rerun the orchestrator.`,
		);
	}

	const prompt = await getInitializerPrompt();

	console.log("\n--- Initializer Session ---\n");

	await runAgentSession({
		agentType: "initializer",
		prompt,
		model: config.model,
		cwd: config.projectDir,
		allowedTools: ["Read", "Write", "Bash", "Glob", "Grep"],
		env: config.enableOtel
			? {
					CLAUDE_CODE_ENABLE_TELEMETRY: "1",
					OTEL_METRICS_EXPORTER: "otlp",
					OTEL_LOGS_EXPORTER: "otlp",
					OTEL_EXPORTER_OTLP_ENDPOINT: config.otelEndpoint,
				}
			: undefined,
		otel,
		parentSpan,
	});

	// Post-validate: feature_list.json was written correctly
	const features = await readFeatureList(config.projectDir);
	if (features === null) {
		throw new Error(
			"Initializer did not produce a valid feature_list.json in the project directory.",
		);
	}

	// Post-validate: progress.json was written correctly
	const progress = await readProgress(config.projectDir);
	if (progress === null) {
		throw new Error(
			"Initializer did not produce a valid progress.json in the project directory.",
		);
	}
}
