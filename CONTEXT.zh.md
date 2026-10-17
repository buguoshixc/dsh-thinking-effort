# CONTEXT.zh.md — 本仓库的工作笔记

[English](AGENTS.md) | **简体中文**

给刚接手 `dsh-thinking-effort` 的 agent（或人）的入门说明。`README.zh.md` 讲**这个插件是干什么的**；
本文件记录**动它之前必须先知道的东西** —— 代码里没有复述的设计不变量、会静默破坏构建的约束，
以及一份可对照的实测基线。

先读 README，再读本文件。

---

## 1. 这个仓库是什么

一个 **DeepSeek Harness (dsh) 插件**（ESM，MIT，v0.2.0），只解决一件事：让第三方
OpenAI 兼容路由可以调节思考强度。当前版本面向 dsh **0.2.1-rc.2**（peer 固定版本、`engines.dsh`、
`dsh.manifestVersion: 1`）。

第三方 provider 是挂在 `llm-pi-ai` 适配器上的 `providers.<route>` 配置。这条链路从不写
`reasoningEfforts`，而适配器这样判定模型能力：

```ts
const efforts = entry.reasoningEfforts
if (efforts === undefined) return { reasoning: base?.reasoning ?? false }
```

手写声明的路由没有内置目录的 `base`，所以**该路由下每个模型都解析为 `reasoning: false`**：
composer 的推理等级选择器消失，强制档位会被 `UNSUPPORTED_REASONING_EFFORT` 拒绝。本插件通过
受支持的 settings 接口补上这份缺失的声明 —— 不做适配器接管、不做 HTTP 拦截、不打 harness 补丁。

四个入口共用同一个 planner：加载时自动补声明的适配（装上即完成全部配置）、`/thinking` 斜杠命令、
插件页卡片（侧边栏 **插件** → **dsh-thinking-effort**，经 `plugins.bundle.config` 槽位）、以及三个
可被模型调用的工具。之后还有一次加载时自检，会点名所有仍无法调节的路由。

## 2. 建议的阅读顺序

1. `README.zh.md` —— 问题陈述、预设方言表、写入形状、刻意的非目标。
2. `package.json` —— `dsh.bundle` / `dsh.client` 契约、`exports`、以及全部 optional 的 peer 依赖。
3. `cordis.patch.yml` —— 插件如何被组合进 profile（只有两个偏好，别无其他）。
4. `tsdown.config.ts` —— 两段式构建（host 的 ESM 库 + 浏览器的 CJS bundle）。
5. 源码，按依赖方向读 —— 纯模块在前，带副作用的外壳在后：

| 文件 | 职责 |
|---|---|
| `src/json.ts` | `isPlainObject` / `deepEqual` / `omit`；刻意零依赖 |
| `src/presets.ts` | **纯数据 + 纯函数**：七个档位、十种 wire 方言、预设表、`validateLevels`，以及两个自动适配常量 |
| `src/types.ts` | `Declaration`、`ModelLike` / `ProfileLike`、`PiAiPort`、`SettingsPathOp`，以及 `SettingsLike` 的结构子集 |
| `src/plan.ts` | **核心**：声明 → 路由 patch → 路径寻址的 settings 操作。纯函数，两半共用 |
| `src/auto.ts` | 未声明的路由该拿哪套预设 —— 自动适配唯一的判断。纯 |
| `src/diagnose.ts` | 能力报告。纯 |
| `src/wire.ts` | 复刻 pi-ai 的 dispatch：每档实际发送什么。纯 |
| `src/apply.ts` | settings 端口：读 descriptor → plan → 带 revision 栅栏的 `settings.mutate` |
| `src/commands.ts` | `/thinking` 语法、`explainModel`，以及批量写入循环 `adaptDeclaredModels` |
| `src/tools.ts` | `thinking_effort_status` / `_set` / `_explain` |
| `src/format.ts` | 命令、工具与加载时日志共用的文本渲染 |
| `src/index.ts` | host 入口：`Config`、各项注册、加载时的自动适配与自检 |
| `src/client/` | 浏览器半边：`index.ts` 挂载、`card.ts` 插件页配置卡片、`styles.ts`、`types.ts` |

