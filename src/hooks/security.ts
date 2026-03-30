import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";

/**
 * Stub bash security hook. Full implementation is a separate issue.
 * Currently allows all commands through.
 */
export const bashSecurityHook: HookCallback = async (
	_input,
	_toolUseId,
	_options,
) => {
	return { continue: true };
};
