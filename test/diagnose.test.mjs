// The capability report is the plugin's diagnosis, so its verdicts are pinned:
// the whole point is that an undeclared third-party route is reported as
// NOT adjustable, which is the symptom users hit.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { analyzeRoutes, modelCapability, offeredLevels, unadjustable } from '../src/diagnose.ts'

test('an undeclared model on a configuration-only route is not adjustable', () => {
  const routes = analyzeRoutes(
    { providers: { qiyuan: { models: [{ id: 'deepseek-v4.1' }] } } },
    ['qiyuan'],
  )
  assert.equal(routes.length, 1)
  const [model] = routes[0].models
  assert.equal(model.adjustable, false)
  assert.equal(model.source, 'inherit')
  assert.match(model.problems.join(' '), /不在内置目录里/)
  assert.deepEqual(unadjustable(routes), ['qiyuan/deepseek-v4.1'])
})

test('the same model on a catalog route leaves the installed entry to decide', () => {
  const routes = analyzeRoutes({ providers: { anthropic: { models: [{ id: 'claude-sonnet-4-5' }] } } }, [])
  const [model] = routes[0].models
  assert.equal(model.source, 'inherit')
  assert.equal(model.adjustable, true)
  assert.deepEqual(model.problems, [])
})

test('a declared map offers exactly its levels, off included', () => {
  const routes = analyzeRoutes({
    providers: {
      qiyuan: {
        models: [{ id: 'deepseek-v4.1', reasoningEfforts: { off: null, high: 'high', max: 'ultra' } }],
      },
    },
  }, ['qiyuan'])
  const [model] = routes[0].models
  assert.equal(model.adjustable, true)
  assert.equal(model.source, 'declared')
  assert.deepEqual(model.levels, ['off', 'high', 'max'])
  assert.deepEqual(unadjustable(routes), [])
})

test('a malformed declaration is reported as not adjustable, with the reason', () => {
  const model = modelCapability({ id: 'm', reasoningEfforts: { off: null, high: null } }, true)
  assert.equal(model.adjustable, false)
  assert.match(model.problems.join(' '), /缺少要发送的值/)
})

test('reasoningEfforts: false is a deliberate disable, not a defect', () => {
  const model = modelCapability({ id: 'm', reasoningEfforts: false }, true)
  assert.equal(model.source, 'disabled')
  assert.equal(model.adjustable, false)
  assert.deepEqual(model.problems, [])
})

test('offeredLevels always keeps off and drops null non-off levels', () => {
  assert.deepEqual(offeredLevels({ off: null, low: 'low', high: null }), ['off', 'low'])
  assert.deepEqual(offeredLevels({}), ['off'])
})

test('a section of the wrong shape yields an empty report instead of throwing', () => {
  for (const value of [undefined, null, 42, 'nope', [], { providers: 7 }]) {
    assert.deepEqual(analyzeRoutes(value, ['x']), [])
  }
})

test('the report reads the declared flag per route', () => {
  const routes = analyzeRoutes({ providers: { a: { models: [] }, b: { models: [] } } }, ['b'])
  assert.deepEqual(routes.map((route) => [route.provider, route.declared]), [['a', false], ['b', true]])
})
