# 代码索引 — 程序本身

> 用途：给接手的人和 agent 一张地图，省掉「这个文件是干什么的」这一轮摸索。
> 姊妹篇是 `docs/index-world-model.md`（世界模型与模组内容）。
>
> 建立方式：逐文件读取头部注释归纳，2026-08-19。
> 路径均相对 `C:\aitrpg\poc\`。
>
> **维护约定**：新增文件请顺手补一行。发现某行与实际不符，以代码为准并直接改这里——
> 一份没人信的索引比没有索引更糟。

## 快速定位

| 我想…… | 去看 |
|---|---|
| 跑一局剧本，从头到尾 | `src/play-module.ts` |
| 自由跑团（非剧本）的服务端 | `src/api/game-session.ts` |
| 命令行玩 | `src/index.ts` |
| 改 CoC 检定/SAN/伤害规则 | `src/rules/coc-engine.ts` |
| 改 NPC 怎么说话 | `src/llm/npc-dialogue-prompts.ts`、`src/agent/npc-agent.ts` |
| 改世界状态怎么存 | `src/state/world-state-manager.ts` |
| 加 HTTP 接口 | `src/api/server.ts` |

## 三条并行的局面驱动

这是本仓最容易走错的地方：**同时存在三套"跑一局"的实现，互不共享状态**。

| 路径 | 入口 | 形态 |
|---|---|---|
| 剧本杀（线性） | `src/play-module.ts` → `src/api/scripted-session.ts` | 吃 `ModuleData` + `ModuleSupport`，按场景推进到结局 |
| 自由跑团 | `src/api/game-session.ts` | 玩家任意行动，LLM + 律书即时裁决 |
| 命令行 | `src/index.ts` | readline 主循环，单人 |

`play-module.ts` 文件头明确写着与自由跑团"互不共享状态，混在一起只会互相污染"——**是有意为之，不是事故**。

---

## 引擎核心

| 路径 | 职责 | 关键导出 |
|---|---|---|
| src/play-module.ts | 剧本引擎主入口（3100+ 行）：KP 描述 → PL 决策 → 检定 → 世界推进，有 LLM 用 LLM 无 LLM 用模板 | runModule, rollDice, trapsInScene, isMajorWound, speechLead |
| src/index.ts | CLI 主循环（1398 行，无导出）：输入 → 意图解析 → 律书判定 → 状态写入 → KP 叙事 → NPC 反应 → 快照 | （入口，main() 在 842 行） |
| src/types.ts | 全局类型中枢：ActionIntent / CombatResult / WorldEntity / WorldState / Effect | ActionIntent, WorldState, WorldEntity, CombatResult |
| src/config.ts | 从环境变量装配 LLMConfig，缺 key 时告警降级 | loadConfig, LLMConfig |
| src/log.ts | 诊断日志；明确划界——面向玩家的正文不走本模块 | log, LogLevel |

## 规则引擎（确定性，不经 LLM）

| 路径 | 职责 | 关键导出 |
|---|---|---|
| src/rules/coc-engine.ts | 全项目 CoC 规则核心：d100 roll-under、奖惩骰、SAN 检定与疯狂、伤害加值、命中部位、对抗 | CoCEngine, SanityEngine, rollBoutOfMadness, calcDamageBonus |
| src/rules/coc-equipment.ts | 护甲减伤、武器属性表、负重、装备耐久 | COC_ARMOR, COC_WEAPONS_FULL, applyArmorToDamage, calcEncumbrance |
| src/rules/coc-chase.ts | CoC 7e 追逐：抽象距离段、障碍表、射程惩罚、车辆追逐 | ChaseEngine, rangeFromDistance, shootingPenaltyForRange |
| src/rules/coc-cr.ts | 信用评级 → 收入/初始物品/购买权限，外加羁绊与 SAN 恢复 | CR_TIERS, SHOP_CATALOG, getCrTier, createDefaultBonds |
| src/rules/coc-ruleset-mod.ts | 规则集变体钩子（如 Pulp），不侵入 coc-engine 核心 | DEFAULT_COC_HOOKS, registerRulesetMod |
| src/rules/rules-engine.ts | 律书路由器：按 activeRuleset 分发到 CoC / dnd5e / grail 三个引擎 | RulesEngine, RulesetId, UnifiedCombatResult |
| src/rules/apply-action.ts | 状态变更的合法性闸门：校验提议动作并返回不可变 StateDelta | applyAction, ProposedAction, StateDelta, RejectReason |
| src/rules/coc-session-scenario.ts | 把 apply-action 闸门实例化到 CoC 会话（目前只接了难度这一个枚举） | COC_SESSION_SCENARIO, buildDifficultyGateState |
| src/rules/status-effects.ts | 状态/疾病系统：六类分类、持续回合与叠层、逐回合 tick | StatusEffect, createStatus, statusTick |
| src/rules/game-time.ts | 昼夜循环：8 段时段 + 回合推进 + 时段氛围文案 | GameTime, advanceTime, periodAtmosphere |
| src/rules/random-tables.ts | 通用加权随机表引擎，用于不依赖 LLM 的随机内容 | RandomTable, registerTable, rollTable |
| src/rules/module-difficulty.ts | 把模组 difficulty 四档翻译成 DC 偏移/失败产出/push 叙事 | assessModuleDifficulty, getDifficultyProfile |
| src/rules/story-generator.ts | 纯模板的故事/场景生成器（不调 LLM） | StoryGenerator, GeneratedStory, HorrorSubgenre |
| src/engine/rule-engine.ts | D&D 5e 的 YAML 规则匹配 + 骰子执行器 | RuleEngine |
| src/spell/spell-engine.ts | D&D 5e 法术引擎：环位管理与施法执行 | SpellEngine, SpellDef, CastResult |
| src/rules/grail-engine.ts | 自研「圣杯」规则集：五段位阶压制与士气连锁 | GrailEngine, GrailRank, inferGrailRank |
| src/investigation/investigation-engine.ts | 多技能路径线索评估：主/辅检定、三技能阈值免投骰、全失败走预设 fallback | InvestigationEngine |

> `dnd5e.yaml` / `spells.yaml` / `grail-engine.ts` 与 CoC 主线无关，属另外两套规则集，均仍被实际加载。

## 战斗与同伴

| 路径 | 职责 | 关键导出 |
|---|---|---|
| src/combat/npc-combat.ts | NPC 战斗状态机：读 YAML 生物配置（战术/目标优先级/逃跑阈值/士气） | NPCCombatEngine |
| src/combat/companion-manager.ts | 队友生命周期：入队、AI 自主行动与玩家热接管、战死/士气崩溃离队 | CompanionManager, positionLabel |
| src/combat/wound-effects.ts | 伤势分级与部位致残、惩罚骰、Major Wound 体质检定、清创 | calcSeverity, applyWoundEffects, getDisability |

## Agent 层

| 路径 | 职责 | 关键导出 |
|---|---|---|
| src/agent/kp-agent.ts | KP：只做场景描述、事件注入、节奏控制，不扮 NPC 不判规则 | KPAgent |
| src/agent/npc-agent.ts | 单个 NPC：人格卡 + 独立记忆 buffer + LLM 对话，落库 NPCStore | NPCAgent |
| src/agent/player-agent.ts | LLM 驱动的调查员 PC；无 LLM 时按职业标签权重走性格模板 | PlayerAgent, createPlayerCharacter, occupationTagWeight |
| src/agent/agent-registry.ts | NPC Agent 热插拔容器：进场景按需注册，死亡自动注销 | AgentRegistry, RegistryHook |
| src/agent/constraints.ts | NPC 输出后置约束：拦秘密泄露、超 knowledge 编造、态度不一致 | applyConstraints, checkSecretLeak, checkKnowledgeBoundary |
| src/agent/npc-reaction.ts | 确定性反应决策表（无 LLM）：战斗/社交/事件三类反应及情绪迁移 | getNPCReactions, updateMood |
| src/agent/companion-agent.ts | AI 队友战斗决策：技能+性格+装备+状态推导权重后随机抽取 | CompanionAgent, Situation |
| src/agent/types.ts | Agent 层类型中枢：NPCTraits / NPCMood / MemoryEntry / KPDirective | DEFAULT_NPC_TRAITS, NPC_MOODS, asNPCMood |

## LLM 层

| 路径 | 职责 | 关键导出 |
|---|---|---|
| src/llm/client.ts | OpenAI 兼容客户端（OpenAI/DeepSeek/Ollama），流式、jsonMode、超时 | LLMClient, extractMessageContent |
| src/llm/npc-dialogue-prompts.ts | 运行时对话的 prompt 工厂（1075 行）：主动开口、回应提问、转场、救场、线索揭示 | generateNpcReply, generateNpcProactive, generatePcQuestion |
| src/llm/generate-llm-expanded.ts | **NPC 预生成管线**：为带 knowledge[] 的 NPC 批量生成 llmExpanded，已有的跳过，无 API 降级模板 | applyAllLlmExpandedWithLLM, applyLlmExpanded, selfIntroduction |
| src/llm/intent.ts | 自然语言 → ActionIntent；无 LLM 时退化为 regex | parseIntent, parseIntentLLM |
| src/llm/narrator.ts | 战斗叙事：按伤害比映射伤势等级，套模板或交 LLM 润色，出口过世界观约束 | generateNarrative, templateNarrative |
| src/llm/fallback.ts | LLM 不可用时的兜底叙事模板池 | fallbackNarrative, DEGRADATION_NOTICE |
| src/llm/mock-client.ts | 离线假 LLM：按场景 id 返回预写文本，让无 key 时整条循环可跑可测 | MockLLMClient |

> **无 LLM 可运行链路是系统性设计的**：`fallback.ts` + `mock-client.ts` + `intent.ts` 的 regex 退化 + `background-profile.ts` 的模板背景 + `investigation-engine.ts` 的预设 fallback，构成完整闭环。

## 角色

| 路径 | 职责 | 关键导出 |
|---|---|---|
| src/character/coc-character.ts | CoC 7e 建卡全流程：属性投骰、职业约束、技能点分配、年龄修正、衍生值 | createCoCCharacter, COC_SKILLS, SKILL_NAME_MAP |
| src/character/background-profile.ts | 背景故事纯模板生成（无 LLM）：1920s 人名池 + 八项背景元素 | randomCoCName, buildBaseBackgroundProfile, composeBackstory |
| src/character/character-factory.ts | D&D 5e 侧角色创建：职业模板注册表 + 属性下限约束 | CharacterFactory, ALL_ARCHETYPES, getArchetype |
| src/character/career-file.ts | 角色跨模组历程的 JSON 存储（原子写入）。**实际在用的那套** | CareerFileStore |
| src/character/career.ts | 同上的 SQLite 版。**CareerStore 类全仓无人 new，半废弃**；仅 computeCurrentState 仍被复用 | computeCurrentState, CareerStore |
| src/character/qiankun-subclasses.ts | 乾坤职业体系映射到 D&D 子职业的纯数据表（2426 行） | QIANKUN_SUBCLASSES, QIANKUN_LEGENDARY_TEMPLATES |
| src/character/prestige-classes.ts | D&D 进阶职业纯数据表（28 行） | PRESTIGE_CLASSES |
| src/pl/character-display.ts | 角色卡渲染：完整表、一行摘要、高亮技能 | displayCharacterSheet, characterSummary |

## 存储与状态

| 路径 | 职责 | 关键导出 |
|---|---|---|
| src/state/world-state-manager.ts | **真相源**：Bun SQLite 上的实体/场景/效果/事件读写门面，LLM 只读不写 | WorldStateManager, SceneRecord, SceneExit |
| src/state/schema.ts | 世界状态建表 DDL | createSchema |
| src/state/event-types.ts | 事件日志与快照的数据形状 | GameEvent, StateChange, SnapshotSummary |
| src/state/game-state-manager.ts | 会话存档 JSON 读写，与 SQLite 真相源相互独立 | saveGameState, loadGameState |
| src/db/index.ts | NPC 的 SQLite 持久化：人格卡、记忆、关系值、情绪 | NPCStore |
| src/session/player-session.ts | 多玩家 per-receiver 视图：按可见性给每人不同旁白，秘密隔离 | PlayerSession, VisibilityRule |

## API 与前端

| 路径 | 职责 | 关键导出 |
|---|---|---|
| src/api/server.ts | HTTP/WS 入口（Bun.serve）：管理两类会话实例池，暴露 REST 路由 | （入口，无导出） |
| src/api/game-session.ts | 自由跑团单局总装配（2470 行）：串起 LLM、律书、CoC 引擎、Agent、世界状态、战斗/调查/法术/经济 | GameSession, ActionResponse |
| src/api/scripted-session.ts | 剧本杀会话：把 play-module 包成可外部驱动的一局，岔口挂起等提交 | ScriptedSession, createScriptedSession |
| src/api/module-editor.ts | 模组 JSON 的 CRUD + 结构校验 | loadModuleFile, saveModuleFile, createBlankModule |
| src/api/character-store.ts / session-store.ts | 角色卡 / 会话元数据的 JSON 落盘 | saveCharacter / saveSessionMeta |
| src/api/ws-handler.ts | WebSocket 登记与按 sessionId 广播 | broadcastToSession, sendToKp |
| frontend/src/App.vue | 前端根组件（724 行）：开始屏/游戏屏、响应式会话状态、规则集主题 | — |
| frontend/src/KPDashboard.vue | 守秘人控制台（494 行）：分页展示 KP 状态并提供操作表单 | — |
| frontend/src/CombatGrid.vue / SceneOverview.vue / NpcChat.vue / CharacterEditor.vue / ModuleEditor.vue / SettingsPanel.vue | 战斗站位 / 场景概览 / NPC 单聊 / 角色卡编辑 / 模组编辑 / 设置 | — |

## 语音与音频

| 路径 | 职责 |
|---|---|
| src/voice/speech-plan.ts | 语音路由判定（只判不合成）：念不念、谁念、prebaked 还是 realtime；分界依据是消息有没有经过 LLM |
| scripts/gen-speech.ts | 预制语音离线合成（Windows SAPI），键的口径来自 speech-plan.ts |
| scripts/gen-bgm.ts | 环境音床生成：噪声→低通→混响→LFO→限幅，带交叉淡化保证循环点连续 |

## 经济与政治（独立模块）

`src/economy/` 六个文件：`politic-economy-engine.ts`（总编排）+ `faction-system` / `trade-system` / `policy-system` / `finance-system` / `types.ts`。纯回合结算，不经 LLM。

## 测试（42 个）

分两簇。**规则纯逻辑单测**：coc-character / coc-engine / coc-combat / coc-equipment / coc-chase / coc-spells / coc-mythos-module / investigation-* / rule-engine / grail-ruleset / story-generator / politico-economy / trap-mechanics。

**回归测试**（更值得读）——每个都锁着一次"类型说一套、数据是另一套、类型检查全绿"的静默失效：

| 测试 | 锁的是什么事故 |
|---|---|
| entity-round-trip | WorldEntity 缺声明字段导致 UPDATE 把已存值抹成 NULL |
| scene-exits | exits 写入 `{target,desc}[]` 而 getScene() 声明返回 `string[]`，JSON.parse 让类型检查全程沉默 |
| scene-write-path | 场景激活必须只有 setScene() 一条写入路径 |
| message-history | act() 的消息必须进 messageHistory，否则历史恒空、语音层缺源 |
| kp-scene-truth | 在场判定必须跟界面场景走，不得读玩家 position |
| coc-character-wiring | 建卡必须走 createCoCCharacter，否则技能检定读不到真实技能值 |
| investigation-wiring | 调查必须真接进 handleSkillCheck，而不是裸掷 d100 |
| world-model-sharing | WorldModelLoader 必须进程内共享（实测加载三遍驻留 1938MB） |
| world-state-truth-source | SAN/物品/装备写入必须到达真相源，而不是停在进程内 Map |
| rule-content-boundary | 版权边界：受限规则书内容必须已从发行树删除 |

**明显缺测**：HTTP/API 层本身（server.ts 的路由、静态托管、会话超时）、前端 9 个 .vue、LLM 客户端与提示词组装（只测了 intent 的 regex 兜底）、语音/BGM 实际生成链路、数值域的 applyAction。

## 工具脚本（`tools/` 整个目录被 .gitignore 排除）

| 路径 | 职责 |
|---|---|
| tools/run-play.mjs | 跑团记录生成器，输出 Markdown 完整记录，`--mock` 强制离线 |
| tools/simulate-module.ts | 双调查员跑团演示，固定用 MockLLM，偏冒烟 |
| tools/convert-world-model.ts | 一次性数据迁移：v16 jsonl → v17 格式 |
| tools/test-career-file.mjs | 自建 assert 的遗留验证，已被 bun test 覆盖 |
| tools/_verify-read-build.ts / _verify-runpath.ts | 一次性调试脚本（下划线前缀） |
| tools/check_warehouse.mjs | 一次性排查脚本，无通用价值 |
| tools/_cmp-raw.ts | 一次性：PDF 逐页文本 vs `tools/modules/raw/` 切片的重合度比对 |
| tools/_run-ingest.ts | **摄取管线的端到端实跑器**（约 120 行）：读 PDF → 清洗 → 切分 → 分类（含 `RecordingClient`，把 LLM 原始响应一并落盘）→ 建骨架 → 对基准 diff。下面 §模组摄取 里 **17/20**、`命中 20 / 误报 7 / 漏报 0`、`差异 131 处` 这些数**全部出自它**；重跑它是唯一能复现这些数的途径 |

## 模组摄取（在建）

目标：`PDF → ModuleData（权威源）→ 投影出运行模组`，改写处带 `Provenance` 留痕。
产出物先并排放，用现有已校准的 `barn-of-premier.ts` 逐字段 diff 反过来校准读取模块。
内容侧的素材清单与血缘见 `docs/index-world-model.md`；这里只记工程实现。

### pdf-parse 的坑（会浪费掉半小时，先看这条）

依赖是 **v2.4.5**，导出的是 `PDFParse` **类**，不是网上示例里那个默认函数。
`require("pdf-parse")(buffer)` 会抛 `pdfParse is not a function`——
它在 `package.json` 里长期没人用，多半就是卡在这里。正确用法：

```ts
const { PDFParse } = require("pdf-parse");
const res = await new PDFParse({ data: buffer }).getText();
// res.total → 页数；res.text → 全文；res.pages[] → 逐页
```

`getText()` 之外还有 `getPageTables` / `getImage` / `getHyperlinks` 等，
模组附件是 6 张图，将来要用得上。

### 状态

| 阶段 | 文件 | 状态 |
|---|---|---|
| PDF → 逐页文本 | `src/ingest/pdf-source.ts` | **已完成**，2 测试（只测形态）；内容保真**已验证**：与既有 `tools/modules/raw/` 切片逐字一致 **17/17**（空白归一化后，见 index-world-model.md） |
| 文本清洗 | `src/ingest/clean-text.ts` | **已完成**，21 测试 |
| 字段级 diff 校准器 | `src/ingest/calibrate.ts` | **已完成**，38 测试 |
| 章节切分 | `src/ingest/sectionize.ts` | **已完成**，22 测试 |
| 确定性抽取 + Provenance | `src/ingest/extract-trap.ts` | **陷阱机制已完成**，22 测试；其余字段未做 |
| LLM 插槽 · 块分类 | `src/ingest/classify-sections.ts` | **已完成**，20 测试。实跑 **命中 20 / 误报 7 / 漏报 0**（口径：按块内容认地点） |
| id 命名 | `src/ingest/scene-id.ts` | **已完成**，8 测试。形态 `scene_NN`，按块编号 |
| 场景骨架 | `src/ingest/build-scenes.ts` | **已完成**，14 测试。实跑 **基准 20 个场景按 name 命中 17**（**与上面那行不同口径**：name 严格配；按场景身份仍是 20/20。且是单次采样、`temperature: 0.1`，非确定性——别当回归基线，详见下） |
| LLM 插槽 · 其余语义字段 | — | 未做（`findMethods`、NPC 字段、`connections`） |

> **关于 LLM 可用性**：`bun test` 输出里的 `[config] No LLM_API_KEY set` 是**测试在验证无 key 的降级路径**，
> 不是配置故障——本仓库有整套无 LLM 可运行的兜底链路，那条警告是被测行为的一部分。
> 2026-08-19 实测：`.env` 的 key 有效，`POST {LLM_BASE_URL}/chat/completions` 返回 **HTTP 200**。
> 判断 LLM 通不通，**必须实际发一次请求**，不要拿测试输出或历史记录当证据。
> 同次实测还查了一条本机事实：`.env` 的 `LLM_MAX_TOKENS` 是 **256000**，覆盖掉了 config 默认的 **1024**。
> 「43 个块塞进一个 prompt 一次发出去」全靠这个覆盖才成立——干净检出上按 1024 跑，回复会被截断，
> 分类**静默少掉几条**，症状与下面 `【】` 键格式那个坑一模一样（都表现成「模型没干活」）。
> 遇到这个症状先量 `maxTokens`，别直接顺着键归一化去查。

**清洗**（`cleanPageText`）判断"换行是排版造成的还是句子结束"，靠四个信号：句子终止标点、
终止标点后的右引号（场景描述整段是引文，只认句号会把描述和 KP 说明粘住）、`▶` 条目标记、冒号。
冒号需要两条规则：冒号结尾的行引出下面整块内容（不能把内容拽上来），
而**短**的冒号结尾行是场景名（不能被上一段吸走）——区分两者只有长度这一个信号。

实测 18 页：975 行 → 208 行，496 处制表符处理干净，骰子表达式完整，
全书 **45 个 `▶` 条目逐条可寻址**（四个陷阱全在内）——这是下游抽取最可靠的锚点。

**校准器**（`diffValues` / `formatDiff`）逐字段比对两份 `ModuleData`，产出 missing/extra/changed 三类。
带 `id` 的数组按 id 配对而非下标——生成物的场景顺序不必与手写那份一致，
按下标比会把"顺序不同"报成"每项都不同"，真实差异被噪音埋掉。实测：真实模组自比零差异；
把候选截到 3 个场景并倒序，只报 17 处缺失，无一条顺序误报。

**章节切分**（`sectionize`）吃清洗后的逐页文本，产出带层级的块：标题 + 正文 + `▶` 条目。
层级不能拍平——`▶捕兽夹` 属于「农场外围」，扁平之后陷阱不知道该挂哪个场景，
引擎里那对单数的 `support.trapSceneId`/`trapClueId` 正是这么来的。
每个块与条目都带 `{page, line}`，供 `Provenance.sourceRef` 使用。

有一类行既像条目又像标题（`▶证物室：` 冒号后无内容，底下再挂真条目），
按原文语义它是小节标题，`▶` 必须剥掉，否则场景名成了 `▶证物室`，与基准对不上。

**端到端实测**（PDF → 清洗 → 切分）：切出 44 块 / 39 条目，
**基准的 20 个场景名 20/20 全部命中**。多出的标题是文档结构（前言/附录/写在最后）、
NPC 小节（菲碧·特里坎/米尔·特里坎，基准里确实是 NPC）与子小节，只有「与背景」「可选」两个像误检片段。

**基准规模**（读取模块要还原的目标量）：20 场景 / 11 NPC / 10 物品 / 4 结局 / 32 线索。

### 首次校准结果（陷阱，2026-08-19）

四个陷阱的核心数值全部正确抽出：伤害骰、难度、体型阈值、以及「躲避 vs 挣脱」之分。
与手写基准 diff 出 9 处，分三类——**校准是双向的**：

| 类型 | 处数 | 说明 |
|---|---|---|
| 生成器正确地没编造 | 4 | `maimAtHpRatio` / `immuneNarration` / `inferred` / `detectedByClue`。PDF 原文没有，或属引擎层概念 |
| **生成器比手写版更忠实原文** | 2 | 音响陷阱手写成 `null`（"已失效"），原文其实留了 `sc0/1d3` 的口子；硫酸陷阱原文明写"可以通过一个**闪避**技能来躲避"，手写版漏了 |
| 生成器较弱 | 2 | `ongoing.until` 用占位词；`firstAid` 那句在场景正文里，不在条目内，抽不到 |

第二类是这套做法的价值所在：基准不是不可动摇的，生成物更准时该改的是基准。

**抽取的边界**：能用规则抽的不交给 LLM——骰子表达式、难度词、体型阈值都是死板文本形态，
规则抽取可复现、可解释、不要 API key。踩过一个坑：音响陷阱原文「造成 sc0/1d3 的惩罚」，
`造成…骰子` 的规则把 SAN 消耗当成了物理伤害，给一个不掉血的陷阱安上了 1d3。sc 记法必须排掉。

### 已验证行不通：靠引文判定场景（别再试了）

场景描述大多以整段朗读引文开头（`农场主别墅：“从远处观察别墅…”`），
看上去是个现成的判据。**实测不成立**：命中 15 / 误报 6 / 漏报 5（基准共 20 个场景）。

- 漏报：`报亭`、`与艾德里安的会面`、`证物室`、`农场外围`、`谷仓形建筑` —— 真场景，但没有朗读引文
- 误报：`敌对神话生物`（附录里的米戈描述）、`比较大的奇怪管道`、`艾米丽与爱莉的棺材`；
  其中 `旅店` 有引文也确实像个地点，可能是基准自己漏收了

结论：**「这一块是不是场景」是语义判断，不是文本形态能定的**，应归 LLM 那一层。
确定性部分能做的是把 44 个块连同标题、正文、条目、`{page,line}` 一并交出去，
分类留给语义层——这与「规则管死板形态、LLM 管理解」的分工一致。

改用 LLM 之后：**命中 20 / 误报 7 / 漏报 0**，严格优于引文启发式的 15/6/5。
7 个误报大多站得住（`旅店` 确实是地点，`绑架犯的报道` 是子场景），可留给人工过一遍。

**踩过的坑（值得记）**：prompt 里把标题展示成 `【农场外围】`，模型就照这个格式返回键
`"【农场外围】"`。解析器拿裸标题匹配，43 条全被丢弃，表现成"模型没干活"——
实际它全做对了。**展示格式不该变成输出格式的契约**，解析侧要做键归一化。
诊断方法是把原始响应打出来看，别猜。

> 再遇到「模型没干活」这个症状，**先量 `maxTokens`**：回复被截断的表现与上面这个键格式坑
> 一模一样，而 43 块一次性送进去全靠 `.env` 把它抬到了 256000（见上面 LLM 可用性那条）。
> 两个原因看起来一样，查错方向完全相反。

> 一个约束：读取阶段要调 LLM 修掉模组中不合理处、并把能预生成的先生成，
> 以减轻运行期压力（装载等待可接受）。`generate-llm-expanded.ts` 已有
> 「已存在 llmExpanded 就跳过」的语义，是现成的接入点——把它从运行期挪到构建期即可。

### 端到端实跑：场景骨架（2026-08-19）

首次把整条链跑通（PDF → 清洗 → 切分 → 分类 → 骨架 → 对基准 diff）：
18 页 / 44 块 / 送分类 43 / 分类返回 43 / 判成场景 27，
**基准 20 个场景按 name 命中 17**，差异 131 处（changed 17 / missing 87 / extra 10 / id 不一致 17）。

**跑出这些数的仪器是 `tools/_run-ingest.ts`**（108 行，见上面工具脚本表）。它被 `.gitignore` 排除，
`tsconfig.json` 的 `include` 又只写了 `src/**/*.ts`，所以它既不进版本库、也不过 `bun run typecheck`。
`docs/superpowers/plans/2026-08-19-ingest-scene-skeleton.md` §Step 2「写实跑脚本」里那段代码
**是当时的快照，不是现在的源码**：实际跑出 17/20 的那份多一个 `RecordingClient extends LLMClient`
（`_run-ingest.ts:32`，把 LLM 原始响应一并落盘——`【】` 键格式那个坑就是靠它查出来的）。
要重跑，以本机 `tools/` 下那一份为准；计划里那段只能当结构说明读。
**这个数下一轮还想比，前提是那份文件还找得到、还跑得动。**

**17 不是确定性的数**：`classifySections` 跑在 `temperature: 0.1`（不是 0），上面是**单次采样**。
下面三个未命中纯属名字格式、与模型判断无关，重跑大概率还是 17；但边界块（`旅店`、
`在小镇内询问路人`）翻一下就会让误报数变动。**要拿它当回归基线，得先把温度降到 0、
多跑几次定方差**——本轮没做。看到 16 先怀疑采样，别去 bisect；
18 不是采样能到的——那 3 个漏报是确定性的名字格式问题，除非基准或 PDF 的标题变了。

那 3 个「漏报」不是没抽出来，是**名字对不上**：基准的
`农场外围（陷阱区）`、`建筑内（谷仓大厅）`、`维修间（终局场景）`
括号里那截是手写时补的说明，PDF 标题只有 `农场外围`、`建筑内`、`维修间`。
三块都被正确判成场景、正文也抽到了，只是按 name 严格配对配不上。
**按场景身份算 20/20，按 name 严格配算 17/20** —— 表里记的是后者，因为它是机器能自动判的那个。
「身份」只说这 20 个地点全都被还原成了场景，**不表示正文对得上**：同一轮的 `changed 17` 说的正是
17 个命中场景的 `description` 无一与基准相同（生成侧原样带了块正文，普遍更长，如 `警察局` 117 字 → 496 字）。

10 个「误报」里有 3 个正是上面这三块的变体名，真误报 7 个，与上一轮分类实跑的 7 个对得上：
`奇怪的卡片`、`绑架犯的报道`、`关于艾米丽难产的事件`、`艾米丽与爱莉的棺材`、`比较大的奇怪管道`
在基准里是 **Clue 而不是 Scene**（最后一个对应 `奇怪管道与青色按钮`）；
`旅店` 基准里只有一段 `SCENE_TEXT.HOTEL` 正文、从没接成场景；`在小镇内询问路人` 基准里完全没有。
所以这 7 个不是模型乱认，但也不是同一个原因：**其中 5 个是基准把可调查地点收成了线索**；
`旅店` 是基准自己漏收的嫌疑（引文启发式那轮就已存疑，本轮独立复现了一次）；
`在小镇内询问路人` 基准里连对应物都没有，只能人工裁决。校准是双向的，下一轮该决定的是收哪边。

### id 是内部句柄，不与基准对齐（2026-08-19）

基准的场景 id 是带上下文的人工意译：`霍姆斯医院 → hospital`（人名丢了）、
`与艾德里安的会面 → adrian_hospital_meeting`（反而加了原标题没有的 hospital）、
`证物室 → police_evidence_room`（补了父场景前缀）。这是语义翻译，机械复现不了；
把基准 id 塞进 prompt 当范例又等于泄题，测出的命中率不说明任何事。

所以生成的 id 只保证唯一、同一 PDF 重跑稳定、纯 ASCII、可被 `targetSceneId` 解析，
形态是 `scene_NN`（按**块**编号，不按场景——分类结果一变，按场景编号会让所有 id 集体挪位）。
配对改由 `diffValues(..., { pairBy: ["id","name"] })` 承担：先按 id 配，配不上按 name 配，
id 不同的单列成 `id-mismatch`，不去污染 changed 那个计数。实跑 17 处 id 不一致，全部是这种情况。

顺带修掉校准器一处会埋掉信息的地方：`allHaveKey`（当时叫 `allHaveId`）原本要求数组非空，
于是候选侧 `clues: []` 会把整个数组拖回按下标比，基准全部 32 条线索都印成
`clues[0]`、`clues[1]` 这种纯下标路径（每个场景各自从 0 数起，最多到 `clues[3]`），
既看不出缺的是哪条，也没法直接拿去干活。空数组现在平凡成立，路径变成
`scenes[维森酒吧].clues[clue_bar_ask_around]` —— 这份清单直接是下一轮的路线图。

## 关键文档

| 路径 | 内容 |
|---|---|
| docs/kp-tool-surface-assessment.md | **架构主文档**：AI KP 工具面评估与 apply_action 迁移计划，多个测试直接引其章节号当验收依据 |
| DESIGN-LOG.md | 架构决策日志，把学术综述提炼成设计原则并逐条对照实现 |
| docs/kp-tool-numeric-domain-design.md | 决策记录：给 StateVariableSpec 加 tagged domain 联合 |
| docs/rules-licensing-audit.md + NOTICE.md | 版权合规线，直接产生了 rule-content-boundary.test.ts |
| docs/voice-readiness.md | 语音接入准备度与进度 |
| docs/deploy.md | 部署决策：为何单容器、静态托管踩坑 |
| docs/scene-visuals.md | 场景视觉方向（状态：暂缓） |
| frontend/DESIGN.md | 前端设计系统：语义颜色令牌与排版规范 |

## 已知问题

**同职责多实现**
- 三套局面驱动（见上）——有意为之
- 两套角色历程存储：`career.ts`(SQLite) vs `career-file.ts`(JSON)，只有后者在用
- 两套状态追踪：`src/world/state.ts`（内存，仅 play-module 用）vs `src/state/world-state-manager.ts`（SQLite）——最可能的整合目标

**废弃/无引用**
- `src/validator/item-validator.ts` —— 全仓（含测试）零 import，三个导出全部悬空
- `src/character/career.ts` 的 `CareerStore` 类 —— 无处 new
- `frontend/src/FlightPanel.vue` —— 未被任何组件引用的孤儿
- `character/prestige-classes.ts` 与 `qiankun-subclasses.ts` 只被 CLI 入口引用，服务端完全不碰

**测试套件里有一条会假红（约 1/100）**
- `src/__tests__/coc-engine.test.ts:131`「失败时损失 = sanCost 后半部分」：用 `new SanityEngine(1)`
  凑「几乎必失败」，但 `coc-engine.ts:669` 的 `regularD100()` 没有种子，判定是 `roll <= currentSAN`。
  `currentSAN` 是 1，掷出 1 就算通过，`expect(r.passed).toBe(false)` 于是红。概率正好 1%。
- **先例存在、本轮不修**：它早于摄取管线，属规则引擎，修它要改 d100 的注入方式，是另一轮的活。
- 但它现在比以前更碍事：摄取这条线的产物是**一个数**（17/20），下一轮要重新测量，
  而「`bun test` 全绿」是那个数唯一的背书。一个 1% 说谎的套件会把每一次这样的背书都打个折。
  **看到单条红先核对是不是这一条，重跑一次确认，别去 bisect 摄取那边。**

**环境陷阱（踩过）**
- 本仓源文件**不能过 PowerShell 写**（`Set-Content` 会把中文 mojibake）。读也一样，用 Read 工具。
- `bash` 工具的 `workdir` 参数会卡死，用 `cd C:\aitrpg\poc; ...`
- 精确分析写临时 `.ts` 用 bun 跑，并让脚本自己 `Bun.write` 落盘，不要经控制台
