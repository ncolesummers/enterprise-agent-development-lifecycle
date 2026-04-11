import { describe, expect, test } from "bun:test";
import type { PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import type { BiomeDiagnostic } from "../schemas/biome.js";
import { createBiomeHooks, runBiomeCheck } from "./biome.js";

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
