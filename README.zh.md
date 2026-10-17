# dsh-thinking-effort

[English](README.md) | **简体中文**

在 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 里，让**第三方 API Key** 重新拥有
**思考强度**（推理等级 / reasoning effort）调节能力。

你接入一个 OpenAI 兼容中转站，选中它的模型，输入框上方的「推理等级」面板却直接消失了。本插件为这些路由补上缺失的能力声明，把选择器找回来——用斜杠命令、用插件页，或者直接让模型自己修。

---

## 问题到底出在哪

第三方 provider 是 `llm-pi-ai` 适配器上的一个 `providers.<route>` 配置：

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

这条链路里没有任何一步会写 `reasoningEfforts`，而 `@deepseek-ai/dsh-llm-pi-ai` 是这样判定模型的推理能力的：

```ts
const efforts = entry.reasoningEfforts
if (efforts === undefined) return { reasoning: base?.reasoning ?? false }
```

自声明路由没有内置目录条目作为 `base`，于是**它下面每一个模型都解析成 `reasoning: false`**。适配器不再上报任何档位，输入框的选择器无从渲染，强行指定档位会被 `UNSUPPORTED_REASONING_EFFORT` 拒绝。这就是全部症状。

这跟 Key 和厂商无关：内置目录路由保留出厂能力；同一个中转站如果走 `llm-deepseek` 适配器也是好的——那个适配器给它服务的每条路由都上报档位。**缺的是一份声明。**

## 本插件做了什么

它把这份声明写进去——写进适配器真正读取的那一处，走官方支持的 settings 接缝。不接管适配器、不拦截 HTTP、不改 harness。写入时机默认是**启动即自动**：没有任何档位声明的第三方路由会被直接补上，装完就用，不用再敲命令。

```yaml
# 针对上面那条路由，它写入的内容
providers:
  qiyuan:
    models:
      - id: deepseek-v4.1
        contextWindow: 1000000
        reasoningEfforts:      # ← 选择器读取的就是这里
          off:
          low: low
          high: high
          max: max
        compat:
          thinkingFormat: deepseek
```

四个入口共用同一份经过单元测试的规划逻辑：

| 入口 | 用法 |
|---|---|
| 自动适配 | **装上就生效**：启动时给每条还没有档位声明的第三方路由自动写入声明，无需任何命令 |
| 斜杠命令 | `/thinking` · `/thinking presets` · `/thinking adapt` · `/thinking set <provider>/<model> <preset>` · `/thinking remove …` |
| 插件页 | 侧边栏 **插件** → **dsh-thinking-effort** → 逐模型下拉选择，即时生效 |
| 模型工具 | `thinking_effort_status` / `thinking_effort_set`，于是「这个模型调不了思考强度」可以一句话修好 |

启动时还会做一次自检，把仍然无法调节的路由直接写进日志——新接入的 Key 会立刻被注意到，而不是等你打开模型选择器才发现。

## 安装

```sh
# 从本地目录
dsh plugin --profile <profile> add /path/to/dsh-thinking-effort

# 从 GitHub（换成你自己的仓库）
dsh plugin --profile <profile> add github:<you>/dsh-thinking-effort
```

`dsh plugin` 会在 profile 目录里转发给 pnpm。GitHub 安装拉的是**源码**，pnpm 会执行 `prepare`（即 `tsdown`）来构建 `lib/`。pnpm ≥ 10 会拒绝第一次 git 依赖的构建脚本，把 pnpm 打印出的包名加进 profile 的 `pnpm-workspace.yaml` 后重试：

```yaml
allowBuilds:
  dsh-thinking-effort: true
```

> 这份白名单等于授权在安装时执行该包的代码。只对你信任的源码放行，并尽量固定到具体提交：`github:<you>/dsh-thinking-effort#<sha>`。

然后重启 `dsh`（bundle 成员只在启动时读取），确认配置层已合成：

```sh
dsh --profile <profile> --dump-config    # 应能看到名为 dsh-thinking-effort 的行
```

> Windows 桌面版的 `desktop` profile 被运行中的应用独占并加了文件锁：**装进它之前请先完全退出 DeepSeek Harness。**

