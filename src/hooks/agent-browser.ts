import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";

export interface AgentBrowserHooks {
	postToolUse: HookCallbackMatcher[];
}

/**
 * Stub agent-browser hook factory. Full implementation is a separate issue.
 * Returns empty hook arrays so the orchestrator compiles.
 */
export function createAgentBrowserHooks(): AgentBrowserHooks {
	return {
		postToolUse: [],
	};
}
