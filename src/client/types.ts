/**
 * Minimal structural types for the two browser services this plugin uses.
 *
 * The client half imports no `@deepseek-ai` client package on purpose: the
 * framework's client-bundle purity gate rejects value imports that are not in
 * the browser module table, and a cross-package value import would also split
 * the module identity of a service the shell already owns. The runtime
 * instances come from `ctx` (cordis `ctx.get` plus declaration merging), and the
 * shapes below are the structural subsets actually touched.
 *
 * @module dsh-thinking-effort/client/types
 */

/** One settings namespace as the browser mirror sees it. */
export interface SettingsSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  /** Resolved value: schema defaults, then the composition base, then the user layer. */
  value: unknown
  /** The stored user layer; a key present here is user-overridden. */
  user: unknown
  /** Whether the host document accepts writes (a memory provider never does). */
  writable: boolean
}

/** One namespace scope bound on the caller's fiber. */
export interface SettingsScopeLike {
  getSnapshot(): SettingsSnapshot
  subscribe(listener: () => void): () => void
  /** Write one TOP-LEVEL field of the user section (revision-fenced). */
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

/** The binder service the settings page provides. */
export interface SettingsScopeBinderLike {
  bind(spec: { namespace: string }): SettingsScopeLike
}

/** One `slots.register` call, as far as this plugin needs it. */
export interface SlotOptions {
  name: string
  /** Keyed slots key on this; a keyed slot registered without one throws. */
  key?: string
  /** List slots key on this. */
  id?: string
  order?: number
  label?: string
  inject?: (...args: never[]) => Record<string, unknown>
}

/** The browser slot service. */
export interface SlotsLike {
  inject(name: string, register: () => unknown): void
  register(options: SlotOptions, component: unknown): unknown
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser slot service (provided at runtime by dsh-client-ui-slots). */
    slots: SlotsLike
  }
}
