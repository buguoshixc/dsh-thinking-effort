/**
 * Text rendering shared by the `/thinking` command and the model-callable tools.
 *
 * Pure string work: both frontends print the same report, so a user reading the
 * command output and a model reading the tool result see the same facts.
 *
 * @module dsh-thinking-effort/format
 */

import { deepEqual } from './json.ts'
import {
  AUTO_FALLBACK_PRESET,
  findPreset,
  normalizeLevels,
  PRESETS,
  THINKING_LEVELS,
  type LevelWire,
} from './presets.ts'
import type { AdaptOutcome, AdaptPlan } from './auto.ts'
import type { ModelCapability, RouteCapability } from './diagnose.ts'

/** Render one declared map as `off→(不发) low→low high→high`. */
export function renderLevels(declared: Record<string, LevelWire>): string {
  return THINKING_LEVELS
    .filter((level) => declared[level] !== undefined)
    .map((level) => `${level}→${declared[level] === null ? '(不发)' : String(declared[level])}`)
    .join(' ')
}

/** One line describing a model's capability. */
function modelLine(model: ModelCapability): string {
  const head = `  - ${model.id}: `
  if (model.source === 'disabled') return `${head}已标记为不支持推理（reasoningEfforts: false）。`
  if (model.source === 'declared') {
    const levels = model.levels.length > 0 ? model.levels.join(' / ') : '(无)'
    const dialect = model.thinkingFormat === undefined ? '' : ` · 方言 ${model.thinkingFormat}`
    const bad = model.problems.length > 0 ? `\n      ⚠ ${model.problems.join('\n      ⚠ ')}` : ''
    return `${head}可调 · 档位 ${levels}${dialect}${bad}`
  }
  if (model.adjustable) return `${head}沿用内置目录的档位（本插件不覆盖）。`
  return `${head}❌ 不可调 · 未声明 reasoningEfforts 且该路由不在内置目录里。`
}

/**
 * Render the capability report.
 *
 * @param routes - reports from `analyzeRoutes`.
 * @returns a multi-line report, ending without a trailing newline.
 */
export function renderRoutes(routes: readonly RouteCapability[]): string {
  if (routes.length === 0) return '当前 profile 没有配置任何 llm-pi-ai 路由。'
  const lines: string[] = []
  for (const route of routes) {
    const tag = route.declared ? '自声明路由' : '内置目录路由'
    lines.push(`路由 ${route.provider}（${tag}）`)
    if (route.models.length === 0) lines.push('  - （没有模型条目）')
    for (const model of route.models) lines.push(modelLine(model))
  }
  const broken = routes.flatMap((route) =>
    route.models.filter((model) => !model.adjustable).map((model) => `${route.provider}/${model.id}`))
  // Names the preset auto-adaptation writes, so a user who never ran a command
  // can still learn which declaration appeared and that it is changeable. The
  // test is level-shape equality, not "7 levels": a hand-written map that happens
  // to match passthrough is indistinguishable from it and reads correctly anyway.
  const fallbackLevels = findPreset(AUTO_FALLBACK_PRESET)?.levels ?? {}
  const autoWritten = routes.some((route) =>
    route.declared && route.models.some((model) =>
      model.declared !== undefined && deepEqual(model.declared, fallbackLevels)))
  lines.push('')
  if (broken.length === 0) {
    lines.push('✅ 所有模型都可调节思考强度。')
    if (autoWritten) {
      lines.push(`   与本插件自动写入的 ${AUTO_FALLBACK_PRESET} 档位表相同的自声明路由：`)
      lines.push('   七档同名透传、不锁方言。想换档位名或方言：/thinking set <provider>/<model> <preset>。')
    }
  } else {
    lines.push(`❌ ${broken.length} 个模型无法调节思考强度：${broken.join('、')}`)
    const example = broken[0] ?? 'qiyuan/model'
    // Deliberately the safest preset, not a DeepSeek-specific one: this plugin
    // cannot tell which vendor dialect an endpoint speaks, and the generic
    // preset sends only the parameter an OpenAI-compatible endpoint already
    // understands. `/thinking explain` shows what any choice would actually send.
    lines.push(`   修复：/thinking set ${example} openai-null-off`)
    lines.push(`   不确定方言时，先看 /thinking explain ${example} 预览每档实际发送的请求参数。`)
  }
  return lines.join('\n')
}

/** Render the available dialects. */
export function renderPresets(): string {
  return [
    '可用方言预设（在 /thinking set 的第三个参数里使用）：',
    ...PRESETS.map((preset) => `  ${preset.id.padEnd(14)} ${preset.label}\n                 档位 ${renderLevels(preset.levels)}\n                 ${preset.summary}`),
    '  custom         自定义\n                 档位与发送值由调用方给出（levels）。',
    '  inherit        只固定方言/默认档位，不改动档位表。',
  ].join('\n')
}

/**
 * Render the result of an auto-adaptation pass.
 *
 * Two audiences read this text: the load-time log and the `adapt` subcommand. It
 * therefore states every write and, just as importantly, states what it refused
 * to touch — a route that is quietly skipped is the one thing a user cannot
 * discover from the capability report alone.
 *
 * @param plan - what auto-adaptation decided, from `adaptPlan`.
 * @param outcomes - one result per attempted declaration.
 * @returns a multi-line report, ending without a trailing newline.
 */
export function renderAdapt(plan: AdaptPlan, outcomes: readonly AdaptOutcome[]): string {
  const lines: string[] = []
  const perRoute = new Map<string, { preset: string; reason: string; models: number }>()
  for (const outcome of outcomes) {
    if (!outcome.ok || outcome.unchanged) continue
    const { provider, preset, reason } = outcome.adjustment
    const group = perRoute.get(provider) ?? { preset, reason, models: 0 }
    group.models += 1
    perRoute.set(provider, group)
  }
  if (perRoute.size === 0) {
    lines.push('✅ 没有需要自动声明的模型。')
  } else {
    const total = [...perRoute.values()].reduce((sum, group) => sum + group.models, 0)
    lines.push(`✅ 已自动声明 ${total} 个模型的思考强度档位：`)
    for (const [provider, group] of perRoute) {
      lines.push(`  路由 ${provider} → ${group.preset}（${group.models} 个模型）`)
      lines.push(`    ${group.reason}`)
      const preset = findPreset(group.preset)
      if (preset !== undefined) lines.push(`    档位：${renderLevels(preset.levels)}`)
    }
    lines.push('  这是可以随时改的起点：换档位名或方言用 /thinking set，预览用 /thinking explain。')
  }
  for (const outcome of outcomes) {
    if (outcome.ok) continue
    const pair = `${outcome.adjustment.provider}/${outcome.adjustment.modelId}`
    lines.push(`❌ ${pair} 写入失败：${outcome.problems.join(' ')}`)
  }
  if (plan.state.length > 0) lines.push(`  跳过（保持原样）：${plan.state.join('；')}`)
  lines.push(...plan.problems.map((line) => `⚠ ${line}`))
  return lines.join('\n')
}