### 兼容性

面向 dsh **0.2.1-rc.2** 构建。peer 依赖固定在该版本，`engines.dsh` 声明 `>=0.2.1-rc.2 <0.3.0`，
`dsh.manifestVersion` 记录 0.2.1 的包清单格式。

集成点也都是 0.2.1 的：host 写入走 `ctx.settings.mutate`（路径操作），浏览器卡片走设置域的
`ctx.configForms` 服务，第三方 bundle 自己的配置页注册在侧边栏**插件**页的
`plugins.bundle.config` 槽位上。dsh 已经没有旧版的客户端 `settingsScope` 绑定器，因此
0.2.1 之前的版本不受支持。

## 使用

装上之后什么都不用做。新接入的第三方 Key 会在启动时被自动补上档位声明，日志里会写明给哪条路由写了哪套档位：

```
# dsh-thinking-effort: 自动适配完成。
# ✅ 已自动声明 1 个模型的思考强度档位：
#   路由 qiyuan → passthrough（1 个模型）
#     端点检测为 openai，写入 passthrough
#     档位：off→(不发) minimal→minimal low→low medium→medium high→high xhigh→xhigh max→max
#   这是可以随时改的起点：换档位名或方言用 /thinking set，预览用 /thinking explain。
```

然后到输入框的模型选择器里展开 **推理等级**，就能看到 Off / Minimal / Low / Medium / High / XHigh / Max。选中某一档同时会写进 Agent 默认设置，和内置 provider 的行为完全一致。

### 自动适配做了什么判断

它只处理**配置声明出来的**第三方路由（内置目录路由本来就有能力，写声明只会收窄目录给它的档位）。对每条路由它只看配置里已有的证据：

1. 如果 pi-ai 已经判定该端点**不接收** `reasoning_effort`（xAI、智谱、Moonshot、Together、NVIDIA、Cloudflare 这类，或你自己在 `compat.supportsReasoningEffort` 里写明 `false`），就写入 `openai-null-off`——往不解析该参数的端点发 `xhigh` 才是唯一可能把"选择器不见了"变成"请求报 400"的做法。你的显式设置优先于插件的推断。
2. 否则，如果端点主机能认出厂商（`deepseek.com`、`openrouter.ai`、DashScope 等），就写入该厂商的预设。
3. 其余情况写入 `autoAdaptPreset`，默认 `passthrough`：七档按同名值原样发送、不锁方言。中转站如果自己定义了一套档位名，这样能把整条阶梯都拿回来。

它**不会**覆盖你已经声明过的模型，也不会碰 `reasoningEfforts: false` 的模型——那是"这个模型不支持推理"的明确表态，不该被自动改回去。

自动适配补的是**声明**，它不能替你验证端点是否真的认这些参数——这从配置里读不出来。所以看到自动写入的日志后，用 `/thinking explain` 看一遍每档实际发送的参数，再到会话里试一档。

### 手动调整

自动写入的是一个可以随时改的起点。查看现状、换档位名、只修某条路由：

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

`/thinking adapt` 可以手动再跑一次全量适配：`/thinking adapt qiyuan --preset deepseek-relay` 只修一条路由并指定档位表。

关掉自动适配（本插件的 profile 配置）：

```yaml
- id: dsh-thinking-effort
  name: 'dsh-thinking-effort'
  config:
    autoAdapt: false          # 只在 /thinking adapt 时写入
    autoAdaptPreset: passthrough
```

### 方言预设

端点到底认哪些值取决于服务商；`reasoningEfforts` 映射的是**可选档位 → 实际发送的值**。但档位只是一半：每个 `thinkingFormat` 是**独立分支**，会顶掉通用的 OpenAI 路径——所以锁错方言的后果是某一档看起来能用、实际什么都没发。因此预设按"最安全优先"排序，也只有真正需要方言的服务商才锁定它。