6. 测试文件与源码同名对应（`plan.ts` → `test/planner.test.mjs` 是唯一例外）：
   `planner`、`auto`、`wire`、`apply`、`diagnose`、`command`、`smoke` —— 其中 `smoke` 跑的是**构建产物**，
   用 `resolve-hook.mjs` + `dsh-tools-stub.mjs` 顶替 harness 包。

## 3. 不变量 —— 动手前必须理解

- **只有一个 planner。** 所有判断都在 `src/plan.ts`（纯函数），包括把声明 patch 转成路径操作
  （`settingsOps`）。Node 半边（`src/apply.ts`）与浏览器半边（`src/client/card.ts`）都调用它、
  都发送这些操作 —— Node 半边走 `ctx.settings.mutate`，浏览器半边走 `ctx.configForms` ——
  因此命令、工具、GUI 三者永远不可能给出不一致的结果。**不要把这个逻辑复制到第二处。**
- **写入形状由路由形态决定** —— `plan.ts` 里最容易搞错的那个分支：
  - 路由有非空 `models` 列表 → **整表重写**（数组整体替换），
    必须把每个条目、每个非本插件拥有的字段原样带过去；
  - 路由沿用内置目录 → 只写一条 `modelOverrides.<model>`，并作为独立路径操作写入，
    字典里其余条目保持原样。
  - 之所以是两种形状：`llm-pi-ai` **拒绝**在同时带 `models` 列表的路由上再写 `modelOverrides`。
- **写入是路径寻址的，且有 revision 栅栏。** `settings.mutate(ns, settingsOps(provider, patch), revision)`
  只碰 `providers.<route>`（内置目录路由里只碰一个 model id）。刻意**不用** `settings.update`：
  它会递归合并对象，于是计划里已经去掉的 `compat.thinkingFormat` 会被旧值保留下来。
  冲突会被报告，然后对着新读取重试一次（`apply.ts` 最多两轮）。
- **没什么可写就一个字节都不写。** 已生效的声明返回 `unchanged: true`，写入次数为 0；有测试守着。
- **插件自身不保存任何声明状态。** `llm-pi-ai` 段是唯一事实来源；一次声明就是对它的一次性编辑，
  绝不是可能与之漂移的影子副本。
- **命名空间按形状发现，不看目录位置。** `listConfigurableProviders()` 按注册顺序返回；0.2.1 里
  `llm-deepseek` 先于 `llm-pi-ai` 注册，所以"第一个带 `settingsNs` 的条目"会落到一个没有
  `providers` 字典的配置节上（计划为空、自检假报平安 —— 这确实在真实的 0.2.1 启动里发生过）。
  应选择 `settingsPath[0] === 'providers'` 或所在配置节确实带 `providers` 字典的条目；
  `DEFAULT_PI_AI_NS = 'llm-pi-ai'` 是决胜项，因此重命名过 loader 条目的 profile 依然可用。
  浏览器半边直接绑定内置 id，与 dsh 内置 Models 页做法一致。
- **`off: null` 与「没有声明 off」含义相反。** `off: null` 是「支持该档位，但 dispatch 什么都不发」；
  完全没有 `off` 是「不提供该档位」。只有 `off` 允许留空。`src/wire.ts` 的 `thinkingLevelMapOf`
  精确复刻了这一点。
- **锁定方言会抑制通用分支。** 每个 `thinkingFormat` 都是独立的 `else if` 分支，所以 pin 错会让
  某一档看起来生效、实际什么都没发。`deepseek` 还会额外 pin DeepSeek 私有的 `thinking:{type:…}`，
  通用中转会忽略它 —— 而**忽略比报错更糟**：关闭思考时该分支连 `reasoning_effort` 也不发，
  于是 **Off 静默失效**。这正是 `deepseek-relay` 存在的原因。
- **预设顺序是刻意的**（安全优先）：`openai-null-off` 永远排第一，诊断输出里推荐的修复命令
  也必须是它，绝不能是任何厂商专用预设。`test/wire.test.mjs` 用 `THE REGRESSION` 与
  "the first recommendation is the one that cannot fail loudly" 两个测试守着这两条。
