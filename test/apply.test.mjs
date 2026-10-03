// The settings port, exercised against a fake settings service: this pins the
// exact write shape (one route key, merged — never the whole section) and the
// revision fence, without needing a running harness.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyDeclaration, piAiDescriptor, profileOf } from '../src/apply.ts'

/** A settings service stand-in that records writes and can force one conflict. */
function fakeSettings(section, options = {}) {
  const writes = []
  let revision = options.revision ?? 7
  let conflicts = options.conflicts ?? 0
  const state = { section: structuredClone(section), revision }
  return {
    writes,
    get state() { return state },
    describe: () => [{ ns: 'llm-pi-ai', value: state.section, revision: state.revision, applies: 'live' }],
    get: (ns) => (ns === 'llm-pi-ai' ? state.section : undefined),
    async update(ns, patch, expectedRevision) {
      writes.push({ ns, patch, expectedRevision })
      if (conflicts > 0) {
        conflicts -= 1
        state.revision += 1
        throw new Error('settings namespace "llm-pi-ai" changed since it was read (expected revision 7, now 8)')
      }
      // Mirror `mergeLayers`: plain objects merge, arrays replace.
      state.section = merge(state.section, patch)
      state.revision += 1
    },
  }
}

function merge(under, over) {
  if (over === undefined) return under
  const plain = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!plain(under) || !plain(over)) return structuredClone(over)
  const out = { ...under }
  for (const [key, value] of Object.entries(over)) {
    out[key] = key in out ? merge(out[key], value) : structuredClone(value)
  }
  return out
}

const SECTION = {
  providers: {
    qiyuan: {
      apiKeyEnv: 'QIYUAN_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://api.qiyuanapi.cc/v1',
      models: [{ id: 'deepseek-v4.1', name: 'deepseek-v4.1', contextWindow: 1_000_000 }],
    },
    openai: { apiKeyEnv: 'OPENAI_API_KEY', models: [{ id: 'gpt-5' }] },
  },
}

/** The settings port both halves pass around: the service plus the owning entry id. */
function portOf(settings) {
  return { settings, ns: 'llm-pi-ai' }
}

test('writes one route key and leaves every other route alone', async () => {
  const settings = fakeSettings(SECTION)
  const outcome = await applyDeclaration(portOf(settings), 'qiyuan', 'deepseek-v4.1', { preset: 'deepseek' })

  assert.equal(outcome.ok, true, outcome.problems.join('; '))
  assert.equal(outcome.unchanged, false)
  assert.equal(settings.writes.length, 1)
  const [{ ns, patch, expectedRevision }] = settings.writes
  assert.equal(ns, 'llm-pi-ai')
  assert.equal(expectedRevision, 7, 'the write is fenced on the revision it read')
  assert.deepEqual(Object.keys(patch), ['providers'])
  assert.deepEqual(Object.keys(patch.providers), ['qiyuan'], 'only the edited route is named')

  // The merge preserved the route's other fields and the sibling route.
  const merged = settings.state.section
  assert.equal(merged.providers.qiyuan.baseURL, 'https://api.qiyuanapi.cc/v1')
  assert.equal(merged.providers.qiyuan.apiKeyEnv, 'QIYUAN_API_KEY')
  assert.deepEqual(merged.providers.openai, SECTION.providers.openai)
  assert.equal(merged.providers.qiyuan.models[0].name, 'deepseek-v4.1')
  assert.deepEqual(merged.providers.qiyuan.models[0].reasoningEfforts,
    { off: null, low: 'low', high: 'high', max: 'max' })
})

test('does not write when the declaration is already in force', async () => {
  const settings = fakeSettings({
    providers: {
      qiyuan: {
        models: [{
          id: 'm',
          reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
          compat: { thinkingFormat: 'deepseek' },
        }],
      },
    },
  })
  const outcome = await applyDeclaration(portOf(settings), 'qiyuan', 'm', { preset: 'deepseek' })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.unchanged, true)
  assert.equal(settings.writes.length, 0)
})

test('retries once against a fresh read when the revision moved', async () => {
  const settings = fakeSettings(SECTION, { conflicts: 1 })
  const outcome = await applyDeclaration(portOf(settings), 'qiyuan', 'deepseek-v4.1', { preset: 'deepseek' })
  assert.equal(outcome.ok, true, outcome.problems.join('; '))
  assert.equal(settings.writes.length, 2)
  assert.equal(settings.writes[1].expectedRevision, 8, 'the retry re-reads the revision')
})

test('reports a missing pi-ai entry instead of throwing', async () => {
  const settings = { describe: () => [], update: async () => {} }
  const outcome = await applyDeclaration(portOf(settings), 'qiyuan', 'm', { preset: 'deepseek' })
  assert.equal(outcome.ok, false)
  assert.match(outcome.problems.join(' '), /未注册/)
})

test('reports an absent settings service instead of throwing', async () => {
  const outcome = await applyDeclaration(portOf(undefined), 'qiyuan', 'm', { preset: 'deepseek' })
  assert.equal(outcome.ok, false)
  assert.match(outcome.problems.join(' '), /settings 服务未挂载/)
})

test('a refusal from the planner never reaches the write', async () => {
  const settings = fakeSettings(SECTION)
  const outcome = await applyDeclaration(portOf(settings), 'qiyuan', 'ghost', { preset: 'deepseek' })
  assert.equal(outcome.ok, false)
  assert.equal(settings.writes.length, 0)
})

test('piAiDescriptor and profileOf tolerate foreign shapes', () => {
  assert.equal(piAiDescriptor(portOf(undefined)), undefined)
  assert.equal(profileOf(undefined, 'qiyuan'), undefined)
  assert.equal(profileOf({ providers: { qiyuan: 5 } }, 'qiyuan'), undefined)
  assert.equal(profileOf({ providers: 5 }, 'qiyuan'), undefined)
  assert.deepEqual(profileOf({ providers: { qiyuan: { api: 'x' } } }, 'qiyuan'), { api: 'x' })
})
