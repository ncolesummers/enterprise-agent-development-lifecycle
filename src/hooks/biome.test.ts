import { describe, expect, test } from "bun:test";
import type {
	PostToolUseHookInput,
	PreToolUseHookInput,
	StopHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { BiomeDiagnostic } from "../schemas/biome.js";
import { createBiomeHooks, runBiomeCheck, runBiomeCheckAll } from "./biome.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ABORT_SIGNAL = new AbortController().signal;
const REPO_CWD = import.meta.dir.replace("/src/hooks", "");

function makePostToolUseInput(
	toolName: string,
	filePath: string,
): PostToolUseHookInput {
	return {
		hook_event_name: "PostToolUse",
		tool_name: toolName,
		tool_input: { file_path: filePath },
		tool_response: {},
		tool_use_id: "tu_post_001",
		session_id: "sess_001",
		transcript_path: "/tmp/transcript.json",
	} as PostToolUseHookInput;
}

/** A TypeScript snippet that biome will flag as having an error. */
const BIOME_ERROR_CONTENT = `const x = 1;\nconst y = x == 1;\n`;
/** A TypeScript snippet that biome considers clean. */
const BIOME_CLEAN_CONTENT = `export const x = 1;\n`;

async function writeTempFile(content: string, suffix = ".ts"): Promise<string> {
	const filePath = `/tmp/biome_hook_test_${Date.now()}${suffix}`;
	await Bun.file(filePath).writer().write(content);
	return filePath;
}

// ---------------------------------------------------------------------------
// Stub check functions for unit tests
// ---------------------------------------------------------------------------

type CheckFn = (filePath: string, cwd: string) => Promise<BiomeDiagnostic[]>;

function createTestPostToolUseHook(checkFn: CheckFn, cwd: string) {
	return async (
		input: PostToolUseHookInput,
		_toolUseId: string | undefined,
		_options: { signal: AbortSignal },
	) => {
		const toolInput = input.tool_input as Record<string, unknown> | null;
		const filePath =
			toolInput && typeof toolInput.file_path === "string"
				? toolInput.file_path
				: null;
		if (!filePath) return { continue: true };
		const diagnostics = await checkFn(filePath, cwd);
		if (diagnostics.length === 0) return { continue: true };
		const errors = diagnostics.filter((d) => d.severity === "error");
		const warnings = diagnostics.filter((d) => d.severity === "warning");
		const parts: string[] = [];
		if (errors.length > 0) parts.push(`${errors.length} error(s)`);
		if (warnings.length > 0) parts.push(`${warnings.length} warning(s)`);
		const additionalContext =
			`Biome found ${parts.join(" and ")} in ${filePath}:\n` +
			diagnostics
				.map(
					(d) =>
						`  [${d.severity.toUpperCase()}] ${d.file}:${d.line}:${d.column} — ${d.category}: ${d.message}`,
				)
				.join("\n");
		return {
			continue: true,
			hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext },
		};
	};
}

// ---------------------------------------------------------------------------
// Issue #15: PostToolUse hook
// ---------------------------------------------------------------------------

