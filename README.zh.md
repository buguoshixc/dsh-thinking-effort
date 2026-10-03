# dsh-thinking-effort

[English](README.md) | **简体中文**

在 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 里，让**第三方 API Key** 重新拥有
**思考强度**（推理等级 / reasoning effort）调节能力。

你接入一个 OpenAI 兼容中转站，选中它的模型，输入框上方的「推理等级」面板却直接消失了。本插件为这些路由补上缺失的能力声明，把选择器找回来——用斜杠命令、用设置页，或者直接让模型自己修。

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

它把这份声明写进去——写进适配器真正读取的那一处，走官方支持的 settings 接缝。不接管适配器、不拦截 HTTP、不改 harness。

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

三个入口共用同一份经过单元测试的规划逻辑：

| 入口 | 用法 |
|---|---|
| 斜杠命令 | `/thinking` · `/thinking presets` · `/thinking set <provider>/<model> <preset>` · `/thinking remove …` |
| 设置页 | 设置 → 插件 → **思考强度**，逐模型下拉选择，即时生效 |
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

## 使用

一次性修好你的中转站：

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

然后在输入框的模型选择器里展开 **推理等级** → Off / Low / Medium / High。选中某一档同时会写进 Agent 默认设置，和内置 provider 的行为完全一致。

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

`settings.update(条目id, { providers: { <route>: … } })` 是**合并**语义，因此只给一个路由键，其余路由、以及该路由下不属于本插件的字段都原封不动。补丁的形状取决于路由的能力来自哪里——因为 `mergeLayers` 对数组是整体替换，而 `llm-pi-ai` 拒绝在同时带有 `models` 列表的路由上使用 `modelOverrides`：

- 带非空 `models` 列表的路由（所有自声明的第三方路由）→ **整体重写该列表**，每一项、每一个不属于本插件的字段都原样带过；
- 沿用内置目录的路由 → 写 `modelOverrides` 条目；它是字典，合并，且不会收窄实际服务的目录。

看 diff 之前有件事值得先知道。被重写的 `models` 数组是从**解析后**的配置构造的，因此解析器已经填好的 schema 默认值会一起落进存储文档——在自声明路由上声明档位后，那个模型条目通常会在本插件真正写入的 `thinkingFormat` 旁边多出 `compat.chatTemplateKwargs: {}` 和 `compat.chatTemplateArgs: {}`。它们就是 schema 自己的默认值，解析结果没有任何变化、行为也没有任何不同，只是文档对原本隐式的字段变得更显式。写入在路由层面仍然是窄的：用户层里只出现你指名的那条路由，也不会写入任何路由级默认值。

写入用同一次读取拿到的 revision 做乐观并发围栏（检测到并发编辑会报出并重试一次），而已经生效的声明则完全不写。

设置条目 id 取自适配器自己的可配置 provider 目录（`listConfigurableProviders().settingsNs`），所以即使 profile 重命名了 loader 条目也仍然可用；`llm-pi-ai` 只是兜底值。

## 它刻意不做的事

- **不动路由级字段的移除。** `remove` 只剥掉 `reasoningEfforts` 和本插件写过的 `thinkingFormat`，不碰 `reasoning` / `thinkingBudgets`：`update` 是合并，JSON 里没有 `undefined` 可以合并进去，而要 unset 不属于自己的字段就得对别人的配置做路径操作。
- **不重写 HTTP 层。** 请求体没有受支持的拦截点，而调用配置是深冻结的，改它直接抛异常。声明能力才是受支持的路径。
- **不猜方言。** 端点认哪些值无法从配置里发现；猜错的结果是一个看起来能用、实际什么都没发对的选择器。请自己挑预设。

## 开发

```sh
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm build         # tsdown → lib/index.js + lib/client.js
pnpm test          # node --test：纯逻辑模块 + 构建产物
pnpm verify        # 以上三步
```

`pnpm test` 不需要安装 dsh：`test/register.mjs` 会挂一个解析钩子，把 `@deepseek-ai/dsh-tools` 重定向到本地同名桩（`defineTool` 运行时就是恒等函数；它真实的类型签名仍由 devDependency 参与类型检查）。

目录结构：

```
src/
  index.ts        host 入口：Config、各注册、启动自检
  presets.ts      思考档位、线协议方言、校验器（纯函数）
  plan.ts         声明 → 设置补丁（纯函数，浏览器半边共用）
  diagnose.ts     能力报告（纯函数）
  wire.ts         每一档实际会往请求里发什么（纯函数）
  apply.ts        settings 端口：读描述符、规划、合并写入
  commands.ts     /thinking
  tools.ts        thinking_effort_status / thinking_effort_set
  format.ts       共用文本渲染
  client/         浏览器半边：设置页签与样式表
test/             单元测试 + 针对构建产物的冒烟测试
```

## 许可证

MIT
