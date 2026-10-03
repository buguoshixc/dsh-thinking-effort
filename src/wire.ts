/**
 * A faithful preview of what a declared level actually puts on the wire.
 *
 * Which parameters a thinking level sends is decided inside
 * `@earendil-works/pi-ai`'s OpenAI-completions API, from two inputs: the model's
 * `thinkingLevelMap` (built by `dsh-llm-pi-ai` from `reasoningEfforts`) and the
 * resolved `compat` block. Neither is visible from the settings document, so a
 * user choosing a dialect is guessing — and a wrong guess fails silently, since
 * an endpoint that does not recognise a parameter generally ignores it.
 *
 * This module reimplements that dispatch so the guess becomes an inspection. It
 * mirrors `pi-ai`'s `dist/api/openai-completions.js`:
 *
 * - `streamSimple` maps the level `off` to *no* effort, and every other level to
 *   itself, before dispatch ever sees it;
 * - each `thinkingFormat` has its own branch, and the branch is an `else if`
 *   chain — so naming a format also *suppresses* the generic OpenAI path;
 * - `supportsReasoningEffort` gates `reasoning_effort` in every branch that
 *   sends it, and defaults to `true` for an endpoint pi-ai cannot recognise.
 *
 * Pure: no cordis, no network. `test/wire.test.mjs` pins it against the rules
 * quoted above.
 *
 * @module dsh-thinking-effort/wire
 */

import { THINKING_LEVELS, type LevelMap, type LevelWire } from './presets.ts'

/** The resolved `thinkingLevelMap` shape `dsh-llm-pi-ai` hands to pi-ai. */
export type ThinkingLevelMap = Partial<Record<string, string | null>>

/** One level's wire effect. */
export interface WireEffect {
  /** The selectable level. */
  level: string
  /** Parameters this level adds to the request body. */
  params: Record<string, unknown>
  /** Whether the level adds no reasoning-related parameter at all. */
  silent: boolean
}

/**
 * Build the `thinkingLevelMap` `dsh-llm-pi-ai` derives from a declaration.
 *
 * Undeclared levels are pinned to `null` (unsupported). `off` declared with no
 * value is the one exception: it stays *absent* from the map, which is what
 * "supported, send nothing" looks like downstream.
 *
 * @param levels - the declared level-to-wire map.
 * @returns the map pi-ai would receive.
 */
export function thinkingLevelMapOf(levels: LevelMap): ThinkingLevelMap {
  const map: ThinkingLevelMap = {}
  for (const level of THINKING_LEVELS) {
    const wire = levels[level]
    if (wire === undefined) {
      // `off` is never pinned: an undeclared off means "not offered", which
      // differs from a declared off with no value.
      if (level !== 'off') map[level] = null
      continue
    }
    if (wire !== null) map[level] = wire
  }
  return map
}

/** The wire value a level dispatches, falling back to the level name. */
function wireOf(map: ThinkingLevelMap, level: string): string {
  const mapped = map[level]
  return typeof mapped === 'string' ? mapped : level
}

/**
 * Compute what one level sends.
 *
 * @param level - the selectable level.
 * @param map - the resolved thinking level map.
 * @param thinkingFormat - the resolved dispatch dialect, if one is pinned.
 * @param supportsReasoningEffort - the resolved `compat.supportsReasoningEffort`.
 * @returns the level's effect.
 */
export function effectOf(
  level: string,
  map: ThinkingLevelMap,
  thinkingFormat: string | undefined,
  supportsReasoningEffort: boolean,
): WireEffect {
  const params: Record<string, unknown> = {}
  // pi-ai collapses `off` to "no effort" before any branch runs.
  const effort: string | undefined = level === 'off' ? undefined : level
  const offSendsSomething = map['off'] !== null

  switch (thinkingFormat) {
    case 'deepseek': {
      if (effort !== undefined) params['thinking'] = { type: 'enabled' }
      else if (offSendsSomething) params['thinking'] = { type: 'disabled' }
      if (effort !== undefined && supportsReasoningEffort) {
        params['reasoning_effort'] = wireOf(map, effort)
      }
      break
    }
    case 'openrouter': {
      if (effort !== undefined) params['reasoning'] = { effort: wireOf(map, effort) }
      else if (offSendsSomething) {
        params['reasoning'] = { effort: typeof map['off'] === 'string' ? map['off'] : 'none' }
      }
      break
    }
    case 'qwen': {
      params['enable_thinking'] = effort !== undefined
      if (effort !== undefined && supportsReasoningEffort) {
        params['reasoning_effort'] = wireOf(map, effort)
      }
      break
    }
    case 'zai': {
      params['thinking'] = effort !== undefined
        ? { type: 'enabled', clear_thinking: false }
        : { type: 'disabled' }
      if (effort !== undefined && supportsReasoningEffort) {
        params['reasoning_effort'] = wireOf(map, effort)
      }
      break
    }
    case 'together': {
      params['reasoning'] = { enabled: effort !== undefined }
      if (effort !== undefined && supportsReasoningEffort) {
        params['reasoning_effort'] = wireOf(map, effort)
      }
      break
    }
    default: {
      // `openai`, and anything pi-ai does not recognise — including a route with
      // no dialect pinned at all, which pi-ai detects as `openai` unless the URL
      // names a known vendor.
      if (effort !== undefined && supportsReasoningEffort) {
        params['reasoning_effort'] = wireOf(map, effort)
      } else if (effort === undefined && supportsReasoningEffort && typeof map['off'] === 'string') {
        params['reasoning_effort'] = map['off']
      }
      break
    }
  }
  return { level, params, silent: Object.keys(params).length === 0 }
}

