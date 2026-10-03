/**
 * The settings card: Settings → Plugins → Configurable.
 *
 * It shows, per route and model, whether thinking intensity is adjustable — and
 * lets the user declare it with one dropdown instead of hand-editing
 * `settings.yaml`. This is the click-driven twin of `/thinking`.
 *
 * ## Data path
 *
 * The card binds TWO namespaces:
 *
 * - `llm-pi-ai` — read for the live capability report, written when the user
 *   applies a dialect;
 * - its own card is registered under this plugin's namespace key, which is what
 *   the keyed `settings.plugin.item` slot expects.
 *
 * ## Why the write merges the user layer by hand
 *
 * `settingsScope.set(field, value)` addresses one TOP-LEVEL field and replaces
 * it, so writing `providers` would drop any other provider override the user
 * already had. The card therefore reads the stored user layer out of the
 * snapshot, merges the single route into it, and writes the result back — the
 * same one-route-at-a-time shape the host half gets from `settings.update`'s
 * recursive merge.
 *
 * @module dsh-thinking-effort/client/card
 */

import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { profileOf } from '../apply.ts'
import { analyzeRoutes, type ModelCapability, type RouteCapability } from '../diagnose.ts'
import { isPlainObject } from '../json.ts'
import { planDeclaration } from '../plan.ts'
import { PRESETS } from '../presets.ts'
import { LLM_PI_AI_NAMESPACE, NAMESPACE } from '../types.ts'
import type { SettingsScopeLike, SettingsSnapshot } from './types.ts'

/** The sentinel a select carries for "remove what this plugin wrote". */
const REMOVE = '__remove__'

/** Badge text plus whether it reads as a problem. */
function badgeOf(model: ModelCapability): { text: string, bad: boolean } {
  if (model.source === 'disabled') return { text: '已停用推理', bad: false }
  if (model.source === 'declared') {
    if (model.problems.length > 0) return { text: '声明有误', bad: true }
    return { text: `可调 · ${model.levels.join('/')}`, bad: model.levels.length <= 1 }
  }
  return { text: '未声明', bad: true }
}

/** The hint under a model row. */
function hintOf(model: ModelCapability, provider: string): string | undefined {
  if (model.source === 'declared') {
    const dialect = model.thinkingFormat === undefined ? '' : `，方言 ${model.thinkingFormat}`
    return model.problems.length > 0
      ? `llm-pi-ai 会拒绝这份声明：${model.problems.join(' ')}`
      : `已声明档位${dialect}，在模型选择器的「推理等级」里可选。`
  }
  if (model.source === 'disabled') return 'reasoningEfforts: false —— 该模型被标记为不支持推理。'
  return `未声明 reasoningEfforts。第三方路由（没有内置目录条目）因此不支持推理等级，`
    + `这正是无法调节思考强度的原因；选一个方言后点「应用」即可，例如 ${provider}/${model.id}。`
}

/** Apply one preset (or a removal) to one model by merging the stored user layer. */
async function applyDeclaration(
  scope: SettingsScopeLike,
  provider: string,
  modelId: string,
  presetId: string,
): Promise<string> {
  const snapshot = scope.getSnapshot()
  const declaration = presetId === REMOVE ? { remove: true } : { preset: presetId }
  const plan = planDeclaration({
    provider,
    modelId,
    declaration,
    profile: profileOf(snapshot.value, provider),
  })
  if (!plan.ok) throw new Error(plan.problems.join('\n'))
  if (plan.unchanged) return `${provider}/${modelId} 已经是该声明，未做改动。`

  const user = isPlainObject(snapshot.user) ? snapshot.user : {}
  const userProviders = isPlainObject(user['providers']) ? user['providers'] as Record<string, unknown> : {}
  const routeUser = isPlainObject(userProviders[provider]) ? userProviders[provider] as Record<string, unknown> : {}
  await scope.set('providers', {
    ...userProviders,
    [provider]: { ...routeUser, ...plan.patch },
  })
  const notes = plan.notes.length === 0 ? '' : `（${plan.notes.join(' ')}）`
  return `已写入 ${provider}/${modelId} 的思考强度声明。${notes}`
}

