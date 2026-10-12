/**
 * The `/thinking` slash command.
 *
 * The command is the deterministic front door: it works from any session, needs
 * no browser, and is the surface the plugin's own diagnostics point a user at.
 * The grammar is fixed and small so a typo produces a usage line rather than a
 * silent no-op.
 *
 * @module dsh-thinking-effort/commands
 */

import type { Context } from '@deepseek-ai/cordis'
import { applyDeclaration, piAiDescriptor, profileOf, type ApplyOutcome } from './apply.ts'
import { adaptPlan, type AdaptOutcome, type AdaptPlan } from './auto.ts'
import { analyzeRoutes } from './diagnose.ts'
import { renderAdapt, renderPresets, renderRoutes } from './format.ts'
import { findPreset, normalizeLevels, PRESETS, type LevelWire } from './presets.ts'
import { COMMAND_NAME, type Declaration, type PiAiPort, type SettingsDescriptorLike } from './types.ts'
import { collapses, detectsThinkingFormat, previewWire, renderEffect, resolveSupportsReasoningEffort } from './wire.ts'

/** What a slash command returns to the framework. */
export interface CommandResult {
  kind: 'success' | 'error'
  text?: string
}

/** The minimum of `@deepseek-ai/dsh-commands` this plugin uses. */
export interface CommandsLike {
  register(definition: {
    name: string
    description: string
    handler: (invocation: { rawInput: string }) => CommandResult | Promise<CommandResult>
  }): unknown
}

/** The parsed command line. */
type Parsed =
  | { action: 'status' }
  | { action: 'presets' }
  | { action: 'help' }
  | { action: 'bad'; message: string }
  | { action: 'explain'; provider: string; model: string; preset: string | undefined }
  | { action: 'adapt'; provider: string | undefined; preset: string | undefined }
  | { action: 'set'; provider: string; model: string; declaration: Declaration }

/** The usage block. */
const USAGE = [
  '用法：',
  `  /${COMMAND_NAME}                          查看每个模型的思考强度状态`,
  `  /${COMMAND_NAME} presets                  列出可用方言预设`,
  `  /${COMMAND_NAME} explain <provider>/<model> [preset]`,
  '                                        预览每一档实际会发送的请求参数（不写入）',
  `  /${COMMAND_NAME} adapt [provider] [--preset <id>]`,
  '                                        自动给尚未声明的模型写入档位（省略 provider 即全部路由）',
  `  /${COMMAND_NAME} set <provider>/<model> <preset> [--format <方言>] [--default <档位>]`,
  `  /${COMMAND_NAME} set <provider> <model> <preset>`,
  `  /${COMMAND_NAME} remove <provider>/<model>  撤销本插件写入的档位声明`,
  '',
  '例：',
  `  /${COMMAND_NAME} explain qiyuan/deepseek-v4.1`,
  `  /${COMMAND_NAME} set qiyuan/deepseek-v4.1 deepseek-relay`,
].join('\n')

/** Split a `provider/model` or `provider model` pair. */
function splitTarget(parts: readonly string[]): { provider: string; model: string; rest: string[] } | undefined {
  const first = parts[0]
  if (first === undefined) return undefined
  if (first.includes('/')) {
    const [provider, ...tail] = first.split('/')
    if (provider === undefined || provider.length === 0) return undefined
    return { provider, model: tail.join('/'), rest: parts.slice(1) }
  }
  const second = parts[1]
  if (second === undefined) return undefined
  return { provider: first, model: second, rest: parts.slice(2) }
}

/**
 * Parse a command line. Exported so the grammar can be tested without a plugin.
 *
 * @param rawInput - everything after the command name.
 * @returns the parsed action, or a `bad` action carrying the reason.
 */
