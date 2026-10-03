/**
 * Thinking-intensity vocabularies and the named dialects this plugin offers.
 *
 * Everything here is pure data plus pure functions: no cordis, no settings, no
 * I/O. `src/plan.ts` consumes it to build a settings patch, `src/client/` reads
 * it to render the same choices in the GUI, and `test/` exercises it directly.
 *
 * The vocabulary is pi-ai's `ModelThinkingLevel` — the levels
 * `@deepseek-ai/dsh-llm-pi-ai` accepts in a model profile's `reasoningEfforts`
 * map. The harness copies it verbatim into the composer's reasoning picker, so
 * what a declaration offers here is exactly what a user can pick there.
 *
 * @module dsh-thinking-effort/presets
 */

/** pi-ai's thinking levels, in pi-ai's canonical escalation order. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One pi-ai thinking level. */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** Levels that appear in the composer picker as a real step up from "off". */
export const ACTIVE_LEVELS = THINKING_LEVELS.filter((level): level is Exclude<ThinkingLevel, 'off'> => level !== 'off')

/** The wire spellings pi-ai can dispatch; the dialects a profile may name. */
export const THINKING_FORMATS = [
  'openai',
  'deepseek',
  'openrouter',
  'together',
  'zai',
  'qwen',
  'chat-template',
  'qwen-chat-template',
  'string-thinking',
  'ant-ling',
] as const

/** One wire dialect for reasoning dispatch. */
export type ThinkingFormat = (typeof THINKING_FORMATS)[number]

/**
 * A level's wire spelling.
 *
 * `null` means the level is supported but dispatch sends *nothing* for it — the
 * correct spelling when "not thinking" is the absence of the parameter. A
 * string is sent as-is. Only `off` may be `null`; any other level must name the
 * value its endpoint expects.
 */
export type LevelWire = string | null

/** A declared level-to-wire map. */
export type LevelMap = Partial<Record<ThinkingLevel, LevelWire>>

/** One named thinking-intensity dialect. */
export interface DialectPreset {
  /** Stable id stored in a declaration. */
  id: string
  /** Short label for the GUI and command output. */
  label: string
  /** One line explaining which endpoints this fits. */
  summary: string
  /** The levels this dialect offers, and what each sends. */
  levels: LevelMap
  /** The dispatch dialect to pin on the model, when the preset implies one. */
  thinkingFormat?: ThinkingFormat
}

/**
 * The offered dialects, most-reached first.
 *
 * These are starting points, not laws: a relay that renames an effort is served
 * by `custom`, and every preset can be overridden field by field in a
 * declaration. `passthrough` exists for endpoints that accept pi-ai's own level
 * names unchanged and need no dialect hint.
 */
export const PRESETS: readonly DialectPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek（low / high / max）',
    summary: 'DeepSeek 官方接口及兼容中转：off 不发参数，low/high/max 走 reasoning_effort + thinking。',
    levels: { off: null, low: 'low', high: 'high', max: 'max' },
    thinkingFormat: 'deepseek',
  },
  {
    id: 'openai',
    label: 'OpenAI（none / low / medium / high）',
    summary: 'OpenAI 及大多数 OpenAI 兼容中转：off 显式发送 none，low/medium/high 走 reasoning_effort。',
    levels: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
    thinkingFormat: 'openai',
  },
  {
    id: 'openai-null-off',
    label: 'OpenAI 兼容（off 不发参数）',
    summary: '与 openai 相同，但 off 不发送 reasoning_effort —— 适用于拒绝 "none" 的中转。',
    levels: { off: null, low: 'low', medium: 'medium', high: 'high' },
    thinkingFormat: 'openai',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter（low / medium / high）',
    summary: 'OpenRouter 及其镜像：off 不发参数，low/medium/high 走 reasoning_effort。',
    levels: { off: null, low: 'low', medium: 'medium', high: 'high' },
    thinkingFormat: 'openrouter',
  },
  {
    id: 'qwen',
    label: 'Qwen（enable_thinking）',
    summary: '通义千问系：off 不发参数，low/high 经 enable_thinking / thinking_budget 派发。',
    levels: { off: null, low: 'low', high: 'high' },
    thinkingFormat: 'qwen',
  },
  {
    id: 'passthrough',
    label: '透传全部七档',
    summary: '七档全部按同名值发送，不锁定 thinking 方言 —— 适用于自己认得这些档位的网关。',
    levels: {
      off: null,
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    },
  },
] as const

/** The sentinel preset id whose levels come from the declaration itself. */
export const CUSTOM_PRESET = 'custom'

/** Preset id used when a declaration should only pin a dialect, not levels. */
export const INHERIT_PRESET = 'inherit'

/** Look up a preset by id. */
export function findPreset(id: string): DialectPreset | undefined {
  return PRESETS.find((preset) => preset.id === id)
}

/** Whether a string is a pi-ai thinking level. */
export function isThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value)
}

/** Whether a string names a dispatch dialect pi-ai understands. */
export function isThinkingFormat(value: string): value is ThinkingFormat {
  return (THINKING_FORMATS as readonly string[]).includes(value)
}

/**
 * Every reason a level map would be refused by `@deepseek-ai/dsh-llm-pi-ai`.
 *
 * `llm-pi-ai` validates a declared map only when the profile resolves, which is
 * *after* the write lands in the settings document. Reproducing its three rules
 * here lets a surface refuse a bad declaration up front, naming the level,
 * instead of storing one that silently disables the route.
 *
 * @param levels - the candidate level-to-wire map.
 * @returns one message per problem, in level order; empty means acceptable.
 */
export function validateLevels(levels: LevelMap): string[] {
  const problems: string[] = []
  const declared = THINKING_LEVELS.filter((level) => levels[level] !== undefined)
  if (declared.length === 0) {
    problems.push('未声明任何档位：至少声明一个非 off 档位，或把该模型标为不支持推理（reasoningEfforts: false）。')
    return problems
  }
  for (const level of declared) {
    const wire = levels[level]
    if (wire === null) {
      if (level !== 'off') {
        problems.push(`档位 "${level}" 必须给出要发送的值；只有 "off" 可以留空（表示"支持但不发送该参数"）。`)
      }
      continue
    }
    if (typeof wire !== 'string' || wire.length === 0) {
      problems.push(`档位 "${level}" 的发送值不能是空字符串。`)
    }
  }
  if (!declared.some((level) => level !== 'off')) {
    problems.push('只声明了 off：至少再加一个有思考的档位，否则无法调节思考强度。')
  }
  return problems
}

/** Normalize a raw level map: drop keys that are not thinking levels, keep order. */
export function normalizeLevels(raw: Record<string, LevelWire>): LevelMap {
  const levels: LevelMap = {}
  for (const level of THINKING_LEVELS) {
    const wire = raw[level]
    if (wire !== undefined) levels[level] = wire
  }
  return levels
}
