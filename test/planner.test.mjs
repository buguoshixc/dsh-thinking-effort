// Unit tests for the pure planner. These import the TypeScript sources directly
// (Node strips the types), so they exercise exactly what both halves run — the
// browser card inlines this same module.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planDeclaration } from '../src/plan.ts'
import { findPreset, validateLevels } from '../src/presets.ts'

/** The route shape this plugin exists for: a hand-declared third-party gateway. */
function declaredRoute(extra = {}) {
  return {
    apiKeyEnv: 'QIYUAN_API_KEY',
    api: 'openai-completions',
    baseURL: 'https://api.qiyuanapi.cc/v1',
    models: [{
      id: 'deepseek-v4.1',
      name: 'deepseek-v4.1',
      contextWindow: 1_000_000,
      maxTokens: 86_642,
      input: ['text', 'image'],
    }],
    ...extra,
  }
}

test('declares levels on a hand-declared route by rewriting its models list', () => {
  const plan = planDeclaration({
    provider: 'qiyuan',
    modelId: 'deepseek-v4.1',
    declaration: { preset: 'deepseek' },
    profile: declaredRoute(),
  })

  assert.equal(plan.ok, true, plan.problems.join('; '))
  assert.equal(plan.unchanged, false)
  const [model] = plan.patch.models
  assert.deepEqual(model.reasoningEfforts, { off: null, low: 'low', high: 'high', max: 'max' })
  assert.deepEqual(model.compat, { thinkingFormat: 'deepseek' })
  // Every unowned field survives the array rewrite.
  assert.equal(model.id, 'deepseek-v4.1')
  assert.equal(model.name, 'deepseek-v4.1')
  assert.equal(model.contextWindow, 1_000_000)
  assert.equal(model.maxTokens, 86_642)
  assert.deepEqual(model.input, ['text', 'image'])
})

test('carries sibling models through untouched', () => {
  const profile = declaredRoute()
  profile.models.push({ id: 'gpt-5', name: 'GPT-5', contextWindow: 400_000 })
  const plan = planDeclaration({
    provider: 'qiyuan',
    modelId: 'gpt-5',
    declaration: { preset: 'openai' },
    profile,
  })
  assert.equal(plan.ok, true, plan.problems.join('; '))
  assert.equal(plan.patch.models.length, 2)
  // The untouched entry is the very same object, not a copy that could drift.
  assert.equal(plan.patch.models[0], profile.models[0])
  assert.deepEqual(plan.patch.models[1].reasoningEfforts, {
    off: 'none', low: 'low', medium: 'medium', high: 'high',
  })
})

test('reports an already-satisfied declaration as unchanged with no patch', () => {
  const plan = planDeclaration({
    provider: 'qiyuan',
    modelId: 'deepseek-v4.1',
    declaration: { preset: 'deepseek' },
    profile: declaredRoute({
      models: [{
        id: 'deepseek-v4.1',
        reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
        compat: { thinkingFormat: 'deepseek' },
      }],
    }),
  })
  assert.equal(plan.ok, true, plan.problems.join('; '))
  assert.equal(plan.unchanged, true)
  assert.deepEqual(plan.patch, {})
})

test('removes only the fields this plugin owns', () => {
  const plan = planDeclaration({
    provider: 'qiyuan',
    modelId: 'deepseek-v4.1',
    declaration: { remove: true },
    profile: declaredRoute({
      models: [{
        id: 'deepseek-v4.1',
        reasoningEfforts: { off: null, high: 'high' },
        compat: { thinkingFormat: 'deepseek' },
      }],
    }),
  })
  assert.equal(plan.ok, true, plan.problems.join('; '))
  const [model] = plan.patch.models
  assert.equal(model.reasoningEfforts, undefined)
  // compat held nothing else, so the emptied container goes too.
  assert.equal(model.compat, undefined)
  assert.equal(model.id, 'deepseek-v4.1')
})

test('keeps unowned compat switches when removing', () => {
  const plan = planDeclaration({
    provider: 'qiyuan',
    modelId: 'deepseek-v4.1',
    declaration: { remove: true },
    profile: declaredRoute({
      models: [{
        id: 'deepseek-v4.1',
        reasoningEfforts: { off: null, high: 'high' },
        compat: { thinkingFormat: 'deepseek', supportsDeveloperRole: false },
      }],
    }),
  })
  const [model] = plan.patch.models
  assert.deepEqual(model.compat, { supportsDeveloperRole: false })
})

test('a preset that pins no dialect CLEARS a pin left by an earlier one', () => {
  // Switching deepseek -> deepseek-relay is the fix for a relay that ignores
  // DeepSeek's private thinking parameter. If the old pin survived, the switch
  // would report success and change nothing on the wire.
  const plan = planDeclaration({
    provider: 'qiyuan',
    modelId: 'deepseek-v4.1',
    declaration: { preset: 'deepseek-relay' },
    profile: declaredRoute({
      models: [{
        id: 'deepseek-v4.1',
        reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
        compat: { thinkingFormat: 'deepseek', chatTemplateKwargs: {} },
      }],
    }),
  })
  assert.equal(plan.ok, true, plan.problems.join('; '))
  assert.equal(plan.unchanged, false, 'the pin must make this a real change')
  const [model] = plan.patch.models
  // Only the owned switch goes; the rest of compat stays.
  assert.deepEqual(model.compat, { chatTemplateKwargs: {} })
})

