# dsh-thinking-effort

**English** | [简体中文](README.zh.md)

Bring back the **thinking-intensity picker** (推理等级 / reasoning effort) for third-party API keys in
[DeepSeek Harness](https://github.com/deepseek-ai/dsh).

You plug an OpenAI-compatible relay into `dsh`, pick one of its models, and the
「推理等级」 pane in the composer is simply gone. This plugin declares the missing capability for
those routes, so the picker comes back — from a slash command, from a settings tab, or by asking
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
seam. No adapter takeover, no HTTP interception, no harness patch.

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

Three entry points over one shared, unit-tested planner:

| Surface | How |
|---|---|
| Slash command | `/thinking` · `/thinking presets` · `/thinking set <provider>/<model> <preset>` · `/thinking remove …` |
| Settings tab | Settings → Plugins → **思考强度** — per-model dropdown, applies instantly |
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

## Usage

Fix your relay once:

```
/thinking
# 路由 qiyuan（自声明路由）
#   - deepseek-v4.1: ❌ 不可调 · 未声明 reasoningEfforts 且该路由不在内置目录里。
# ❌ 1 个模型无法调节思考强度：qiyuan/deepseek-v4.1

/thinking explain qiyuan/deepseek-v4.1
# 路由 qiyuan · deepseek-v4.1
#   当前声明（未锁方言，pi-ai 会按端点检测为 openai）
#   实际生效的方言：openai（由端点检测得出）
#   compat.supportsReasoningEffort：true
#   每档实际发送的参数：
#     off      （不发送任何推理参数）
#     low      {"reasoning_effort":"low"}
#     ...

/thinking set qiyuan/deepseek-v4.1 openai-null-off
# ✅ 已写入 qiyuan/deepseek-v4.1 的思考强度声明。
```

Then open the model picker in the composer → **推理等级** → Off / Low / Medium / High. Picking one also
saves it as the Agent default, exactly like a built-in provider.

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

`settings.update(entryId, { providers: { <route>: … } })` **merges**, so supplying one route key
leaves every other route — and every field of this route it does not own — untouched. The shape of
the patch depends on where the route's capability comes from, because `mergeLayers` replaces arrays
wholesale and `llm-pi-ai` refuses `modelOverrides` on a route that also carries a `models` list:

- a route with a non-empty `models` list (every hand-declared third-party route) → the list is
  **rewritten in full**, carrying every entry and every unowned field through;
- a route inheriting the installed catalog → a `modelOverrides` entry, a dict that merges and never
  narrows the served catalog.

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
nothing at all.

The settings entry id is taken from the adapter's own configurable-provider directory
(`listConfigurableProviders().settingsNs`), so a profile that renames the loader entry still works;
`llm-pi-ai` is only the fallback.

## What it deliberately does not do

- **No route-level removal.** `remove` strips `reasoningEfforts` and the `thinkingFormat` this plugin
  wrote. It leaves `reasoning` / `thinkingBudgets` alone: `update` merges, JSON has no `undefined` to
  merge in, and unsetting fields this plugin does not own would need a path op against somebody
  else's config.
- **No HTTP-layer rewriting.** There is no supported interceptor for the request body, and mutating
  the frozen call config throws. Declaring the capability is the supported path.
- **No automatic guessing of a dialect.** Which values an endpoint accepts is not discoverable from
  configuration; a wrong guess would look like a working control that silently sends nothing useful.
  Pick a preset.

## Development

```sh
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm build         # tsdown → lib/index.js + lib/client.js
pnpm test          # node --test over the pure modules and the build output
pnpm verify        # all three
```

`pnpm test` runs without a dsh installation: `test/register.mjs` installs a resolver hook that
redirects `@deepseek-ai/dsh-tools` to a faithful local stub (`defineTool` is an identity helper at
runtime; its real signature still type-checks from the devDependency).

Layout:

```
src/
  index.ts        host entry: Config, registrations, load-time diagnostic
  presets.ts      thinking levels, wire dialects, the validator (pure)
  plan.ts         declaration → settings patch (pure, shared with the browser)
  diagnose.ts     capability report (pure)
  wire.ts         what each level actually puts on the wire (pure)
  apply.ts        the settings port: read descriptor, plan, merge the write
  commands.ts     /thinking
  tools.ts        thinking_effort_status / thinking_effort_set
  format.ts       shared text rendering
  client/         browser half: the settings tab and its stylesheet
test/             unit tests + a smoke test over the build output
```

## License

MIT
