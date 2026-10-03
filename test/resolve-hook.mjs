/**
 * Module-customization hook that redirects the harness packages the built plugin
 * imports to local stubs, so `node --test` works without a dsh installation.
 *
 * Wired up by `test/register.mjs`, which the `test` script imports with
 * `--import`.
 *
 * @module dsh-thinking-effort/test/resolve-hook
 */

/** Bare specifier → the local module that stands in for it. */
const STUBS = new Map([
  ['@deepseek-ai/dsh-tools', new URL('./dsh-tools-stub.mjs', import.meta.url).href],
])

/**
 * Redirect a stubbed specifier, otherwise defer to the default resolver.
 *
 * @param specifier - the requested specifier.
 * @param context - the resolution context.
 * @param next - the default resolver.
 * @returns the resolution result.
 */
export async function resolve(specifier, context, next) {
  const stub = STUBS.get(specifier)
  if (stub !== undefined) return { url: stub, shortCircuit: true, format: 'module' }
  return next(specifier, context)
}
