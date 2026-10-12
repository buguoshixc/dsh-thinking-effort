/**
 * The shapes this plugin stores, reads and writes.
 *
 * Two vocabularies live here and they are deliberately different:
 *
 * - the plugin's **own** settings section (`Config`), holding only preferences;
 * - the `llm-pi-ai` section this plugin edits on the user's behalf, described
 *   by the loose structural types below.
 *
 * The plugin keeps no declaration state of its own. `llm-pi-ai` is the single
 * source of truth for what a model offers, so a declaration is a one-shot edit
 * of that section — never a shadow copy that could drift from it.
 *
 * @module dsh-thinking-effort/types
 */

import type { LevelWire } from './presets.ts'

/** The `llm-pi-ai` settings entry id this plugin edits by default. */
export const LLM_PI_AI_NAMESPACE = 'llm-pi-ai'

/** This plugin's own settings namespace (preferences only). */
export const NAMESPACE = 'dsh-thinking-effort'

/** The slash command this plugin registers. */
export const COMMAND_NAME = 'thinking'

/**
 * One edit to request against a model's thinking-intensity capability.
 *
 * Every field is optional and independent: `preset` alone is the common case,
 * and the rest exist for endpoints whose dialect a preset cannot guess.
 */
export interface Declaration {
  /** A preset id from `src/presets.ts`, or `inherit` to only pin fields. */
  preset?: string
  /**
   * Explicit level-to-wire map. When present it wins over the preset's own
   * levels, so a user can start from a preset and rename one step.
   */
  levels?: Record<string, LevelWire>
  /** Pin the dispatch dialect, overriding the preset's. */
  thinkingFormat?: string
  /** Route-level default level for new sessions (`providers.<p>.reasoning`). */
  defaultEffort?: string
  /** Per-level token budgets, for endpoints that size thinking by budget. */
  thinkingBudgets?: Record<string, number>
  /** Remove the fields this plugin owns instead of writing them. */
  remove?: boolean
}

/** This plugin's own settings section. */
export interface Config {
  /** Log one capability report at load, naming routes that cannot be adjusted. */
  diagnoseOnStart: boolean
  /**
   * Declare the missing capability at load for every third-party route that has
   * none, so adding an API key needs no follow-up command.
   *
   * Defaults to on because that is the point of the plugin; turn it off to keep
   * the settings document untouched until `/thinking adapt` is run by hand.
   */
  autoAdapt: boolean
  /** Preset pre-selected in the GUI card. */
  defaultPreset: string
  /**
   * The preset auto-adaptation writes when a route has no recognisable vendor
   * dialect. A vendor the endpoint detection recognises gets that vendor's
   * preset regardless of this value.
   */
  autoAdaptPreset: string
}

/** One model entry of a `llm-pi-ai` provider profile, as far as this plugin reads it. */
export interface ModelLike {
  id: string
  reasoningEfforts?: false | Record<string, LevelWire>
  compat?: Record<string, unknown>
  [key: string]: unknown
}

/** One `llm-pi-ai` provider profile, as far as this plugin reads it. */
export interface ProfileLike {
  api?: string
  baseURL?: string
  models?: ModelLike[]
  modelOverrides?: Record<string, Record<string, unknown>>
  compat?: Record<string, unknown>
  reasoning?: string
  thinkingBudgets?: Record<string, number>
  [key: string]: unknown
}

/** The `llm-pi-ai` section, as far as this plugin reads it. */
export interface PiAiSection {
  providers?: Record<string, ProfileLike>
  [key: string]: unknown
}

/** A descriptor row out of `settings.describe()`, narrowed to what is used here. */
export interface SettingsDescriptorLike {
  /**
   * The loader entry id that owns this form — for the shipped pi-ai adapter that
   * is `llm-pi-ai`, exactly the `id:` its `cordis.patch.yml` row declares.
   */
  ns: string
  value: unknown
  base?: unknown
  user?: unknown
  revision: number
}

/** The slice of `ctx.settings` this plugin uses. */
export interface SettingsLike {
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptorLike[]
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
}

/**
 * Where this plugin reads and writes the pi-ai routes.
 *
 * The entry id comes from the adapter's own configurable-provider directory
 * (`settingsNs`) rather than from a constant, so a profile that renames the
 * loader entry still works; the shipped id is only the fallback.
 */
export interface PiAiPort {
  settings: SettingsLike | undefined
  ns: string
}

/** The entry id the shipped pi-ai adapter uses, and the fallback for {@link PiAiPort.ns}. */
export const DEFAULT_PI_AI_NS = LLM_PI_AI_NAMESPACE

/** A preset row as the browser card renders it (no functions cross the wire). */
export interface PresetRow {
  id: string
  label: string
  summary: string
  levels: Record<string, LevelWire>
  thinkingFormat?: string
}
