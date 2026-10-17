# AGENTS.md — working notes for this repository

**English** | [简体中文](CONTEXT.zh.md)

Orientation for an agent (or a human) starting cold on `dsh-thinking-effort`. `README.md` explains
*what the plugin is for*; this file records *what you need to know before changing it* — the design
invariants the code does not restate, the constraints that silently break the build, and a verified
baseline to compare against.

Read the README first, then this.

---

## 1. What this repository is

A **DeepSeek Harness (dsh) plugin** (ESM, MIT, v0.2.0) with exactly one job: give a third-party
OpenAI-compatible route adjustable thinking intensity. The current release targets dsh
**0.2.1-rc.2** (peer pins, `engines.dsh`, `dsh.manifestVersion: 1`).

A third-party provider is a `providers.<route>` profile on the `llm-pi-ai` adapter. Nothing in that
flow writes `reasoningEfforts`, and the adapter decides a model's capability like this:

```ts
const efforts = entry.reasoningEfforts
if (efforts === undefined) return { reasoning: base?.reasoning ?? false }
```

A hand-declared route has no installed-catalog `base`, so **every one of its models resolves to
`reasoning: false`**: the composer's reasoning picker disappears and a forced level is refused with
`UNSUPPORTED_REASONING_EFFORT`. The plugin declares the missing capability through the supported
settings seam — no adapter takeover, no HTTP interception, no harness patch.

Four entry points over one shared planner: a load-time automatic pass that declares every
undeclared third-party route (so installing the plugin is the whole setup), the `/thinking` slash
command, the Plugins-page card (sidebar **Plugins** → **dsh-thinking-effort**, through the
`plugins.bundle.config` slot), and three model-callable tools. A load-time diagnostic then names
every route that still cannot be adjusted.

## 2. Reading order

1. `README.md` — problem statement, the preset table, the write shape, the deliberate non-goals.
2. `package.json` — the `dsh.bundle` / `dsh.client` contract, `exports`, and the all-optional peers.
3. `cordis.patch.yml` — how the plugin is composed into a profile (two preferences, nothing else).
4. `tsdown.config.ts` — the two-part build (host ESM library + browser CJS bundle).
5. Sources, in dependency order — pure modules first, side-effecting shells last:

| File | Role |
|---|---|
| `src/json.ts` | `isPlainObject` / `deepEqual` / `omit`; dependency-free by design |
| `src/presets.ts` | **Pure data + pure functions**: the seven levels, ten wire dialects, the presets, `validateLevels`, and the two auto-adapt constants |
| `src/types.ts` | `Declaration`, `ModelLike` / `ProfileLike`, `PiAiPort`, `SettingsPathOp`, and the `SettingsLike` structural subset |
| `src/plan.ts` | **The core**: declaration → route patch → path-addressed settings ops. Pure, shared by both halves |
| `src/auto.ts` | Which preset an undeclared route gets — the only judgement auto-adaptation makes. Pure |
| `src/diagnose.ts` | The capability report. Pure |
| `src/wire.ts` | A reimplementation of pi-ai's dispatch: what each level actually sends. Pure |
| `src/apply.ts` | The settings port: read descriptor → plan → revision-fenced `settings.mutate` |
| `src/commands.ts` | The `/thinking` grammar, `explainModel`, and the batch write loop `adaptDeclaredModels` |
| `src/tools.ts` | `thinking_effort_status` / `_set` / `_explain` |
| `src/format.ts` | Text rendering shared by the command, the tools and the load-time log |
| `src/index.ts` | Host entry: `Config`, registrations, the load-time adaptation pass and diagnostic |
| `src/client/` | Browser half: `index.ts` mount, `card.ts` Plugins-page configuration card, `styles.ts`, `types.ts` |

6. Tests are named after their source (`plan.ts` → `test/planner.test.mjs` is the one exception):
   `planner`, `auto`, `wire`, `apply`, `diagnose`, `command`, and `smoke` — the last runs the **build
   output**, with `resolve-hook.mjs` + `dsh-tools-stub.mjs` standing in for the harness.

## 3. Invariants — understand these before changing anything

- **One planner.** All judgement lives in `src/plan.ts` (pure), including the conversion from a
  declaration's patch to path ops (`settingsOps`). The Node half (`src/apply.ts`) and the browser
  half (`src/client/card.ts`) both call it and both send those ops — the Node half through
  `ctx.settings.mutate`, the browser half through `ctx.configForms` — so the command, the tools and
  the GUI can never disagree. Do not duplicate that logic in a second place.
