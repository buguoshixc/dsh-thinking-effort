// The settings port, exercised against a fake settings service: this pins the
// exact write shape (path ops for one route only) and the revision fence,
// without needing a running harness.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyDeclaration, piAiDescriptor, profileOf } from '../src/apply.ts'

/** Apply path ops the way `settings.mutate` does: `set` replaces at its leaf. */
function applyOps(root, ops) {
  for (const op of ops) {
    if (op.op !== 'set') continue
    const path = op.path
    let target = root
    for (let index = 0; index < path.length - 1; index += 1) {
      const key = path[index]
      if (typeof target[key] !== 'object' || target[key] === null) target[key] = {}
      target = target[key]
    }
    target[path.at(-1)] = structuredClone(op.value)
  }
  return root
}

/** A settings service stand-in that records writes and can force one conflict. */
function fakeSettings(section, options = {}) {
  const writes = []
  let conflicts = options.conflicts ?? 0
  const state = { section: structuredClone(section), revision: options.revision ?? 7 }
  return {
    writes,
    get state() { return state },
    describe: () => [{ ns: 'llm-pi-ai', value: state.section, revision: state.revision, applies: 'live' }],
    get: (ns) => (ns === 'llm-pi-ai' ? state.section : undefined),
    async mutate(ns, ops, expectedRevision) {
      writes.push({ ns, ops, expectedRevision })
      if (conflicts > 0) {
        conflicts -= 1
        state.revision += 1
        throw new Error('settings namespace "llm-pi-ai" changed since it was read (expected revision 7, now 8)')
      }
      applyOps(state.section, ops)
      state.revision += 1
    },
  }
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

test('writes path ops for one route and leaves every other route alone', async () => {
  const settings = fakeSettings(SECTION)
  const outcome = await applyDeclaration(portOf(settings), 'qiyuan', 'deepseek-v4.1', { preset: 'deepseek' })

  assert.equal(outcome.ok, true, outcome.problems.join('; '))
  assert.equal(outcome.unchanged, false)
  assert.equal(settings.writes.length, 1)
  const [{ ns, ops, expectedRevision }] = settings.writes
  assert.equal(ns, 'llm-pi-ai')
  assert.equal(expectedRevision, 7, 'the write is fenced on the revision it read')
  assert.deepEqual(ops, [{
    op: 'set',
    path: ['providers', 'qiyuan', 'models'],
    value: settings.state.section.providers.qiyuan.models,
  }])

  // The sibling route and the route's own unowned fields are untouched.
  const merged = settings.state.section
  assert.equal(merged.providers.qiyuan.baseURL, 'https://api.qiyuanapi.cc/v1')
  assert.equal(merged.providers.qiyuan.apiKeyEnv, 'QIYUAN_API_KEY')
  assert.deepEqual(merged.providers.openai, SECTION.providers.openai)
  assert.equal(merged.providers.qiyuan.models[0].name, 'deepseek-v4.1')
  assert.deepEqual(merged.providers.qiyuan.models[0].reasoningEfforts,
    { off: null, low: 'low', high: 'high', max: 'max' })
})

test('a catalog-route edit replaces the override entry instead of merging it', async () => {
  // A path-op `set` at the model id replaces the entry, so a pin the plan
  // dropped cannot survive; `update`'s recursive merge would leave it behind.
  const settings = fakeSettings({
    providers: {
      'deepseek-official': {
        modelOverrides: {
          'deepseek-flash': {
            reasoningEfforts: { off: null, high: 'high' },
            compat: { thinkingFormat: 'deepseek' },
            maxTokens: 1234,
          },
        },
      },
    },
  })
  const outcome = await applyDeclaration(portOf(settings), 'deepseek-official', 'deepseek-flash', { remove: true })
  assert.equal(outcome.ok, true, outcome.problems.join('; '))
  assert.deepEqual(settings.state.section.providers['deepseek-official'].modelOverrides['deepseek-flash'],
    { maxTokens: 1234 }, 'only the fields the plan did not own survive')
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
  const settings = { describe: () => [], mutate: async () => {} }
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