export function parseCommand(rawInput: string): Parsed {
  const parts = rawInput.trim().split(/\s+/).filter((part) => part.length > 0)
  const head = parts[0]
  if (head === undefined || head === 'status') return { action: 'status' }
  if (head === 'help' || head === '?') return { action: 'help' }
  if (head === 'presets') return { action: 'presets' }
  if (head === 'explain') {
    const target = splitTarget(parts.slice(1))
    if (target === undefined || target.provider.length === 0 || target.model.length === 0) {
      return { action: 'bad', message: 'explain 需要 <provider>/<model>。' }
    }
    const preset = target.rest[0]
    if (target.rest.length > 1) return { action: 'bad', message: `explain 多余的参数 "${target.rest[1] ?? ''}"。` }
    return { action: 'explain', provider: target.provider, model: target.model, preset }
  }
  if (head === 'adapt') {
    let provider: string | undefined
    let preset: string | undefined
    const rest = parts.slice(1)
    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index]
      if (token === undefined) continue
      if (token === '--preset') {
        const value = rest[index + 1]
        if (value === undefined) return { action: 'bad', message: '--preset 需要一个值。' }
        preset = value
        index += 1
        continue
      }
      if (token.startsWith('--')) return { action: 'bad', message: `未知的选项 "${token}"。` }
      if (provider !== undefined) return { action: 'bad', message: `多余的参数 "${token}"。` }
      provider = token
    }
    // The provider is optional and the preset is the configured default, so a
    // bad value here would only fail after a write-shaped plan was built.
    if (preset !== undefined && preset !== 'custom' && preset !== 'inherit' && findPreset(preset) === undefined) {
      return { action: 'bad', message: `未知的 preset "${preset}"；可用：${PRESETS.map((p) => p.id).join('、')}。` }
    }
    return { action: 'adapt', provider, preset }
  }
  if (head !== 'set' && head !== 'remove') {
    return { action: 'bad', message: `未知的子命令 "${head}"。` }
  }

  const target = splitTarget(parts.slice(1))
  if (target === undefined || target.provider.length === 0 || target.model.length === 0) {
    return { action: 'bad', message: '需要 <provider>/<model>。' }
  }
  if (head === 'remove') {
    return { action: 'set', provider: target.provider, model: target.model, declaration: { remove: true } }
  }

  const declaration: Declaration = {}
  let presetId: string | undefined
  for (let index = 0; index < target.rest.length; index += 1) {
    const token = target.rest[index]
    if (token === undefined) continue
    if (token === '--format' || token === '--default') {
      const value = target.rest[index + 1]
      if (value === undefined) return { action: 'bad', message: `${token} 需要一个值。` }
      if (token === '--format') declaration.thinkingFormat = value
      else declaration.defaultEffort = value
      index += 1
      continue
    }
    if (presetId === undefined) {
      presetId = token
      continue
    }
    return { action: 'bad', message: `多余的参数 "${token}"。` }
  }
  if (presetId === undefined) return { action: 'bad', message: '需要 preset（用 presets 查看）。' }
  if (presetId !== 'custom' && presetId !== 'inherit' && findPreset(presetId) === undefined) {
    return { action: 'bad', message: `未知的 preset "${presetId}"；可用：${PRESETS.map((p) => p.id).join('、')}。` }
  }
  declaration.preset = presetId
  return { action: 'set', provider: target.provider, model: target.model, declaration }
}

/**
 * Apply the auto-adaptation plan for every route that has no declaration yet.
 *
 * This is the one place a batch of declarations is written, shared by the
 * `adapt` subcommand and the load-time pass so both report the same facts. The
 * descriptor is passed in rather than re-read: the load-time caller needs to
 * know whether the adapter was mounted at all, and a second read could disagree
 * with the first.
 *
 * Writes are serial, not concurrent: `settings.update` is revision-fenced, and
 * two overlapping merges into the same section would make one of them lose the
 * revision race for no gain.
 *
 * @param port - the settings port.
 * @param descriptor - the resolved `llm-pi-ai` descriptor.
 * @param declaredRoutes - provider keys the adapter reports as configuration-declared only.
 * @param provider - restrict the pass to one route, when given.
 * @param fallback - the preferred preset for routes with no vendor signal.
 * @returns the plan and one outcome per attempted declaration.
 */