- **刻意的非目标**（见 README 同名章节；这些不是待修的 bug）：
  - 不做路由级移除 —— `remove` 只剥本插件拥有的、模型条目里的 `reasoningEfforts` 与
    `compat.thinkingFormat`，不动路由级的 `reasoning` / `thinkingBudgets`：声明从未拥有它们；
  - 不做 HTTP 层改写 —— 没有受支持的拦截点，改冻结的 call config 会抛异常；
  - 不探测端点 —— 自动适配只依据配置里已有的事实（路由的 `compat`、`baseURL`，以及适配器给出的
    「自声明 vs 内置目录」判断）；它不会拿你的 API Key 去发测试请求，何况单次请求也分不清
    「参数被忽略」和「参数生效」。这也正是它给"pi-ai 判定不接收 `reasoning_effort`"的端点写
    *最保守*预设、而不是猜真实取值的原因。
- **自动适配靠构造保证幂等，而不是靠记忆。** 它不记录自己写过什么：已生效的声明会让
  `planDeclaration` 返回 `unchanged: true`，于是第一次启动写入、之后每次启动都是零写入空转。
  永远不要加「这条路由适配过了吗」的标记 —— 那正是本节「插件自身不保存任何声明状态」禁止的影子状态。
- **自动适配只在能力缺失、且用户没有表态的地方写入。** `adaptPlan` 会跳过内置目录路由（它们的模型
  已从目录解析出能力，写声明只会收窄它）、已经声明过档位的模型、以及 `reasoningEfforts: false`
  （那是"该模型不支持推理"的明确表态，适配不该把它改回去）。自声明路由若没有 `models` 条目，
  会被**报告**出来，而不是静默跳过。
- **加载时自检必须跑在自动适配之后，不能与之并行。** 适配过程过了第一个 `await` 就没有同步代码了，
  并行发出的报告会在写入落地**之前**读 settings 文档，于是在"已声明 1 个模型"的上一行打印
  "1 个模型无法调节"这类自相矛盾的话。`test/smoke.test.mjs` 同时断言了写入发生与这句话不出现。
- **适配流程必须真的等待。** pi-ai 适配器在 settings 服务挂载之后才注册自己的 settings descriptor，
  所以第一次查看找不到它是正常的。每次重试之间要 sleep（`AUTO_ADAPT_DELAY_MS`）；如果写成瞬时
  `continue`，五次重试会落在同一瞬间、在适配器出现前就放弃，新接入的 Key 得不到声明 ——
  这一点在真实的 0.2.1 启动中观察到，并已由冒烟测试钉住。

## 4. 值得知道的文档缺口

两份 README 都落后于代码，已在新增本文件的同时一并修正 —— 值得记录，因为它展示了这类漂移
是怎么发生的（新接口加进了 `src/` 和 `test/smoke.test.mjs` 的断言，而 README 里枚举接口的
那段话被漏掉了）：

- `src/tools.ts` 注册了**三个**工具；两份 README 都只写了两个，漏掉
  **`thinking_effort_explain`**（预览方言、不写入）。目录树里也缺 `src/types.ts`、
  `src/json.ts`，以及 `src/client/` 的真实文件。
- 现在两份 README 都列出了全部三个工具与真实的目录结构。

所以：新增或重命名一个接口时，请检查**两份** README、它们的目录树、以及对应的
`test/*.test.mjs` —— 而不是只检查你恰好正在读的那一份。

自动适配把同样的模式复制到了一个新位置，值得记下来，因为这次漂移的接口不是工具、也不是文件，
而是一种**行为**：

- 加入加载时适配后，两份 README、本文件、以及本文件第 1 节的正文里都写着的
  「**不自动猜方言**」这一非目标当场失效 —— 代码会在读者最先看到的那一行与自己的文档相矛盾；
- 自动适配的判断刻意放进 `src/auto.ts` 而不是 `plan.ts`：`plan.ts` 回答"这份声明怎么写入"，
  `auto.ts` 回答"到底该存在哪份声明"。分开才能让后者不需要 settings 服务就能测，
  也才能让前者不含任何"用户应该选哪个预设"的意见。

dsh 0.2.1 的适配一次踩出了第三个例子，而且横跨三个表面：