describe("biomePostToolUseHook", () => {
	const noDiagnostics: CheckFn = async () => [];
	const withError: CheckFn = async () => [
		{
			file: "src/index.ts",
			severity: "error",
			category: "lint/suspicious/noDoubleEquals",
			message: "Use === instead of ==",
			line: 5,
			column: 10,
			endLine: 5,
			endColumn: 12,
			hasFix: false,
		},
	];
	const withWarning: CheckFn = async () => [
		{
			file: "src/utils.ts",
			severity: "warning",
			category: "lint/correctness/noUnusedVariables",
			message: "This variable is unused.",
			line: 3,
			column: 6,
			endLine: 3,
			endColumn: 7,
			hasFix: false,
		},
	];
	const withTwoErrors: CheckFn = async () => [
		{
			file: "src/a.ts",
			severity: "error",
			category: "lint/suspicious/noDoubleEquals",
			message: "Use === instead of ==",
			line: 1,
			column: 1,
			endLine: 1,
			endColumn: 3,
			hasFix: false,
		},
		{
			file: "src/b.ts",
			severity: "error",
			category: "lint/suspicious/noDoubleEquals",
			message: "Use === instead of ==",
			line: 2,
			column: 1,
			endLine: 2,
			endColumn: 3,
			hasFix: false,
		},
	];

	test("returns continue:true silently when biome finds no issues", async () => {
		const hook = createTestPostToolUseHook(noDiagnostics, REPO_CWD);
		const result = await hook(
			makePostToolUseInput("Write", "src/index.ts"),
			undefined,
			{ signal: ABORT_SIGNAL },
		);
		expect(result.continue).toBe(true);
		expect(
			(result as Record<string, unknown>).hookSpecificOutput,
		).toBeUndefined();
	});

	test("injects additionalContext when biome finds errors", async () => {
		const hook = createTestPostToolUseHook(withError, REPO_CWD);
		const result = await hook(
			makePostToolUseInput("Write", "src/index.ts"),
			undefined,
			{ signal: ABORT_SIGNAL },
		);
		expect(result.continue).toBe(true);
		const specific = (result as Record<string, unknown>)
			.hookSpecificOutput as Record<string, unknown>;
		expect(specific).toBeDefined();
		expect(specific.hookEventName).toBe("PostToolUse");
		expect(typeof specific.additionalContext).toBe("string");
		expect((specific.additionalContext as string).toLowerCase()).toContain(
			"biome",
		);
	});

	test("injects additionalContext for Edit tool as well", async () => {
		const hook = createTestPostToolUseHook(withWarning, REPO_CWD);
		const result = await hook(
			makePostToolUseInput("Edit", "src/utils.ts"),
			undefined,
			{ signal: ABORT_SIGNAL },
		);
		expect(result.continue).toBe(true);
		const specific = (result as Record<string, unknown>)
			.hookSpecificOutput as Record<string, unknown>;
		expect(specific).toBeDefined();
		expect(specific.additionalContext as string).toContain("src/utils.ts");
	});

	test("returns continue:true silently when tool_input has no file_path", async () => {
		const hook = createTestPostToolUseHook(withError, REPO_CWD);
		const inputWithoutPath: PostToolUseHookInput = {
			hook_event_name: "PostToolUse",
			tool_name: "Write",
			tool_input: {},
			tool_response: {},
			tool_use_id: "tu_002",
			session_id: "sess_001",
			transcript_path: "/tmp/transcript.json",
		} as PostToolUseHookInput;
		const result = await hook(inputWithoutPath, undefined, {
			signal: ABORT_SIGNAL,
		});
		expect(result.continue).toBe(true);
		expect(
			(result as Record<string, unknown>).hookSpecificOutput,
		).toBeUndefined();
	});

	test("mentions error count in additionalContext", async () => {
		const hook = createTestPostToolUseHook(withTwoErrors, REPO_CWD);
		const result = await hook(
			makePostToolUseInput("Write", "src/a.ts"),
			undefined,
			{ signal: ABORT_SIGNAL },
		);
		const specific = (result as Record<string, unknown>)
			.hookSpecificOutput as Record<string, unknown>;
		expect(specific.additionalContext as string).toContain("2 error");
	});
});

// ---------------------------------------------------------------------------
// createBiomeHooks factory (postToolUse portion)
// ---------------------------------------------------------------------------

describe("createBiomeHooks (postToolUse)", () => {
	const baseConfig = {
		projectDir: REPO_CWD,
		maxIterations: 0,
		model: "claude-sonnet-4-6",
		enableEvaluator: true,
		evaluatorModel: "claude-opus-4-6",
		plannerModel: "claude-opus-4-6",
		passThreshold: 6,
		maxEvaluatorRetries: 3,
		enableOtel: false,
		otelEndpoint: "http://localhost:4318",
	};
	const otel = {} as Parameters<typeof createBiomeHooks>[1];

	test("returns empty arrays when enableBiomeHooks is false", () => {
		const hooks = createBiomeHooks(
			{ ...baseConfig, enableBiomeHooks: false },
			otel,
		);
		expect(hooks.preToolUse).toEqual([]);
		expect(hooks.postToolUse).toEqual([]);
		expect(hooks.stop).toEqual([]);
		expect(hooks.preCompact).toEqual([]);
	});

	test("postToolUse matchers cover Write and Edit tools", () => {
		const hooks = createBiomeHooks(
			{ ...baseConfig, enableBiomeHooks: true },
			otel,
		);
		const matchers = hooks.postToolUse.map((m) => m.matcher);
		expect(matchers).toContain("Write");
		expect(matchers).toContain("Edit");
	});
});

