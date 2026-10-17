/**
 * dsh-thinking-effort — adjustable thinking intensity for third-party API keys.
 *
 * ## The problem this solves
 *
 * A third-party provider is declared as a `providers.<route>` profile on the
 * pi-ai adapter, with a `models` list. Nothing in that flow ever writes
 * `reasoningEfforts`, and the adapter decides a model's reasoning capability
 * like this:
 *
 * ```ts
 * const efforts = entry.reasoningEfforts
 * if (efforts === undefined) return { reasoning: base?.reasoning ?? false }
 * ```
 *
 * A hand-declared route has no catalog `base`, so every one of its models
 * resolves to `reasoning: false`, the adapter advertises no effort levels, and
 * the composer's reasoning picker disappears. The user-visible symptom is
 * exactly "接入了第三方 API Key，但没法调节思考强度了".
 *
 * ## What this plugin does
 *
 * It declares the missing capability, in the one place the adapter reads it,
 * through the supported settings seam — no adapter takeover, no HTTP
 * interception, no harness patch:
 *
 * - `settings.mutate(ns, settingsOps(…), revision)` writes one route through
 *   path ops, so every other route and every unowned field survives;
 * - a route with a `models` list is rewritten in full (arrays replace, so its
 *   entries must be carried through); a route inheriting the installed catalog
 *   is edited through one `modelOverrides.<model>` path;
 * - the write is revision-fenced against the descriptor read in the same pass.
 *
 * The settings entry id is read from the adapter's own configurable-provider
 * directory (by shape, not by registration order) rather than hardcoded, so a
 * profile that renames the loader entry still works.
 *
 * Entry points: the `/thinking` slash command, the `thinking_effort_status` /
 * `thinking_effort_set` tools, a load-time diagnostic, and the Plugins-page
 * browser card.
 *
 * @module dsh-thinking-effort
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { adaptDeclaredModels, capabilityReport, registerThinkingCommand } from './commands.ts'
import { analyzeRoutes, unadjustable } from './diagnose.ts'
import { renderAdapt } from './format.ts'
import { isPlainObject } from './json.ts'
import { AUTO_FALLBACK_PRESET, DEFAULT_PRESET, presetOrDefault } from './presets.ts'
import { piAiDescriptor } from './apply.ts'
import { registerThinkingTools } from './tools.ts'
import {
  DEFAULT_PI_AI_NS,
  NAMESPACE,
  type Config as PluginConfig,
  type PiAiPort,
  type SettingsLike,
} from './types.ts'

export { PRESETS, THINKING_LEVELS, THINKING_FORMATS, validateLevels } from './presets.ts'
export type { Declaration } from './types.ts'
export { planDeclaration } from './plan.ts'
export { analyzeRoutes, modelCapability, offeredLevels, unadjustable } from './diagnose.ts'
export { autoPresetFor, adaptPlan, detectedPreset, AUTO_FALLBACK_PRESET } from './auto.ts'
export { previewWire, effectOf, thinkingLevelMapOf, detectsThinkingFormat } from './wire.ts'

/** Plugin display name, matching the package name. */
export const name = NAMESPACE

/** No required services: every consumer is injected optionally. */
export const inject: string[] = []

/**
 * How many times the load-time adaptation pass waits for the adapter to mount.
 *
 * The settings service can arrive before the pi-ai adapter registers its
 * descriptor, and a pass that gives up on the first look would leave a freshly
 * added third-party route undeclared until the user thought to run `/thinking
 * adapt`. Five half-second waits cover a slow boot without retrying forever.
 */
const AUTO_ADAPT_ATTEMPTS = 5

/** How long to wait between those attempts. */
const AUTO_ADAPT_DELAY_MS = 500

/**
 * Schemastery schema for this plugin's own composition config.
 *
 * `defaultPreset` pre-selects a value in the GUI, and `autoAdaptPreset` is the
 * fallback auto-adaptation writes for a route with no recognisable vendor
 * dialect. Both default to presets that send only what an OpenAI-compatible
 * endpoint already understands.
 */
export const Config: Schema<PluginConfig> = Schema.object({
  diagnoseOnStart: Schema.boolean().default(true),
  autoAdapt: Schema.boolean().default(true),
  defaultPreset: Schema.string().default(DEFAULT_PRESET),
  autoAdaptPreset: Schema.string().default(AUTO_FALLBACK_PRESET),
})