- 客户端 API 在插件脚下换了：`settingsScope` 在 0.2.0 之前就消失了，由 `ctx.configForms` 取代；
  第三方 bundle 自己的配置位置也从 `settings.plugins.tab`（内置插件清单）搬到了侧边栏插件页的
  `plugins.bundle.config`；
- `llm.listConfigurableProviders()` 开始把 `llm-deepseek` 排在 `llm-pi-ai` 前面，于是
  "第一个 `settingsNs`" 的发现方式静默失效（计划为空、自检假报平安），只有真实 0.2.1 启动才暴露；
- 空描述符重试循环从不 sleep，所谓"五次半秒等待"其实是瞬间的五次尝试。

这些在适配之前 `pnpm test` 全都看不见。教训与上面相同、只是放大了一层：dsh 的次版本/主版本升级
可能换掉一个**接缝**而本地单测全绿，所以在相信任何兼容性声明之前，请检查已安装运行时自己的
manifest/README，并做一次无头启动。

## 5. 实测基线

在 Windows 上，非 TTY 的 `pnpm` 运行会先做一次依赖校验，试图清空 `node_modules`，并以
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 失败。请使用捆绑运行时并显式设置 `CI`：

```powershell
$env:CI = "true"
# 桌面版把这个运行时放在用户目录下：
$runtime = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies"
$node = "$runtime\node\bin\node.exe"
$pnpm = "$runtime\pnpm\bin\pnpm.mjs"
& $node $pnpm verify      # typecheck -> build -> test
```

在 0.2.1-rc.2 适配后的工作树上实测（2026-10-17）：`tsc --noEmit` 对着 0.2.1-rc.2 的声明无输出；
tsdown 产出 `lib/index.js` + `lib/index.d.ts` + `lib/client.js`（含 sourcemap）；
`node --test` → **91 pass / 0 fail**。相对 0.2.0-rc.2 基线（82）的增量来自
`test/planner.test.mjs` 的 `settingsOps`/路径操作用例、`test/apply.test.mjs` 的
`settings.mutate` 重写、`smoke.test.mjs` 的命名空间发现与重试等待用例，以及 0.2.1 客户端契约断言。

除测试套件外，适配还对着**已安装的 0.2.1-rc.2 运行时**验证过：把它的 `app.asar` 解到临时目录，
用隔离的 `DSH_HOME` 和一个装着本 bundle 的 profile 跑它的 CLI，然后检查：(a) `--dump-config`
列出 `thinking-effort` 行与测试路由；(b) 无头启动退出码 0、无被跳过的 bundle、Loader 行 active；
(c) `/thinking` 与三个工具注册在真实的 0.2.1 服务上；(d) 加载时适配确实写入声明且日志无矛盾；
(e) 客户端 module graph 带着 `dsh-thinking-effort` 的 `client.js` 与 `__ModuleLoader__` 握手。
那次运行 PASS、0 advisory，正是它发现了上面第 4 节列的三个 0.2.1 接缝。今后任何 harness 版本
升级都要重跑；单靠测试套件抓不到接缝变化。

读这份输出时有两个坑：

- `lib/` 被 gitignore，但 `smoke.test.mjs` **加载构建产物**，所以永远先 build 再 test。
  `lib/` 过期会让测试结果说谎。
- 用 `Select-Object -First N` 截断 pnpm 输出会关闭管道，让 PowerShell 报 `NativeCommandError`
  —— 那是假失败。请以 `pass`/`fail` 计数和 pnpm 自身的退出码为准；要读真实退出码，
  请重定向到文件而不是截断。

CI（`.github/workflows/ci.yml`）在 Node 24 + pnpm 11.7.0 上跑同样的三步。

## 6. 必须遵守的约束

**TypeScript。** `tsconfig.json` 开了 `strict` + `noUncheckedIndexedAccess`（数组取值必须判
undefined）+ `verbatimModuleSyntax` + `isolatedModules` + `erasableSyntaxOnly`。因此：
类型导入必须写 `import type`；源码里的 import **带 `.ts` 后缀**（`allowImportingTsExtensions`）；
不能用 enum、参数属性，或任何超出类型擦除范围的语法。