/** One model row. */
function ModelRow(props: {
  provider: string
  model: ModelCapability
  draft: string
  busy: boolean
  writable: boolean
  onDraft: (value: string) => void
  onApply: (preset: string) => void
}): React.ReactElement {
  const { provider, model, draft, busy, writable } = props
  const badge = badgeOf(model)
  const hint = hintOf(model, provider)
  return React.createElement(
    'div',
    { className: 'dte-model' },
    React.createElement('span', { className: 'dte-model-id', title: model.id }, model.id),
    React.createElement(
      'span',
      { className: `dte-badge${badge.bad ? ' dte-badge-bad' : ' dte-badge-ok'}` },
      badge.text,
    ),
    React.createElement(
      'select',
      {
        className: 'dte-select',
        value: draft,
        disabled: !writable || busy,
        'aria-label': `${provider}/${model.id} 的思考强度方言`,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => props.onDraft(event.target.value),
      },
      PRESETS.map((preset) => React.createElement(
        'option',
        { key: preset.id, value: preset.id },
        `${preset.label}`,
      )),
      React.createElement('option', { key: REMOVE, value: REMOVE }, '撤销声明'),
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dte-btn dte-btn-primary',
        disabled: !writable || busy,
        onClick: () => props.onApply(draft),
      },
      busy ? '写入中…' : '应用',
    ),
    hint === undefined ? null : React.createElement('p', { className: 'dte-hint' }, hint),
  )
}

/** One route block. */
function RouteBlock(props: {
  route: RouteCapability
  drafts: Record<string, string>
  busyKey: string | undefined
  writable: boolean
  onDraft: (key: string, value: string) => void
  onApply: (provider: string, modelId: string, preset: string) => void
}): React.ReactElement {
  const { route } = props
  return React.createElement(
    'div',
    { className: 'dte-route' },
    React.createElement(
      'p',
      { className: 'dte-route-name' },
      route.provider,
      React.createElement('span', { className: 'dte-route-tag' }, 'llm-pi-ai 路由'),
    ),
    route.models.length === 0
      ? React.createElement('p', { className: 'dte-note' }, '该路由没有模型条目。')
      : route.models.map((model) => {
        const key = `${route.provider}/${model.id}`
        return React.createElement(ModelRow, {
          key,
          provider: route.provider,
          model,
          draft: props.drafts[key] ?? PRESETS[0]?.id ?? 'deepseek',
          busy: props.busyKey === key,
          writable: props.writable,
          onDraft: (value: string) => props.onDraft(key, value),
          onApply: (preset: string) => props.onApply(route.provider, model.id, preset),
        })
      }),
  )
}

/** A read-only explainer card, shown instead of vanishing. */
function statusCard(title: string, ...body: string[]): React.ReactElement {
  return React.createElement(
    'li',
    { className: 'dte-card' },
    React.createElement(
      'div',
      { className: 'dte-body' },
      React.createElement('p', { className: 'dte-status-title' }, title),
      ...body.map((line, index) => React.createElement('p', { key: index, className: 'dte-status-body' }, line)),
    ),
  )
}

/**
 * The card component.
 *
 * Every hook runs before any early return: the namespace moves from `loading`
 * to `ready` and re-renders, and a hook declared after a return would change the
 * hook count between renders — the failure mode that crashes a card in this
 * exact slot.
 *
 * @param props - the bound scope, or undefined when the settings page is absent.
 * @returns the card element, or a status element.
 */
