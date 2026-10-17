/**
 * The one injected stylesheet.
 *
 * Two rules of the house apply here:
 *
 * - **the prefix is plugin-unique.** An injected `<style>` is one flat
 *   stylesheet in a shared page — it is not scoped per plugin — so a prefix
 *   shared with another plugin means whichever sheet loads later silently wins.
 *   `dte-` belongs to this plugin.
 * - **colours come from the theme tokens**, never from literals, so the card
 *   follows light/dark like every built-in surface.
 *
 * The `data-plugin` / `data-plugin-css` attributes are the HMR reclamation
 * contract: client-modules claims unowned `<style>` tags during materialization
 * and later finds them by these attributes to replace them.
 *
 * @module dsh-thinking-effort/client/styles
 */

import { NAMESPACE } from '../types.ts'

const CSS = `
.dte-card {
  margin: 0;
  padding: 12px 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
}
.dte-section-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.dte-status-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.4; color: var(--dsw-alias-label-primary); }
.dte-status-body { margin: 6px 0 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
.dte-route { margin-top: 14px; }
.dte-route-name { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.dte-route-tag { margin-left: 6px; font-weight: 400; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dte-model {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 0; border-top: 1px solid var(--dsw-alias-border-l2);
}
.dte-model-id { flex: 1 1 160px; min-width: 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dte-badge {
  flex: none; padding: 2px 8px; border-radius: 999px; font-size: 12px; line-height: 20px;
  background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary);
}
.dte-badge-ok { color: var(--dsw-alias-label-primary); }
.dte-badge-bad { color: var(--dsw-alias-state-error-primary); }
.dte-select {
  flex: none; height: 30px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.dte-select:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dte-btn {
  flex: none; appearance: none; border: 1px solid var(--dsw-alias-border-l2); background: none; font: inherit;
  font-size: 12px; line-height: 1.5; height: 30px; padding: 0 10px; border-radius: 8px; cursor: pointer;
  color: var(--dsw-alias-label-secondary);
}
.dte-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dte-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dte-btn:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dte-btn-primary { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); border-color: transparent; }
.dte-note { margin: 8px 0 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
.dte-failed { margin: 8px 0 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-state-error-primary); white-space: pre-wrap; }
.dte-hint { margin: 6px 0 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
`

let injected = false

/**
 * Inject the stylesheet once per page.
 *
 * The tag carries the two data attributes client-modules uses to claim and later
 * replace a plugin's styles during HMR, so it is skipped when a tag for this
 * plugin already exists.
 */
export function injectStyles(): void {
  if (injected || typeof document === 'undefined') return
  injected = true
  if (document.querySelector(`style[data-plugin=${JSON.stringify(NAMESPACE)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset['plugin'] = NAMESPACE
  tag.dataset['pluginCss'] = `${NAMESPACE}/card`
  tag.textContent = CSS
  document.head.appendChild(tag)
}