| 预设 | 档位 | 发送 | 锁定方言 | 适用 |
|---|---|---|---|---|
| `openai-null-off` | off / low / medium / high | `reasoning_effort`；off 不发参数 | 否 | 任何 OpenAI 兼容端点——先试这个 |
| `openai` | off / low / medium / high | `reasoning_effort`；off → `"none"` | 否 | OpenAI 官方，或明确接受 `none` 的中转 |
| `deepseek-relay` | off / low / high / max | `reasoning_effort` | 否 | 服务 DeepSeek 模型的第三方中转站 |
| `deepseek` | off / low / high / max | `reasoning_effort` **+ `thinking:{type:…}`** | `deepseek` | DeepSeek 官方端点或严格克隆 |
| `openrouter` | off / low / medium / high | 嵌套 `reasoning:{effort}` | `openrouter` | OpenRouter 及其镜像 |
| `qwen` | off / low / high | `enable_thinking`（+ `reasoning_effort`） | `qwen` | 通义千问系 |
| `passthrough` | 全部七档 | 档位名原样发送 | 否 | 认得 pi-ai 自己档位名的网关 |
| `custom` | 你给 | 你给 | — | 其他情况——自行传入 `levels` |
| `inherit` | 不变 | 不变 | — | 只固定 `--format` / `--default` |

**`deepseek-relay` 为什么存在。** `deepseek` 会锁定 DeepSeek 私有的 `thinking:{type:…}` 参数，而 OpenAI 兼容中转站通常直接忽略它。忽略比报错更糟：需要关闭思考时，那个分支同时**也不发** `reasoning_effort`，于是 **off 完全不起作用**，而有名字的档位看起来一切正常。如果你的中转站上 off 没反应，原因就在这里——换成 `deepseek-relay` 或 `openai-null-off`，它们只发标准参数。

`/thinking explain <provider>/<model> [preset]` 会逐档列出实际会发送的请求参数，同时告诉你"如果不锁方言 pi-ai 本来会检测成什么"，并在两档发送内容完全相同时给出警告。它不写入任何东西。

`off:` **留空**表示「支持该档位，但派发时不发送任何参数」——当「不思考」就等于「参数缺席」时，这才是正确写法。只有 `off` 允许留空。

覆盖项：`/thinking set qiyuan/m deepseek --format deepseek --default high`。

## 工作原理

写入是**路径寻址的 settings 变更**：`settings.mutate(条目id, settingsOps(provider, patch), revision)`。
每个操作只指定一条路径——`providers.<route>.models`、`providers.<route>.modelOverrides.<model>`、
`providers.<route>.reasoning`——因此只影响被编辑的那条路由（在内置目录路由里只影响被编辑的那个模型），
兄弟路由和本插件不拥有的字段无需"读-改-写"就能原封不动。浏览器卡片通过 `ctx.configForms` 发送同一组
操作，所以命令、工具和 GUI 不可能写出不同的文档。

补丁的形状取决于路由的能力来自哪里——因为 `llm-pi-ai` 拒绝在同时带有 `models` 列表的路由上使用
`modelOverrides`：

- 带非空 `models` 列表的路由（所有自声明的第三方路由）→ **整体重写该列表**，每一项、每一个不属于
  本插件的字段都原样带过；
- 沿用内置目录的路由 → 只写一个 `modelOverrides.<model>` 条目，并作为独立的路径操作写入，字典里其余
  条目保持原样。

看 diff 之前有件事值得先知道。被重写的 `models` 数组是从**解析后**的配置构造的，因此解析器已经填好的
schema 默认值会一起落进存储文档——在自声明路由上声明档位后，那个模型条目通常会在本插件真正写入的
`thinkingFormat` 旁边多出 `compat.chatTemplateKwargs: {}` 和 `compat.chatTemplateArgs: {}`。它们就是
schema 自己的默认值，解析结果没有任何变化、行为也没有任何不同，只是文档对原本隐式的字段变得更显式。
写入在路由层面仍然是窄的：用户层里只出现你指名的那条路由，也不会写入任何路由级默认值。

写入用同一次读取拿到的 revision 做乐观并发围栏（检测到并发编辑会报出并重试一次），而已经生效的声明则
完全不写。自动适配因此是幂等的：第一次启动写进去，之后每次启动都是零写入的空转——它不需要记住自己写过
什么，已生效的声明本身就让它无事可做。

