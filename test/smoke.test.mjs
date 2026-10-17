// Smoke test over the BUILD OUTPUT (lib/index.js, lib/client.js).
//
// The unit tests cover the pure modules; this one covers the bundle the harness
// actually loads: the plugin contract, the registrations `apply` performs, the
// write the `/thinking set` command produces for a real third-party route, and
// the browser bundle's module-loader handshake.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'

// Install the stub resolver HERE rather than relying on the runner forwarding
// its own `--import` into the per-file child process. Node's test runner does
// not guarantee that, and this file is the only one that imports the built
// bundle, so it is the only one that needs it.
register(new URL('./resolve-hook.mjs', import.meta.url))

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const plugin = await import('../lib/index.js')

/** The effective pi-ai section for the route this plugin exists for. */
function section() {
  return {
    providers: {
      qiyuan: {
        apiKeyEnv: 'QIYUAN_API_KEY',
        api: 'openai-completions',
        baseURL: 'https://api.qiyuanapi.cc/v1',
        models: [{ id: 'deepseek-v4.1', name: 'deepseek-v4.1', contextWindow: 1_000_000, maxTokens: 86_642 }],
      },
    },
  }
}

/**
 * Apply path ops to a JSON-shaped object, the way the settings service does:
 * `set` writes at the leaf (creating intermediate objects) and replaces it.
 */
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
    target[path.at(-1)] = op.value
  }
  return root
}

/** The models array one write rewrote, or undefined for a catalog-route write. */
function modelsWritten(write) {
  const op = write.ops.find((entry) => entry.op === 'set' && entry.path.at(-1) === 'models')
  return op?.value
}

/** A settings service with a real path-op apply, plus a configurable-provider directory. */
function harness({ value = section(), directory, descriptors } = {}) {
  const state = { value, revision: 3 }
  const writes = []
  const logs = []
  const registered = { commands: [], tools: [] }
  const services = {
    settings: {
      // A function lets a test follow the live document (a real describe() does).
      describe: () => (typeof descriptors === 'function' ? descriptors(state) : descriptors)
        ?? [{ ns: 'llm-pi-ai', value: state.value, revision: state.revision }],
      mutate: async (ns, ops, expectedRevision) => {
        writes.push({ ns, ops, expectedRevision })
        applyOps(state.value, ops)
        state.revision += 1
        return true
      },
    },
    llm: {
      listConfigurableProviders: () => directory ?? [
        { provider: 'qiyuan', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'qiyuan'], declared: true },
      ],
    },
    commands: { register: (definition) => registered.commands.push(definition) },
    tools: { register: (tool) => registered.tools.push(tool) },
  }
  const ctx = {
    get: (name) => services[name],
    inject: (names, run) => {
      // Only run the callback when every named service exists, exactly as the
      // real container does.
      if (names.every((name) => services[name] !== undefined)) {
        run({ get: (name) => services[name], effect: () => {}, ...services })
      }
    },
    effect: () => {},
    logger: { info: (message) => logs.push(`info: ${message}`), warn: (message) => logs.push(`warn: ${message}`) },
  }
  return { ctx, state, writes, logs, registered, services }
}

/**
 * Mount the plugin as a profile whose settings document the test owns.
 *
 * Auto-adaptation is OFF in every test that counts writes: with it on, a mount
 * also declares the broken route in the background, and a test asserting "one
 * write happened" would have to race that pass instead of its own subject. The
 * tests that are *about* auto-adaptation mount it directly.
 */
function handwritten(ctx) {
  plugin.apply(ctx, { diagnoseOnStart: false, autoAdapt: false, defaultPreset: 'deepseek' })
}

/** Let the load-time auto-adaptation pass finish, including its async writes. */
async function settle(times = 8) {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  }
}

test('the package manifest declares the bundle and the client half', () => {
  assert.equal(pkg.name, 'dsh-thinking-effort')
  assert.equal(pkg.dsh.manifestVersion, 1, '0.2.1 records the manifest format version')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  // 0.2.1 `dsh.client.inject` is informational package-name edges, not Cordis
  // service injection; the old "slots" value named no package row and was inert.
  for (const dependency of pkg.dsh.client.inject) {
    assert.match(dependency, /^@deepseek-ai\/dsh-client-/, `not a client package: ${dependency}`)
  }
  assert.match(pkg.engines.dsh, /0\.2\.1-rc\.2/, 'the declared DSH compatibility range names the target')
  assert.ok(pkg.files.includes('cordis.patch.yml'))
  assert.ok(pkg.files.includes('lib/client.js'))
  assert.ok(pkg.exports['./client'])
})

