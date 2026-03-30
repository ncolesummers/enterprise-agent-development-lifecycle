import type {
	HookCallback,
	PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

const DANGEROUS_PATTERNS: string[] = [
	"rm -rf /",
	"rm -rf --no-preserve-root",
	":(){:|:&};:",
	"mkfs.",
	"mkfs ",
	"dd if=/dev/zero of=/dev/sd",
	"shutdown -h now",
	"shutdown now",
	"halt -p",
];

/**
 * Bash security hook with minimal denylist for obviously destructive commands.
 * Full implementation is a separate issue.
 */
export const bashSecurityHook: HookCallback = async (
	input,
	_toolUseId,
	_options,
) => {
	const hookInput = input as PreToolUseHookInput;
	const command =
		typeof hookInput.tool_input === "object" &&
		hookInput.tool_input !== null &&
		"command" in hookInput.tool_input
			? String((hookInput.tool_input as Record<string, unknown>).command)
			: "";

	const normalized = command.toLowerCase();

	for (const pattern of DANGEROUS_PATTERNS) {
		if (normalized.includes(pattern)) {
			return { continue: false };
		}
	}

	return { continue: true };
};