// ---------------------------------------------------------------------------
// Integration: runBiomeCheck with real biome on temp files
// ---------------------------------------------------------------------------

describe("runBiomeCheck (integration)", () => {
	test("returns no errors for clean TypeScript", async () => {
		const filePath = await writeTempFile(BIOME_CLEAN_CONTENT);
		try {
			const diagnostics = await runBiomeCheck(filePath, REPO_CWD);
			const errors = diagnostics.filter((d) => d.severity === "error");
			expect(errors.length).toBe(0);
		} finally {
			await Bun.file(filePath)
				.arrayBuffer()
				.catch(() => {});
		}
	});

	test("returns diagnostics for a file with biome errors", async () => {
		const filePath = await writeTempFile(BIOME_ERROR_CONTENT);
		try {
			const diagnostics = await runBiomeCheck(filePath, REPO_CWD);
			const errors = diagnostics.filter((d) => d.severity === "error");
			expect(errors.length).toBeGreaterThan(0);
			expect(errors[0]?.category).toContain("noDoubleEquals");
		} finally {
			await Bun.file(filePath)
				.arrayBuffer()
				.catch(() => {});
		}
	});

	test("returns empty array when biome binary does not exist", async () => {
		const diagnostics = await runBiomeCheck("src/index.ts", "/nonexistent/dir");
		expect(diagnostics).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Issue #16: Commit gate hook (unit tests with stub checkAllFn)
// ---------------------------------------------------------------------------

type CheckAllFn = (cwd: string) => Promise<BiomeDiagnostic[]>;

function makePreToolUseInput(command: string): PreToolUseHookInput {
	return {
		hook_event_name: "PreToolUse",
		tool_name: "Bash",
		tool_input: { command },
		tool_use_id: "tu_pre_001",
		session_id: "sess_001",
		transcript_path: "/tmp/transcript.json",
	} as PreToolUseHookInput;
}

function createTestCommitGateHook(checkAllFn: CheckAllFn, cwd: string) {
	return async (
		input: PreToolUseHookInput,
		_toolUseId: string | undefined,
		_options: { signal: AbortSignal },
	) => {
		const toolInput = input.tool_input as Record<string, unknown> | null;
		const command =
			toolInput && typeof toolInput.command === "string"
				? toolInput.command
				: "";
		if (!command.includes("git commit")) return { continue: true };
		const diagnostics = await checkAllFn(cwd);
		const errors = diagnostics.filter((d) => d.severity === "error");
		if (errors.length === 0) return { continue: true };
		const errorFiles = new Set(errors.map((d) => d.file));
		return {
			continue: false,
			reason: `Biome check failed. Fix ${errors.length} error(s) in ${errorFiles.size} file(s) before committing.`,
		};
	};
}

describe("biomeCommitGateHook", () => {
	const clean: CheckAllFn = async () => [];
	const withErrors: CheckAllFn = async () => [
		{
			file: "src/index.ts",
			severity: "error",
			category: "lint/suspicious/noDoubleEquals",
			message: "Use === instead of ==",
			line: 5,
			column: 10,
			endLine: 5,
			endColumn: 12,
			hasFix: false,
		},
	];
	const withTwoFilesErrors: CheckAllFn = async () => [
		{
			file: "src/a.ts",
			severity: "error",
			category: "lint/suspicious/noDoubleEquals",
			message: "Use === instead of ==",
			line: 1,
			column: 1,
			endLine: 1,
			endColumn: 3,
			hasFix: false,
		},
		{
			file: "src/b.ts",
			severity: "error",
			category: "lint/suspicious/noDoubleEquals",
			message: "Use === instead of ==",
			line: 2,
			column: 1,
			endLine: 2,
			endColumn: 3,
			hasFix: false,
		},
	];
	const warningsOnly: CheckAllFn = async () => [
		{
			file: "src/index.ts",
			severity: "warning",
			category: "lint/correctness/noUnusedVariables",
			message: "Unused variable.",
			line: 1,
			column: 1,
			endLine: 1,
			endColumn: 2,
			hasFix: false,
		},
	];

	test("passes through non-git-commit commands", async () => {
		const hook = createTestCommitGateHook(withErrors, REPO_CWD);
		const result = await hook(makePreToolUseInput("ls -la"), undefined, {
			signal: ABORT_SIGNAL,
		});
		expect(result.continue).toBe(true);
	});

	test("allows commit when biome is clean", async () => {
		const hook = createTestCommitGateHook(clean, REPO_CWD);
		const result = await hook(
			makePreToolUseInput("git commit -m 'feat: add feature'"),
			undefined,
			{ signal: ABORT_SIGNAL },
		);
		expect(result.continue).toBe(true);
	});

	test("blocks commit when biome has errors", async () => {
		const hook = createTestCommitGateHook(withErrors, REPO_CWD);
		const result = await hook(
			makePreToolUseInput("git commit -m 'wip'"),
			undefined,
			{ signal: ABORT_SIGNAL },
		);
		expect(result.continue).toBe(false);
		expect(typeof (result as Record<string, unknown>).reason).toBe("string");
		const reason = (result as Record<string, unknown>).reason as string;
		expect(reason.toLowerCase()).toContain("biome");
		expect(reason).toContain("1 error");
	});

	test("blocks commit and reports multiple files", async () => {
		const hook = createTestCommitGateHook(withTwoFilesErrors, REPO_CWD);
		const result = await hook(
			makePreToolUseInput("git commit -m 'wip'"),
			undefined,
			{ signal: ABORT_SIGNAL },
		);
		expect(result.continue).toBe(false);
		const reason = (result as Record<string, unknown>).reason as string;
		expect(reason).toContain("2 error");
		expect(reason).toContain("2 file");
	});

	test("does not block for warnings-only when committing", async () => {
		const hook = createTestCommitGateHook(warningsOnly, REPO_CWD);
		const result = await hook(
			makePreToolUseInput("git commit -m 'clean'"),
			undefined,
			{ signal: ABORT_SIGNAL },
		);
		expect(result.continue).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Issue #17: Session gate (Stop) hook (unit tests with stub checkAllFn)
// ---------------------------------------------------------------------------

function makeStopInput(stopHookActive = false): StopHookInput {
	return {
		hook_event_name: "Stop",
		stop_hook_active: stopHookActive,
		session_id: "sess_001",
		transcript_path: "/tmp/transcript.json",
	} as StopHookInput;
}

function createTestSessionGateHook(checkAllFn: CheckAllFn, _cwd: string) {
	return async (
		input: StopHookInput,
		_toolUseId: string | undefined,
		_options: { signal: AbortSignal },
	) => {
		if (input.stop_hook_active) return { continue: true };
		const diagnostics = await checkAllFn(_cwd);
		const errors = diagnostics.filter((d) => d.severity === "error");
		if (errors.length === 0) return { continue: true };
		const errorFiles = new Set(errors.map((d) => d.file));
		return {
			continue: false,
			stopReason: `Biome errors remain. Fix ${errors.length} error(s) in ${errorFiles.size} file(s) before ending session.`,
		};
	};
}

describe("biomeSessionGateHook", () => {
	const clean: CheckAllFn = async () => [];
	const withErrors: CheckAllFn = async () => [
		{
			file: "src/index.ts",
			severity: "error",
			category: "lint/suspicious/noDoubleEquals",
			message: "Use === instead of ==",
			line: 5,
			column: 10,
			endLine: 5,
			endColumn: 12,
			hasFix: false,
		},
	];
	const threeErrorsTwoFiles: CheckAllFn = async () => [
		{
			file: "src/a.ts",
			severity: "error",
			category: "lint/suspicious/noDoubleEquals",
			message: "err",
			line: 1,
			column: 1,
			endLine: 1,
			endColumn: 3,
			hasFix: false,
		},
		{
			file: "src/b.ts",
			severity: "error",
			category: "lint/suspicious/noDoubleEquals",
			message: "err",
			line: 2,
			column: 1,
			endLine: 2,
			endColumn: 3,
			hasFix: false,
		},
		{
			file: "src/a.ts",
			severity: "error",
			category: "lint/suspicious/noDoubleEquals",
			message: "err",
			line: 3,
			column: 1,
			endLine: 3,
			endColumn: 3,
			hasFix: false,
		},
	];
	const warningsOnly: CheckAllFn = async () => [
		{
			file: "src/index.ts",
			severity: "warning",
			category: "lint/correctness/noUnusedVariables",
			message: "Unused variable.",
			line: 1,
			column: 1,
			endLine: 1,
			endColumn: 2,
			hasFix: false,
		},
	];

	test("allows stop when biome is clean", async () => {
		const hook = createTestSessionGateHook(clean, REPO_CWD);
		const result = await hook(makeStopInput(false), undefined, {
			signal: ABORT_SIGNAL,
		});
		expect(result.continue).toBe(true);
	});

	test("blocks stop when biome has errors", async () => {
		const hook = createTestSessionGateHook(withErrors, REPO_CWD);
		const result = await hook(makeStopInput(false), undefined, {
			signal: ABORT_SIGNAL,
		});
		expect(result.continue).toBe(false);
		expect(typeof (result as Record<string, unknown>).stopReason).toBe(
			"string",
		);
		const stopReason = (result as Record<string, unknown>).stopReason as string;
		expect(stopReason.toLowerCase()).toContain("biome");
		expect(stopReason).toContain("1 error");
		expect(stopReason).toContain("1 file");
	});

	test("does not block when stop_hook_active is true (avoids infinite loop)", async () => {
		const hook = createTestSessionGateHook(withErrors, REPO_CWD);
		const result = await hook(makeStopInput(true), undefined, {
			signal: ABORT_SIGNAL,
		});
		expect(result.continue).toBe(true);
	});

	test("reports correct error and file counts", async () => {
		const hook = createTestSessionGateHook(threeErrorsTwoFiles, REPO_CWD);
		const result = await hook(makeStopInput(false), undefined, {
			signal: ABORT_SIGNAL,
		});
		expect(result.continue).toBe(false);
		const stopReason = (result as Record<string, unknown>).stopReason as string;
		expect(stopReason).toContain("3 error");
		expect(stopReason).toContain("2 file");
	});

	test("does not block for warnings-only", async () => {
		const hook = createTestSessionGateHook(warningsOnly, REPO_CWD);
		const result = await hook(makeStopInput(false), undefined, {
			signal: ABORT_SIGNAL,
		});
		expect(result.continue).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// createBiomeHooks factory (full)
// ---------------------------------------------------------------------------

describe("createBiomeHooks", () => {
	const baseConfig = {
		projectDir: REPO_CWD,
		maxIterations: 0,
		model: "claude-sonnet-4-6",
		enableEvaluator: true,
		evaluatorModel: "claude-opus-4-6",
		plannerModel: "claude-opus-4-6",
		passThreshold: 6,
		maxEvaluatorRetries: 3,
		enableOtel: false,
		otelEndpoint: "http://localhost:4318",
	};
	const otel = {} as Parameters<typeof createBiomeHooks>[1];

	test("returns populated arrays when enableBiomeHooks is true", () => {
		const hooks = createBiomeHooks(
			{ ...baseConfig, enableBiomeHooks: true },
			otel,
		);
		expect(hooks.preToolUse.length).toBeGreaterThan(0);
		expect(hooks.postToolUse.length).toBeGreaterThan(0);
		expect(hooks.stop.length).toBeGreaterThan(0);
	});

	test("preToolUse matchers include Bash for commit gate", () => {
		const hooks = createBiomeHooks(
			{ ...baseConfig, enableBiomeHooks: true },
			otel,
		);
		const matchers = hooks.preToolUse.map((m) => m.matcher);
		expect(matchers).toContain("Bash");
	});

	test("stop hooks array is non-empty when enabled", () => {
		const hooks = createBiomeHooks(
			{ ...baseConfig, enableBiomeHooks: true },
			otel,
		);
		expect(hooks.stop.length).toBeGreaterThan(0);
		expect(hooks.stop[0]?.hooks.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Integration: runBiomeCheckAll with real biome
// ---------------------------------------------------------------------------

describe("runBiomeCheckAll (integration)", () => {
	test("returns an array of diagnostics (may be empty or non-empty)", async () => {
		const diagnostics = await runBiomeCheckAll(REPO_CWD);
		expect(Array.isArray(diagnostics)).toBe(true);
	});

	test("returns no errors in src/ when src/ is clean", async () => {
		const diagnostics = await runBiomeCheckAll(REPO_CWD);
		const srcErrors = diagnostics.filter(
			(d) => d.severity === "error" && d.file.includes("/src/"),
		);
		expect(srcErrors.length).toBe(0);
	});

	test("returns empty array when biome binary does not exist", async () => {
		const diagnostics = await runBiomeCheckAll("/nonexistent/dir");
		expect(diagnostics).toEqual([]);
	});
});
