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
import { applyDeclaration, piAiDescriptor, type ApplyOutcome } from './apply.ts'
import { analyzeRoutes } from './diagnose.ts'
import { renderPresets, renderRoutes } from './format.ts'
import { findPreset, PRESETS } from './presets.ts'
import { COMMAND_NAME, type Declaration, type PiAiPort } from './types.ts'

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
  | { action: 'set'; provider: string; model: string; declaration: Declaration }

/** The usage block. */
const USAGE = [
  '用法：',
  `  /${COMMAND_NAME}                          查看每个模型的思考强度状态`,
  `  /${COMMAND_NAME} presets                  列出可用方言预设`,
  `  /${COMMAND_NAME} set <provider>/<model> <preset> [--format <方言>] [--default <档位>]`,
  `  /${COMMAND_NAME} set <provider> <model> <preset>`,
  `  /${COMMAND_NAME} remove <provider>/<model>  撤销本插件写入的档位声明`,
  '',
  '例：',
  `  /${COMMAND_NAME} set qiyuan/deepseek-v4.1 deepseek`,
  `  /${COMMAND_NAME} set qiyuan/deepseek-v4.1 openai --default high`,
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
 * Register the `/thinking` command, skipping silently when the commands service
 * is not composed into this profile.
 *
 * @param ctx - the host plugin context.
 * @param portOf - thunk returning the settings port, re-resolved on every use.
 * @param report - thunk returning the current capability report text.
 */
export function registerThinkingCommand(
  ctx: Context,
  portOf: () => PiAiPort,
  report: () => string,
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
