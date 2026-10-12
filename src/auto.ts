/**
 * Automatic adaptation: work out a declaration for every route nobody has
 * declared one on, so adding a third-party API key needs no follow-up command.
 *
 * ## Why this module exists, and what it refuses to do
 *
 * `/thinking set` asks a human which dialect an endpoint speaks. That question
 * cannot be answered from configuration — which values a gateway accepts is only
 * discoverable by talking to it — so the plugin has always made it an explicit
 * choice. Auto-adaptation does not overturn that: it answers the question
 * *conservatively*, from evidence that is already in the configuration, and says
 * out loud which answer it gave.
 *
 * The evidence is the route's own `compat` / endpoint plus the adapter's
 * "declared vs installed catalog" verdict:
 *
 * - a route pi-ai already believes takes `reasoning_effort` gets the safest
 *   preset that still sends it, and the widest honest choice of levels;
 * - a route pi-ai believes does *not* take it gets the preset that cannot trip a
 *   strict parser, so adaptation degrades instead of breaking requests;
 * - a route whose endpoint matches a vendor this plugin recognises gets that
 *   vendor's dialect, which is the same inference `/thinking explain` already
 *   prints.
 *
 * ## Why the result is a plan, not a write
 *
 * This module is pure, like `plan.ts` and `diagnose.ts`: it produces the list of
 * declarations to apply and the list of reasons it could not, and the Node half
 * (`src/index.ts`) performs the writes with the same revision-fenced merge the
 * command uses. Purity is what makes the interesting branch — "which preset does
 * a route with this shape get" — testable without a settings service.
 *
 * @module dsh-thinking-effort/auto
 */

import { isPlainObject } from './json.ts'
import { AUTO_EXCLUDED_PRESET, AUTO_FALLBACK_PRESET, presetOrDefault } from './presets.ts'
import type { ModelLike, PiAiSection, ProfileLike } from './types.ts'
import { detectsThinkingFormat, resolveSupportsReasoningEffort } from './wire.ts'

// Re-exported so a caller reasoning about auto-adaptation needs only this module;
// the values themselves live in `presets.ts` with the rest of the vocabulary.
export { AUTO_EXCLUDED_PRESET, AUTO_FALLBACK_PRESET }

/**
 * The preset pi-ai's own endpoint detection justifies for a route.
 *
 * Ordered most specific first. A route whose wire dialect pi-ai would detect as
 * `openai` has no vendor signal worth pinning, so it falls through to nothing —
 * the caller's own default decides for it.
 *
 * @param provider - the provider route key.
 * @param baseURL - the route's endpoint, when it has one.
 * @returns a preset id, or `undefined` when detection justifies none.
 */
export function detectedPreset(provider: string, baseURL: string | undefined): string | undefined {
  const dialect = detectsThinkingFormat(provider, baseURL)
  if (dialect === 'deepseek') return 'deepseek-relay'
  if (dialect === 'openrouter') return 'openrouter'
  if (dialect === 'zai' || dialect === 'together' || dialect === 'ant-ling') return AUTO_EXCLUDED_PRESET
  const url = (baseURL ?? '').toLowerCase()
  if (url.includes('dashscope') || url.includes('aliyuncs')) return 'qwen'
  return undefined
}

/**
 * The preset auto-adaptation writes for one route.
 *
 * The fallback is checked last so an explicit preference cannot be overridden by
 * the "no vendor signal" case — but never before the excluded case, because no
 * user preference should talk the plugin into sending `reasoning_effort` to an
 * endpoint that pi-ai says refuses it.
 *
 * @param provider - the provider route key.
 * @param baseURL - the route's endpoint, when it has one.
 * @param profileCompat - the route's `compat` block.
 * @param fallback - the configured default preset, or `undefined` for {@link AUTO_FALLBACK_PRESET}.
 * @returns a preset id that exists in `PRESETS`.
 */
export function autoPresetFor(
  provider: string,
  baseURL: string | undefined,
  profileCompat: unknown,
  fallback?: string,
): string {
  if (!resolveSupportsReasoningEffort(undefined, profileCompat, provider, baseURL)) {
    return AUTO_EXCLUDED_PRESET
  }
  return detectedPreset(provider, baseURL) ?? presetOrDefault(fallback, AUTO_FALLBACK_PRESET)
}

