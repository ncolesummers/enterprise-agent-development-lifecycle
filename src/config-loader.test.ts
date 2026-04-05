import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZodError, ZodIssueCode } from "zod";
import {
	formatValidationErrors,
	loadConfigFile,
	mergeConfigs,
} from "./config-loader.js";

// ---------------------------------------------------------------------------
// loadConfigFile
// ---------------------------------------------------------------------------

describe("loadConfigFile", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "config-loader-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	test("returns parsed object for valid JSON file", async () => {
		const configPath = join(tempDir, "agent-config.json");
		await Bun.write(
			configPath,
			JSON.stringify({ projectDir: "/tmp/test", model: "claude-sonnet-4-6" }),
		);

		const result = await loadConfigFile(configPath);
		expect(result).toEqual({
			projectDir: "/tmp/test",
			model: "claude-sonnet-4-6",
		});
	});

	test("returns null when file does not exist", async () => {
		const result = await loadConfigFile(join(tempDir, "nonexistent.json"));
		expect(result).toBeNull();
	});

	test("throws on invalid JSON", async () => {
		const configPath = join(tempDir, "bad.json");
		await Bun.write(configPath, "{ not valid json }");

		await expect(loadConfigFile(configPath)).rejects.toThrow("invalid JSON");
	});

	test("throws when JSON content is an array", async () => {
		const configPath = join(tempDir, "array.json");
		await Bun.write(configPath, JSON.stringify([1, 2, 3]));

		await expect(loadConfigFile(configPath)).rejects.toThrow(
			"must contain a JSON object, got array",
		);
	});

	test("throws when JSON content is a string", async () => {
		const configPath = join(tempDir, "string.json");
		await Bun.write(configPath, JSON.stringify("hello"));

		await expect(loadConfigFile(configPath)).rejects.toThrow(
			"must contain a JSON object, got string",
		);
	});

	test("returns empty object for empty JSON object", async () => {
		const configPath = join(tempDir, "empty.json");
		await Bun.write(configPath, "{}");

		const result = await loadConfigFile(configPath);
		expect(result).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// mergeConfigs
// ---------------------------------------------------------------------------

describe("mergeConfigs", () => {
	test("CLI-sourced values override file config values", () => {
		const fileConfig = { model: "file-model", maxIterations: 5 };
		const cliValues = { model: "cli-model", maxIterations: 10 };
		const cliSources = { model: "cli", maxIterations: "cli" };

		const result = mergeConfigs(fileConfig, cliValues, cliSources);
		expect(result.model).toBe("cli-model");
		expect(result.maxIterations).toBe(10);
	});

	test("file config values used when CLI source is default", () => {
		const fileConfig = { model: "file-model", passThreshold: 8 };
		const cliValues = { model: "default-model", passThreshold: 6 };
		const cliSources = { model: "default", passThreshold: "default" };

		const result = mergeConfigs(fileConfig, cliValues, cliSources);
		expect(result.model).toBe("file-model");
		expect(result.passThreshold).toBe(8);
	});

	test("CLI defaults used when file config has no value for that key", () => {
		const fileConfig = { model: "file-model" };
		const cliValues = {
			model: "default-model",
			otelEndpoint: "http://localhost:4318",
		};
		const cliSources = { model: "default", otelEndpoint: "default" };

		const result = mergeConfigs(fileConfig, cliValues, cliSources);
		expect(result.model).toBe("file-model");
		expect(result.otelEndpoint).toBe("http://localhost:4318");
	});

	test("works when file config is null", () => {
		const cliValues = { projectDir: "/tmp/test", model: "claude-sonnet-4-6" };
		const cliSources = { projectDir: "cli", model: "default" };

		const result = mergeConfigs(null, cliValues, cliSources);
		expect(result.projectDir).toBe("/tmp/test");
		expect(result.model).toBe("claude-sonnet-4-6");
	});

	test("skips undefined CLI values", () => {
		const fileConfig = { model: "file-model" };
		const cliValues = { model: undefined, agent: undefined };
		const cliSources = { model: "default", agent: "default" };

		const result = mergeConfigs(
			fileConfig,
			cliValues as Record<string, unknown>,
			cliSources,
		);
		expect(result.model).toBe("file-model");
		expect("agent" in result).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// formatValidationErrors
// ---------------------------------------------------------------------------

describe("formatValidationErrors", () => {
	test("formats a single validation error", () => {
		const error = new ZodError([
			{
				code: ZodIssueCode.too_small,
				minimum: 1,
				type: "string",
				inclusive: true,
				message: "String must contain at least 1 character(s)",
				path: ["projectDir"],
			},
		]);

		const output = formatValidationErrors(error);
		expect(output).toContain("Invalid configuration:");
		expect(output).toContain(
			"projectDir: String must contain at least 1 character(s)",
		);
		expect(output).toContain("--help");
	});

	test("formats multiple validation errors", () => {
		const error = new ZodError([
			{
				code: ZodIssueCode.too_small,
				minimum: 1,
				type: "string",
				inclusive: true,
				message: "String must contain at least 1 character(s)",
				path: ["projectDir"],
			},
			{
				code: ZodIssueCode.too_big,
				maximum: 10,
				type: "number",
				inclusive: true,
				message: "Number must be less than or equal to 10",
				path: ["passThreshold"],
			},
		]);

		const output = formatValidationErrors(error);
		expect(output).toContain("projectDir:");
		expect(output).toContain("passThreshold:");
	});
});