test('the host bundle exports the cordis plugin contract', () => {
  assert.equal(plugin.name, 'dsh-thinking-effort')
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(plugin.Config, 'a Schemastery Config schema is exported')
  assert.ok(Array.isArray(plugin.inject))
})

test('apply registers the command and both tools', () => {
  const { ctx, registered } = harness()
  handwritten(ctx)
  assert.deepEqual(registered.commands.map((entry) => entry.name), ['thinking'])
  assert.deepEqual(registered.tools.map((entry) => entry.name),
    ['thinking_effort_status', 'thinking_effort_set', 'thinking_effort_explain'])
})

test('the status command names the route that cannot be adjusted', async () => {
  const { ctx, registered } = harness()
  handwritten(ctx)
  const result = await registered.commands[0].handler({ rawInput: '' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /qiyuan/)
  assert.match(result.text, /deepseek-v4\.1/)
  assert.match(result.text, /❌ 1 个模型无法调节思考强度/)
  // The suggestion must be the preset that cannot trip a strict relay, not a
  // vendor-specific one.
  assert.match(result.text, /\/thinking set qiyuan\/deepseek-v4\.1 openai-null-off/)
  assert.match(result.text, /\/thinking explain qiyuan\/deepseek-v4\.1/)
})

test('the set command writes one route key through path-addressed settings ops', async () => {
  const { ctx, writes, registered } = harness()
  handwritten(ctx)
  const result = await registered.commands[0].handler({
    rawInput: 'set qiyuan/deepseek-v4.1 deepseek',
  })
  assert.equal(result.kind, 'success', result.text)
  assert.equal(writes.length, 1)
  const [write] = writes
  assert.equal(write.ns, 'llm-pi-ai')
  assert.equal(write.expectedRevision, 3)
  assert.deepEqual(write.ops.map((op) => op.path), [['providers', 'qiyuan', 'models']],
    'one path addresses exactly one route and one field')
  const [model] = write.ops[0].value
  assert.deepEqual(model.reasoningEfforts, { off: null, low: 'low', high: 'high', max: 'max' })
  assert.deepEqual(model.compat, { thinkingFormat: 'deepseek' })
  assert.equal(model.name, 'deepseek-v4.1')
  assert.equal(model.maxTokens, 86_642)
})

test('re-running the same declaration is a no-op', async () => {
  const { ctx, writes, registered } = harness()
  handwritten(ctx)
  const command = registered.commands[0]
  await command.handler({ rawInput: 'set qiyuan/deepseek-v4.1 deepseek' })
  const before = writes.length
  const second = await command.handler({ rawInput: 'set qiyuan/deepseek-v4.1 deepseek' })
  assert.equal(writes.length, before, 'the second run must not write again')
  assert.match(second.text, /未做改动/)
})

test('remove takes the declaration back out', async () => {
  const { ctx, writes, registered } = harness()
  handwritten(ctx)
  const command = registered.commands[0]
  await command.handler({ rawInput: 'set qiyuan/deepseek-v4.1 deepseek' })
  await command.handler({ rawInput: 'remove qiyuan/deepseek-v4.1' })
  const [model] = modelsWritten(writes.at(-1))
  assert.equal(model.reasoningEfforts, undefined)
  assert.equal(model.compat, undefined)
  assert.equal(model.id, 'deepseek-v4.1')
})

test('the model-facing tool applies the same declaration', async () => {
  const { ctx, writes, registered } = harness()
  handwritten(ctx)
  const tool = registered.tools.find((entry) => entry.name === 'thinking_effort_set')
  const value = await tool.execute({ provider: 'qiyuan', model: 'deepseek-v4.1', preset: 'openai' })
  assert.match(String(value), /已写入/)
  assert.deepEqual(modelsWritten(writes[0])[0].reasoningEfforts,
    { off: 'none', low: 'low', medium: 'medium', high: 'high' })
})

test('with no pi-ai adapter mounted the command explains instead of throwing', async () => {
  const { ctx, registered } = harness({ value: { providers: {} } })
  ctx.get = () => undefined
  handwritten(ctx)
  const result = await registered.commands[0].handler({ rawInput: 'status' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /未注册|没有配置任何/)
})

test('mounting the plugin declares the third-party route without being asked', async () => {
  const { ctx, writes, logs, services } = harness()
  plugin.apply(ctx, { diagnoseOnStart: true, autoAdapt: true, defaultPreset: 'deepseek' })
  await settle()
  assert.equal(writes.length, 1, 'the load-time pass declares the undeclared route exactly once')
  const [model] = modelsWritten(writes[0])
  // No vendor signal on `api.qiyuanapi.cc`, so the fallback preset goes in: all
  // seven levels under their own names, and no dialect pinned.
  assert.deepEqual(model.reasoningEfforts, {
    off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
  })
  assert.equal(model.compat, undefined, 'the fallback must not pin a dialect')
  assert.equal(model.name, 'deepseek-v4.1', 'every unowned field survives the rewrite')
  // The same harness keeps serving the settings service, so the write is visible.
  assert.ok(services.settings)
  // The diagnostic must describe the state the pass produced, not the one it
  // started from: emitting it in parallel reads the document before the writes
  // land and prints "1 model cannot be adjusted" above the success line.
  assert.ok(logs.some((line) => line.startsWith('info:') && line.includes('自动适配完成')))
  assert.ok(logs.some((line) => line.startsWith('info:') && line.includes('所有 pi-ai 模型都可调节')))
  assert.equal(logs.filter((line) => line.includes('无法调节思考强度')).length, 0)
})

test('a second mount finds nothing to declare', async () => {
  const first = harness()
  plugin.apply(first.ctx, { diagnoseOnStart: false, autoAdapt: true, defaultPreset: 'deepseek' })
  await settle()
  assert.equal(first.writes.length, 1)

  // Re-mount against the section the first pass produced: the plan must come back
  // empty rather than rewriting the same declaration on every boot.
  const second = harness({ value: first.state.value })
  plugin.apply(second.ctx, { diagnoseOnStart: false, autoAdapt: true, defaultPreset: 'deepseek' })
  await settle()
  assert.equal(second.writes.length, 0, 'an already-declared route is left alone')
})

test('the load-time pass waits for the adapter before giving up', async () => {
  // The pi-ai adapter registers its settings descriptor after the settings
  // service mounts, so the first look legitimately finds nothing. The pass must
  // sleep between attempts; an instant retry loop gives up in the same tick and
  // leaves a freshly added key undeclared (observed in a real 0.2.1 boot).
  const value = section()
  let describes = 0
  const { ctx, writes, logs } = harness({
    value,
    descriptors: (state) => {
      describes += 1
      // Two reads per failed attempt (namespace discovery + descriptor lookup).
      if (describes <= 2) return []
      return [{ ns: 'llm-pi-ai', value: state.value, revision: state.revision }]
    },
    directory: [
      { provider: 'qiyuan', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'qiyuan'], declared: true },
    ],
  })
  plugin.apply(ctx, { diagnoseOnStart: false, autoAdapt: true, defaultPreset: 'deepseek' })
  await new Promise((resolve) => { setTimeout(resolve, 700) })
  await settle()
  assert.equal(writes.length, 1, 'the retry reached the adapter once it mounted')
  assert.equal(writes[0].ns, 'llm-pi-ai')
  assert.ok(logs.some((line) => line.includes('自动适配完成')))
})

test('the pi-ai namespace is found even when another adapter registers first', async () => {
  // DSH 0.2.1 lists configurable providers in registration order, and
  // llm-deepseek registers before llm-pi-ai. Picking the first entry with a
  // settings namespace therefore targets a section with no `providers` dict:
  // the plan is empty and the report claims everything is adjustable.
  const value = section()
  const { ctx, writes, logs } = harness({
    value,
    descriptors: (state) => [
      { ns: 'llm-deepseek', value: { models: [] }, revision: 2 },
      { ns: 'llm-pi-ai', value: state.value, revision: state.revision },
    ],
    directory: [
      { provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] },
      { provider: 'qiyuan', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'qiyuan'], declared: true },
    ],
  })
  plugin.apply(ctx, { diagnoseOnStart: true, autoAdapt: true, defaultPreset: 'deepseek' })
  await settle()
  assert.equal(writes.length, 1, 'the pass writes to llm-pi-ai, not to the first namespace in the directory')
  assert.equal(writes[0].ns, 'llm-pi-ai')
  const [model] = modelsWritten(writes[0])
  assert.equal(model.reasoningEfforts.max, 'max')
  assert.ok(logs.some((line) => line.startsWith('info:') && line.includes('自动适配完成')))
  assert.equal(logs.filter((line) => line.includes('无法调节思考强度')).length, 0)
})

