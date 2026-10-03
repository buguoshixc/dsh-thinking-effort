/**
 * The capability report: which routes can actually adjust thinking intensity.
 *
 * The question this answers is the one a user cannot otherwise ask. A model's
 * reasoning capability is decided in `@deepseek-ai/dsh-llm-pi-ai` by
 * `resolveModelReasoning`, whose first branch is
 * `if (efforts === undefined) return { reasoning: base?.reasoning ?? false }` —
 * and a hand-declared third-party route has no `base`, so its models are
 * silently non-reasoning and the composer offers no effort picker at all.
 *
 * Pure: the Node half feeds it the resolved `llm-pi-ai` section plus the
 * adapter's own "declared vs catalog" verdict; the browser card feeds it the
 * same section from its settings snapshot.
 *
 * @module dsh-thinking-effort/diagnose
 */

import { isPlainObject } from './json.ts'
import { THINKING_LEVELS, type LevelWire } from './presets.ts'
import type { ModelLike, PiAiSection, ProfileLike } from './types.ts'

/** Where a model's capability comes from. */
export type CapabilitySource =
  /** The profile declares `reasoningEfforts`; the picker offers exactly those levels. */
  | 'declared'
  /** `reasoningEfforts: false`; the model is marked as not reasoning at all. */
  | 'disabled'
  /** Nothing is declared: the installed catalog decides, or nothing does. */
  | 'inherit'

/** One model's adjustability. */
export interface ModelCapability {
  /** Model id. */
  id: string
  /** Whether the composer can offer thinking-intensity levels for this model. */
  adjustable: boolean
  /**
   * The levels the picker offers, in escalation order. Empty when the installed
   * catalog decides them (see `source: 'inherit'` on a catalog route).
   */
  levels: string[]
  /** How the capability was decided. */
  source: CapabilitySource
  /** The declared level-to-wire map, when the profile declares one. */
  declared?: Record<string, LevelWire>
  /** The pinned dispatch dialect, when the profile pins one. */
  thinkingFormat?: string
  /**
   * The declaration is present but `llm-pi-ai` would refuse it, so the route is
   * not actually serving these levels. One message per problem.
   */
  problems: string[]
}

/** One route's report. */
export interface RouteCapability {
  /** Provider route key. */
  provider: string
  /**
   * Whether the owning adapter knows this route only because configuration
   * declared it. `true` means no installed catalog entry can supply a
   * capability, so an absent declaration is definitively non-adjustable.
   */
  declared: boolean
  /** One entry per model the route serves. */
  models: ModelCapability[]
}

/**
 * The levels a declared map actually offers.
 *
 * Mirrors `@deepseek-ai/dsh-llm-pi-ai`'s own resolution: `off` is always
 * supported (`off: null` means "supported, send nothing"), every other level is
 * supported exactly when it names a wire spelling.
 *
 * @param declared - the profile's `reasoningEfforts` map.
 * @returns the offered levels, in escalation order.
 */
export function offeredLevels(declared: Record<string, LevelWire>): string[] {
  return THINKING_LEVELS.filter((level) =>
    level === 'off' || (declared[level] !== undefined && declared[level] !== null))
}

/**
 * The reasons `llm-pi-ai` would refuse a declared map.
 *
 * Duplicated from `src/presets.ts`'s validator on purpose: this report describes
 * a profile someone else may have written by hand, so it must judge a map that
 * arrived from the settings document rather than one this plugin built.
 *
 * @param declared - the profile's `reasoningEfforts` map.
 * @returns one message per problem; empty means the map resolves.
 */