export async function adaptDeclaredModels(
  port: PiAiPort,
  descriptor: SettingsDescriptorLike,
  declaredRoutes: Iterable<string>,
  provider: string | undefined,
  fallback: string,
): Promise<{ plan: AdaptPlan; outcomes: AdaptOutcome[] }> {
  const full = adaptPlan(descriptor.value, declaredRoutes, fallback)
  const plan = provider === undefined
    ? full
    : {
      adjustments: full.adjustments.filter((adjustment) => adjustment.provider === provider),
      // Problems and skipped-state lines are keyed on the route, so the scope is
      // decided here rather than by the planner: a `provider` argument must not
      // report a different route's trouble as if it were this one's.
      state: full.state.filter((line) => line.startsWith(`${provider}/`)),
      problems: full.problems.filter((line) => line.startsWith(`路由 "${provider}"`)),
    }
  // The plan's reasoning rides along with each write result, so the renderer can
  // say *why* a route got this preset without recomputing the detection.
  const outcomes: AdaptOutcome[] = []
  for (const adjustment of plan.adjustments) {
    const applied = await applyDeclaration(
      port,
      adjustment.provider,
      adjustment.modelId,
      { preset: adjustment.preset },
    )
    outcomes.push({ adjustment, ...applied })
  }
  return { plan, outcomes }
}

/** Render the outcome of one apply. */
function renderOutcome(target: string, outcome: ApplyOutcome): CommandResult {
  if (!outcome.ok) {
    return { kind: 'error', text: `❌ ${target}\n${outcome.problems.map((line) => `  ${line}`).join('\n')}` }
  }
  if (outcome.unchanged) {
    return { kind: 'success', text: `✅ ${target} 已经是该声明，未做改动。` }
  }
  const notes = outcome.notes.length === 0 ? '' : `\n${outcome.notes.map((line) => `  ${line}`).join('\n')}`
  return {
    kind: 'success',
    text: `✅ 已写入 ${target} 的思考强度声明。${notes}\n  下一步：在输入框的模型选择器里展开「推理等级」即可调节；新会话默认档位取自 agent-default-model。`,
  }
}

/**
 * Preview what a declaration actually sends, level by level.
 *
 * Without a preset this reads the model's declaration as it stands; with one it
 * previews that preset as if applied. Either way it writes nothing — the point
 * is to make "which dialect does my relay want" an inspection rather than a
 * guess, since an endpoint that does not know a parameter usually ignores it
 * instead of failing.
 *
 * @param port - the settings port.
 * @param provider - provider route key.
 * @param modelId - model id within that route.
 * @param presetId - a preset to preview, or `undefined` for the current declaration.
 * @returns the rendered preview, or a message explaining why there is nothing to show.
 */
export function explainModel(
  port: PiAiPort,
  provider: string,
  modelId: string,
  presetId: string | undefined,
): string {
  const descriptor = piAiDescriptor(port)
  if (descriptor === undefined) {
    return `settings 条目 "${port.ns}" 未注册：没有可预览的第三方(pi-ai)适配器。`
  }
  const profile = profileOf(descriptor.value, provider)
  if (profile === undefined) return `路由 "${provider}" 尚未配置。`
  const entry = (Array.isArray(profile.models) ? profile.models : []).find((model) => model?.id === modelId)
  if (entry === undefined) return `路由 "${provider}" 的 models 列表里没有 "${modelId}"。`

  const header = `路由 ${provider} · ${modelId}`
  const detected = detectsThinkingFormat(provider, typeof profile['baseURL'] === 'string' ? profile['baseURL'] : undefined)
  const supports = resolveSupportsReasoningEffort(
    entry.compat, profile.compat, provider,
    typeof profile['baseURL'] === 'string' ? profile['baseURL'] : undefined,
  )

  let levels = entry.reasoningEfforts
  let origin: string
  if (presetId !== undefined) {
    const preset = findPreset(presetId)
    if (preset === undefined) {
      return `未知的预设 "${presetId}"；可用：${PRESETS.map((entry) => entry.id).join('、')}。`
    }
    levels = preset.levels
    origin = `预设 ${preset.id}（预览，未写入）`
  } else if (levels === undefined || levels === false) {
    return [
      header,
      '  该模型当前没有声明 reasoningEfforts，因此 pi-ai 收到的是 reasoning:false，选择器不会出现。',
      `  用 /${COMMAND_NAME} set ${provider}/${modelId} <preset> 声明；先看 /${COMMAND_NAME} presets。`,
    ].join('\n')
  } else {
    const compat = entry.compat
    const pinned = typeof compat === 'object' && compat !== null
      ? (compat as Record<string, unknown>)['thinkingFormat']
      : undefined
    origin = typeof pinned === 'string'
      ? `当前声明（锁定方言 ${pinned}）`
      : `当前声明（未锁方言，pi-ai 会按端点检测为 ${detected}）`
  }

  const pinnedFormat = presetId !== undefined
    ? findPreset(presetId)?.thinkingFormat
    : (typeof entry.compat === 'object' && entry.compat !== null
      ? (entry.compat as Record<string, unknown>)['thinkingFormat'] as string | undefined
      : undefined)
  const effective = pinnedFormat ?? detected
  const effects = previewWire(normalizeLevels(levels as Record<string, LevelWire>), effective, supports)
  const collisions = collapses(effects)

  return [
    header,
    `  ${origin}`,
    `  实际生效的方言：${effective}${pinnedFormat === undefined ? `（由端点检测得出）` : '（声明锁定）'}`
      + `${pinnedFormat !== undefined && pinnedFormat !== detected ? ` · 注意：检测结果本应是 ${detected}` : ''}`,
    `  compat.supportsReasoningEffort：${supports}`,
    '',
    '  每档实际发送的参数：',
    ...effects.map((effect) => `    ${renderEffect(effect)}`),
    ...(collisions.length === 0 ? [] : ['', ...collisions.map((line) => `  ⚠ ${line}`)]),
  ].join('\n')
}

