import { bashSecurityHook } from "../hooks/security.js";
import type { OtelContext, Span } from "../otel/index.js";
import type { AgentConfig } from "../schemas/config.js";
import { runAgentSession } from "../sdk-wrapper.js";
import { readAppSpec, readFeatureList, readProgress } from "../state.js";
import { getInitializerPrompt } from "./prompts.js";

export async function runInitializerSession(
	config: AgentConfig,
	otel: OtelContext,
	parentSpan: Span,
): Promise<void> {
	// Pre-validate: app_spec.txt must exist and be non-empty
	await readAppSpec(config.projectDir);

	const prompt = await getInitializerPrompt();

	console.log("\n--- Initializer Session ---\n");

	await runAgentSession({
		agentType: "initializer",
		prompt,
		model: config.model,
		cwd: config.projectDir,
		allowedTools: ["Read", "Write", "Bash", "Glob", "Grep"],
		hooks: {
			PreToolUse: [{ matcher: "Bash", hooks: [bashSecurityHook] }],
		},
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
