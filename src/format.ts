/**
 * Text rendering shared by the `/thinking` command and the model-callable tools.
 *
 * Pure string work: both frontends print the same report, so a user reading the
 * command output and a model reading the tool result see the same facts.
 *
 * @module dsh-thinking-effort/format
 */

import { PRESETS, THINKING_LEVELS, type LevelWire } from './presets.ts'
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
  lines.push('')
  if (broken.length === 0) {
    lines.push('✅ 所有模型都可调节思考强度。')
  } else {
    lines.push(`❌ ${broken.length} 个模型无法调节思考强度：${broken.join('、')}`)
    lines.push(`   修复：/thinking set <provider>/<model> <preset>，例如 /thinking set ${broken[0] ?? 'qiyuan/model'} deepseek`)
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
