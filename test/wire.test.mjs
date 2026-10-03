// The wire preview is a reimplementation of pi-ai's dispatch, so it is pinned
// against the behaviour that motivated it: a dialect that adds a parameter the
// endpoint ignores makes a level fail silently, and `off` is where that bites.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { findPreset, PRESETS } from '../src/presets.ts'
import {
  collapses, detectsSupportsReasoningEffort, detectsThinkingFormat, effectOf,
  previewWire, thinkingLevelMapOf,
} from '../src/wire.ts'

/** The preset this plugin used to recommend for every DeepSeek-serving relay. */
const DEEPSEEK = { off: null, low: 'low', high: 'high', max: 'max' }

test('an undeclared off stays absent; undeclared non-off levels pin to null', () => {
  // `minimal`/`medium`/`xhigh` are pinned to null rather than left out: null
  // means "not offered", absent (for a non-off level) would mean "offered". Only
  // `off` may be absent, which is what "supported, send nothing" looks like.
  assert.deepEqual(thinkingLevelMapOf(DEEPSEEK),
    { minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' })
  assert.deepEqual(thinkingLevelMapOf({ off: 'none', high: 'high' }),
    { off: 'none', minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: null })
})

test('the deepseek dialect adds DeepSeek\'s private thinking parameter', () => {
  const effects = previewWire(DEEPSEEK, 'deepseek', true)
  const byLevel = Object.fromEntries(effects.map((effect) => [effect.level, effect.params]))
  assert.deepEqual(byLevel['off'], { thinking: { type: 'disabled' } })
  assert.deepEqual(byLevel['low'], { thinking: { type: 'enabled' }, reasoning_effort: 'low' })
  assert.deepEqual(byLevel['max'], { thinking: { type: 'enabled' }, reasoning_effort: 'max' })
})

test('THE REGRESSION: on the deepseek dialect, off sends no reasoning_effort at all', () => {
  // This asymmetry is what a generic relay punishes. `off` collapses to "no
  // effort" before dispatch, so it can only switch thinking off through the
  // vendor-private parameter - which an OpenAI-compatible relay ignores, leaving
  // the model thinking while a named level looks like it works.
  const off = effectOf('off', thinkingLevelMapOf(DEEPSEEK), 'deepseek', true)
  assert.equal(off.params['reasoning_effort'], undefined)
  assert.deepEqual(Object.keys(off.params), ['thinking'])
})

test('the same levels without a pinned dialect send plain reasoning_effort', () => {
  // pi-ai detects an unrecognised relay as `openai`, which is the branch a user
  // on a third-party gateway wants.
  const effects = previewWire(DEEPSEEK, detectsThinkingFormat('qiyuan', 'https://api.qiyuanapi.cc/v1'), true)
  const byLevel = Object.fromEntries(effects.map((effect) => [effect.level, effect.params]))
  assert.deepEqual(byLevel['off'], {})
  assert.deepEqual(byLevel['low'], { reasoning_effort: 'low' })
  assert.deepEqual(byLevel['high'], { reasoning_effort: 'high' })
  assert.deepEqual(byLevel['max'], { reasoning_effort: 'max' })
  assert.deepEqual(collapses(effects), [])
})

test('the openai preset sends an explicit none for off', () => {
  const levels = findPreset('openai').levels
  const byLevel = Object.fromEntries(previewWire(levels, 'openai', true).map((e) => [e.level, e.params]))
  assert.deepEqual(byLevel['off'], { reasoning_effort: 'none' })
  assert.deepEqual(byLevel['high'], { reasoning_effort: 'high' })
})

test('supportsReasoningEffort false silences every named level', () => {
  const effects = previewWire(DEEPSEEK, 'openai', false)
  for (const effect of effects.filter((entry) => entry.level !== 'off')) {
    assert.equal(effect.silent, true, `${effect.level} should send nothing`)
  }
  // And off too, because its wire value is a bare null rather than a string.
  assert.equal(effects.find((entry) => entry.level === 'off').silent, true)
})

test('openrouter nests the effort instead', () => {
  const byLevel = Object.fromEntries(previewWire(findPreset('openrouter').levels, 'openrouter', true)
    .map((e) => [e.level, e.params]))
  assert.deepEqual(byLevel['high'], { reasoning: { effort: 'high' } })
  assert.deepEqual(byLevel['off'], { reasoning: { effort: 'none' } })
})

test('qwen toggles enable_thinking', () => {
  const byLevel = Object.fromEntries(previewWire(findPreset('qwen').levels, 'qwen', true)
    .map((e) => [e.level, e.params]))
  assert.deepEqual(byLevel['off'], { enable_thinking: false })
  assert.deepEqual(byLevel['high'], { enable_thinking: true, reasoning_effort: 'high' })
})

test('no shipped preset collapses two levels into the same request', () => {
  for (const preset of PRESETS) {
    const detected = preset.thinkingFormat ?? 'openai'
    const collisions = collapses(previewWire(preset.levels, detected, true))
    assert.deepEqual(collisions, [], `preset ${preset.id} has indistinguishable levels`)
  }
})

test('dialect detection follows pi-ai: only a deepseek host is deepseek', () => {
  assert.equal(detectsThinkingFormat('qiyuan', 'https://api.qiyuanapi.cc/v1'), 'openai')
  assert.equal(detectsThinkingFormat('deepseek', 'https://gateway.example/v1'), 'deepseek')
  assert.equal(detectsThinkingFormat('acme', 'https://api.deepseek.com'), 'deepseek')
  assert.equal(detectsThinkingFormat('openrouter', undefined), 'openrouter')
  assert.equal(detectsThinkingFormat('acme', 'https://openrouter.ai/api/v1'), 'openrouter')
})

test('an unrecognised relay keeps supportsReasoningEffort on', () => {
  assert.equal(detectsSupportsReasoningEffort('qiyuan', 'https://api.qiyuanapi.cc/v1'), true)
  assert.equal(detectsSupportsReasoningEffort('xai', undefined), false)
  assert.equal(detectsSupportsReasoningEffort('acme', 'https://api.z.ai/v1'), false)
})

test('the deepseek-relay preset exists and pins no dialect', () => {
  const preset = findPreset('deepseek-relay')
  assert.ok(preset, 'the preset that fixed the reported bug must stay available')
  assert.equal(preset.thinkingFormat, undefined)
  assert.deepEqual(preset.levels, DEEPSEEK)
})

test('the first recommendation is the one that cannot fail loudly', () => {
  // `openai-null-off` sends only the standard parameter and sends nothing at
  // all for off, so it cannot trip a strict relay.
  assert.equal(PRESETS[0].id, 'openai-null-off')
  assert.equal(PRESETS[0].thinkingFormat, undefined)
})