test('a renamed pi-ai settings entry still resolves', async () => {
  const value = section()
  const { ctx, writes } = harness({
    value,
    descriptors: [{ ns: 'relay-pi', value, revision: 3 }],
    directory: [
      { provider: 'qiyuan', settingsNs: 'relay-pi', settingsPath: ['providers', 'qiyuan'], declared: true },
    ],
  })
  plugin.apply(ctx, { diagnoseOnStart: false, autoAdapt: true, defaultPreset: 'deepseek' })
  await settle()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].ns, 'relay-pi', 'the loader-entry id is discovered, never hardcoded')
})

test('auto-adapt stays off when the profile says so', async () => {
  const { ctx, writes } = harness()
  handwritten(ctx)
  await settle()
  assert.equal(writes.length, 0)
})

test('the adapt subcommand declares every undeclared route at once', async () => {
  const { ctx, writes, registered } = harness()
  handwritten(ctx)
  const result = await registered.commands[0].handler({ rawInput: 'adapt' })
  assert.equal(result.kind, 'success', result.text)
  assert.equal(writes.length, 1)
  assert.match(result.text, /已自动声明 1 个模型/)
  assert.match(result.text, /passthrough/)
  const [model] = modelsWritten(writes[0])
  assert.equal(model.reasoningEfforts.max, 'max')
})

