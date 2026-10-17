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
 * Both services are 0.2.1 shapes. The pre-0.2 `settingsScope` binder this card
 * used no longer exists anywhere in the runtime; `configForms` is the settings
 * domain's replacement (the Settings inventory and the per-plugin pages both
 * read it).
 *
 * @module dsh-thinking-effort/client/types
 */

/** One path-addressed settings edit (`SettingsPathOpView` over the remote). */
export type SettingsPathOp =
  | { op: 'set', path: string[], value: unknown }
  | { op: 'unset', path: string[] }

/** One settings namespace's sync state (`ConfigFormSnapshot` of ui-settings). */
export interface ConfigFormSnapshot<T = unknown> {
  /** `loading` until the first accepted section; `unavailable` when not served. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Resolved value: schema defaults, then the composition base, then the user layer. */
  value: T | undefined
  /** Composition layer `value` was resolved over. */
  base: unknown
  /** The stored user layer; a key present here is user-overridden. */
  user: unknown
  /** Revision fencing the next write; undefined before the first Host view. */
  revision: number | undefined
  /** Whether the host document accepts writes (a memory provider never does). */
  writable: boolean
}

/** One Host entry's shared form (`ConfigForm` of ui-settings). */
export interface ConfigFormLike<T = unknown> {
  getSnapshot(): ConfigFormSnapshot<T>
  subscribe(listener: () => void): () => void
  /** One atomic namespace mutation, revision-fenced; `false` means the Host refused. */
  mutate(ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<boolean>
  /** Write one TOP-LEVEL field of the user section (replaces it, does not merge). */
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
}

/** The `configForms` service the settings domain provides. */
export interface ConfigFormsLike {
  /** `entryId` is the Host loader entry id — `llm-pi-ai` for the shipped adapter. */
  get<T = unknown>(entryId: string): ConfigFormLike<T>
  /**
   * Run `register` while any listed namespace is served; its disposer runs when
   * none is served or when the returned disposer runs. The CALLER wraps the
   * returned disposer in `ctx.effect` — the service registers nothing itself.
   */
  whileServed(namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void): () => void
}

/** One `ctx.slots.register` call, as far as this plugin needs it. */
export interface SlotOptions {
  /** Target slot key, e.g. `plugins.bundle.config`. */
  name: string
  /** Keyed slots key on this; a keyed slot registered without one throws. */
  key?: string
  /** List slots key on this. */
  id?: string
  order?: number
  /** Label text, or a thunk re-read per render so it follows the locale. */
  label?: string | (() => string)
  priority?: number
  /** Business share factory: its return value becomes extra component props. */
  inject?: () => Record<string, unknown>
  /** Diagnostics label for registration conflicts. */
  registrant?: string
}

/** The browser slot service. */
export interface SlotsLike {
  /** Install an effect per declaration lifetime of a slot; returns its disposer. */
  inject(name: string, register: () => (() => void) | Iterable<() => void>): () => void
  /** Register one contribution; returns its idempotent disposer. */
  register(options: SlotOptions, component: unknown): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser slot service (provided at runtime by dsh-client-ui-renderer). */
    slots: SlotsLike
    /** Settings-domain shared forms (provided at runtime by dsh-client-ui-settings). */
    configForms: ConfigFormsLike
  }
}