test('clearing the last compat switch drops the container', () => {
  const plan = planDeclaration({
    provider: 'qiyuan',
    modelId: 'm',
    declaration: { preset: 'openai-null-off' },
    profile: declaredRoute({
      models: [{ id: 'm', reasoningEfforts: { off: null, high: 'high' }, compat: { thinkingFormat: 'deepseek' } }],
    }),
  })
  const [model] = plan.patch.models
  assert.equal(model.compat, undefined)
})

test('an already-correct non-pinning declaration is still a no-op', () => {
  const plan = planDeclaration({
    provider: 'qiyuan',
    modelId: 'm',
    declaration: { preset: 'deepseek-relay' },
    profile: declaredRoute({
      models: [{ id: 'm', reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' } }],
    }),
  })
  assert.equal(plan.unchanged, true)
  assert.deepEqual(plan.patch, {})
})

test('edits a catalog route through modelOverrides instead of a models list', () => {
  // `openrouter` is used because it is one of the presets that PINS a dialect:
  // the point here is both halves of a catalog-route write - the dict override
  // and the compat block that goes with it.
  const plan = planDeclaration({
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    declaration: { preset: 'openrouter' },
    profile: { apiKeyEnv: 'ANTHROPIC_API_KEY', models: [] },
  })
  assert.equal(plan.ok, true, plan.problems.join('; '))
  assert.equal(plan.patch.models, undefined)
  assert.deepEqual(plan.patch.modelOverrides, {
    'claude-sonnet-4-5': {
      reasoningEfforts: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
      compat: { thinkingFormat: 'openrouter' },
    },
  })
})

test('the generic presets pin no dialect, so pi-ai keeps detecting the endpoint', () => {
  // Pinning replaces detection, and a wrong pin is exactly how a level ends up
  // silently doing nothing. The presets that only mean "OpenAI-style
  // reasoning_effort" must therefore leave compat alone.
  for (const id of ['openai', 'openai-null-off', 'deepseek-relay', 'passthrough']) {
    const plan = planDeclaration({
      provider: 'qiyuan',
      modelId: 'm',
      declaration: { preset: id },
      profile: { api: 'openai-completions', models: [{ id: 'm' }] },
    })
    assert.equal(plan.ok, true, `${id}: ${plan.problems.join('; ')}`)
    assert.equal(plan.patch.models[0].compat, undefined, `${id} must not pin a dialect`)
    assert.ok(plan.patch.models[0].reasoningEfforts, `${id} must still declare levels`)
  }
})

test('carries route-level fields the declaration names', () => {
  const plan = planDeclaration({
    provider: 'qiyuan',
    modelId: 'deepseek-v4.1',
    declaration: { preset: 'deepseek', defaultEffort: 'high', thinkingBudgets: { high: 32768 } },
    profile: declaredRoute(),
  })
  assert.equal(plan.patch.reasoning, 'high')
  assert.deepEqual(plan.patch.thinkingBudgets, { high: 32768 })
})

test('refuses a declaration against an unconfigured route', () => {
  const plan = planDeclaration({
    provider: 'nope',
    modelId: 'm',
    declaration: { preset: 'deepseek' },
    profile: undefined,
  })
  assert.equal(plan.ok, false)
  assert.match(plan.problems.join(' '), /尚未配置/)
})

test('refuses a model the route does not serve', () => {
  const plan = planDeclaration({
    provider: 'qiyuan',
    modelId: 'ghost',
    declaration: { preset: 'deepseek' },
    profile: declaredRoute(),
  })
  assert.equal(plan.ok, false)
  assert.match(plan.problems.join(' '), /没有 "ghost"/)
})

test('refuses an unknown preset', () => {
  const plan = planDeclaration({
    provider: 'qiyuan',
    modelId: 'deepseek-v4.1',
    declaration: { preset: 'gpt5-ultra' },
    profile: declaredRoute(),
  })
  assert.equal(plan.ok, false)
  assert.match(plan.problems.join(' '), /未知的预设/)
})

test('refuses an off-only level map', () => {
  const plan = planDeclaration({
    provider: 'qiyuan',
    modelId: 'deepseek-v4.1',
    declaration: { preset: 'custom', levels: { off: null } },
    profile: declaredRoute(),
  })
  assert.equal(plan.ok, false)
  assert.match(plan.problems.join(' '), /只声明了 off|至少/)
})

test('an explicit levels map wins over the preset levels', () => {
  const plan = planDeclaration({
    provider: 'qiyuan',
    modelId: 'deepseek-v4.1',
    declaration: { preset: 'deepseek', levels: { off: null, minimal: 'low', low: 'medium', high: 'high' } },
    profile: declaredRoute(),
  })
  assert.deepEqual(plan.patch.models[0].reasoningEfforts, {
    off: null, minimal: 'low', low: 'medium', high: 'high',
  })
})

test('validateLevels mirrors llm-pi-ai rules', () => {
  assert.deepEqual(validateLevels({ off: null, high: 'high' }), [])
  assert.ok(validateLevels({ high: null }).some((line) => /必须给出要发送的值/.test(line)))
  assert.ok(validateLevels({ off: null, high: '' }).some((line) => /空字符串/.test(line)))
  assert.ok(validateLevels({ off: null }).some((line) => /只声明了 off/.test(line)))
  assert.ok(validateLevels({}).length > 0)
  assert.equal(findPreset('deepseek')?.thinkingFormat, 'deepseek')
})
