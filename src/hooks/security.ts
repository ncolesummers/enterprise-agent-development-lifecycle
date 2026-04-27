import { resolve } from "node:path";
import type {
	HookCallback,
	PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

/** Substring patterns — matched via `includes()` on the lowercased command. */
const DANGEROUS_SUBSTRINGS: string[] = [
	// Original patterns
	"rm -rf /",
	"rm -rf --no-preserve-root",
	":(){:|:&};:",
	"mkfs.",
	"mkfs ",
	"dd if=/dev/zero of=/dev/sd",
	"shutdown -h now",
	"shutdown now",
	"halt -p",
	// Filesystem destruction
	"rm -rf ~",
	"rm -rf $home",
	"rm -rf .",
	"chmod -r 777 /",
	"chown -r",
	"> /dev/sda",
	"> /dev/nvme",
	// Network / exfiltration (substring-safe)
	"nc -l",
	"socat tcp-listen",
	"socat exec:",
	"socat system:",
	// Privilege escalation
	"chmod u+s",
	"chmod +s",
	// Process / system manipulation
	"kill -9 1",
	"systemctl stop",
	"service stop",
	// Crypto mining / malware
	"xmrig",
	"minerd",
	"cryptonight",
];

/**
 * Regex patterns — for terms that cause false positives with substring matching.
 * Tested via `.test()` on the lowercased command.
 */
const DANGEROUS_REGEXES: RegExp[] = [
	// Pipe to shell — must be "sh" or "bash" as a whole word after pipe
	/\|\s*sh\b/,
	/\|\s*bash\b/,
	// Privilege escalation — whole-word to avoid matching "sudoku", "susan", etc.
	/\bsudo\b/,
	/\bsu\s+-/,
	/\bdoas\b/,
	// Process manipulation — whole-word to avoid false positives
	/\bkillall\b/,
	/\bpkill\b/,
	/\breboot\b/,
];

/**
 * Bash security hook with comprehensive denylist for destructive and dangerous commands.
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

	for (const pattern of DANGEROUS_SUBSTRINGS) {
		if (normalized.includes(pattern)) {
			return { continue: false };
		}
	}

	for (const regex of DANGEROUS_REGEXES) {
		if (regex.test(normalized)) {
			return { continue: false };
		}
	}

	return { continue: true };
};

/**
 * Creates a filesystem boundary enforcement hook that restricts file operations
 * to within the given projectDir, preventing path traversal attacks.
 */
export function createFileSystemBoundaryHook(projectDir: string): HookCallback {
	const resolvedProjectDir = resolve(projectDir);

	return async (input, _toolUseId, _options) => {
		const hookInput = input as PreToolUseHookInput;
		const toolName = hookInput.tool_name;
		const toolInput =
			typeof hookInput.tool_input === "object" && hookInput.tool_input !== null
				? (hookInput.tool_input as Record<string, unknown>)
				: {};

		// For Write and Edit tools: check file_path is within projectDir
		if (toolName === "Write" || toolName === "Edit") {
			const filePath =
				typeof toolInput.file_path === "string" ? toolInput.file_path : "";
			if (filePath) {
				const resolved = resolve(resolvedProjectDir, filePath);
				if (
					!resolved.startsWith(`${resolvedProjectDir}/`) &&
					resolved !== resolvedProjectDir
				) {
					return { continue: false };
				}
			}
			return { continue: true };
		}

		// For Bash tools: best-effort check for obvious boundary violations
		if (toolName === "Bash") {
			const command =
				typeof toolInput.command === "string" ? toolInput.command : "";

			// Check for cd to absolute paths outside projectDir
			const cdAbsolutePattern = /(?:^|;|\s&&|\s\|\|)\s*cd\s+(\/[^\s;|&]*)/g;
			let match: RegExpExecArray | null;
			// biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop pattern
			while ((match = cdAbsolutePattern.exec(command)) !== null) {
				const cdTarget = match[1];
				if (!cdTarget) continue;

				const targetPath = resolve(cdTarget);
				if (
					!targetPath.startsWith(`${resolvedProjectDir}/`) &&
					targetPath !== resolvedProjectDir
				) {
					return { continue: false };
				}
			}

			// Check for direct cd /
			if (/(?:^|[;&|])\s*cd\s+\/\s*(?:$|[;&|])/.test(command)) {
				return { continue: false };
			}
		}

		return { continue: true };
	};
}
