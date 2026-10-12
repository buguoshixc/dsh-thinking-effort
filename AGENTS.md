# AGENTS.md — working notes for this repository

**English** | [简体中文](CONTEXT.zh.md)

Orientation for an agent (or a human) starting cold on `dsh-thinking-effort`. `README.md` explains
*what the plugin is for*; this file records *what you need to know before changing it* — the design
invariants the code does not restate, the constraints that silently break the build, and a verified
baseline to compare against.

Read the README first, then this.

---

## 1. What this repository is

A **DeepSeek Harness (dsh) plugin** (ESM, MIT, v0.1.0) with exactly one job: give a third-party
OpenAI-compatible route adjustable thinking intensity.

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
command, the settings tab (Settings → Plugins → **思考强度**), and three model-callable tools. A
load-time diagnostic then names every route that still cannot be adjusted.

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
| `src/types.ts` | `Declaration`, `ModelLike` / `ProfileLike`, `PiAiPort`, and the `SettingsLike` structural subset |
| `src/plan.ts` | **The core**: declaration → settings patch. Pure, shared by both halves |
| `src/auto.ts` | Which preset an undeclared route gets — the only judgement auto-adaptation makes. Pure |
| `src/diagnose.ts` | The capability report. Pure |
| `src/wire.ts` | A reimplementation of pi-ai's dispatch: what each level actually sends. Pure |
| `src/apply.ts` | The settings port: read descriptor → plan → revision-fenced merge |
| `src/commands.ts` | The `/thinking` grammar, `explainModel`, and the batch write loop `adaptDeclaredModels` |
| `src/tools.ts` | `thinking_effort_status` / `_set` / `_explain` |
| `src/format.ts` | Text rendering shared by the command, the tools and the load-time log |
| `src/index.ts` | Host entry: `Config`, registrations, the load-time adaptation pass and diagnostic |
| `src/client/` | Browser half: `index.ts` mount, `card.ts` settings tab, `styles.ts`, `types.ts` |

6. Tests are named after their source (`plan.ts` → `test/planner.test.mjs` is the one exception):
   `planner`, `auto`, `wire`, `apply`, `diagnose`, `command`, and `smoke` — the last runs the **build
   output**, with `resolve-hook.mjs` + `dsh-tools-stub.mjs` standing in for the harness.

## 3. Invariants — understand these before changing anything

- **One planner.** All judgement lives in `src/plan.ts` (pure). The Node half (`src/apply.ts`) and
  the browser half (`src/client/card.ts`) both call it, so the command, the tools and the GUI can
  never disagree. Do not duplicate that logic in a second place.
- **The write shape follows the route's shape** — the branch in `plan.ts` that is easiest to get wrong:
  - a route with a non-empty `models` list → the list is **rewritten in full** (`mergeLayers` replaces
    arrays wholesale), so every entry and every field the plugin does not own must be carried through;
  - a route inheriting the installed catalog → a `modelOverrides` entry, a dict that merges and never
    narrows the served catalog.
  - The reason for two shapes: `llm-pi-ai` **refuses** `modelOverrides` on a route that also carries
    a `models` list.
- **The write is a merge, and it is revision-fenced.** `settings.update(ns, { providers: { <route>: patch } }, revision)`
  touches exactly one route key. A conflict is reported, then retried once against a fresh read
  (`apply.ts`, at most two attempts).
- **Nothing to write means nothing is written.** An already-satisfied declaration returns
  `unchanged: true` and performs zero writes; a test pins this.
- **The plugin keeps no declaration state of its own.** The `llm-pi-ai` section is the single source
  of truth; a declaration is a one-shot edit of it, never a shadow copy that could drift.
- **The namespace is discovered, not hardcoded.** It comes from
  `llm.listConfigurableProviders()[].settingsNs`; `DEFAULT_PI_AI_NS = 'llm-pi-ai'` is only the
  fallback, so a profile that renames the loader entry still works.
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
    this plugin owns, and leaves `reasoning` / `thinkingBudgets` alone, because `update` merges and
    JSON has no `undefined` to merge in;
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

Measured on `main` (`6d46946`, clean tree): `tsc --noEmit` clean; tsdown emits `lib/index.js` +
`lib/index.d.ts` + `lib/client.js` (+ sourcemap); `node --test` → **64 pass / 0 fail**.

Measured again with the auto-adaptation pass in the tree (working tree, `pnpm verify`): typecheck
clean, both bundles emitted, **82 pass / 0 fail**. The delta is `test/auto.test.mjs` plus seven
load-time/`adapt` cases in `smoke.test.mjs`.

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

**Two invisible rules in the React card** (`src/client/card.ts` documents both):

1. every hook must run before any early return — the namespace moves `loading` → `ready` and
   re-renders, and a hook declared after a return changes the hook count, which crashes a card in
   this exact slot;
2. `settingsScope.set(field, value)` addresses one **top-level** field and **replaces** it, so the
   card must read the stored user layer out of the snapshot, merge the single route into it, and
   write that back — never `set('providers', …)` directly.

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

That means **no real harness integration is exercised here**. Verifying the plugin in anger means
installing it into a profile — `dsh plugin --profile <profile> add <path>`, then restarting `dsh`
(bundle membership is read at boot) and confirming the row with
`dsh --profile <profile> --dump-config`. On the Windows desktop build the `desktop` profile is
reserved and file-locked by the running app: **quit DeepSeek Harness before installing into it.**

## 8. Conventions

Conventional-commit subjects (`feat:` / `fix:` / `docs:` / `chore:`), lowercase, no scope unless it
helps. Comments explain *why* a thing is the way it is, in prose, at the point of the surprise —
match that style; the existing code is heavier on rationale than on description because the rationale
is the part that is not recoverable from reading the code.