/** One declaration auto-adaptation wants to apply, and why. */
export interface AdaptAdjustment {
  /** Provider route key. */
  provider: string
  /** Model id within that route. */
  modelId: string
  /** The preset chosen for it. */
  preset: string
  /** One line naming the evidence the choice came from. */
  reason: string
}

/** What auto-adaptation would do, and what it could not do. */
export interface AdaptPlan {
  /** Declarations to apply, in route and model order. */
  adjustments: AdaptAdjustment[]
  /**
   * Route/model pairs deliberately left alone, each with the reason. The model
   * was already adjustable, or the user explicitly turned its reasoning off.
   */
  state: string[]
  /** Reasons a route could not be adapted at all. */
  problems: string[]
}

/** Whether two level maps say the same thing (the check `plan.ts` also makes). */
function hasDeclaration(entry: ModelLike): boolean {
  const efforts = entry.reasoningEfforts
  return efforts !== undefined && efforts !== false && isPlainObject(efforts) && Object.keys(efforts).length > 0
}

/**
 * Plan an auto-adaptation pass over an effective `llm-pi-ai` section.
 *
 * Only configuration-declared routes are considered. A route served from the
 * installed catalog already resolves its models' capability from the catalog, so
 * writing a declaration there would narrow what the catalog offers for no gain —
 * that is what `declaredRoutes` (the adapter's own verdict) is for.
 *
 * @param section - the resolved `llm-pi-ai` value, which may be anything.
 * @param declaredRoutes - provider keys the adapter reports as configuration-declared only.
 * @param fallback - the preferred preset for routes with no vendor signal.
 * @returns the declarations to apply, plus what was skipped and why.
 */
export function adaptPlan(
  section: unknown,
  declaredRoutes: Iterable<string> = [],
  fallback?: string,
): AdaptPlan {
  const declared = new Set(declaredRoutes)
  const providers = isPlainObject(section) && isPlainObject((section as PiAiSection).providers)
    ? (section as PiAiSection).providers as Record<string, ProfileLike>
    : {}
  const adjustments: AdaptAdjustment[] = []
  const state: string[] = []
  const problems: string[] = []

  for (const [provider, profile] of Object.entries(providers)) {
    if (!declared.has(provider)) continue
    const baseURL = typeof profile?.baseURL === 'string' ? profile.baseURL : undefined
    const models = (Array.isArray(profile?.models) ? profile.models : [])
      .filter((entry): entry is ModelLike => isPlainObject(entry) && typeof entry.id === 'string')
    if (models.length === 0) {
      // Nothing to declare on: the models array is where a declared route's
      // capability lives, and an empty route serves nothing this plugin can name.
      problems.push(`路由 "${provider}" 没有 models 条目，无法自动声明（先在设置 → 模型里补上模型）。`)
      continue
    }
    const preset = autoPresetFor(provider, baseURL, profile?.compat, fallback)
    const supports = resolveSupportsReasoningEffort(undefined, profile?.compat, provider, baseURL)
    const reason = supports
      ? `端点检测为 ${detectsThinkingFormat(provider, baseURL)}，写入 ${preset}`
      : `pi-ai 判定该端点不接收 reasoning_effort，写入不会触发解析错误的 ${preset}`
    for (const model of models) {
      const pair = `${provider}/${model.id}`
      if (hasDeclaration(model)) {
        state.push(`${pair} 已有档位声明`)
        continue
      }
      if (model.reasoningEfforts === false) {
        state.push(`${pair} 被显式标记为不支持推理（reasoningEfforts: false），不覆盖`)
        continue
      }
      adjustments.push({ provider, modelId: model.id, preset, reason })
    }
  }
  return { adjustments, state, problems }
}

/** One attempted adjustment: what was declared, and what came of it. */
export interface AdaptOutcome {
  /** The declaration that was attempted. */
  adjustment: AdaptAdjustment
  /** Whether the write landed. */
  ok: boolean
  /** The profile already carried exactly this declaration. */
  unchanged: boolean
  /** One message per reason the write failed. */
  problems: string[]
  /** Non-fatal observations about what the write touched. */
  notes: string[]
}
