/**
 * A faithful stand-in for the one harness package the built plugin imports at
 * module scope: `@deepseek-ai/dsh-tools`.
 *
 * `defineTool` is an identity helper with the interesting part in its *types* —
 * at runtime it returns the definition it was handed. Stubbing it keeps the
 * smoke test runnable outside a dsh installation (the real package resolves a
 * chain of harness-internal peers that a plugin repo has no business
 * installing), while still exercising every registration the plugin performs.
 *
 * The type-level contract is not stubbed away: `pnpm typecheck` compiles the
 * real `defineTool` signature from the installed devDependency.
 *
 * @module dsh-thinking-effort/test/dsh-tools-stub
 */

/**
 * Return the tool definition unchanged, exactly as the real helper does.
 *
 * @param options - the tool definition.
 * @returns the same object.
 */
export function defineTool(options) {
  return options
}

export default { defineTool }
