// Auto-adaptation: which preset a route gets, and which routes it refuses to touch.
//
// `auto.ts` is pure, so the interesting branch — "what does a route with this
// shape get" — is testable without a settings service. The integration path
// (mount → write) is covered by test/smoke.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  adaptPlan,
  autoPresetFor,
  detectedPreset,
  AUTO_EXCLUDED_PRESET,
  AUTO_FALLBACK_PRESET,
} from '../src/auto.ts'
import { findPreset } from '../src/presets.ts'

/** A section carrying one route, with the parts a test cares about filled in. */
function section(profile, provider = 'relay') {
  return { providers: { [provider]: profile } }
}

test('an unrecognised relay gets the fallback preset, unpinned', () => {
  const preset = autoPresetFor('qiyuan', 'https://api.qiyuanapi.cc/v1', undefined)
  assert.equal(preset, AUTO_FALLBACK_PRESET)
  // The whole point of the fallback: every level survives under its own name, so
  // a gateway with its own ladder is not silently narrowed to three rungs.
  const levels = findPreset(preset)?.levels
  assert.equal(Object.keys(levels ?? {}).length, 7)
  assert.equal(levels?.max, 'max')
  assert.equal(levels?.off, null)
  assert.equal(findPreset(preset)?.thinkingFormat, undefined, 'the fallback must not pin a dialect')
})

test('a vendor pi-ai recognises gets that vendor preset, not the fallback', () => {
  assert.equal(autoPresetFor('deepseek', 'https://api.deepseek.com/v1', undefined), 'deepseek-relay')
  assert.equal(autoPresetFor('openrouter', 'https://openrouter.ai/api/v1', undefined), 'openrouter')
  assert.equal(autoPresetFor('qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', undefined), 'qwen')
  // The host alone is enough: the route key is whatever the user called it.
  assert.equal(autoPresetFor('ds', 'https://api.deepseek.com/v1', undefined), 'deepseek-relay')
})

test('an endpoint pi-ai says refuses reasoning_effort gets the preset that cannot trip it', () => {
  // Sending `max` to a vendor that does not parse reasoning_effort is the one way
  // adaptation could turn a missing picker into a failing request.
  for (const [provider, baseURL] of [
    ['xai', 'https://api.x.ai/v1'],
    ['zai', 'https://api.z.ai/api/paas/v4'],
    ['moonshot', 'https://api.moonshot.cn/v1'],
    ['together', 'https://api.together.xyz/v1'],
    ['nvidia', 'https://integrate.api.nvidia.com/v1'],
  ]) {
    assert.equal(autoPresetFor(provider, baseURL, undefined), AUTO_EXCLUDED_PRESET, `${provider} must be excluded`)
  }
})

test('a route compat that switches reasoning_effort off wins over the vendor signal', () => {
  // The user's own statement about their endpoint outranks this plugin's guess.
  const compat = { supportsReasoningEffort: false }
  assert.equal(autoPresetFor('deepseek', 'https://api.deepseek.com/v1', compat), AUTO_EXCLUDED_PRESET)
})

test('the configured preference only decides routes with no vendor signal', () => {
  assert.equal(autoPresetFor('relay', 'https://relay.example/v1', undefined, 'deepseek-relay'), 'deepseek-relay')
  assert.equal(autoPresetFor('deepseek', 'https://api.deepseek.com/v1', undefined, 'passthrough'), 'deepseek-relay')
  // A config naming a preset that does not exist narrows to the fallback rather
  // than writing a declaration llm-pi-ai would refuse.
  assert.equal(autoPresetFor('relay', 'https://relay.example/v1', undefined, 'nope'), AUTO_FALLBACK_PRESET)
})

test('detection justifies nothing for a plain OpenAI-compatible host', () => {
  assert.equal(detectedPreset('relay', 'https://relay.example/v1'), undefined)
  assert.equal(detectedPreset('relay', undefined), undefined)
})

test('the plan declares every model of a declared route', () => {
  const plan = adaptPlan(
    section({ baseURL: 'https://api.qiyuanapi.cc/v1', models: [{ id: 'a' }, { id: 'b' }] }),
    ['relay'],
  )
  assert.deepEqual(plan.adjustments.map((entry) => `${entry.provider}/${entry.modelId}`), ['relay/a', 'relay/b'])
  assert.equal(plan.adjustments[0]?.preset, AUTO_FALLBACK_PRESET)
  assert.deepEqual(plan.problems, [])
  assert.ok(plan.adjustments[0]?.reason.includes('openai'))
})

test('a catalog route is never touched', () => {
  // The adapter decides these from the installed catalog, so writing a
  // declaration would narrow what the catalog already offers.
  const plan = adaptPlan(section({ models: [{ id: 'a' }] }), [])
  assert.deepEqual(plan.adjustments, [])
  assert.deepEqual(plan.problems, [])
})

test('a model that already declares levels is skipped, not overwritten', () => {
  const plan = adaptPlan(
    section({
      baseURL: 'https://api.qiyuanapi.cc/v1',
      models: [{ id: 'done', reasoningEfforts: { off: null, high: 'high' } }, { id: 'fresh' }],
    }),
    ['relay'],
  )
  assert.deepEqual(plan.adjustments.map((entry) => entry.modelId), ['fresh'])
  assert.deepEqual(plan.state, ['relay/done 已有档位声明'])
})

test('reasoningEfforts: false is respected as a deliberate choice', () => {
  const plan = adaptPlan(
    section({ baseURL: 'https://api.qiyuanapi.cc/v1', models: [{ id: 'off', reasoningEfforts: false }] }),
    ['relay'],
  )
  assert.deepEqual(plan.adjustments, [], 'adaptation must not undo an explicit opt-out')
  assert.equal(plan.state.length, 1)
  assert.match(plan.state[0], /reasoningEfforts: false/)
})

test('a declared route with no models is reported rather than silently skipped', () => {
  const plan = adaptPlan(section({ baseURL: 'https://api.x.example/v1' }), ['relay'])
  assert.deepEqual(plan.adjustments, [])
  assert.equal(plan.problems.length, 1)
  assert.match(plan.problems[0], /没有 models 条目/)
})

test('a section that is not shaped like one is handled, not thrown at', () => {
  for (const value of [undefined, null, 5, 'x', { providers: 5 }, { providers: { relay: 5 } }]) {
    const plan = adaptPlan(value, ['relay'])
    assert.deepEqual(plan.adjustments, [])
  }
})
