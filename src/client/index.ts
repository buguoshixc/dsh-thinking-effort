/**
 * Browser-half entry: the cordis `inject` / `apply` pair dsh's client-modules
 * loads.
 *
 * @module dsh-thinking-effort/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerCard } from './card.ts'
import { injectStyles } from './styles.ts'
import { NAMESPACE } from '../types.ts'
import type { ConfigFormsLike } from './types.ts'

/** Registered slots arrive through this service. */
export const inject = ['slots']

/**
 * Mount the browser half.
 *
 * `configForms` is requested with `ctx.inject`, not in the static `inject` list:
 * a composition without the Settings domain would otherwise leave this entry
 * PENDING on a service that never arrives, and the web shell's boot audit treats
 * a pending client entry as a boot failure. With the non-blocking form the
 * callback simply never runs and the bundle stays inert.
 *
 * @param ctx - the client root context.
 */
export function apply(ctx: Context): void {
  injectStyles()
  ctx.inject(['configForms'], (scoped) => {
    const forms = scoped.get('configForms') as unknown as ConfigFormsLike | undefined
    if (forms === undefined) {
      console.warn(`[${NAMESPACE}] configForms 服务未提供，思考强度卡片不会挂载`)
      return
    }
    registerCard(scoped, forms)
  })
}