function declaredProblems(declared: Record<string, LevelWire>): string[] {
  const problems: string[] = []
  const keys = Object.keys(declared)
  if (keys.length === 0) problems.push('reasoningEfforts 是空字典：要么声明档位，要么用 false 标为不支持推理。')
  for (const [level, wire] of Object.entries(declared)) {
    if (!(THINKING_LEVELS as readonly string[]).includes(level)) {
      problems.push(`reasoningEfforts 里的 "${level}" 不是可用的思考档位。`)
      continue
    }
    if (wire === null) {
      if (level !== 'off') problems.push(`reasoningEfforts.${level} 缺少要发送的值（只有 off 可以留空）。`)
    } else if (typeof wire !== 'string' || wire.length === 0) {
      problems.push(`reasoningEfforts.${level} 的发送值不能是空字符串。`)
    }
  }
  if (keys.length > 0 && !keys.some((level) => level !== 'off')) {
    problems.push('reasoningEfforts 只声明了 off：没有可选的思考档位。')
  }
  return problems
}

/**
 * Read one model's capability out of an effective profile.
 *
 * @param entry - the model entry.
 * @param routeDeclared - whether the route exists only because configuration declared it.
 * @returns the capability, including why it is not adjustable when it is not.
 */
export function modelCapability(entry: ModelLike, routeDeclared: boolean): ModelCapability {
  const efforts = entry.reasoningEfforts
  const compat = isPlainObject(entry.compat) ? entry.compat : undefined
  const thinkingFormat = compat !== undefined && typeof compat['thinkingFormat'] === 'string'
    ? compat['thinkingFormat']
    : undefined

  if (efforts === false) {
    return {
      id: entry.id,
      adjustable: false,
      levels: [],
      source: 'disabled',
      ...(thinkingFormat === undefined ? {} : { thinkingFormat }),
      problems: [],
    }
  }
  if (isPlainObject(efforts)) {
    const declared = efforts as Record<string, LevelWire>
    const problems = declaredProblems(declared)
    const levels = offeredLevels(declared)
    return {
      id: entry.id,
      adjustable: problems.length === 0 && levels.some((level) => level !== 'off'),
      levels,
      source: 'declared',
      declared,
      ...(thinkingFormat === undefined ? {} : { thinkingFormat }),
      problems,
    }
  }
  // No declaration. A catalog route inherits the installed entry's capability,
  // which this process cannot read from configuration alone; a hand-declared
  // route has nothing to inherit and is therefore definitively not adjustable.
  return {
    id: entry.id,
    adjustable: !routeDeclared,
    levels: [],
    source: 'inherit',
    ...(thinkingFormat === undefined ? {} : { thinkingFormat }),
    problems: routeDeclared
      ? ['未声明 reasoningEfforts，而该路由不在内置目录里，因此模型不支持推理等级：'
        + '这正是第三方 API Key 接入后无法调节思考强度的原因。']
      : [],
  }
}

/**
 * Report every route in the resolved `llm-pi-ai` section.
 *
 * @param section - the resolved section value (untrusted: it may be anything).
 * @param declaredRoutes - provider keys the adapter reports as configuration-declared only.
 * @returns one report per route, in configuration order.
 */
export function analyzeRoutes(
  section: unknown,
  declaredRoutes: Iterable<string> = [],
): RouteCapability[] {
  const declared = new Set(declaredRoutes)
  const providers = isPlainObject(section) && isPlainObject((section as PiAiSection).providers)
    ? (section as PiAiSection).providers as Record<string, ProfileLike>
    : {}
  return Object.entries(providers).map(([provider, profile]) => ({
    provider,
    declared: declared.has(provider),
    models: (Array.isArray(profile?.models) ? profile.models : [])
      .filter((entry): entry is ModelLike => isPlainObject(entry) && typeof entry.id === 'string')
      .map((entry) => modelCapability(entry, declared.has(provider))),
  }))
}

/**
 * Every route/model pair a user cannot adjust, as `provider/model` keys.
 *
 * @param routes - the reports from {@link analyzeRoutes}.
 * @returns the pairs whose thinking intensity is out of reach.
 */
export function unadjustable(routes: readonly RouteCapability[]): string[] {
  return routes.flatMap((route) =>
    route.models.filter((model) => !model.adjustable).map((model) => `${route.provider}/${model.id}`))
}