/** The slice of the adapter directory this plugin reads. */
interface LlmDirectoryLike {
  listConfigurableProviders?: () => Array<{
    provider: string
    settingsNs?: string
    /** Path from the namespace section root to this route's profile; pi-ai uses `['providers', route]`. */
    settingsPath?: readonly string[]
    declared?: boolean
  }>
}

/** A logger, as far as this plugin uses one. */
interface LoggerLike {
  info: (message: string) => void
  warn: (message: string) => void
}

/**
 * Read one config field.
 *
 * The loader hands a plugin's config as reactive per-field accessors in the
 * 0.2 line (`config.field.get()`) and as plain values in the 0.1 line. Both
 * shapes are accepted so the plugin does not depend on which one is in force.
 *
 * @param value - the raw field value off the config object.
 * @param fallback - what to use when the field is absent or unreadable.
 * @returns the resolved value.
 */
function fieldOf<T>(value: unknown, fallback: T): T {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    try {
      const live = (value as { get: () => unknown }).get()
      return (live === undefined ? fallback : live) as T
    } catch {
      return fallback
    }
  }
  return (value === undefined ? fallback : value) as T
}

/**
 * Mount the plugin.
 *
 * @param ctx - the host plugin context.
 * @param config - the composition layer's config for this entry.
 */
