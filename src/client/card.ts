/**
 * The plugin's configuration page: sidebar **Plugins** → `dsh-thinking-effort`.
 *
 * It shows, per route and model, whether thinking intensity is adjustable — and
 * lets the user declare it with one dropdown instead of hand-editing
 * `settings.yaml`. This is the click-driven twin of `/thinking`.
 *
 * ## Where the page lives in dsh 0.2.1
 *
 * A third-party installed bundle renders its own configuration on its bundle
 * page, through the `plugins.bundle.config` keyed slot (key = npm package name).
 * `settings.plugins.tab` is the built-in plugins inventory; its owner's README
 * says configuration happens on the Plugins page, so that is where this card
 * registers. The page draws the title, icon and crumb; this component renders
 * only its body (`div`, never a list item).
 *
 * ## Data path
 *
 * The card reads and writes the `llm-pi-ai` namespace through the settings
 * domain's shared `configForms` service: `ctx.configForms.get('llm-pi-ai')`
 * returns the same form every editor of that entry uses, so the GUI, the slash
 * command and the tools always agree. Writes are path-addressed
 * (`providers.<route>…`), atomic, and revision-fenced by the service — never
 * `set('providers', …)`, which would replace every route in the user layer.
 *
 * The card only exists while the Host serves the namespace: it registers through
 * `configForms.whileServed`, so a profile without the pi-ai adapter shows no
 * trace of it.
 *
 * @module dsh-thinking-effort/client/card
 */

import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { profileOf } from '../apply.ts'
import { analyzeRoutes, type ModelCapability, type RouteCapability } from '../diagnose.ts'
import { planDeclaration, settingsOps } from '../plan.ts'
import { PRESETS } from '../presets.ts'
import { LLM_PI_AI_NAMESPACE, NAMESPACE } from '../types.ts'
import type { ConfigFormLike, ConfigFormsLike } from './types.ts'

/** The sentinel a select carries for "remove what this plugin wrote". */
const REMOVE = '__remove__'

/** The slot a plugin's own bundle page declares for its configuration. */
const BUNDLE_CONFIG_SLOT = 'plugins.bundle.config'

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

/**
 * Apply one preset (or a removal) to one model with one atomic, revision-fenced
 * path-op write.
 *
 * @param form - the shared `llm-pi-ai` form.
 * @param provider - provider route key.
 * @param modelId - model id within that route.
 * @param presetId - a preset id, or {@link REMOVE}.
 * @returns the user-facing result message.
 */
async function applyDeclaration(
  form: ConfigFormLike,
  provider: string,
  modelId: string,
  presetId: string,
): Promise<string> {
  const snapshot = form.getSnapshot()
  const declaration = presetId === REMOVE ? { remove: true } : { preset: presetId }
  const plan = planDeclaration({
    provider,
    modelId,
    declaration,
    profile: profileOf(snapshot.value, provider),
  })
  if (!plan.ok) throw new Error(plan.problems.join('\n'))
  if (plan.unchanged) return `${provider}/${modelId} 已经是该声明，未做改动。`

  const ops = settingsOps(provider, plan.patch)
  if (ops.length === 0) return `${provider}/${modelId} 已经是该声明，未做改动。`
  const accepted = await form.mutate(ops)
  if (!accepted) throw new Error('写入被 Host 拒绝：设置可能已被并发修改，请重试。')
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

/** A read-only explainer panel, shown instead of vanishing. */
function statusCard(title: string, ...body: string[]): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'dte-card' },
    React.createElement('p', { className: 'dte-status-title' }, title),
    ...body.map((line, index) => React.createElement('p', { key: index, className: 'dte-status-body' }, line)),
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
 * @param props - the form injected by {@link registerCard}.
 * @returns the configuration panel, or a status panel.
 */
function Card({ form }: { form: ConfigFormLike }): React.ReactElement {
  const [, forceRender] = React.useReducer((count: number) => count + 1, 0)
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [busyKey, setBusyKey] = React.useState<string | undefined>(undefined)
  const [note, setNote] = React.useState<string | undefined>(undefined)
  const [failed, setFailed] = React.useState<string | undefined>(undefined)
  React.useEffect(() => form.subscribe(forceRender), [form])

  const snapshot = form.getSnapshot()
  if (snapshot.status === 'unavailable') {
    return statusCard(
      `${LLM_PI_AI_NAMESPACE} 命名空间不可用`,
      '当前 profile 没有挂载 llm-pi-ai 适配器，或设置文档只读。命令行可运行 /thinking 查看详情。',
    )
  }
  if (snapshot.status !== 'ready' || snapshot.value === undefined) {
    return statusCard('正在读取 llm-pi-ai 配置…', '数据到达后本页面会自动切换为可编辑状态。')
  }

  const routes = analyzeRoutes(snapshot.value)
  const apply = (provider: string, modelId: string, preset: string): void => {
    const key = `${provider}/${modelId}`
    setBusyKey(key)
    setNote(undefined)
    setFailed(undefined)
    void applyDeclaration(form, provider, modelId, preset)
      .then((message) => setNote(message))
      .catch((error: unknown) => setFailed(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusyKey(undefined))
  }

  return React.createElement(
    'div',
    { className: 'dte-card' },
    React.createElement('p', { className: 'dte-section-title' }, '思考强度（第三方 API Key）'),
    React.createElement(
      'p',
      { className: 'dte-hint' },
      '为 llm-pi-ai 路由声明推理等级；写入落在 llm-pi-ai 的用户层，只影响所选路由，保存后立即生效。',
    ),
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
      '命令行等价操作：/thinking set <provider>/<model> <preset>。',
    ),
  )
}

/**
 * Register the card on the Plugins page for this bundle.
 *
 * `plugins.bundle.config` is keyed by the npm package name, and the page passes
 * no form for a bundle-wide entry (a bundle can carry several Host entries), so
 * the card obtains its own `llm-pi-ai` form through the slot's `inject` face.
 *
 * The registration is wrapped in `ctx.effect`: `whileServed`'s disposer is
 * caller-owned, and a profile that never serves `llm-pi-ai` must show no trace
 * of the page.
 *
 * @param ctx - the client plugin context.
 * @param forms - the settings domain's shared forms service.
 */
export function registerCard(ctx: Context, forms: ConfigFormsLike): void {
  ctx.effect(
    () => forms.whileServed([LLM_PI_AI_NAMESPACE], () => ctx.slots.inject(
      BUNDLE_CONFIG_SLOT,
      () => ctx.slots.register(
        {
          name: BUNDLE_CONFIG_SLOT,
          key: NAMESPACE,
          registrant: NAMESPACE,
          inject: () => ({ configForm: forms.get(LLM_PI_AI_NAMESPACE) }),
        },
        ({ configForm }: { configForm: ConfigFormLike }) => React.createElement(Card, { form: configForm }),
      ),
    )),
    `${NAMESPACE}: plugins page card`,
  )
}
