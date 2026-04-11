import type { AgentType } from "../sdk-wrapper.js";

/**
 * Per-agent tool permission definitions.
 * Each agent type is granted the minimum set of tools required for its role.
 */
export const AGENT_TOOL_PERMISSIONS: Record<AgentType, string[]> = {
	// Initializer reads the spec, writes plan files, and runs setup commands
	initializer: ["Read", "Write", "Bash", "Glob", "Grep"],
	// Planner only reads the spec and writes the plan — no code execution
	planner: ["Read", "Write", "Glob", "Grep"],
	// Generator has full access to implement features
	generator: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
	// Evaluator reads code and runs tests but does not modify source files
	evaluator: ["Read", "Bash", "Glob", "Grep"],
	// Coding agent mirrors generator with full access
	coding: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
};

/**
 * Returns the allowed tool list for the given agent type.
 */
export function getAllowedTools(agentType: AgentType): string[] {
	return AGENT_TOOL_PERMISSIONS[agentType];
}