/**
 * Preview every offered level.
 *
 * @param levels - the declared level-to-wire map.
 * @param thinkingFormat - the dialect to pin, or `undefined` to leave pi-ai's own detection.
 * @param supportsReasoningEffort - the resolved compat switch.
 * @returns one effect per offered level, in escalation order.
 */
export function previewWire(
  levels: LevelMap,
  thinkingFormat: string | undefined,
  supportsReasoningEffort: boolean,
): WireEffect[] {
  const map = thinkingLevelMapOf(levels)
  return THINKING_LEVELS
    .filter((level) => level === 'off' || levels[level] !== undefined)
    .map((level) => effectOf(level, map, thinkingFormat, supportsReasoningEffort))
}

/** Render one level's effect as a single line. */
export function renderEffect(effect: WireEffect): string {
  if (effect.silent) return `${effect.level.padEnd(8)} （不发送任何推理参数）`
  return `${effect.level.padEnd(8)} ${JSON.stringify(effect.params)}`
}

/** Whether two levels are indistinguishable on the wire. */
export function collapses(effects: readonly WireEffect[]): string[] {
  const seen = new Map<string, string>()
  const collisions: string[] = []
  for (const effect of effects) {
    if (effect.silent) continue
    const key = JSON.stringify(effect.params)
    const first = seen.get(key)
    if (first === undefined) seen.set(key, effect.level)
    else collisions.push(`${first} 与 ${effect.level} 发送完全相同的内容，选中它们没有区别`)
  }
  return collisions
}

/** Re-exported so callers need not reach into `presets.ts` for the wire type. */
export type { LevelWire }

/**
 * Which dialect pi-ai would detect for an endpoint, absent an explicit pin.
 *
 * Mirrors `detectCompat`: `deepseek` only for the `deepseek` provider or a
 * `deepseek.com` host, then `zai`, `together`, `ant-ling`, `openrouter`, and
 * `openai` as the fallback. Shown by `/thinking explain` so a user can see what
 * pinning a dialect overrides.
 *
 * @param provider - the provider route key.
 * @param baseURL - the route's endpoint, when it has one.
 * @returns the dialect pi-ai would pick.
 */
export function detectsThinkingFormat(provider: string, baseURL: string | undefined): string {
  const url = (baseURL ?? '').toLowerCase()
  if (provider === 'deepseek' || url.includes('deepseek.com')) return 'deepseek'
  if (provider === 'zai' || url.includes('api.z.ai')) return 'zai'
  if (provider === 'together' || url.includes('together')) return 'together'
  if (url.includes('ant-ling')) return 'ant-ling'
  if (provider === 'openrouter' || url.includes('openrouter.ai')) return 'openrouter'
  return 'openai'
}

/**
 * pi-ai's default for `compat.supportsReasoningEffort`.
 *
 * This gate decides whether `reasoning_effort` is sent at all. The detected rule
 * is "everything except a handful of vendors", so an unrecognised relay such as
 * a private gateway gets `true` — but an explicit `compat` value wins, so the
 * route's or model's own switch is read first.
 *
 * @param provider - the provider route key.
 * @param baseURL - the route's endpoint, when it has one.
 * @returns the switch pi-ai would resolve to.
 */
export function detectsSupportsReasoningEffort(provider: string, baseURL: string | undefined): boolean {
  const url = (baseURL ?? '').toLowerCase()
  const excluded = provider === 'xai' || url.includes('api.x.ai')
    || provider === 'zai' || url.includes('api.z.ai')
    || provider === 'moonshot' || url.includes('moonshot')
    || provider === 'together' || url.includes('together')
    || url.includes('cloudflare')
    || provider === 'nvidia' || url.includes('nvidia')
    || url.includes('ant-ling')
  return !excluded
}

/**
 * Resolve the `supportsReasoningEffort` a model will actually run with:
 * the model's own switch, then the route's, then pi-ai's detection.
 *
 * @param modelCompat - the model entry's compat block.
 * @param routeCompat - the route's compat block.
 * @param provider - the provider route key.
 * @param baseURL - the route's endpoint.
 * @returns the resolved switch.
 */
export function resolveSupportsReasoningEffort(
  modelCompat: unknown,
  routeCompat: unknown,
  provider: string,
  baseURL: string | undefined,
): boolean {
  const own = (value: unknown): boolean | undefined =>
    (typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)['supportsReasoningEffort'] === 'boolean'
      ? (value as Record<string, unknown>)['supportsReasoningEffort'] as boolean
      : undefined)
  return own(modelCompat) ?? own(routeCompat) ?? detectsSupportsReasoningEffort(provider, baseURL)
}