**一切都是 optional。** 每个 harness 依赖都是 optional peer（`@deepseek-ai/cordis`、
`dsh-commands`、`dsh-llm`、`dsh-settings`、`dsh-tools`、`schemastery`、`react`）。运行时插件用
`ctx.get(...)` 取服务、按结构类型收窄、并把目录读取包在 `try/catch` 里 —— 服务缺失或抛错
只允许让报告变窄，**绝不允许向上抛**。这也是 `src/client/types.ts` 一个 `@deepseek-ai`
客户端包都不 import 的原因。

**客户端 bundle 有纯净性门禁。** `react` 是唯一允许的 external（`tsdown.config.ts` 里的
`CLIENT_EXTERNALS`），其余全部内联。产物必须保持 CJS 的 module-loader 握手：

```js
window.__ModuleLoader__.load({ id: "dsh-thinking-effort", factory: (require) => { … return module.exports; } });
```

`test/smoke.test.mjs` 会扫描 bundle 里每一个 `require(...)` 的 specifier，断言只出现 `react`
（以及 `react/jsx-runtime`）。

**tsdown 配置是数组。** host 那段用 `clean: true`，client 那段必须保持 `clean: false`，
否则两段构建会互相删除产物。

**`dsh.client.inject` 只是信息性的。** 0.2.1 里它列的是 boot graph 的包名依赖边，不是 Cordis
服务；服务注入靠客户端 bundle 自己的 `export const inject`。旧的 `["slots"]` 不指向任何包行，
是静默无效的。

**React 卡片里的两条隐形规则**（`src/client/card.ts` 两处都写了原因）：

1. 所有 hook 必须在任何 early return **之前**执行 —— 命名空间会从 `loading` 走到 `ready`
   并重新渲染，而写在 return 之后的 hook 会改变 hook 数量，在这个 slot 里会直接崩掉卡片；
2. 所有写入都走 `form.mutate` 路径操作：`[{ op: 'set', path: ['providers', <route>, …], value }]`，
   内置目录路由的 `modelOverrides` 里则每个 model id 一条。`set('providers', …)` 会整体替换
   顶层字段，绝不能直接用。form 来自 `ctx.configForms.get('llm-pi-ai')`（entry id = Host
   loader 条目 id）；注册进 `plugins.bundle.config` 时以 npm 包名为 key，并包在
   `ctx.effect(() => forms.whileServed(['llm-pi-ai'], …))` 里；`configForms` 用
   `ctx.inject` 请求，绝不写进 bundle 的静态 `inject` —— 一个 pending 的客户端 fiber 会导致
   web shell 启动审计失败。

另外卡片用的是 `React.createElement` 而不是 JSX，尽管 `jsx: react-jsx` 是开着的。

**用户可见文案是中文。** 命令输出、工具结果、卡片标签、诊断信息全部是中文（失败用 ❌，
成功用 ✅）。新增字符串请保持中文与同样的语气。

**改 `src/` 就要同步检查三处**：`README.md`、`README.zh.md`，以及对应的 `test/*.test.mjs` 断言。
两个 README 是同步的；源码与测试也是同名的。

## 7. 本地验证覆盖不到的部分

`pnpm test` 无需安装 dsh 即可运行：`test/resolve-hook.mjs` 把 `@deepseek-ai/dsh-tools` 重定向到
`test/dsh-tools-stub.mjs`，因为 `defineTool` 在运行时是恒等函数，真正的契约在类型层（而
`pnpm typecheck` 仍会对着 devDependency 里的真实签名做编译）。

这意味着测试套件**没有覆盖真实的 harness 集成**。要真刀真枪验证，要么走第 5 节的无头运行时流程，
要么把插件装进一个 profile —— `dsh plugin --profile <profile> add <path>`，然后重启 `dsh`
（bundle 成员关系只在启动时读取），再用 `dsh --profile <profile> --dump-config` 确认那一行确实出现了。
在 Windows 桌面版上，`desktop` profile 被运行中的应用占用并加锁：**装进去之前必须先退出
DeepSeek Harness。**

## 8. 约定

提交标题用 conventional commits（`feat:` / `fix:` / `docs:` / `chore:`），小写，
除非确有帮助否则不加 scope。注释用散文解释**为什么**是这样，写在让人意外的地方 ——
请沿用这种风格；现有代码的笔墨更多花在理由上而非描述上，因为理由恰恰是读代码读不出来的那部分。
