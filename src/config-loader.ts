import type { ZodError } from "zod";

// ---------------------------------------------------------------------------
// Config file loading
// ---------------------------------------------------------------------------

/**
 * Load and parse an agent-config.json file.
 * Returns the parsed object, or `null` if the file does not exist.
 * Throws on invalid JSON or if the file content is not a plain object.
 */
export async function loadConfigFile(
	configPath: string,
): Promise<Record<string, unknown> | null> {
	const file = Bun.file(configPath);

	if (!(await file.exists())) {
		return null;
	}

	let raw: unknown;
	try {
		raw = await file.json();
	} catch {
		throw new Error(
			`Failed to parse config file "${configPath}": invalid JSON`,
		);
	}

	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error(
			`Config file "${configPath}" must contain a JSON object, got ${Array.isArray(raw) ? "array" : typeof raw}`,
		);
	}

	return raw as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Config merging
// ---------------------------------------------------------------------------

/**
 * Merge CLI values with config file values.
 *
 * Priority: CLI-sourced values > file config values > Zod schema defaults.
 *
 * Only CLI values whose source is `"cli"` (i.e. explicitly passed by the user)
 * override file config values. Commander defaults are ignored in favor of
 * file config values when present.
 */
export function mergeConfigs(
	fileConfig: Record<string, unknown> | null,
	cliValues: Record<string, unknown>,
	cliSources: Record<string, string>,
): Record<string, unknown> {
	const base = fileConfig ?? {};
	const merged: Record<string, unknown> = { ...base };

	for (const [key, value] of Object.entries(cliValues)) {
		if (value === undefined) continue;
		if (cliSources[key] === "cli") {
			merged[key] = value;
		} else if (!(key in base)) {
			merged[key] = value;
		}
	}

	return merged;
}

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

/**
 * Format Zod validation errors into human-readable output.
 */
export function formatValidationErrors(error: ZodError): string {
	const lines = error.issues.map((issue) => {
		const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
		return `  ${path}: ${issue.message}`;
	});

	return `Invalid configuration:\n\n${lines.join("\n")}\n\nRun with --help for usage information.`;
}
