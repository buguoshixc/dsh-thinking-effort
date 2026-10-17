# dsh-thinking-effort

**English** | [简体中文](README.zh.md)

Bring back the **thinking-intensity picker** (推理等级 / reasoning effort) for third-party API keys in
[DeepSeek Harness](https://github.com/deepseek-ai/dsh).

You plug an OpenAI-compatible relay into `dsh`, pick one of its models, and the
「推理等级」 pane in the composer is simply gone. This plugin declares the missing capability for
those routes, so the picker comes back — from a slash command, from the Plugins page, or by asking
the model.

---

## The problem, precisely

A third-party provider is a `providers.<route>` profile on the `llm-pi-ai` adapter:

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      qiyuan:
        apiKeyEnv: QIYUAN_API_KEY
        api: openai-completions
        baseURL: https://api.qiyuanapi.cc/v1
        models:
          - id: deepseek-v4.1
            contextWindow: 1000000
```

Nothing in that flow writes `reasoningEfforts`, and `@deepseek-ai/dsh-llm-pi-ai` decides a model's
reasoning capability like this:

```ts
const efforts = entry.reasoningEfforts
if (efforts === undefined) return { reasoning: base?.reasoning ?? false }
```

A hand-declared route has no installed-catalog `base`, so **every one of its models resolves to
`reasoning: false`**. The adapter then advertises no effort levels, the composer's picker has nothing
to render, and a forced effort is refused with `UNSUPPORTED_REASONING_EFFORT`. That is the whole
symptom.

It is not about the key or the vendor: catalog routes keep their shipped capability, and the same
relay reached through `llm-deepseek` works, because that adapter advertises efforts for every route
it serves. It is a missing *declaration*.

## What this plugin does

It writes that declaration — in the one place the adapter reads it, through the supported settings
seam. No adapter takeover, no HTTP interception, no harness patch. By default it does so
**automatically at startup**: any third-party route with no declaration is filled in, so installing
the plugin is the whole setup.

```yaml
# what it writes, for the route above
providers:
  qiyuan:
    models:
      - id: deepseek-v4.1
        contextWindow: 1000000
        reasoningEfforts:      # ← the declaration the picker reads
          off:
          low: low
          high: high
          max: max
        compat:
          thinkingFormat: deepseek
```

Four entry points over one shared, unit-tested planner:

| Surface | How |
|---|---|
| Automatic | **Nothing to run**: a load-time pass declares every third-party route that has none |
| Slash command | `/thinking` · `/thinking presets` · `/thinking adapt` · `/thinking set <provider>/<model> <preset>` · `/thinking remove …` |
| Plugins page | Sidebar **Plugins** → **dsh-thinking-effort** → per-model dropdown, applies instantly |
| Model tool | `thinking_effort_status` / `thinking_effort_set`, so "这个模型调不了思考强度" gets fixed conversationally |

A load-time diagnostic also names every route that still cannot be adjusted, so a freshly added key
is noticed immediately instead of the first time you open the model picker.

## Install

```sh
# from a checkout
dsh plugin --profile <profile> add /path/to/dsh-thinking-effort

# from GitHub (replace with your fork)
dsh plugin --profile <profile> add github:<you>/dsh-thinking-effort
```

`dsh plugin` forwards to pnpm inside the profile directory. A GitHub install pulls **sources** and
pnpm runs `prepare` (i.e. `tsdown`) to build `lib/`. On pnpm ≥ 10 the first git-dependency build is
refused; add the package name pnpm prints to the profile's `pnpm-workspace.yaml` and retry:

```yaml
allowBuilds:
  dsh-thinking-effort: true
```

> That allowlist authorizes executing this package's code at install time. Only allow source you
> trust, and prefer pinning a commit: `github:<you>/dsh-thinking-effort#<sha>`.

Then restart `dsh` — bundle membership is only read at boot — and check the layer is composed:

```sh
dsh --profile <profile> --dump-config    # expect a row named dsh-thinking-effort
```

> On the Windows desktop build the `desktop` profile is reserved and file-locked by the running app:
> **quit DeepSeek Harness before installing into it.**

### Compatibility

Built for dsh **0.2.1-rc.2**. The peer dependencies pin that release, `engines.dsh` declares
`>=0.2.1-rc.2 <0.3.0`, and `dsh.manifestVersion` records the 0.2.1 package-manifest format.

The integration points are the 0.2.1 ones: host writes go through `ctx.settings.mutate` (path ops),
the browser card through the settings domain's `ctx.configForms` service, and a third-party
bundle's own configuration page registers in the `plugins.bundle.config` slot of the sidebar
**Plugins** page. The pre-0.2 client binder (`settingsScope`) no longer exists in dsh, so versions
before 0.2.1 are not supported.

## Usage

Nothing to do. A freshly added third-party key is declared automatically at startup, and the log says
which route got which level map:

```
# dsh-thinking-effort: 自动适配完成。
# ✅ 已自动声明 1 个模型的思考强度档位：
#   路由 qiyuan → passthrough（1 个模型）
#     端点检测为 openai，写入 passthrough
#     档位：off→(不发) minimal→minimal low→low medium→medium high→high xhigh→xhigh max→max
#   这是可以随时改的起点：换档位名或方言用 /thinking set，预览用 /thinking explain。
```

Then open the model picker in the composer → **推理等级** → Off / Minimal / Low / Medium / High /
XHigh / Max. Picking one also saves it as the Agent default, exactly like a built-in provider.

### What automatic adaptation decides

It only touches **configuration-declared** routes — a catalog route already resolves its models'
capability from the installed catalog, so a declaration there would only narrow it. For each route it
reads the evidence already in the configuration:

1. If pi-ai already believes the endpoint does **not** take `reasoning_effort` (xAI, Z.AI, Moonshot,
   Together, NVIDIA, Cloudflare, or your own `compat.supportsReasoningEffort: false`), it writes
   `openai-null-off`. Sending `xhigh` to an endpoint that does not parse the parameter is the one way
   this plugin could turn a missing picker into a failing request. Your explicit setting outranks the
   plugin's inference.
2. Otherwise, if the endpoint host identifies a vendor (`deepseek.com`, `openrouter.ai`, DashScope,
   …), it writes that vendor's preset.
3. Otherwise it writes `autoAdaptPreset`, `passthrough` by default: all seven levels sent under their
   own names, no dialect pinned. A gateway with its own ladder gets the whole ladder back that way.

It never overwrites a model you already declared, and never touches `reasoningEfforts: false` — that
is an explicit "this model does not reason", and adaptation must not undo it.

Adaptation supplies the *declaration*; it cannot verify that the endpoint honours these values,
because that is not discoverable from configuration. After seeing the log line, check what each level
actually sends with `/thinking explain`, then try a level in a session.

### Adjusting it by hand

What it wrote is a starting point you can change at any time:

```
/thinking
# 路由 qiyuan（自声明路由）
#   - deepseek-v4.1: 可调 · 档位 off / minimal / low / medium / high / xhigh / max

/thinking explain qiyuan/deepseek-v4.1
# 路由 qiyuan · deepseek-v4.1
#   当前声明（未锁方言，pi-ai 会按端点检测为 openai）
#   实际生效的方言：openai（由端点检测得出）
#   compat.supportsReasoningEffort：true
#   每档实际发送的参数：
#     off      （不发送任何推理参数）
#     low      {"reasoning_effort":"low"}
#     ...

/thinking set qiyuan/deepseek-v4.1 deepseek-relay
# ✅ 已写入 qiyuan/deepseek-v4.1 的思考强度声明。
```

`/thinking adapt` runs the pass again on demand: `/thinking adapt qiyuan --preset deepseek-relay`
restricts it to one route and names the level map.

To turn adaptation off (this plugin's own profile config):

```yaml
- id: dsh-thinking-effort
  name: 'dsh-thinking-effort'
  config:
    autoAdapt: false          # only write when /thinking adapt is run
    autoAdaptPreset: passthrough
```

### Dialect presets

Which wire values the endpoint accepts is provider-specific; `reasoningEfforts` maps *selectable
level* → *value sent*. But the levels are only half of it: each `thinkingFormat` is a **separate
branch** that suppresses the generic OpenAI path, so pinning the wrong dialect can make a level do
nothing while appearing to work. That is why the presets are ordered safest first, and why only the
vendors that need one pin a dialect at all.

| Preset | Levels | Sends | Pins | Fits |
|---|---|---|---|---|
| `openai-null-off` | off / low / medium / high | `reasoning_effort`; `off` sends nothing | no | Any OpenAI-compatible endpoint — try this first |
| `openai` | off / low / medium / high | `reasoning_effort`; `off` → `"none"` | no | OpenAI itself, or a relay that accepts `none` |
| `deepseek-relay` | off / low / high / max | `reasoning_effort` | no | A third-party gateway serving DeepSeek models |
| `deepseek` | off / low / high / max | `reasoning_effort` **+ `thinking:{type:…}`** | `deepseek` | DeepSeek's own endpoint, or a strict clone |
| `openrouter` | off / low / medium / high | nested `reasoning:{effort}` | `openrouter` | OpenRouter and mirrors |
| `qwen` | off / low / high | `enable_thinking` (+ `reasoning_effort`) | `qwen` | Qwen family |
| `passthrough` | all seven | level name verbatim | no | Gateways that know pi-ai's own names |
| `custom` | yours | yours | — | Anything else — pass `levels` yourself |
| `inherit` | unchanged | unchanged | — | Only pin `--format` / `--default` |

`off:` with **no value** means "supported, but dispatch sends nothing" — the right spelling when not
thinking *is* the absence of the parameter. Only `off` may be left empty.

**Why `deepseek-relay` exists.** `deepseek` pins DeepSeek's private `thinking:{type:…}` parameter,
which an OpenAI-compatible relay generally ignores. Ignoring is worse than failing: with thinking
switched off, that branch sends *no* `reasoning_effort` either, so **Off does nothing** while a named
level looks fine. If Off seems to have no effect on a relay, this is the cause — switch to
`deepseek-relay` or `openai-null-off`, both of which send only the standard parameter.

`/thinking explain <provider>/<model> [preset]` prints, for every level, the exact request
parameters it will send — plus what pi-ai *would* have detected had nothing been pinned, and a
warning when two levels collapse to the same request. Nothing is written.

Overrides: `/thinking set qiyuan/m deepseek --format deepseek --default high`.

## How it works

Writes are **path-addressed settings mutations**:
`settings.mutate(entryId, settingsOps(provider, patch), revision)`. Each op names one path —
`providers.<route>.models`, `providers.<route>.modelOverrides.<model>`,
`providers.<route>.reasoning` — so only the edited route (and, inside a catalog route, only the
edited model) is touched; sibling routes and unowned fields survive without a read-modify-write.
The browser card sends the same op list through `ctx.configForms`, so the command, the tools and
the GUI cannot write different documents.

The shape of the patch depends on where the route's capability comes from, because `llm-pi-ai`
refuses `modelOverrides` on a route that also carries a `models` list:

- a route with a non-empty `models` list (every hand-declared third-party route) → the list is
  **rewritten in full**, carrying every entry and every unowned field through;
- a route inheriting the installed catalog → one `modelOverrides.<model>` entry, set as its own
  path op so the rest of the dict keeps serving.

One side effect is worth knowing before you read the diff. The rewritten `models` array is built from
the *resolved* section, so schema defaults the resolver had already materialized ride along into the
stored document — after declaring a level on a hand-declared route, that model entry typically gains
`compat.chatTemplateKwargs: {}` and `compat.chatTemplateArgs: {}` beside the `thinkingFormat` this
plugin actually wrote. They are the schema's own defaults, so the resolved value is unchanged and
nothing behaves differently; the document just becomes explicit about fields it previously left
implicit. The write stays narrow at the route level: only the route you named appears in the user
layer, and no route-level default is materialized.

Writes are revision-fenced against the descriptor read in the same pass (a concurrent editor is
reported, then retried once against a fresh read), and a declaration that is already in force writes
nothing at all. That is what makes automatic adaptation idempotent: the first boot writes, every
later boot is a zero-write no-op, and it needs no memory of what it wrote — an in-force declaration
is itself what leaves it with nothing to do.

Adaptation and the diagnostic run at the same injection point, adaptation first, so a log line
saying "every model is adjustable" describes the state the pass just produced rather than one about
to arrive. The settings service can register before the pi-ai adapter does, so a pass that finds no
descriptor waits half a second and retries, up to five times, before giving up and pointing at
`/thinking adapt`.

The settings entry id is discovered by **shape**, not by directory position:
`listConfigurableProviders()` is registration-ordered, and in 0.2.1 the `llm-deepseek` adapter
registers before `llm-pi-ai`, so "the first namespace" resolves to a section with no `providers`
dict. The plugin picks the entry whose settings path is `['providers', …]` (or whose section really
carries a `providers` dict), with the shipped `llm-pi-ai` id as the tie-break; a profile that
renames the loader entry still resolves. (The browser card binds the shipped id, exactly as dsh's
built-in Models page does.)

## What it deliberately does not do

- **No route-level removal.** `remove` strips the `reasoningEfforts` and `compat.thinkingFormat` this
  plugin owns from the model entry. It leaves route-level `reasoning` / `thinkingBudgets` alone:
  the declaration never owned them, so removing a level map should not silently change the route's
  default.
- **No HTTP-layer rewriting.** There is no supported interceptor for the request body, and mutating
  the frozen call config throws. Declaring the capability is the supported path.
- **No probing of the endpoint.** Automatic adaptation judges only the evidence already in the
  configuration: it neither spends your API key on test requests nor infers a dialect by watching
  which level has an effect. A single request cannot tell "the parameter was ignored" apart from "the
  parameter worked", so that conclusion is yours to draw in a session; renaming a level is one
  `/thinking set`.

## Development

```sh
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm build         # tsdown → lib/index.js + lib/client.js
pnpm test          # node --test over the pure modules and the build output
pnpm verify        # all three
```

`pnpm test` runs without a dsh installation. `test/smoke.test.mjs` registers a resolver hook
(`test/resolve-hook.mjs`) that redirects `@deepseek-ai/dsh-tools` to a faithful local stub: the real
package resolves a chain of harness-internal peers a plugin repo has no business installing, and
`defineTool` is an identity helper at runtime — its real signature still type-checks from the
devDependency. The hook is registered inside the test file itself, so `pnpm test` behaves the same
whether or not the runner forwards its own flags to per-file child processes.

Layout:

```
src/
  index.ts        host entry: Config, registrations, load-time adaptation + diagnostic
  presets.ts      thinking levels, wire dialects, the validator (pure)
  plan.ts         declaration → path-addressed settings ops (pure, shared with the browser)
  auto.ts         which preset an undeclared route gets (pure)
  diagnose.ts     capability report (pure)
  wire.ts         what each level actually puts on the wire (pure)
  types.ts        stored/read shapes, the settings port, dialect constants
  json.ts         isPlainObject / deepEqual / omit (dependency-free)
  apply.ts        the settings port: read descriptor, plan, apply path ops
  commands.ts     /thinking, including the `adapt` batch entry
  tools.ts        thinking_effort_status / thinking_effort_set / thinking_effort_explain
  format.ts       shared text rendering
  client/
    index.ts      browser half entry: inject / apply
    card.ts       the configuration card on the Plugins page
    styles.ts     its stylesheet
    types.ts      structural types for the two browser services used
test/             unit tests + a smoke test over the build output
```

Working notes for anyone (human or agent) about to change the code — the invariants, the build
constraints, and a verified `pnpm verify` baseline — live in [AGENTS.md](AGENTS.md)
([简体中文](CONTEXT.zh.md)).

## License

MIT
