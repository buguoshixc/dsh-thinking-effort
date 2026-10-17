/**
 * The single planner both halves of this plugin use.
 *
 * A "declaration" is an edit to the `llm-pi-ai` section that gives a model a
 * thinking-intensity capability. This module turns one into the exact partial
 * profile to merge into that section's user layer — and, just as importantly,
 * refuses the edits `@deepseek-ai/dsh-llm-pi-ai` would refuse *after* they were
 * already persisted, so a bad declaration never silently disables a route.
 *
 * Pure by construction: no cordis, no settings, no I/O. The Node half applies
 * the result through `ctx.settings`; the browser half applies the same result
 * through `ctx.configForms`; `test/planner.test.mjs` pins the behaviour of both.
 *
 * ## Why the write takes one of two shapes
 *
 * `llm-pi-ai` stores routes as a `providers` dict, and its `models` array is
 * replaced wholesale while `modelOverrides` is a dict. So:
 *
 * - a route with a non-empty `models` list (every hand-declared third-party
 *   route) is edited by rewriting that list in full, preserving every entry and
 *   every field this plugin does not own;
 * - a route that inherits the installed catalog is edited through
 *   `modelOverrides`, a dict — one model id at a time, without narrowing the
 *   rest of the dict.
 *
 * @module dsh-thinking-effort/plan
 */

import { deepEqual, isPlainObject, omit } from './json.ts'
import {
  findPreset,
  normalizeLevels,
  validateLevels,
  type LevelMap,
  type LevelWire,
} from './presets.ts'
import type { Declaration, ModelLike, ProfileLike, SettingsPathOp } from './types.ts'

/** Model fields a declaration owns; a removal strips exactly these. */
const OWNED_MODEL_FIELDS = ['reasoningEfforts'] as const

/** The model-level `compat` switch a declaration owns. */
const OWNED_COMPAT_FIELDS = ['thinkingFormat'] as const

/** One planned edit. */
export interface PlanResult {
  /** Whether the edit is well-formed and applicable. */
  ok: boolean
  /** One message per reason the edit was refused; empty when `ok`. */
  problems: string[]
  /** Non-fatal observations worth surfacing to the user. */
  notes: string[]
  /**
   * The `providers.<provider>` partial to merge into the `llm-pi-ai` user
   * layer. Empty when the plan is refused or already satisfied.
   */
  patch: Record<string, unknown>
  /** The resolved profile already carries exactly this declaration. */
  unchanged: boolean
}

/**
 * Turn a plan patch into path ops that touch exactly one route.
 *
 * Path ops land on the user layer and replace the value at their own leaf, so
 * sibling routes and unowned fields survive without a read-modify-write. The
 * one decomposition that matters is `modelOverrides`: setting the whole dict
 * would drop overrides for models this edit does not touch, so each model id
 * gets its own op.
 *
 * This is deliberately *not* `settings.update`: that merges objects
 * recursively, so rewriting a catalog route's override entry would keep a
 * stale `reasoningEfforts` or `compat.thinkingFormat` the plan dropped.
 *
 * @param provider - provider route key.
 * @param patch - the `providers.<provider>` partial from {@link planDeclaration}.
 * @returns ordered path ops, never empty for a non-empty patch.
 */
export function settingsOps(provider: string, patch: Record<string, unknown>): SettingsPathOp[] {
  const base = ['providers', provider]
  const ops: SettingsPathOp[] = []
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'modelOverrides' && isPlainObject(value)) {
      for (const [modelId, entry] of Object.entries(value)) {
        ops.push({ op: 'set', path: [...base, 'modelOverrides', modelId], value: entry })
      }
      continue
    }
    ops.push({ op: 'set', path: [...base, field], value })
  }
  return ops
}

/** The input of {@link planDeclaration}. */
export interface PlanInput {
  /** Provider route key, e.g. `qiyuan`. */
  provider: string
  /** Model id within that route, e.g. `deepseek-v4.1`. */
  modelId: string
  /** What the user asked for. */
  declaration: Declaration
  /**
   * The route's *effective* profile — the resolved `llm-pi-ai` section's
   * `providers.<provider>`, after schema defaults, the composition base layer
   * and the user layer have been merged.
   */
  profile: ProfileLike | undefined
}

/** The levels and dialect a declaration resolves to, before any route is consulted. */
interface ResolvedIntent {
  /** The levels to declare; empty means "leave the level map alone". */
  levels: LevelMap
  /** The dialect to pin; `undefined` means "leave compat alone". */
  thinkingFormat: string | undefined
}

