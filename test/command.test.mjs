// The /thinking grammar is a user-facing contract; a silent mis-parse would look
// like the plugin doing nothing, so every branch is pinned here.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseCommand } from '../src/commands.ts'

test('no argument reports status', () => {
  assert.deepEqual(parseCommand(''), { action: 'status' })
  assert.deepEqual(parseCommand('   '), { action: 'status' })
  assert.deepEqual(parseCommand('status'), { action: 'status' })
})

test('presets and help are their own actions', () => {
  assert.deepEqual(parseCommand('presets'), { action: 'presets' })
  assert.deepEqual(parseCommand('help'), { action: 'help' })
  assert.deepEqual(parseCommand('?'), { action: 'help' })
})

test('set accepts provider/model plus a preset', () => {
  assert.deepEqual(parseCommand('set qiyuan/deepseek-v4.1 deepseek'), {
    action: 'set',
    provider: 'qiyuan',
    model: 'deepseek-v4.1',
    declaration: { preset: 'deepseek' },
  })
})

test('set accepts a spaced provider and model', () => {
  assert.deepEqual(parseCommand('set qiyuan deepseek-v4.1 openai'), {
    action: 'set',
    provider: 'qiyuan',
    model: 'deepseek-v4.1',
    declaration: { preset: 'openai' },
  })
})

test('flags resolve to declaration fields', () => {
  assert.deepEqual(parseCommand('set qiyuan/m deepseek --format deepseek --default high'), {
    action: 'set',
    provider: 'qiyuan',
    model: 'm',
    declaration: { preset: 'deepseek', thinkingFormat: 'deepseek', defaultEffort: 'high' },
  })
})

test('remove needs no preset', () => {
  assert.deepEqual(parseCommand('remove qiyuan/m'), {
    action: 'set',
    provider: 'qiyuan',
    model: 'm',
    declaration: { remove: true },
  })
})

test('custom and inherit are accepted preset ids', () => {
  assert.equal(parseCommand('set qiyuan/m custom').declaration.preset, 'custom')
  assert.equal(parseCommand('set qiyuan/m inherit').declaration.preset, 'inherit')
})

test('bad input is refused with a reason rather than silently doing nothing', () => {
  assert.equal(parseCommand('frobnicate').action, 'bad')
  assert.equal(parseCommand('set').action, 'bad')
  assert.equal(parseCommand('set qiyuan/m').action, 'bad')
  assert.equal(parseCommand('set qiyuan/m not-a-preset').action, 'bad')
  assert.equal(parseCommand('set qiyuan/m deepseek --default').action, 'bad')
  assert.equal(parseCommand('set qiyuan/m deepseek extra').action, 'bad')
})
