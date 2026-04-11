import type {
	HookCallback,
	HookCallbackMatcher,
	PostToolUseHookInput,
	PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { OtelContext } from "../otel/index.js";
import type { BiomeDiagnostic } from "../schemas/biome.js";
import type { AgentConfig } from "../schemas/config.js";

export interface BiomeHooks {
	preToolUse: HookCallbackMatcher[];
	postToolUse: HookCallbackMatcher[];
	stop: HookCallbackMatcher[];
	preCompact: HookCallbackMatcher[];
}

// ---------------------------------------------------------------------------
// Biome output types (JSON reporter)
// ---------------------------------------------------------------------------

interface BiomeJsonDiagnostic {
	severity: string;
	message: string;
	category: string;
	location?: {
		path?: string;
		start?: { line?: number; column?: number };
		end?: { line?: number; column?: number };
	};
	advices?: unknown[];
}

interface BiomeJsonOutput {
	summary?: {
		errors?: number;
		warnings?: number;
		infos?: number;
		unchanged?: number;
	};
	diagnostics?: BiomeJsonDiagnostic[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parses biome's JSON stdout into structured diagnostics.
 * Biome writes JSON to stdout and a human-readable summary to stderr.
 */
function parseBiomeJson(stdout: string): BiomeDiagnostic[] {
	const results: BiomeDiagnostic[] = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		try {
			const parsed = JSON.parse(trimmed) as BiomeJsonOutput;
			for (const d of parsed.diagnostics ?? []) {
				const sev = d.severity?.toLowerCase();
				if (sev !== "error" && sev !== "warning" && sev !== "info") continue;
				results.push({
					file: d.location?.path ?? "",
					severity: sev as "error" | "warning" | "info",
					category: d.category ?? "",
					message: d.message ?? "",
					line: d.location?.start?.line ?? 1,
					column: d.location?.start?.column ?? 0,
					endLine: d.location?.end?.line ?? d.location?.start?.line ?? 1,
					endColumn: d.location?.end?.column ?? 0,
					hasFix: false,
				});
			}
			break;
		} catch {
			// not valid JSON — skip
		}
	}
	return results;
}

/**
 * Resolves the biome binary path relative to cwd.
 */
function biomeBin(cwd: string): string {
	return `${cwd}/node_modules/.bin/biome`;
}

/**
 * Runs `biome check --reporter=json <filePath>` and returns diagnostics.
 * Returns an empty array when biome is not installed or the file does not exist.
 */
export async function runBiomeCheck(
	filePath: string,
	cwd: string,
): Promise<BiomeDiagnostic[]> {
	const bin = biomeBin(cwd);
	try {
		const proc = Bun.spawn([bin, "check", "--reporter=json", filePath], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const stdout = await new Response(proc.stdout).text();
		await proc.exited;
		return parseBiomeJson(stdout);
	} catch {
		return [];
	}
}

/**
 * Runs `biome check --reporter=json .` on the whole project and returns diagnostics.
 */
export async function runBiomeCheckAll(
	cwd: string,
): Promise<BiomeDiagnostic[]> {
	const bin = biomeBin(cwd);
	try {
		const proc = Bun.spawn([bin, "check", "--reporter=json", "."], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const stdout = await new Response(proc.stdout).text();
		await proc.exited;
		return parseBiomeJson(stdout);
	} catch {
		return [];
	}
}

/** Formats a list of diagnostics into a human-readable string. */
export function formatDiagnostics(diagnostics: BiomeDiagnostic[]): string {
	return diagnostics
		.map(
			(d) =>
				`  [${d.severity.toUpperCase()}] ${d.file}:${d.line}:${d.column} — ${d.category}: ${d.message}`,
		)
		.join("\n");
}

// ---------------------------------------------------------------------------
// Issue #15: PostToolUse hook — runs biome after Write/Edit
// ---------------------------------------------------------------------------

export function createBiomePostToolUseHook(cwd: string): HookCallback {
	return async (input, _toolUseId, _options) => {
		const hookInput = input as PostToolUseHookInput;

		const toolInput = hookInput.tool_input as Record<string, unknown> | null;
		const filePath =
			toolInput && typeof toolInput.file_path === "string"
				? toolInput.file_path
				: null;

		if (!filePath) {
			return { continue: true };
		}

		const diagnostics = await runBiomeCheck(filePath, cwd);

		if (diagnostics.length === 0) {
			return { continue: true };
		}

		const errors = diagnostics.filter((d) => d.severity === "error");
		const warnings = diagnostics.filter((d) => d.severity === "warning");

		const parts: string[] = [];
		if (errors.length > 0) parts.push(`${errors.length} error(s)`);
		if (warnings.length > 0) parts.push(`${warnings.length} warning(s)`);

		const additionalContext =
			`Biome found ${parts.join(" and ")} in ${filePath}:\n` +
			formatDiagnostics(diagnostics);

		return {
			continue: true,
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext,
			},
		};
	};
}

// ---------------------------------------------------------------------------
// Issue #16: PreToolUse hook — git commit gate
// ---------------------------------------------------------------------------

export function createBiomeCommitGateHook(cwd: string): HookCallback {
	return async (input, _toolUseId, _options) => {
		const hookInput = input as PreToolUseHookInput;

		const toolInput = hookInput.tool_input as Record<string, unknown> | null;
		const command =
			toolInput && typeof toolInput.command === "string"
				? toolInput.command
				: "";

		if (!command.includes("git commit")) {
			return { continue: true };
		}

		const diagnostics = await runBiomeCheckAll(cwd);
		const errors = diagnostics.filter((d) => d.severity === "error");

		if (errors.length === 0) {
			return { continue: true };
		}

		const errorFiles = new Set(errors.map((d) => d.file));

		return {
			continue: false,
			reason: `Biome check failed. Fix ${errors.length} error(s) in ${errorFiles.size} file(s) before committing.\n${formatDiagnostics(errors)}`,
		};
	};
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBiomeHooks(
	config: AgentConfig,
	_otel: OtelContext,
): BiomeHooks {
	if (!config.enableBiomeHooks) {
		return {
			preToolUse: [],
			postToolUse: [],
			stop: [],
			preCompact: [],
		};
	}

	const cwd = config.projectDir;
	const postToolUseHook = createBiomePostToolUseHook(cwd);
	const commitGateHook = createBiomeCommitGateHook(cwd);

	return {
		preToolUse: [{ matcher: "Bash", hooks: [commitGateHook] }],
		postToolUse: [
			{ matcher: "Write", hooks: [postToolUseHook] },
			{ matcher: "Edit", hooks: [postToolUseHook] },
		],
		stop: [],
		preCompact: [],
	};
}
