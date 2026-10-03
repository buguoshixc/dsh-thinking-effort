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
 * - `settings.update(ns, { providers: { <route>: … } })` merges one route key,
 *   so every other route and every unowned field survives;
 * - a route with a `models` list is rewritten in full (the array replaces, so
 *   its entries must be carried through); a route inheriting the installed
 *   catalog is edited through `modelOverrides`, which merges;
 * - the write is revision-fenced against the descriptor read in the same pass.
 *
 * The settings entry id is read from the adapter's own configurable-provider
 * directory rather than hardcoded, so a profile that renames the loader entry
 * still works.
 *
 * Entry points: the `/thinking` slash command, the `thinking_effort_status` /
 * `thinking_effort_set` tools, a load-time diagnostic, and the browser card.
 *
 * @module dsh-thinking-effort
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { capabilityReport, registerThinkingCommand } from './commands.ts'
import { analyzeRoutes, unadjustable } from './diagnose.ts'
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

/** Plugin display name, matching the package name. */
export const name = NAMESPACE

/** No required services: every consumer is injected optionally. */
export const inject: string[] = []

/** Schemastery schema for this plugin's own composition config. */
export const Config: Schema<PluginConfig> = Schema.object({
  diagnoseOnStart: Schema.boolean().default(true),
  defaultPreset: Schema.string().default('deepseek'),
})

/** The slice of the adapter directory this plugin reads. */
interface LlmDirectoryLike {
  listConfigurableProviders?: () => Array<{ provider: string, settingsNs?: string, declared?: boolean }>
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
  const diagnoseOnStart = (): boolean =>
    fieldOf((config as unknown as Record<string, unknown>)['diagnoseOnStart'], true)

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
   * The settings entry id owning the pi-ai routes: taken from the adapter's own
   * directory so a renamed loader entry still resolves, falling back to the
   * shipped id.
   */
  const piAiNs = (): string => {
    const llm = ctx.get('llm') as unknown as LlmDirectoryLike | undefined
    if (typeof llm?.listConfigurableProviders === 'function') {
      try {
        const entry = llm.listConfigurableProviders()
          .find((candidate) => typeof candidate.settingsNs === 'string' && candidate.settingsNs.length > 0)
        if (entry?.settingsNs !== undefined) return entry.settingsNs
      } catch {
        // Fall through to the shipped id.
      }
    }
    return DEFAULT_PI_AI_NS
  }

  const portOf = (): PiAiPort => ({ settings: settingsOf(), ns: piAiNs() })
  const report = (): string => capabilityReport(portOf(), declaredRoutes())

  registerThinkingCommand(ctx, portOf, report)
  registerThinkingTools(ctx, portOf, report)

  // One load-time report: a freshly added third-party key should be noticed
  // immediately, not the first time someone opens the model picker.
  ctx.inject(['settings'], () => {
    if (!diagnoseOnStart()) return
    const logger = (ctx as unknown as { logger?: LoggerLike }).logger
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
        + '（运行 /thinking set <provider>/<model> <preset> 声明档位）')
    } catch (error) {
      logger.warn(`${name}: 思考强度自检失败：${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