test('the adapt subcommand honours an explicit preset', async () => {
  const { ctx, writes, registered } = harness()
  handwritten(ctx)
  const result = await registered.commands[0].handler({ rawInput: 'adapt --preset openai-null-off' })
  assert.equal(result.kind, 'success', result.text)
  assert.deepEqual(modelsWritten(writes[0])[0].reasoningEfforts,
    { off: null, low: 'low', medium: 'medium', high: 'high' })
})

test('adapt refuses an unknown preset instead of writing one', async () => {
  const { ctx, writes, registered } = harness()
  handwritten(ctx)
  const result = await registered.commands[0].handler({ rawInput: 'adapt --preset not-a-preset' })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /未知的 preset/)
  assert.equal(writes.length, 0)
})

test('the client bundle is a module-loader handshake for this package', async () => {
  const source = await readFile(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.match(source, new RegExp(`id:\\s*"${pkg.name}"`))
  assert.match(source, /factory:\s*\(require\)\s*=>/)
  // The factory must hand the module back to the loader that opened it.
  assert.match(source, /return module\.exports;/)
  assert.match(source, /\}\s*\}\);\s*(\/\/# sourceMappingURL=.*)?$/)
  // react is the only browser-module-table external it may reach for.
  const required = [...source.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1])
  for (const specifier of new Set(required)) {
    assert.ok(['react', 'react/jsx-runtime'].includes(specifier),
      `unexpected external "${specifier}" — the browser module table cannot answer it`)
  }
})

test('the client bundle targets the 0.2.1 settings and plugins-page contracts', async () => {
  const source = await readFile(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
  // 0.2.1 replaced the pre-0.2 settingsScope binder with the settings domain's
  // shared forms service, and a third-party bundle's configuration lives on the
  // sidebar Plugins page through plugins.bundle.config.
  assert.match(source, /configForms/)
  assert.match(source, /plugins\.bundle\.config/)
  assert.ok(!source.includes('settingsScope'), 'the removed pre-0.2 service must not be referenced')
  assert.match(source, /llm-pi-ai/, 'the card binds the pi-ai namespace')
})

test('the bundle patch inserts exactly one row naming this package', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /- insert:/)
  assert.match(patch, /name: 'dsh-thinking-effort'/)
})