/**
 * Resolve a declaration's own intent, without looking at any route.
 *
 * Split out from the route work because a malformed preset or level map is the
 * user's mistake and deserves a message that names the level, not the route.
 *
 * @param declaration - the requested edit.
 * @returns the resolved intent, plus the problems that make it unusable.
 */
function resolveIntent(declaration: Declaration): { intent: ResolvedIntent; problems: string[] } {
  const problems: string[] = []
  const presetId = declaration.preset
  const preset = presetId === undefined ? undefined : findPreset(presetId)
  const named = presetId !== undefined && presetId !== 'custom' && presetId !== 'inherit'
  if (named && preset === undefined) {
    problems.push(`未知的预设 "${String(presetId)}"：用 /thinking presets 查看可用方言。`)
  }

  let levels: LevelMap = {}
  if (declaration.levels !== undefined) levels = normalizeLevels(declaration.levels)
  else if (preset !== undefined) levels = { ...preset.levels }

  const thinkingFormat = declaration.thinkingFormat ?? preset?.thinkingFormat

  if (!declaration.remove) {
    if (Object.keys(levels).length > 0) problems.push(...validateLevels(levels))
    const pinsSomething = Object.keys(levels).length > 0
      || thinkingFormat !== undefined
      || declaration.defaultEffort !== undefined
      || declaration.thinkingBudgets !== undefined
    if (!pinsSomething) {
      problems.push('声明为空：至少要给出 preset、levels、thinkingFormat、defaultEffort 或 thinkingBudgets 之一。')
    }
  }
  return { intent: { levels, thinkingFormat }, problems }
}

/** Whether two declared level maps say the same thing. */
function sameLevels(current: unknown, desired: LevelMap): boolean {
  if (current === undefined) return Object.keys(desired).length === 0
  if (current === false || current === null || !isPlainObject(current)) return false
  return deepEqual(normalizeLevels(current as Record<string, LevelWire>), desired)
}

/**
 * Merge the owned model fields onto one entry.
 *
 * `compat.thinkingFormat` is owned outright, in both directions: a declaration
 * that names a dialect pins it, and one that names none *clears* it, because
 * "no dialect" means "let pi-ai detect the endpoint". Leaving a previous pin in
 * place would make switching from a pinning preset to a non-pinning one a silent
 * no-op — the one failure this module exists to prevent.
 *
 * @param entry - the model entry being edited.
 * @param declaration - the requested edit.
 * @param desiredModel - the owned fields to write, empty for a removal.
 * @param desiredCompat - the dialect to pin, or `undefined` to clear any pin.
 * @returns the next entry, carrying every unowned field through untouched.
 */
function nextModelEntry(
  entry: ModelLike,
  declaration: Declaration,
  desiredModel: Record<string, unknown>,
  desiredCompat: string | undefined,
): Record<string, unknown> {
  const raw = entry as unknown as Record<string, unknown>
  if (declaration.remove) {
    const stripped = omit(raw, OWNED_MODEL_FIELDS)
    const compat = stripOwned(stripped['compat'], OWNED_COMPAT_FIELDS)
    return compat === undefined ? omit(stripped, ['compat']) : { ...stripped, compat }
  }
  const next: Record<string, unknown> = { ...raw, ...desiredModel }
  if (desiredCompat !== undefined) {
    next['compat'] = {
      ...(isPlainObject(raw['compat']) ? raw['compat'] : {}),
      thinkingFormat: desiredCompat,
    }
  } else {
    // No dialect named by the declaration, so any pin this plugin (or a hand
    // edit) left behind must go: "no dialect" means "let pi-ai detect".
    const compat = stripOwned(raw['compat'], OWNED_COMPAT_FIELDS)
    if (compat === undefined) delete next['compat']
    else next['compat'] = compat
  }
  return next
}

/**
 * Strip the keys a removal owns, dropping the container when it empties.
 *
 * @param value - the map being cleaned, e.g. a model's `compat`.
 * @param keys - owned keys to drop.
 * @returns the cleaned map, or `undefined` when nothing is left.
 */
function stripOwned(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined
  const next = omit(value, keys)
  return Object.keys(next).length === 0 ? undefined : next
}