/**
 * Register the `/thinking` command, skipping silently when the commands service
 * is not composed into this profile.
 *
 * @param ctx - the host plugin context.
 * @param portOf - thunk returning the settings port, re-resolved on every use.
 * @param report - thunk returning the current capability report text.
 * @param declaredRoutes - thunk returning provider keys that exist only because configuration declared them.
 * @param preferredPreset - thunk returning the preset auto-adaptation prefers, re-read so a config edit applies without a restart.
 */
export function registerThinkingCommand(
  ctx: Context,
  portOf: () => PiAiPort,
  report: () => string,
  declaredRoutes: () => string[],
  preferredPreset: () => string,
): void {
  ctx.inject(['commands'], (scoped) => {
    const commands = (scoped as unknown as { commands: CommandsLike }).commands
    commands.register({
      name: COMMAND_NAME,
      description: '查看并声明第三方 provider 的思考强度（推理等级）。',
      handler: async ({ rawInput }): Promise<CommandResult> => {
        const parsed = parseCommand(rawInput)
        if (parsed.action === 'help') return { kind: 'success', text: USAGE }
        if (parsed.action === 'bad') return { kind: 'error', text: `❌ ${parsed.message}\n\n${USAGE}` }
        if (parsed.action === 'presets') return { kind: 'success', text: renderPresets() }
        if (parsed.action === 'status') return { kind: 'success', text: `${report()}\n\n${USAGE}` }
        if (parsed.action === 'explain') {
          return { kind: 'success', text: explainModel(portOf(), parsed.provider, parsed.model, parsed.preset) }
        }
        if (parsed.action === 'adapt') {
          const port = portOf()
          const descriptor = piAiDescriptor(port)
          if (descriptor === undefined) {
            return {
              kind: 'error',
              text: `❌ settings 条目 "${port.ns}" 未注册：该 profile 没有挂载第三方(pi-ai)适配器，无需适配。`,
            }
          }
          const fallback = parsed.preset ?? preferredPreset()
          const result = await adaptDeclaredModels(
            port, descriptor, declaredRoutes(), parsed.provider, fallback,
          )
          const text = renderAdapt(result.plan, result.outcomes)
          const failed = result.outcomes.filter((outcome) => !outcome.ok).length
          return { kind: failed > 0 ? 'error' : 'success', text }
        }
        const target = `${parsed.provider}/${parsed.model}`
        const outcome = await applyDeclaration(portOf(), parsed.provider, parsed.model, parsed.declaration)
        return renderOutcome(target, outcome)
      },
    })
  })
}

/** A throwing-safe capability report for the current port. */
export function capabilityReport(port: PiAiPort, declaredRoutes: Iterable<string>): string {
  const descriptor = piAiDescriptor(port)
  if (descriptor === undefined) {
    return `settings 条目 "${port.ns}" 未注册：该 profile 没有挂载第三方(pi-ai)适配器，无需调节。`
  }
  return renderRoutes(analyzeRoutes(descriptor.value, declaredRoutes))
}
