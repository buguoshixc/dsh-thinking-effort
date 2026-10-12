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
 * The offered dialects, safest first.
 *
 * These are starting points, not laws: a relay that renames an effort is served
 * by `custom`, and every preset can be overridden field by field in a
 * declaration.
 *
 * The order is deliberate. Pinning a `thinkingFormat` *replaces* the dialect
 * pi-ai would have detected from the endpoint, and each dialect is a separate
 * branch that suppresses the generic OpenAI path — so a wrong pin can make a
 * level do nothing while appearing to work. The presets that send only the
 * standard `reasoning_effort` come first, and the ones that add a vendor-private
 * parameter say so. `deepseek-relay` exists precisely for the common case this
 * distinction bites: a third-party gateway serving DeepSeek models, which wants
 * DeepSeek's level *names* but not DeepSeek's private wire parameter.
 *
 * Run `/thinking explain <provider>/<model>` to see the resulting request
 * parameters for a route instead of trusting a summary.
 */
export const PRESETS: readonly DialectPreset[] = [
  {
    id: 'openai-null-off',
    label: 'OpenAI 兼容（只发 reasoning_effort）',
    summary: '发送 reasoning_effort；off 什么都不发。对任何 OpenAI 兼容端点都安全——不确定时先试这个。',
    levels: { off: null, low: 'low', medium: 'medium', high: 'high' },
  },
  {
    id: 'openai',
    label: 'OpenAI（off 显式发 none）',
    summary: '发送 reasoning_effort；off 显式发送 "none"。端点是 OpenAI 官方、或明确接受 none 时用。',
    levels: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
  },
  {
    id: 'deepseek-relay',
    label: 'DeepSeek 档位名 + 通用参数（中转站推荐）',
    summary: '档位沿用 DeepSeek 的命名（low/high/max），但只发 reasoning_effort，不锁方言。'
      + '服务 DeepSeek 模型的中转站通常属于这一类。',
    levels: { off: null, low: 'low', high: 'high', max: 'max' },
  },
  {
    id: 'deepseek',
    label: 'DeepSeek 官方（含 thinking 参数）',
    summary: '除 reasoning_effort 外还会发送 DeepSeek 私有的 thinking:{type:enabled|disabled}。'
      + '仅当端点确实是 DeepSeek 官方或严格兼容时使用；通用中转多半不认这个参数，会让 off 看起来失效。',
    levels: { off: null, low: 'low', high: 'high', max: 'max' },
    thinkingFormat: 'deepseek',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter（嵌套 reasoning.effort）',
    summary: '发送嵌套的 reasoning:{effort}；off 发送 reasoning:{effort:"none"}。OpenRouter 及其镜像专用。',
    levels: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
    thinkingFormat: 'openrouter',
  },
  {
    id: 'qwen',
    label: 'Qwen（enable_thinking）',
    summary: '发送 enable_thinking 布尔值，选中档位时附带 reasoning_effort。通义千问系专用。',
    levels: { off: null, low: 'low', high: 'high' },
    thinkingFormat: 'qwen',
  },
  {
    id: 'passthrough',
    label: '透传全部七档（不锁方言）',
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

/**
 * The preset a surface pre-selects, and the fallback for an unusable preference.
 *
 * Deliberately the first row of {@link PRESETS}: it sends only the parameter an
 * OpenAI-compatible endpoint already understands, so a plugin that has been
 * configured with a typo still degrades to a working control instead of failing.
 */
export const DEFAULT_PRESET = 'openai-null-off'

/** Look up a preset by id. */
export function findPreset(id: string): DialectPreset | undefined {
  return PRESETS.find((preset) => preset.id === id)
}

/**
 * The preset auto-adaptation writes when no vendor signal justifies another.
 *
 * `passthrough` sends all seven levels under their own names without pinning a
 * dialect, so a gateway that defines its own ladder (`minimal` … `max`) gets the
 * whole ladder back — which is the point of adapting automatically rather than
 * offering `low`/`medium`/`high` and stopping. A strict endpoint that rejects an
 * unknown value names the culprit in its 400, and `/thinking set … openai-null-off`
 * is the one-step repair.
 *
 * Declared here rather than in `src/auto.ts` because the status report and the
 * diagnostic need to name it too, and those are rendered from presets.
 */
export const AUTO_FALLBACK_PRESET = 'passthrough'

/**
 * The preset to write for an endpoint pi-ai believes rejects `reasoning_effort`.
 *
 * Sending the level ladder to such a route is worse than sending nothing: it
 * makes the composer offer levels whose parameter the endpoint will reject or
 * ignore. This preset is the one every OpenAI-compatible parser already
 * understands, and it is the same one the diagnostic recommends — deliberately,
 * so auto-adaptation and the repair advice never disagree.
 */
export const AUTO_EXCLUDED_PRESET = 'openai-null-off'

/**
 * Resolve a configured preset id, falling back when it names nothing usable.
 *
 * A preset id arrives from this plugin's own composition config, which a user
 * edits by hand; naming a preset that does not exist must narrow the result, not
 * write a declaration `llm-pi-ai` would refuse.
 *
 * @param id - the configured id, possibly absent or wrong.
 * @param fallback - what to use when `id` names no preset.
 * @returns an id that exists in {@link PRESETS}.
 */
export function presetOrDefault(id: string | undefined, fallback: string = DEFAULT_PRESET): string {
  const wanted = id !== undefined && findPreset(id) !== undefined ? id : fallback
  return findPreset(wanted) === undefined ? DEFAULT_PRESET : wanted
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
