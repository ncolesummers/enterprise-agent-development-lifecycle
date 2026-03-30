import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import type { OtelContext } from "../otel/index.js";
import type { AgentConfig } from "../schemas/config.js";

export interface BiomeHooks {
	preToolUse: HookCallbackMatcher[];
	postToolUse: HookCallbackMatcher[];
	stop: HookCallbackMatcher[];
	preCompact: HookCallbackMatcher[];
}

/**
 * Stub biome hook factory. Full implementation is a separate issue.
 * Returns empty hook arrays so the orchestrator compiles.
 */
export function createBiomeHooks(
	_config: AgentConfig,
	_otel: OtelContext,
): BiomeHooks {
	return {
		preToolUse: [],
		postToolUse: [],
		stop: [],
		preCompact: [],
	};
}