- **The write shape follows the route's shape** — the branch in `plan.ts` that is easiest to get wrong:
  - a route with a non-empty `models` list → the list is **rewritten in full** (arrays replace
    wholesale), so every entry and every field the plugin does not own must be carried through;
  - a route inheriting the installed catalog → one `modelOverrides.<model>` entry, written as its own
    path op so the rest of the dict keeps serving.
  - The reason for two shapes: `llm-pi-ai` **refuses** `modelOverrides` on a route that also carries
    a `models` list.
- **The write is path-addressed and revision-fenced.** `settings.mutate(ns, settingsOps(provider, patch), revision)`
  touches exactly `providers.<route>` (and inside a catalog route exactly one model id). It is
  deliberately **not** `settings.update`: that merges objects recursively, so a plan that dropped
  `compat.thinkingFormat` would leave the old pin behind. A conflict is reported, then retried once
  against a fresh read (`apply.ts`, at most two attempts).
- **Nothing to write means nothing is written.** An already-satisfied declaration returns
  `unchanged: true` and performs zero writes; a test pins this.
- **The plugin keeps no declaration state of its own.** The `llm-pi-ai` section is the single source
  of truth; a declaration is a one-shot edit of it, never a shadow copy that could drift.
- **The namespace is discovered by shape, not by directory position.** `listConfigurableProviders()`
  is registration-ordered; in 0.2.1 `llm-deepseek` registers before `llm-pi-ai`, so "the first entry
  with a `settingsNs`" resolves to a section with no `providers` dict (empty plans, false all-clear —
  this actually happened in a real 0.2.1 boot). Pick the entry whose `settingsPath[0] === 'providers'`
  or whose settings section carries a `providers` object; `DEFAULT_PI_AI_NS = 'llm-pi-ai'` is the
  tie-break, so a profile that renames the loader entry still works. The browser half binds the
  shipped id, exactly as dsh's built-in Models page does.
- **`off: null` and "no `off` declared" mean opposite things.** `off: null` is "supported, dispatch
  sends nothing"; an absent `off` is "this level is not offered". Only `off` may be left empty.
  `thinkingLevelMapOf` in `src/wire.ts` reproduces this exactly.
- **Pinning a dialect suppresses the generic branch.** Each `thinkingFormat` is a separate `else if`
  branch, so a wrong pin makes a level look like it works while sending nothing useful. `deepseek`
  additionally pins DeepSeek's private `thinking:{type:…}`, which a generic relay ignores — and
  ignoring is worse than failing: with thinking off, that branch sends no `reasoning_effort` either,
  so **Off silently does nothing**. That is why `deepseek-relay` exists.
- **The preset order is deliberate** (safest first): `openai-null-off` is always first, and the
  recommended repair command in diagnostic output must be that one, never a vendor-specific preset.
  `test/wire.test.mjs` guards both with `THE REGRESSION` and "the first recommendation is the one
  that cannot fail loudly".
- **Deliberate non-goals** (see the README section of that name; these are not bugs to fix):
  - no route-level removal — `remove` strips only the `reasoningEfforts` and `compat.thinkingFormat`
    this plugin owns from the model entry, and leaves route-level `reasoning` / `thinkingBudgets`
    alone: the declaration never owned them;
  - no HTTP-layer rewriting — there is no supported interceptor, and mutating the frozen call config
    throws;
  - no probing of the endpoint — auto-adaptation judges only what the configuration already says
    (the route's `compat`, its `baseURL`, and the adapter's declared-vs-catalog verdict); it never
    spends an API key on test requests, and a single request could not tell "the parameter was
    ignored" from "the parameter worked" anyway. That is why the *safest* preset is the one written
    for an endpoint pi-ai believes refuses `reasoning_effort`, rather than a guess at the real one.
- **Auto-adaptation is idempotent by construction, not by memory.** It stores no record of what it
  wrote: `planDeclaration` returns `unchanged: true` for a declaration already in force, so the first
  boot writes and every later boot is a zero-write no-op. Never add a "have I already adapted this?"
  flag — that shadow state is exactly what section 3's "no declaration state of its own" forbids.
- **Auto-adaptation only writes where the capability is missing and the user has not spoken.**
  `adaptPlan` skips catalog routes (their models already resolve from the installed catalog, so a
  declaration would narrow it), models that already declare levels, and `reasoningEfforts: false`
  (an explicit "this model does not reason" that adaptation must not undo). A declared route with no
  `models` entries is *reported*, never silently ignored.
- **The load-time diagnostic runs after the adaptation pass, never beside it.** Nothing in the pass
  is synchronous past its first `await`, so a report emitted in parallel reads the settings document
  before the writes land and prints "1 model cannot be adjusted" one line above "declared 1 model".
  `test/smoke.test.mjs` asserts both the write and the absence of that contradiction.