function Card({ scope }: { scope: SettingsScopeLike | undefined }): React.ReactElement {
  const [, forceRender] = React.useReducer((count: number) => count + 1, 0)
  const [open, setOpen] = React.useState(false)
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [busyKey, setBusyKey] = React.useState<string | undefined>(undefined)
  const [note, setNote] = React.useState<string | undefined>(undefined)
  const [failed, setFailed] = React.useState<string | undefined>(undefined)
  React.useEffect(() => (scope === undefined ? undefined : scope.subscribe(forceRender)), [scope])

  if (scope === undefined) {
    return statusCard(
      '思考强度卡片未挂载',
      '设置服务（settingsScope）未提供。web profile（dsh-web-app）自带该服务；命令行下请改用 /thinking。',
    )
  }

  const snapshot: SettingsSnapshot = scope.getSnapshot()
  if (snapshot.status === 'unavailable') {
    return statusCard(
      `${LLM_PI_AI_NAMESPACE} 命名空间不可用`,
      '当前 profile 没有挂载 llm-pi-ai 适配器，或设置文档只读。命令行可运行 /thinking 查看详情。',
    )
  }
  if (snapshot.status !== 'ready') {
    return statusCard('正在读取 llm-pi-ai 配置…', '数据到达后本卡片会自动切换为可编辑状态。')
  }

  const routes = analyzeRoutes(snapshot.value)
  const apply = (provider: string, modelId: string, preset: string): void => {
    const key = `${provider}/${modelId}`
    setBusyKey(key)
    setNote(undefined)
    setFailed(undefined)
    void applyDeclaration(scope, provider, modelId, preset)
      .then((message) => setNote(message))
      .catch((error: unknown) => setFailed(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusyKey(undefined))
  }

  return React.createElement(
    'li',
    { className: open ? 'dte-card dte-card-open' : 'dte-card' },
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dte-header',
        'aria-expanded': open,
        onClick: () => setOpen(!open),
      },
      React.createElement(
        'span',
        { className: 'dte-head-text' },
        React.createElement('span', { className: 'dte-name' }, '思考强度（第三方 API Key）'),
        React.createElement(
          'span',
          { className: 'dte-description' },
          `为 llm-pi-ai 路由声明推理等级 · ${NAMESPACE}`,
        ),
      ),
      chevron(open),
    ),
    open
      ? React.createElement(
        'div',
        { className: 'dte-body' },
        !snapshot.writable
          ? React.createElement('p', { className: 'dte-note', role: 'status' }, '设置文档当前只读，无法写入。')
          : null,
        routes.length === 0
          ? React.createElement('p', { className: 'dte-note' }, 'llm-pi-ai 下还没有任何 provider 路由。')
          : routes.map((route) => React.createElement(RouteBlock, {
            key: route.provider,
            route,
            drafts,
            busyKey,
            writable: snapshot.writable,
            onDraft: (key: string, value: string) => setDrafts((current) => ({ ...current, [key]: value })),
            onApply: apply,
          })),
        note === undefined ? null : React.createElement('p', { className: 'dte-note', role: 'status' }, note),
        failed === undefined ? null : React.createElement('p', { className: 'dte-failed', role: 'status' }, failed),
        React.createElement(
          'p',
          { className: 'dte-hint' },
          '写入落在 llm-pi-ai 的用户层，只影响所选路由；保存后立即生效，无需重启。',
          '命令行等价操作：/thinking set <provider>/<model> <preset>。',
        ),
      )
      : null,
  )
}

/** The card's expand chevron, matching the built-in settings cards. */
function chevron(open: boolean): React.ReactElement {
  return React.createElement(
    'svg',
    {
      className: open ? 'dte-chevron dte-chevron-open' : 'dte-chevron',
      width: 14,
      height: 14,
      viewBox: '0 0 14 14',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': true,
    },
    React.createElement('path', {
      d: 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732C6.59876 8.24849C6.74023 8.3623C6.87291 8.46904C6.92272 8.47813C6.9375 8.48047C6.97895 8.48703C7.02105 8.48703C7.0625 8.48047C7.07728 8.47813C7.12709 8.46904C7.25977 8.3623C7.40124 8.24849C7.57405 8.07732C7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z',
      fill: 'currentColor',
    }),
  )
}

/**
 * Register the card on the `settings.plugins.tab` slot.
 *
 * A tab rather than a `settings.plugin.item` card: that slot is keyed by
 * settings entry id, so a custom card there competes with the entry's own
 * generated page, while a tab is a plain list entry that cannot collide.
 *
 * @param ctx - the client plugin context.
 */
export function registerCard(ctx: Context): void {
  const binder = ctx.get('settingsScope') as { bind(spec: { namespace: string }): SettingsScopeLike } | undefined
  const scope = binder === undefined ? undefined : binder.bind({ namespace: LLM_PI_AI_NAMESPACE })
  if (binder === undefined) {
    console.warn(`[${NAMESPACE}] settingsScope service absent; the card shows the unmounted state`)
  }
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
    { name: 'settings.plugins.tab', id: NAMESPACE, order: 30, label: '思考强度' },
    () => React.createElement(Card, { scope }),
  ))
}
