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
| PDF → 逐页文本 | （暂用 `pdf-parse` 直调） | **已验证**：与既有 raw 切片逐字一致 17/17 |
| 文本清洗 | `src/ingest/clean-text.ts` | **已完成**，21 测试 |
| 字段级 diff 校准器 | `src/ingest/calibrate.ts` | **已完成**，21 测试 |
| 章节切分 | — | 未做 |
| 确定性抽取 + Provenance | — | 未做 |
| LLM 插槽（语义字段） | — | 未做，且当前 `.env` 的 key 是 401 |

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

**基准规模**（读取模块要还原的目标量）：20 场景 / 11 NPC / 10 物品 / 4 结局 / 32 线索。

> 一个约束：读取阶段要调 LLM 修掉模组中不合理处、并把能预生成的先生成，
> 以减轻运行期压力（装载等待可接受）。`generate-llm-expanded.ts` 已有
> 「已存在 llmExpanded 就跳过」的语义，是现成的接入点——把它从运行期挪到构建期即可。

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

**环境陷阱（踩过）**
- 本仓源文件**不能过 PowerShell 写**（`Set-Content` 会把中文 mojibake）。读也一样，用 Read 工具。
- `bash` 工具的 `workdir` 参数会卡死，用 `cd C:\aitrpg\poc; ...`
- 精确分析写临时 `.ts` 用 bun 跑，并让脚本自己 `Bun.write` 落盘，不要经控制台
