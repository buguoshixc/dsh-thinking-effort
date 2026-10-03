/**
 * The model-callable tools.
 *
 * They exist so a user can fix a route conversationally — "这个模型调不了思考强度，
 * 帮我声明成 DeepSeek 方言" — without learning the slash-command grammar. Both
 * tools are thin wrappers over the same pure planner the command uses, so a tool
 * call and a command line can never disagree.
 *
 * @module dsh-thinking-effort/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { applyDeclaration, type ApplyOutcome } from './apply.ts'
import { PRESETS } from './presets.ts'
import type { Declaration, PiAiPort } from './types.ts'

/** The minimum of `@deepseek-ai/dsh-tools`' runtime this plugin uses. */
export interface ToolsLike {
  register(tool: unknown): unknown
}

/** Render one apply outcome as plain text for the model. */
function renderOutcome(target: string, outcome: ApplyOutcome): string {
  if (!outcome.ok) return `失败：${target}\n${outcome.problems.join('\n')}`
  if (outcome.unchanged) return `${target} 已经是该声明，未做改动。`
  const notes = outcome.notes.length === 0 ? '' : `\n${outcome.notes.join('\n')}`
  return `已写入 ${target} 的思考强度声明。${notes}`
}

/**
 * Register both tools.
 *
 * @param ctx - the host plugin context.
 * @param portOf - thunk returning the settings port, re-resolved on every use.
 * @param report - thunk returning the current capability report text.
 */
export function registerThinkingTools(
  ctx: Context,
  portOf: () => PiAiPort,
  report: () => string,
): void {
  ctx.inject(['tools'], (scoped) => {
    const tools = (scoped as unknown as { tools: ToolsLike }).tools
    tools.register(defineTool({
      name: 'thinking_effort_status',
      description: 'Report which provider/model routes can adjust thinking intensity (reasoning effort). '
        + 'Call this first when the user says they cannot change a model\'s thinking level.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async () => report(),
    }))

    scoped.tools.register(defineTool({
      name: 'thinking_effort_set',
      description: 'Declare thinking-intensity levels for a provider/model route so the composer\'s reasoning '
        + 'picker offers them. Use it for a third-party API-key route (e.g. an OpenAI-compatible relay) whose '
        + 'models report no reasoning support.',
      parameters: {
        provider: { type: 'string', required: true, description: 'Provider route key, e.g. qiyuan' },
        model: { type: 'string', required: true, description: 'Model id within that route, e.g. deepseek-v4.1' },
        preset: {
          type: 'string',
          required: true,
          description: `Dialect preset id. One of: ${PRESETS.map((entry) => entry.id).join(', ')}, `
            + 'custom (levels come from the caller), inherit (only pin dialect / default level).',
        },
        thinkingFormat: {
          type: 'string',
          description: 'Override the dispatch dialect, e.g. deepseek, openai, openrouter, qwen, zai, together.',
        },
        defaultEffort: {
          type: 'string',
          description: 'Route-level default level for new sessions, e.g. high.',
        },
        remove: {
          type: 'boolean',
          description: 'Remove the declaration this plugin wrote instead of writing one.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        const declaration: Declaration = { preset: args.preset }
        if (args.thinkingFormat !== undefined) declaration.thinkingFormat = args.thinkingFormat
        if (args.defaultEffort !== undefined) declaration.defaultEffort = args.defaultEffort
        if (args.remove === true) declaration.remove = true
        const outcome = await applyDeclaration(portOf(), args.provider, args.model, declaration)
        return renderOutcome(`${args.provider}/${args.model}`, outcome)
      },
    }))
  })
}