自动适配与启动自检在同一个注入点按顺序执行，**先适配、后自检**：这样日志里的"所有模型都可调节"描述的是
刚刚落地的状态，而不是一个即将成立的状态。settings 服务可能先于 pi-ai 适配器注册好，所以找不到描述符时
会等待半秒再重试，至多五次，之后才放弃并提示手动运行 `/thinking adapt`。

设置条目 id 按**形状**发现，而不是按目录位置：`listConfigurableProviders()` 按注册顺序返回，而在 0.2.1
里 `llm-deepseek` 适配器先于 `llm-pi-ai` 注册，所以"第一个命名空间"会落到一个没有 `providers` 字典的
配置节上。插件选择 settings 路径为 `['providers', …]`（或该节确实带有 `providers` 字典）的条目，以内置
的 `llm-pi-ai` 作为决胜；这样即使 profile 重命名了 loader 条目也仍然可用。（浏览器卡片直接绑定内置 id，
与 dsh 内置的 Models 页做法一致。）

## 它刻意不做的事

- **不动路由级字段的移除。** `remove` 只剥掉本插件拥有的模型条目里的 `reasoningEfforts` 和
  `compat.thinkingFormat`，不碰路由级的 `reasoning` / `thinkingBudgets`：声明从未拥有它们，移除档位表
  不应该顺带改掉路由默认值。
- **不重写 HTTP 层。** 请求体没有受支持的拦截点，而调用配置是深冻结的，改它直接抛异常。声明能力才是受支持的路径。
- **不主动探测端点。** 自动适配只在配置已有的证据上做保守判断，既不会拿你的 Key 去发测试请求，也不会通过"看哪档有反应"来反推方言——单次请求分不清"参数被忽略"和"参数生效"，那个结论得由你在会话里得出。改档位名是一次 `/thinking set`。

## 开发

```sh
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm build         # tsdown → lib/index.js + lib/client.js
pnpm test          # node --test：纯逻辑模块 + 构建产物
pnpm verify        # 以上三步
```

`pnpm test` 不需要安装 dsh。`test/smoke.test.mjs` 会自己挂上解析钩子（`test/resolve-hook.mjs`），把 `@deepseek-ai/dsh-tools` 重定向到本地同名桩——真实的那个包会牵出一串 harness 内部依赖，插件仓库没有理由去装它们；`defineTool` 运行时就是恒等函数，而它真实的类型签名仍由 devDependency 参与类型检查。钩子在测试文件内部注册，因此无论测试运行器是否把自身的标志转发给每个文件的子进程，`pnpm test` 的行为都一致。

目录结构：

```
src/
  index.ts        host 入口：Config、各注册、启动自动适配与自检
  presets.ts      思考档位、线协议方言、校验器（纯函数）
  plan.ts         声明 → 路径寻址的 settings 操作（纯函数，浏览器半边共用）
  auto.ts         自动适配的选档规划（纯函数：哪条路由该拿哪套档位）
  diagnose.ts     能力报告（纯函数）
  wire.ts         每一档实际会往请求里发什么（纯函数）
  types.ts        存取形状、settings 端口、方言常量
  json.ts         isPlainObject / deepEqual / omit（零依赖）
  apply.ts        settings 端口：读描述符、规划、按路径写入
  commands.ts     /thinking（含 adapt 批量入口）
  tools.ts        thinking_effort_status / thinking_effort_set / thinking_effort_explain
  format.ts       共用文本渲染
  client/
    index.ts      浏览器半边入口：inject / apply
    card.ts       插件页上的配置卡片
    styles.ts     样式表
    types.ts      所涉两个浏览器服务的结构类型
test/             单元测试 + 针对构建产物的冒烟测试
```

动手改代码之前该知道的东西 —— 设计不变量、构建约束、以及一份实测的 `pnpm verify` 基线 ——
写在 [CONTEXT.zh.md](CONTEXT.zh.md)（[English](AGENTS.md)）里。

## 许可证

MIT