export function apply(ctx: Context, config: PluginConfig): void {
  /** Read one config field, whichever shape the loader handed over. */
  const field = <T>(key: string, fallback: T): T =>
    fieldOf((config as unknown as Record<string, unknown>)[key], fallback)

  const diagnoseOnStart = (): boolean => field('diagnoseOnStart', true)
  const autoAdapt = (): boolean => field('autoAdapt', true)
  const preferredPreset = (): string =>
    presetOrDefault(field<string | undefined>('autoAdaptPreset', undefined), AUTO_FALLBACK_PRESET)

  const settingsOf = (): SettingsLike | undefined =>
    ctx.get('settings') as unknown as SettingsLike | undefined

  /**
   * Provider keys the adapter reports as configuration-declared only. An absent
   * service or a throwing directory only narrows the report, so it is never
   * allowed to break a command.
   */
  const declaredRoutes = (): string[] => {
    const llm = ctx.get('llm') as unknown as LlmDirectoryLike | undefined
    if (typeof llm?.listConfigurableProviders !== 'function') return []
    try {
      return llm.listConfigurableProviders()
        .filter((entry) => entry.declared === true)
        .map((entry) => entry.provider)
    } catch {
      return []
    }
  }

  /**
   * The settings entry id owning the pi-ai routes.
   *
   * 0.2.1 lists configurable providers in registration order, and the DeepSeek
   * account adapter registers before the pi-ai adapter. "The first entry with a
   * settings namespace" therefore resolves to `llm-deepseek`, a section with no
   * `providers` dict: every plan comes back empty and the report claims every
   * model is adjustable. Judge by shape instead — the adapter whose directory
   * path is `['providers', …]`, or whose section value really carries a
   * `providers` object. The shipped id is the tie-break, so a profile that
   * renames the loader entry still resolves.
   */
  const piAiNs = (): string => {
    const descriptors = (() => {
      const settings = settingsOf()
      if (settings === undefined) return []
      try {
        return settings.describe({ redactSecrets: true })
      } catch {
        return []
      }
    })()
    /** Whether one settings section resolves to an object with a `providers` dict. */
    const sectionHasProviders = (ns: string): boolean => {
      const row = descriptors.find((candidate) => candidate.ns === ns)
      return row !== undefined && isPlainObject(row.value)
        && isPlainObject((row.value as { providers?: unknown }).providers)
    }
    if (descriptors.length === 0) return DEFAULT_PI_AI_NS
    if (sectionHasProviders(DEFAULT_PI_AI_NS)) return DEFAULT_PI_AI_NS
    const llm = ctx.get('llm') as unknown as LlmDirectoryLike | undefined
    if (typeof llm?.listConfigurableProviders === 'function') {
      try {
        const entries = llm.listConfigurableProviders().filter(
          (entry): entry is { provider: string, settingsNs: string, settingsPath?: readonly string[], declared?: boolean } =>
            typeof entry.settingsNs === 'string' && entry.settingsNs.length > 0,
        )
        const owning = entries.find((entry) =>
          entry.settingsPath?.[0] === 'providers' && sectionHasProviders(entry.settingsNs))
          ?? entries.find((entry) => sectionHasProviders(entry.settingsNs))
        if (owning !== undefined) return owning.settingsNs
      } catch {
        // Fall through to the shipped id.
      }
    }
    return DEFAULT_PI_AI_NS
  }

  const portOf = (): PiAiPort => ({ settings: settingsOf(), ns: piAiNs() })
  const report = (): string => capabilityReport(portOf(), declaredRoutes())

  registerThinkingCommand(ctx, portOf, report, declaredRoutes, preferredPreset)
  registerThinkingTools(ctx, portOf, report)

  /** Resolve the logger once; every load-time message goes through it or nowhere. */
  const loggerOf = (): LoggerLike | undefined => (ctx as unknown as { logger?: LoggerLike }).logger

  ctx.inject(['settings'], () => {
    if (autoAdapt()) {
      void autoAdaptOnStart()
      return
    }
    // With adaptation off, the report is the only load-time message, and it has
    // to stand on its own rather than describe a pass that is not going to run.
    if (diagnoseOnStart()) diagnoseOnce()
  })

  /**
   * The automatic pass: declare every route nobody has declared yet.
   *
   * The diagnostic moves to the end of this function rather than running beside
   * it. Nothing here is synchronous past the first `await`, so a report emitted
   * in parallel would read the settings document *before* the writes landed and
   * announce "3 models cannot be adjusted" one line above "declared 3 models".
   */
  async function autoAdaptOnStart(): Promise<void> {
    const logger = loggerOf()
    let failures = 0
    let converged = false
    for (let attempt = 0; attempt < AUTO_ADAPT_ATTEMPTS; attempt += 1) {
      try {
        const port = portOf()
        const descriptor = piAiDescriptor(port)
        if (descriptor === undefined) {
          // The adapter registers its directory entries and settings descriptor
          // after the settings service mounts, so "not there yet" is the normal
          // first look. Waiting is the point of the retry loop; without the
          // sleep every attempt would land in the same instant and the pass
          // would give up before the adapter had a chance to register.
          await sleep(AUTO_ADAPT_DELAY_MS)
          continue
        }
        const result = await adaptDeclaredModels(
          port, descriptor, declaredRoutes(), undefined, preferredPreset(),
        )
        const written = result.outcomes.filter((outcome) => outcome.ok && !outcome.unchanged).length
        if (written > 0 && logger !== undefined) {
          logger.info(`${name}: 自动适配完成。\n${renderAdapt(result.plan, result.outcomes)}`)
        }
        failures = result.outcomes.filter((outcome) => !outcome.ok).length
        // Zero writes means nothing was missing; every write landing means this
        // boot is done. Anything in between is a partial failure (a write
        // conflict, or an unwritable document) and is worth one more look, but
        // the plan is recomputed from a fresh read each time, so a resort that
        // keeps failing cannot loop.
        if (written === 0 || written === result.plan.adjustments.length) {
          converged = true
          break
        }
      } catch (error) {
        if (logger !== undefined) {
          logger.warn(`${name}: 自动适配失败：${error instanceof Error ? error.message : String(error)}`)
        }
        break
      }
      await sleep(AUTO_ADAPT_DELAY_MS)
    }
    if (!converged && failures > 0 && logger !== undefined) {
      logger.warn(`${name}: 自动适配未能写入全部声明，运行 /thinking adapt 查看原因。`)
    }
    if (diagnoseOnStart()) diagnoseOnce()
  }

  /**
   * One load-time report: a freshly added third-party key should be noticed
   * immediately, not the first time someone opens the model picker.
   */
  function diagnoseOnce(): void {
    const logger = loggerOf()
    if (logger === undefined) return
    try {
      const port = portOf()
      const descriptor = piAiDescriptor(port)
      if (descriptor === undefined) return
      const broken = unadjustable(analyzeRoutes(descriptor.value, declaredRoutes()))
      if (broken.length === 0) {
        logger.info(`${name}: 所有 pi-ai 模型都可调节思考强度。`)
        return
      }
      logger.warn(`${name}: ${broken.length} 个模型无法调节思考强度：${broken.join('、')}`
        + '（运行 /thinking adapt 自动声明，或 /thinking set <provider>/<model> <preset> 手动指定）')
    } catch (error) {
      logger.warn(`${name}: 思考强度自检失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** Wait, without keeping the host process alive on shutdown. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer === 'object' && timer !== null && typeof timer.unref === 'function') timer.unref()
  })
}
