import { createAgentBrowserHooks } from "../hooks/agent-browser.js";
import { createBiomeHooks } from "../hooks/biome.js";
import { bashSecurityHook } from "../hooks/security.js";
import type { OtelContext, Span } from "../otel/index.js";
import { getNativeOtelEnv } from "../otel/native-config.js";
import type { AgentConfig } from "../schemas/config.js";
import { runAgentSession } from "../sdk-wrapper.js";
import { getCodingPrompt } from "./prompts.js";

export async function runCodingSession(
	config: AgentConfig,
	otel: OtelContext,
	parentSpan: Span,
	iteration: number,
): Promise<void> {
	const prompt = await getCodingPrompt();
	const biomeHooks = config.enableBiomeHooks
		? createBiomeHooks(config, otel)
		: { preToolUse: [], postToolUse: [], stop: [], preCompact: [] };
	const agentBrowserHooks = createAgentBrowserHooks();

	console.log(`\n--- Coding Session (iteration ${iteration}) ---\n`);

	await runAgentSession({
		agentType: "coding",
		prompt,
		model: config.model,
		cwd: config.projectDir,
		allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
		hooks: {
			PreToolUse: [
				{ matcher: "Bash", hooks: [bashSecurityHook] },
				...biomeHooks.preToolUse,
			],
			PostToolUse: [
				...biomeHooks.postToolUse,
				...agentBrowserHooks.postToolUse,
			],
			Stop: [...biomeHooks.stop],
			PreCompact: [...biomeHooks.preCompact],
		},
		env: getNativeOtelEnv(config),
		otel,
		parentSpan,
		spanAttributes: { iteration },
	});
}
