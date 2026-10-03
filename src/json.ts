/**
 * JSON-shaped helpers shared by the pure planner and the browser card.
 *
 * Deliberately dependency-free: `src/plan.ts` and `src/diagnose.ts` are pure
 * modules that both the Node host half and the inlined browser bundle import,
 * and `test/` exercises them without a build step.
 *
 * @module dsh-thinking-effort/json
 */

/** Whether a value is a plain data object (not an array, null, or class instance). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Structural equality over JSON-compatible data. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((entry, index) => deepEqual(entry, b[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => key in right && deepEqual(left[key], right[key]))
}

/**
 * A copy of `source` without the listed own keys.
 *
 * Used to strip the fields a declaration owns when it is being removed, so the
 * rewrite does not carry a stale `reasoningEfforts` into the user layer.
 *
 * @param source - the object to copy.
 * @param keys - own keys to drop.
 * @returns a shallow copy without those keys.
 */
export function omit(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (!keys.includes(key)) out[key] = value
  }
  return out
}
