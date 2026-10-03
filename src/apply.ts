/**
 * The Node half's settings port: read the effective `llm-pi-ai` section, plan an
 * edit, and merge the result into that section's user layer.
 *
 * All of the judgement lives in `src/plan.ts`; this module is the thin,
 * side-effecting shell around it. Two properties matter here:
 *
 * - **the write is a merge**, `settings.update(ns, { providers: { <route>: ... } })`.
 *   `mergeLayers` recurses through plain objects, so supplying one route key
 *   leaves every other route — and every other field of this route — exactly as
 *   the composition layer or the user had it.
 * - **the write is revision-fenced**, using the revision read in the same pass,
 *   so a concurrent editor is reported rather than silently overwritten. A
 *   conflict is retried once against a fresh read.
 *
 * @module dsh-thinking-effort/apply
 */

import { isPlainObject } from './json.ts'
import { planDeclaration } from './plan.ts'
import type { Declaration, PiAiPort, PiAiSection, ProfileLike, SettingsDescriptorLike } from './types.ts'

/** The result of attempting one declaration. */
export interface ApplyOutcome {
  /** The edit is well-formed and landed (or was already satisfied). */
  ok: boolean
  /** The effective profile already carried exactly this declaration. */
  unchanged: boolean
  /** One message per reason the edit was refused or failed. */
  problems: string[]
  /** Non-fatal observations about what the write touched. */
  notes: string[]
}

/** The pi-ai adapter's descriptor, or `undefined` when that plugin is not mounted. */
export function piAiDescriptor(port: PiAiPort): SettingsDescriptorLike | undefined {
  if (port.settings === undefined) return undefined
  return port.settings.describe({ redactSecrets: true }).find((row) => row.ns === port.ns)
}

/**
 * Read one route's effective profile out of a resolved section.
 *
 * @param section - the resolved `llm-pi-ai` value, which may be anything.
 * @param provider - the route key.
 * @returns the profile, or `undefined` when the route is not configured.
 */
export function profileOf(section: unknown, provider: string): ProfileLike | undefined {
  if (!isPlainObject(section)) return undefined
  const providers = (section as PiAiSection).providers
  if (!isPlainObject(providers)) return undefined
  const profile = providers[provider]
  return isPlainObject(profile) ? profile as ProfileLike : undefined
}

/**
 * Plan and apply one declaration.
 *
 * @param port - the settings service plus the entry id owning the pi-ai routes.
 * @param provider - provider route key.
 * @param modelId - model id within that route.
 * @param declaration - the requested edit.
 * @returns what happened, with a message for every refusal.
 */
export async function applyDeclaration(
  port: PiAiPort,
  provider: string,
  modelId: string,
  declaration: Declaration,
): Promise<ApplyOutcome> {
  const settings = port.settings
  if (settings === undefined) {
    return { ok: false, unchanged: false, problems: ['settings 服务未挂载，无法写入 llm-pi-ai。'], notes: [] }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const descriptor = piAiDescriptor(port)
    if (descriptor === undefined) {
      return {
        ok: false,
        unchanged: false,
        problems: [`settings 条目 "${port.ns}" 未注册：该 profile 没有挂载 llm-pi-ai 适配器。`],
        notes: [],
      }
    }
    const plan = planDeclaration({
      provider,
      modelId,
      declaration,
      profile: profileOf(descriptor.value, provider),
    })
    if (!plan.ok) return { ok: false, unchanged: false, problems: plan.problems, notes: plan.notes }
    if (plan.unchanged) return { ok: true, unchanged: true, problems: [], notes: [] }
    try {
      await settings.update(port.ns, { providers: { [provider]: plan.patch } }, descriptor.revision)
      return { ok: true, unchanged: false, problems: [], notes: plan.notes }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt === 0 && /changed since it was read|SETTINGS_CONFLICT/i.test(message)) continue
      return { ok: false, unchanged: false, problems: [`写入 ${port.ns} 失败：${message}`], notes: plan.notes }
    }
  }
  return { ok: false, unchanged: false, problems: [`写入 ${port.ns} 失败：并发修改冲突，重试后仍未成功。`], notes: [] }
}