/** The `compat.thinkingFormat` currently in force on a model-shaped object. */
function currentFormat(entry: Record<string, unknown> | ModelLike): unknown {
  const compat = (entry as Record<string, unknown>)['compat']
  return isPlainObject(compat) ? compat['thinkingFormat'] : undefined
}

/** Whether a model-shaped object already carries exactly the declaration. */
function modelMatches(
  entry: Record<string, unknown> | ModelLike,
  declaration: Declaration,
  desired: LevelMap,
  desiredCompat: string | undefined,
): boolean {
  const reasoning = (entry as Record<string, unknown>)['reasoningEfforts']
  if (declaration.remove) return reasoning === undefined && currentFormat(entry) === undefined
  return sameLevels(reasoning, desired) && deepEqual(currentFormat(entry), desiredCompat)
}

/**
 * Plan one declaration against one route.
 *
 * @param input - the provider, model, requested declaration and effective profile.
 * @returns the patch to merge, plus any reason it was refused.
 */
export function planDeclaration(input: PlanInput): PlanResult {
  const { provider, modelId, declaration, profile } = input
  const refuse = (problems: string[]): PlanResult =>
    ({ ok: false, problems, notes: [], patch: {}, unchanged: false })

  const { intent, problems } = resolveIntent(declaration)
  if (profile === undefined) {
    problems.push(`路由 "${provider}" 尚未配置：先在 设置 → 模型 或 cordis.patch.yml 里添加它。`)
    return refuse(problems)
  }
  if (problems.length > 0) return refuse(problems)

  const notes: string[] = []
  const patch: Record<string, unknown> = {}
  const desiredModel: Record<string, unknown> = {}
  const declareLevels = !declaration.remove && Object.keys(intent.levels).length > 0
  if (declareLevels) desiredModel['reasoningEfforts'] = intent.levels
  const desiredCompat = declaration.remove ? undefined : intent.thinkingFormat

  // Route-level fields are diffed rather than written unconditionally: `update`
  // merges, so restating a value the profile already carries would be a no-op
  // that still counted as a change and defeated the unchanged short-circuit.
  if (!declaration.remove) {
    if (declaration.defaultEffort !== undefined && profile['reasoning'] !== declaration.defaultEffort) {
      patch['reasoning'] = declaration.defaultEffort
    }
    if (declaration.thinkingBudgets !== undefined
      && !deepEqual(profile['thinkingBudgets'], declaration.thinkingBudgets)) {
      patch['thinkingBudgets'] = declaration.thinkingBudgets
    }
  }

  const models = Array.isArray(profile.models) ? profile.models : []
  if (models.length > 0) {
    // Hand-declared or narrowed route: the models array is the only writable
    // home, and its entries must survive the rewrite intact.
    const index = models.findIndex((entry) => entry?.id === modelId)
    if (index < 0) {
      return refuse([`路由 "${provider}" 的 models 列表里没有 "${modelId}"。`])
    }
    const current = models[index] as ModelLike
    const matched = modelMatches(current, declaration, intent.levels, desiredCompat)
    if (matched && Object.keys(patch).length === 0) {
      return { ok: true, problems: [], notes: [], patch: {}, unchanged: true }
    }
    if (!matched) {
      patch['models'] = models.map((entry, at) =>
        (at === index ? nextModelEntry(entry, declaration, desiredModel, desiredCompat) : entry))
      notes.push(`将重写 "${provider}" 的 models 列表（共 ${models.length} 项，其余条目原样保留）。`)
    }
    return { ok: true, problems: [], notes, patch, unchanged: false }
  }

  // Catalog route: a dict override merges and never narrows the served catalog.
  const overrides = isPlainObject(profile.modelOverrides) ? profile.modelOverrides : {}
  const currentOverride = isPlainObject(overrides[modelId]) ? overrides[modelId] : {}
  const matched = modelMatches(currentOverride, declaration, intent.levels, desiredCompat)
  if (matched && Object.keys(patch).length === 0) {
    return { ok: true, problems: [], notes: [], patch: {}, unchanged: true }
  }
  if (!matched) {
    patch['modelOverrides'] = {
      [modelId]: nextModelEntry(
        currentOverride as ModelLike,
        declaration,
        desiredModel,
        desiredCompat,
      ),
    }
    notes.push(`路由 "${provider}" 沿用内置目录，因此通过 modelOverrides 覆盖 "${modelId}"。`)
  }
  return { ok: true, problems: [], notes, patch, unchanged: false }
}
