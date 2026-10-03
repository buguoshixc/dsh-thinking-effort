/**
 * Browser-half entry: the cordis `inject` / `apply` pair dsh's client-modules
 * loads.
 *
 * @module dsh-thinking-effort/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerCard } from './card.ts'
import { injectStyles } from './styles.ts'

/** Registered slots arrive through this service. */
export const inject = ['slots']

/**
 * Mount the browser half.
 *
 * @param ctx - the client root context.
 */
export function apply(ctx: Context): void {
  injectStyles()
  registerCard(ctx)
}