- **The adaptation pass must actually wait.** The pi-ai adapter registers its settings descriptor
  after the settings service mounts, so the first look legitimately finds nothing. Sleep between
  attempts (`AUTO_ADAPT_DELAY_MS`); an instant `continue` retries five times in the same tick, gives
  up before the adapter exists, and leaves a fresh key undeclared — observed in a real 0.2.1 boot and
  pinned by a smoke test.

## 4. Documentation gaps worth knowing about

Both READMEs were behind the code, and this was corrected in the same pass that added this file —
worth knowing because it shows how the drift happens (a new surface is added to `src/` and the
assertion in `test/smoke.test.mjs`, while a README paragraph that enumerates surfaces is missed):

- `src/tools.ts` registers **three** tools; both READMEs documented two, omitting
  **`thinking_effort_explain`** (preview a dialect without writing). The layout trees were also
  missing `src/types.ts`, `src/json.ts`, and `src/client/`'s real files.
- Both READMEs now list all three tools and the true layout.

So: when you add or rename a surface, check both READMEs, their layout trees, and the matching
`test/*.test.mjs` — not just the one README you happen to be reading.

The auto-adaptation pass repeated the pattern in a new place, which is worth recording because the
surface was not a tool or a file but a *behaviour*:

- adding the load-time pass invalidated the "**No automatic guessing of a dialect**" non-goal that had
  been stated in both READMEs, this file, and the front matter of section 1 here — the code would
  have contradicted its own documentation on the very first line a reader checks;
- the auto-adaptation judgement itself went into `src/auto.ts` rather than into `plan.ts`, on purpose:
  `plan.ts` answers "how do I write this declaration", `auto.ts` answers "which declaration should
  exist at all". Keeping them apart is what lets the second be tested without a settings service, and
  what keeps the first free of any opinion about which preset a user *should* have.

The dsh 0.2.1 port produced a third instance, across three surfaces at once:

- the client API changed under the plugin: `settingsScope` disappeared before 0.2.0 and
  `ctx.configForms` replaced it, while a third-party bundle's configuration moved from
  `settings.plugins.tab` (built-in inventory) to `plugins.bundle.config` on the sidebar Plugins page;
- `llm.listConfigurableProviders()` started listing `llm-deepseek` before `llm-pi-ai`, which broke
  "first `settingsNs`" discovery silently (empty plans, an all-clear diagnostic) and only a real
  0.2.1 boot exposed it;
- the empty-descriptor retry loop never slept, so "five half-second waits" were five instant tries.

None of those were visible to `pnpm test` before the port. The lesson is the same as above, one layer
bigger: a dsh minor/major bump can change a *seam* while every local unit test stays green, so check
the installed runtime's own manifests/READMEs and boot it headlessly before believing a compatibility
claim.

## 5. Verified baseline

On Windows a non-TTY `pnpm` run performs a pre-run dependency check that wants to purge
`node_modules` and dies with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. Use the bundled runtime
and set `CI` explicitly:

```powershell
$env:CI = "true"
# The desktop build ships this runtime under the user profile:
$runtime = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies"
$node = "$runtime\node\bin\node.exe"
$pnpm = "$runtime\pnpm\bin\pnpm.mjs"
& $node $pnpm verify      # typecheck -> build -> test
```

Measured on the 0.2.1-rc.2 port (working tree, 2026-10-17): `tsc --noEmit` clean against the
0.2.1-rc.2 declarations; tsdown emits `lib/index.js` + `lib/index.d.ts` + `lib/client.js`
(+ sourcemap); `node --test` → **91 pass / 0 fail**. The delta from the 0.2.0-rc.2 baseline (82)
is `settingsOps`/path-op cases in `test/planner.test.mjs`, the `settings.mutate` rewrite of
`test/apply.test.mjs`, namespace-discovery and retry-wait cases in `smoke.test.mjs`, and the 0.2.1
client-contract assertions.

Beyond the suite, the port was verified against the **installed 0.2.1-rc.2 runtime**: extract its
`app.asar` into a scratch directory, run its CLI with an isolated `DSH_HOME` and a profile carrying
this bundle, then check (a) `--dump-config` lists the `thinking-effort` row and the test route,
(b) a headless boot exits 0 with no skipped bundle and the Loader row active, (c) `/thinking` plus
the three tools are registered on the real 0.2.1 services, (d) load-time adaptation actually
declares the route and the log shows no contradiction, and (e) the client graph carries
`dsh-thinking-effort`'s `client.js` with the `__ModuleLoader__` handshake. That run is PASS with no
advisories, and it is the check that caught the 0.2.1 seams listed in section 4. Repeat it for any
future harness-version bump; the suite alone will not catch a changed seam.

Two traps when reading that output:

- `lib/` is gitignored but `smoke.test.mjs` **loads the build output**, so always build before
  testing. A stale `lib/` makes the suite lie.
- Truncating pnpm's output with `Select-Object -First N` closes the pipe and makes PowerShell report
  `NativeCommandError` — a false failure. Judge by the `pass`/`fail` counts and pnpm's own exit code;
  to read the real exit code, redirect to a file instead of truncating.

CI (`.github/workflows/ci.yml`) runs the same three steps on Node 24 with pnpm 11.7.0.

## 6. Constraints you must respect

**TypeScript.** `tsconfig.json` is `strict` + `noUncheckedIndexedAccess` (array reads must be
undefined-checked) + `verbatimModuleSyntax` + `isolatedModules` + `erasableSyntaxOnly`. So: type-only
imports must use `import type`; source imports carry the **`.ts` extension**
(`allowImportingTsExtensions`); and no enums, parameter properties, or anything needing more than
type erasure.

**Optional everything.** Every harness dependency is an optional peer (`@deepseek-ai/cordis`,
`dsh-commands`, `dsh-llm`, `dsh-settings`, `dsh-tools`, `schemastery`, `react`). At runtime the
plugin reaches for services with `ctx.get(...)`, types them structurally, and wraps directory reads
in `try/catch` — an absent or throwing service may only narrow a report, never throw. This is also
why `src/client/types.ts` imports no `@deepseek-ai` client package at all.

**The client bundle has a purity gate.** `react` is the only allowed external
(`CLIENT_EXTERNALS` in `tsdown.config.ts`); everything else is inlined. The artifact must keep the
CJS module-loader handshake:

```js
window.__ModuleLoader__.load({ id: "dsh-thinking-effort", factory: (require) => { … return module.exports; } });
```

`test/smoke.test.mjs` scans the bundle for every `require(...)` specifier and asserts only `react`
(and `react/jsx-runtime`) appear.

**The tsdown config is an array.** The host entry uses `clean: true` and the client entry must keep
`clean: false`, or the two builds delete each other's output.

**`dsh.client.inject` is informational.** In 0.2.1 it lists package-name edges in the boot graph, not
Cordis services; service injection is the client bundle's own `export const inject`. The old
`["slots"]` value named no package row and was silently inert.

**Two invisible rules in the React card** (`src/client/card.ts` documents both):

1. every hook must run before any early return — the namespace moves `loading` → `ready` and
   re-renders, and a hook declared after a return changes the hook count, which crashes a card in
   this exact slot;
2. every write goes through `form.mutate` path ops: `[{ op: 'set', path: ['providers', <route>, …], value }]`,
   plus one op per model id inside a catalog route's `modelOverrides`. `set('providers', …)` replaces
   the whole top-level field and is off-limits. The form comes from
   `ctx.configForms.get('llm-pi-ai')` (entry id = Host loader entry id); registration into
   `plugins.bundle.config` is keyed by the npm package name and wrapped in
   `ctx.effect(() => forms.whileServed(['llm-pi-ai'], …))`; `configForms` is requested with
   `ctx.inject`, never the bundle's static `inject` — a pending client fiber fails the web shell's
   boot audit.

The card also uses `React.createElement` rather than JSX, even though `jsx: react-jsx` is enabled.

**User-visible text is Chinese.** Command output, tool results, card labels and diagnostics are all
Chinese (❌ for failures, ✅ for success). Keep new strings Chinese and in that voice.

**Changing `src/` means checking three things**: `README.md`, `README.zh.md`, and the matching
`test/*.test.mjs` assertions. The two READMEs are kept in step; so are source and tests.

## 7. What local verification does *not* cover

`pnpm test` runs without a dsh installation: `test/resolve-hook.mjs` redirects
`@deepseek-ai/dsh-tools` to `test/dsh-tools-stub.mjs`, because `defineTool` is an identity helper at
runtime while the real contract is type-level (and `pnpm typecheck` still compiles the genuine
signature from the installed devDependency).

That means the suite exercises **no real harness integration**. Verifying the plugin in anger means
either the headless runtime procedure in section 5, or installing it into a profile —
`dsh plugin --profile <profile> add <path>`, then restarting `dsh` (bundle membership is read at
boot) and confirming the row with `dsh --profile <profile> --dump-config`. On the Windows desktop
build the `desktop` profile is reserved and file-locked by the running app: **quit DeepSeek Harness
before installing into it.**

## 8. Conventions

Conventional-commit subjects (`feat:` / `fix:` / `docs:` / `chore:`), lowercase, no scope unless it
helps. Comments explain *why* a thing is the way it is, in prose, at the point of the surprise —
match that style; the existing code is heavier on rationale than on description because the rationale
is the part that is not recoverable from reading the code.
