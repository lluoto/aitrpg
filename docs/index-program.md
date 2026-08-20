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
| tools/_diag-strand.ts | 取证脚本：定位「条目正文丢后半截」发生在哪一层。在 `extractPages` / `cleanPageText` / `sectionize` 三个边界各打一份，标出片段与它该属的条目相隔几行。**下一轮修那个 bug 前先跑它**，产物 `tools/ingest-out/diag-strand.txt`。它推翻过一个错诊断（原以为是读取顺序，实际是分页与条目单行取值两回事），别凭症状猜 |
| tools/_diag-absorb.ts | 取证脚本：把「条目吃到下一个 `▶`/标题为止」这条待选规则**先复现一遍再决定要不要实现**。逐条列出会被吸收的行、标跨页/同页。产物 `tools/ingest-out/diag-absorb.txt`。它量出跨页 4 行 / 同页 21 行、同页里四成会误吃场景正文，据此否掉了一个已经写进文档的修法方向 |
| tools/_diag-lineno.ts | 取证脚本：逐页比对「原始行数 vs 清洗后行数」，并拿真实条目对照 `sourceKey` 给的行号与 PDF 实际行号。产物 `tools/ingest-out/diag-lineno.txt`。它证伪了 `Provenance.sourceRef` 的文档（见下面 §sourceRef 那条） |
| tools/_diag-joined.ts | 取证脚本：`joinPages` 到底接了哪几处、哪些条目正文因此变了。产物 `tools/ingest-out/diag-joined.txt`。**它是「分类器逐条输出不独立」那条结论的证据来源**——正文没变的条目标签照样会翻，所以不能按单条归因。注意它把「接走首行的那一页」和「被接走首行的那一页」都列出来，所以列出 10 段 = 5 处边界 |
| tools/_diag-p15.ts | 取证脚本：列出页内以 ASCII 连续句点收尾的行及其上下文形态，并倒出 p15 整页原始行。产物 `tools/ingest-out/diag-p15.txt`。**它把「ASCII 省略号有两种含义」这个症状级诊断推进到了真因**——p15 的结局与奖励表整片被焊（见 §p15 那节） |
| tools/_diag-labels.ts | 取证脚本：把「纯拉丁行」「以骰子/数值收尾」两条候选判据在**全书**上跑，逐条列出上下文供判真假阳，并复现「加上这两条否决」之后的完整输出与逐页行数变化。产物 `tools/ingest-out/diag-labels.txt`。**它量出 22 真阳 / 6 假阳、8/18 页受影响，据此否掉了这两条判据**——假阳全落在 `extract-trap` 正在读的陷阱描述上 |
| tools/_diag-findmethods.ts | 取证脚本：倒出基准 32 条线索的 `findMethods` 全貌，验两件事——`type` 是否自身不一致（是，3 条）、`skillName` 是否逐字来自 description（15/16）。产物 `tools/ingest-out/diag-findmethods.txt` |
| tools/_diag-skillwords.ts | 取证脚本：逐场景比对「原文技能词」与「基准 findMethods 记录」。产物 `diag-skillwords.txt`。量出 54 vs 19（2.8×），并指出超产集中在技能属于陷阱/连接的那七个场景 |
| tools/_exp-clue-followup.ts | **实验脚本**：分族对条目追问，拿评分键算前后对比。产物 `exp-clue-followup.txt` 与 `exp-signature.txt`。它先否掉了「得到东西 vs 知道事情」（−2），再验成了 item 族的「带走的东西 vs 去翻的地方」（+7）与 event 族的「往下还有得查吗」（+2），合计 **22/33 → 31/33，0 弄坏**。**验一个分类修法的标准做法就是它**——不改管线、两次调用、有前后数、带逐条签名验稳定（8 次跑签名全同） |
| tools/_diag-confusion.ts | 取证脚本：给 `▶` 条目分类器出混淆矩阵——逐条拿名字去基准里找它对应什么结构，只认强匹配（`name` 逐字 / `findMethods.description` 逐字含）。产物 `diag-confusion.txt`。**量出「57% 的条目无法按名字核验」，据此确定手建评分键是唯一可行的线索计分办法**。弱匹配单独列出不进矩阵——`.includes` 在描述上兜底会造出假的双命中 |
| tools/_diag-skill-scoped.ts | 取证脚本：把技能词抽取限定在已判为 `clue` 的条目上再量。产物 `diag-skill-scoped.txt`。**它否掉了「findMethods 当首切片」**——限定后变成 12 vs 19（0.6×），召回塌陷且塌在分类器误判的那几个场景上。读上一次实跑的 `item-kinds.txt`，不重调 LLM，避免引入采样变量 |
| tools/_diag-sentence-end.ts | 取证脚本：改共用正则前后，全书 `cleanPageText` 输出**逐字节**快照对比（`bun tools/_diag-sentence-end.ts <tag>` → `snap-clean-<tag>.txt`），外加「哪些行以 ASCII 连续句点收尾」的清单。**「把 `\.{2,}` 并进 `SENTENCE_END` 会改动既有行为」这条结论就是它量出来的**——共用正则的改动一律先过它，别靠推理 |
| tools/_diag-blocks.ts | 取证脚本：把 p1→p2 那处错接手工补回去，与修好的输出逐块比标题/正文/`sourceRef`。产物 `tools/ingest-out/diag-blocks.txt`。**它推翻了一个推理出来的说法**（原以为缺陷会让块数从 44 掉到 43，实测两边都是 44、行号一行没挪，唯一差别是一块的正文被污染）——所以那个缺陷躲过了所有按计数做的验收 |
| tools/_run-ingest.ts | **摄取管线的端到端实跑器**（约 250 行）：读 PDF → 清洗 → 切分 → **块分类 → 建场景骨架 → 条目分类 → 建 ModuleItem** → 对基准 diff。含 `RecordingClient`，把**每一次** LLM 调用的 prompt 与原始响应都落盘（两次调用，单组字段会让后一次覆盖前一次，而那是「模型到底答没答」的唯一证据）。**清洗那一段的组合是 `joinPages(raw.map(cleanPageText))`，两段都要**——本文件被 `.gitignore` 排除，这个组合唯一进版本库的记录是 `docs/superpowers/plans/2026-08-19-ingest-scene-skeleton.md` 的 Step 2 代码块（已订正）。照着重建 runner 时漏掉 `joinPages`，跨页续行就悄悄停摆，而单测全绿——`joinPages` 的测试直接调它，不经过这条组合。下面 §模组摄取 里所有实跑数**全部出自它**——`身份覆盖 20/20`、`物品覆盖 9/10`、`精确率 9/19`、`差异 179 处`（先前这里写的 `9/17` 与 `178 处` 与下面的表对不上，实测是后者），以及上一轮的 `命中 20 / 误报 7 / 漏报 0`。重跑它是唯一能复现这些数的途径。它还印三样光看 diff 看不出来的：口径对账（覆盖+误报 是否等于生成数，防重名两边同时吃掉）、悬空引用（`item.sceneId` 是否都指得到人）、以及逐条目的分类结果 |
| src/ingest/scoring-key.ts | **手建的条目评分键**（39 条 `▶` → 它在基准里实际是什么）。**它绝不能进 prompt**——是评分口径不是输入，由 `ingest-scoring-key-boundary.test.ts` 结构性拦着（扫 `src/` 与 `tools/` 两侧，后者带白名单）。没有 `trap` 变体：陷阱在基准里就是 `ModuleItem.type="trap"`，所以 4 条陷阱条目标成 `item(...)`，**算分时必须把 id 解回 `item.type` 才算得中**，否则 4 个正确答案会被记成 4 个 miss（39 条的 10%）——这条约定由测试钉住，不靠记性 |

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
| 文本清洗 | `src/ingest/clean-text.ts` | **已完成**，41 测试。`cleanPageText` 管页内、`joinPages` 管跨页（实测接 **5 处**页边界，其中 4 处的上一行是 `▶`——两个分母见下）。内核是同一个 `shouldJoin`，但页边界上另加两条否决（首行冒号收尾一律不接、上一页末行 ASCII 连续句点算句末），因为 `cleanPageText` 逐页调用时把空行吃掉了，段落分隔到 `joinPages` 手上已经看不见 |
| 字段级 diff 校准器 | `src/ingest/calibrate.ts` | **已完成**，46 测试。配对键可配（`pairBy`）、引用字段单列（`refFields` → `ref-mismatch`） |
| 章节切分 | `src/ingest/sectionize.ts` | **已完成**，22 测试 |
| 确定性抽取 + Provenance | `src/ingest/extract-trap.ts` | **陷阱机制已完成**，22 测试；其余字段未做 |
| LLM 插槽 · 块分类 | `src/ingest/classify-sections.ts` | **已完成**，20 测试。实跑 **命中 20 / 误报 7 / 漏报 0**（口径：按块内容认地点） |
| id 命名 | `src/ingest/ids.ts` | **已完成**，16 测试。`scene_NN` 按块编号、`item_NN` 按条目编号（键是 `p9:L13`） |
| 场景骨架 | `src/ingest/build-scenes.ts` | **已完成**，14 测试。实跑 **严格 17 + 名字变体 3 = 身份覆盖 20/20，真漏报 0，真误报 7**（**与上面那行不同口径**：name 严格配。非确定性，详见下） |
| LLM 回复取 JSON | `src/ingest/llm-json.ts` | **已完成**，13 测试。两个分类器共用，避免两份副本各自漂 |
| 条目分类（`▶` 是什么） | `src/ingest/classify-items.ts` | **已完成**，21 测试。实跑 37 送分类 / **返回 37**，分布 item 15 / clue 11 / event 4 / trap 4 / connection 3（与下面 §实跑数 那张表同一次跑；先前这里写的 `item 13 / clue 12 / event 5` 是更早一轮的数，两处对不上） |
| ModuleItem 抽取 | `src/ingest/build-items.ts` | **已完成**，22 测试。实跑 **基准 10 个物品覆盖 9**（上限 9）、生成 19 个、**精确率 9/19**、误报 9。补跨页续行（`joinPages`）之前是 9/17，那两个数**不能直接比**——见下面「分类器的逐条输出不是独立的」 |

| LLM 插槽 · 其余语义字段 | — | 未做（线索与 `findMethods`、NPC 字段、`connections`） |

> ingest 测试合计 **239**（上表逐文件相加）。这个数是逐文件 `bun test` 实测的，不是估的——
> 而它已经被算错过三次：先前两处是表内数字本身写错（`build-scenes` 写成 16 实为 14、
> `build-items` 写成 20 实为 22），第三次是合计没跟着表走（写 **219**，而当时表实际相加是 230）。
> 逐文件实测值：pdf-source 2 / clean-text 41 / calibrate 46 / sectionize 22 / extract-trap 22 /
> classify 20 / ids 16 / build-scenes 14 / llm-json 13 / classify-items 21 / build-items 22。
> 改这张表时请照着 `bun test <path>` 的实测值写，并把合计重新加一遍。

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

### p15 的结局与奖励表被整片焊成一行（潜伏，待修）

`cleanPageText` 在第 15 页把 **24 行压成 4 行**（全书最高压缩比），其中第 4 行是个
400+ 字的团块，把 **4 段结局叙述 + 3 个结局标签 + 整张 9 行奖励表**全焊在一起：

```
…"伎俩"呢...Good End调查员在发现…照顾爱莉吧...Bad End调查员在中控室…
True End调查员找到了…杀死所有受害者 San 削减 d6解救受害者 San 值回复…委托达成 信誉+10…
```

第 3 行同样坏了：`Normal End调查员没有知道事情的真相…` —— 标签把自己名下的叙述吸了进来。

**主因不是 ASCII 省略号**（那只是让 `Good/Bad/True End` 被前一行吸走的那一个因素）。
主因是 `shouldJoin` 的默认假设：「中文正文里，一行结束而没有终止标点，几乎总是被栏宽切断的」。
这条对中文散文成立，对 p15 的两类行不成立：

- **纯拉丁标签**：`Normal End` / `Good End` / `Bad End` / `True End`
- **以骰子或数值收尾的表格行**：`杀死所有受害者 San 削减 d6`、`委托达成 信誉+10`

**今天下游影响是零**：`ModuleData.endings` 与奖励都还没抽，没人读 p15。
所以这是潜伏损坏。但它是「做结局那一轮」的必经障碍——那一轮开工第一件事就是这个。

#### 那两条形态判据量过了：不能上（2026-08-20）

`tools/_diag-labels.ts` 把「纯拉丁行」与「以骰子/数值收尾且含中文的行」两条判据
在全书 18 页上跑了一遍，并复现了「把它们当作 `shouldJoin` 额外否决」之后的完整输出。

**命中 28 行，逐条判定 22 真阳 / 6 假阳（约 21%）。**

真阳是该保护的：p15 的 4 个结局标签与 9 行奖励表、p16/p17 的怪物属性块
（`Str50 Dex65 Pow80…`、`HP13 MP13 DB+1d4 体格+1`、`理智损失：0/1d6`）、p18 的版权尾页。

**6 个假阳全是同一个形状——被栏宽切断的散文，恰好以骰子表达式收尾：**

```
p9:L49  "击。霰弹枪会朝着拌锁的位置开火，造成 1d6"   下一行是「的伤害，…」
p9:L57  "…为由对所有调查员造成 sc0/1d3"             下一行是「的惩罚，…」
p10:L45 "草堆作为落点。跳跃失败摔到地板上 伤害 1d6"
p10:L69 "者是因为血液进入气管窒息而死。Sc0/1d3"
p13:L21 "地漂浮在缸中。Sc1/1d6"
p16:L19 "1d6+DB"                                    其实是「警棍 1d6+DB」被切开
```

**blast radius：8/18 页受影响，全书 260 → 297 行。** 不是局部改动。
改后的 p15 是**完全正确**的（20 行，标签与表格行各自独立）——判据确实能修 p15。

**结论是不上，理由是取舍方向反的：**

| | 今天有没有消费者 |
|---|---|
| p15 的结局与奖励 | **没有**（`ModuleData.endings` 与奖励都还没抽） |
| p9 / p10 / p13 的陷阱与机制描述 | **有**（`extract-trap` 正在读） |

那 5 处散文误切全落在陷阱与机制描述上。上这两条判据等于
**为了修没人读的内容，去破坏正在工作的抽取**。净负，所以不动。

**下一轮真要修 p15，可走的方向**（都还没量，别当结论）：

1. 给判据加一条共同要求：**上一行以终止标点收尾**。手判这 6 个假阳全部能排掉
   （它们的上一行都是断在半句上的），但 p16:L4 会破功——它上一行 `…生物学教授 耐久 14`
   本身也不以终止标点收尾。而且这条要先把 ASCII 省略号算进终止标点（见上一节），
   那又是一处独立改动。
2. 把 p15 当**结构块**而不是逐行处理：它整页就是「结局标签 + 叙述」四段加一张表，
   页级的结构识别比逐行形态判据更贴合。代价是引入一个新的处理层级。
3. 承认它是语义判断，交给 LLM——与根因 B、物品/线索边界同一类。

**跨页连接**（`joinPages`）复用同一个判据，但**多一道页边界专用的否决**：页首行以冒号收尾时
一律不接，不看长度。因为页内那条长度规则的前提是「长的冒号行通常是正文」
（`艾德里安会在外围布置 3 种陷阱：`），而页首那一行有标题先验。
不加这道否决就会出真事故：p1 末行以 ASCII 省略号 `....` 收尾（`SENTENCE_END` 只认 U+2026 的 `…`），
p2 首行是 21 字的 `事件真相（想跑的人请不要继续往下看了。）：`，两条守卫同时失效，
把一个小节标题焊到了上一页正文末尾。**这个错接在 6 处接续里占 1 处，最初没被发现，
因为当时只核了「跟在 `▶` 后面」的那 4 处，把多出的 2 处当成分母差异解释掉了。**

实测 18 页（口径：非空行数，`cleanPageText` 逐页后统计）：

| | 数 |
|---|---|
| 原始非空行 | 975 |
| 页内连接后 | **260** |
| 再跨页连接后（`joinPages`） | **255** —— 少的 5 行正是 5 处跨页接续，与 `_diag-joined` 对得上 |
| 制表符 | 496，处理干净 |
| 骰子表达式 | 46 处，完整 |
| 行首带 `▶` 的行 | **45** |
| 最终 `SectionItem` | **39** |

> **45 与 39 是两件事，别当成一个。** 45 是行首带 `▶` 的行数；其中 6 个形如 `▶证物室：`
> ——冒号后无内容，按原文语义是小节标题，`sectionize` 把 `▶` 剥掉当标题处理，不计入条目。
> 所以「可寻址的锚点」是 **39 个条目 + 6 个由 `▶` 起头的小节标题**。
> 这一段先前写的是「975 行 → 208 行」和「全书 45 个 `▶` 条目」：前者口径无从重建、
> 实测是 260；后者把标记数说成了条目数。四个陷阱确实都在那 39 个里。

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

### 修法验证成功：分族追问，67% → 94%（2026-08-20，跑了 8 次）

有了评分键之后，验一个修法变得很便宜：换 prompt 跑一次、拿键算分就有对比数。
`tools/_exp-clue-followup.ts` 干这件事，**不改管线**。

设计原则是**别碰已经对的部分**：`clue`/`connection`/`trap` 三项精确率都是 100%，
全量换 prompt 有把它们弄坏的风险，而它们是白赚的。所以只对出错的族追问一次。

**第一次试的轴失败了：`得到东西 vs 知道事情`，22/33 → 20/33（净 −2）。**
弄坏的 4 条里有 3 条同形：`农场的照片`、`驾驶证`×2 被答成 `know` 而改判成 clue。
原因是**基准里 6 个非陷阱物品有 3 个是文件**（照片/驾驶证/老旧文件）——
实体物件，而存在的全部意义就是传递信息。这条轴在原材料里本就分不开两类。
而容器家具那一族**一条都没修好**：直接问 `枪械柜`/`床头柜` 也照样答 `get`。
（另外给了 `harm`/`move` 两个选项，还把本来 100% 的 trap/connection 拖下水。）

**失败指出了正确的轴。** 看基准自己怎么分的：`农场的照片` 是证物室里**带得走的一件东西**；
`床头柜` 是**你去翻的地方**，翻出来的日记本才是线索。界线是**容器 vs 内容**，
不是「拿走 vs 知道」。

**第二次：`标题指的是带走的那件东西，还是去翻的那个地方？`（只两个选项，只问 item 族）**

| | |
|---|---|
| 改前 | 22/33（67%） |
| **改后** | **29/33（88%）** |
| 修好 / 弄坏 | **7 / 0** |
| 稳定性 | 连跑 3 次，全部 29/33 |

修好的正是那一族：`侦查休息区/仔细检查床底`、`侦查卫生间/…`、`侦查餐厅/…`、
`在一旁的冰箱与储物柜`、`中控台的开关`、`枪械柜`、`床头柜`。
而真正的物品一个都没被带偏——`防盗门的钥匙`/`农场的照片`/`驾驶证`×2/`住宅钥匙`
全答 `thing`；双角色的 `老旧文件` 答 `thing` 也算对。

**第三次：给 `event` 族也找了一根轴，`31/33（94%）`**

`event` 族的形态与 item 族完全不同（都是「如果调查员……就会……」），
区别在**结果**里：三条是「调查员因此知道了/看见了什么」，一条是「事情发生完了，没了」。
而那一条的原文自己写着「无法再进一步获得线索」。

轴：**这一段发生完之后，调查员手里是不是多了一条能继续往下查的东西？**（`lead` / `dead`）

`p5:L17`（冷静后认罪告知农庄）与 `p13:L11`（母女的缸中脑）答 `lead` → 改判 clue，**修好**；
`p6:L1`（夺枪导致击毙）答 `dead` → 留在 `event`，**正确**。2 修 0 坏。

| | |
|---|---|
| 原始 | 22/33（67%） |
| + item 族追问 | 29/33（88%） |
| **+ event 族追问** | **31/33（94%）** |

**稳定性是真的，不是总数巧合。** 加了逐条签名（每个条目的「改前→改后」拼成一串取哈希），
连跑 4 次签名完全相同（`1506558744`）。总数稳定而逐条 churn 是可能的——
本文件 §分类器的逐条输出不是独立的 那一条就是这种耦合的证据——所以这一项必须单独验。
顺带一个对比：条目分类在 `temperature: 0.1` 下逐条确定，而**块分类漂过一次**
（`npc 3/rule 5` → `npc 2/rule 6`）。两者 prompt 规模不同，可能是原因。

### 剩下的 2 个错，都不是分类问题（这条把两条线连起来了）

追到底之后，最后 2 个错**都是根因 B（同页续句）的下游**：

**`p5:L15`** —— 基准 `clue_adrian_psychoanalysis.description` 逐字横跨两个条目，
中间那句 **「此时的他处于一种疯狂的边缘。成功的社交类技能才可以让他冷静下来。」**
是连接两段的枢纽。实测：这句**留在块正文里没进条目**（同页续句），
于是条目正文止于「夺取调查员的武器等行为。」——以暴力收尾、没有任何往下的出口。
模型答 `dead` 完全合理，**缺的那句才是指向后文的钩子**。

**`p8:L6`** —— `▶` 行只有名字、正文为空，模型没东西可判。同样是根因 B。

**所以两段式追问已经打到当前文本质量的天花板了。下一分准确率来自修根因 B，
不是来自继续改 prompt。** 这条把「上游文本处理」与「语义分类」连了起来——
在此之前它们看着是两个独立议题。

**要落地成管线的话**：两段式分类，第二段只对 `item` 族触发（实测 15 条）、
第三段只对 `event` 族触发（4 条），共多两次 LLM 调用。
落地前注意本文件 §分类器的逐条输出不是独立的 那一条——追问也是整批发的，同样有批内耦合。

### 条目分类的真实准确率：22/33，而 11 个错误全指向同一个方向（2026-08-20）

评分键（`src/ingest/scoring-key.ts`）落地之后，`tools/_run-ingest.ts` 每次实跑都会算这一项。
**在有键之前算不出来**——只能拿「生成物品的名字对不对得上基准」间接推，而那条路只覆盖 43%。

**22/33（67%）**。另有 4 条不计分（键说 `none`，基准没收，无所谓对错）：
`搜查一层`、`搜查二层`、`受害者床位边上`、`下水道深处的房间`。

| 预测 | 实际 |
|---|---|
| `clue` 8 | **clue 8** ✓ |
| `connection` 3 | **connection 3** ✓ |
| `trap` 4 | **trap 4** ✓ |
| `event` 4 | clue 3 / event 1 |
| `item` 14 | clue 8 / item 6 |

**11 个错误全是同一个方向：某某 → 实际是 `clue`。** 分类器**从不把别的东西误判成线索**。
所以问题是召回不是精确率：

- `clue` 精确率 **8/8 = 100%**，召回 **8/19 = 42%**
- `connection` 与 `trap` 各 100%，两项都可以直接信

判错的 11 条分两族，族内高度同形：

**族一 · 判成 `item`（8 条）—— 全是「容器家具 / 搜查动作」**
`枪械柜`、`床头柜`、`在一旁的冰箱与储物柜`、`中控台的开关`、
`侦查休息区/宣言仔细检查床底`、`侦查卫生间/…`、`侦查餐厅/…`、`抽屉里的…转购协议`

**族二 · 判成 `event`（3 条）—— 全是「条件叙述，但它就是那条线索」**
`如果调查员投掷了成功的精神分析…`（= `clue_adrian_psychoanalysis`）、
`如果他冷静了下来，会认罪…`（= 同上 + `clue_adrian_farm_location`）、
`母女的缸中脑`（= `clue_final_brain_jars`）

**单方向错误比散布错误好修得多**，而且这里还有一条硬约束：
**prompt 里已经拿 `床头柜` 当「这是线索」的范例，模型仍把它判成 `item`。**
所以「再多写点说明」大概率无效，得换手段。可考虑的方向（都没量）：
把「是不是可拿走的实体」与「是不是一条信息」拆成两个独立判断（两族错都能覆盖）；
或允许多标签（基准里 `老旧文件` 本就同时是两者）；或逐条问而不是整批问
（整批问会让一条的文本变化翻掉另一条的标签，见 §分类器的逐条输出不是独立的）。

### 条目分类的混淆矩阵，与「57% 无法按名字核验」（2026-08-20）

`tools/_diag-confusion.ts` 拿上一次实跑的 37 条分类结果，逐条去基准里找它对应什么结构。
**只认强匹配**：名字逐字等于基准的 `name`，或逐字出现在 `findMethods.description` 里。

| 分类器判的 | 基准里实际是 |
|---|---|
| `trap` 4 | **item 4** —— 4/4 全对（陷阱在基准里就是 `ModuleItem.type="trap"`） |
| `item` 15 | item 5 / **clue+item 1** / clue 3 / 名字对不上 6 |
| `clue` 11 | clue 2 / 名字对不上 6 / 无名 3 |
| `event` 4 | clue 1 / 无名 3 |
| `connection` 3 | 名字对不上 2 / 无名 1 |

三条实质发现：

1. **`老旧文件` 被确认是唯一的双角色条目**（`clue+item 1`）。先前只是推测「39 条里只此一例」，
   现在是量出来的。所以单标签加一个记录在案的例外是对的，不必上多标签。
2. **陷阱判定 4/4 全对。** 这一块可以信，`extract-trap` 的上游是干净的。
3. **决定性的：37 条里 21 条（14 个名字对不上 + 7 个无名）= 57% 无法按名字核验。**
   名字匹配的天花板是 43%。

第 3 条改变了路线：**「手建一份逐条评分键」不是可选项，是唯一能测线索分类准确率的办法。**
没有它，任何线索指标都只能覆盖不到一半的条目，而看不见的那 57% 里既可能全对也可能全错。
那份键必须永远不进 prompt——它是评分口径，不是输入。

**顺带否掉一条刚提出的猜想**：基准 `clue_card` 的 findMethods 描述里逐字含着条目名
`侦查餐厅/宣言仔细检查餐桌`，看上去像是「线索名长在 findMethods 上」这条机械计分路径。
实测**只有 5/37**，不足以支撑口径。

**并更正一处措辞**：先前记「误报 9 个，全部是基准里的 `Clue`，一个凭空的都没有」——
那是独立复查用**意译对应**判出来的（`枪械柜` → `clue_bedroom_gun` 那类）。
按**逐字名字匹配**只有 3 个能对上，另外 6 个名字在基准里不存在。
两者不矛盾，但强度不同：意译对应靠人/agent 判断、覆盖面大但不可复现；
逐字匹配可复现但只能到 43%。**引用那个「9 个全是 Clue」时要带上是哪种方法。**

**这份矩阵自己踩过的坑，值得记**：第一版把 8 个无名条目剥成空串后当作「基准里找不到」，
于是 `none` 里混进 8 个测量假象；又在 `Clue.description` / `revelation` / `ModuleItem.description`
上用 `.includes` 兜底，造出 6 个「同时是 item 又是 clue」的假双命中——物品描述与线索描述
本来就大段重叠。**污染过的矩阵写进文档比没有更糟**，所以先收紧了才记。

### 评分键的覆盖分析，与一处标错（2026-08-20，复核后重算）

键建完之后逐条复核了一遍，**抓到一个把正确答案判成错的标注**，并顺带把覆盖面量清楚了。

**先说那个错，因为它比被它量的东西更严重。** `p7:L11`（`交火现场` 的 `▶驾驶证`）原先标成
`none`，理由写的是「基准有意不收」。两处站不住：`item:drivers_license` 是存在的
（`sceneId` 是 `police_evidence_room`，所以**绑定**是单份，但那个对象基准收了——去重不等于没收）；
而且基准还专门写了 `clue_adrian_wallet`，description 是「从证物室获得**或从交火现场找到**
艾德里安的东西（**驾驶证**、住宅钥匙…）」，物件与场景都点名了。分类器这条答的是 `item`，**是对的**，
旧键把它记成了错。**键是尺子，尺子上的错比被量的东西上的错更糟**——它无声地压低或抬高被测的准确率。
已改成 `item("drivers_license")`。

**为什么会标错，是方法的问题不是手滑。** 工作表按**场景**切候选（`tools/_gen-key-worksheet.ts`），
把搜索空间从 37×86 缩到每条 0–4 个——这是它能被人复核的全部原因，但代价是
**看不见跨场景的基准对象**。`clue_adrian_wallet` 挂在 `与艾德里安的会面` 名下，
内容却是证物室与交火现场的物品，于是 `p7:L11` 那一栏的候选里根本没有它。
**复核「基准里没有对应对象」这类判断时必须额外全本搜一遍**，别只信工作表那一屏。

另外 `p5:L17` 原先只标 `clue_adrian_farm_location`，补上了 `clue_adrian_psychoanalysis`——
条目正文「如果他冷静了下来，会认罪，并宣言那些失踪案件都是自己所做，但是要求调查员帮助他的妻女，
并且他会告知藏匿的农庄」**逐字**就是后者 description 的结尾。这不改准确率（分类器答的是 `event`，
两种标法都算错），改的是覆盖数与一对多条目数（2 → 3）。

**重算后的分布**（`keyDistribution()` 实际返回，不是照注释算的）：

| | clue | item | connection | npc_knowledge | npc_secret | event | none | 合计 |
|---|---|---|---|---|---|---|---|---|
| 标记数 | 22 | 10 | 3 | 1 | 1 | 1 | 4 | **42** |

39 个条目 → 42 个标记，多出的 3 个来自三条一对多：`p5:L17`、`p8:L5`、`p12:L6`。
其中只有 `p12:L6` 是**跨类别**双角色（同时是 `Clue` 与 `ModuleItem`），另两条都是一条对两条 `clue`。

**覆盖**：键引用了基准 **32 条线索里的 21 条**、**10 个物品里的 9 个**（未被引用的物品就是
`黑色钱包`，即上面那个 9/10 上限）。11 条没被引用的线索分四类，**分开记才有用**——
四类的修法完全不同，混成一句「PDF 里没有」会让下一轮往错的方向使劲：

| 类 | 线索 | 为什么没进键 |
|---|---|---|
| (a) 原文根本没有 `▶`，写在块正文里 | `clue_newspaper_missing`、`clue_police_missing_cases`、`clue_adrian_mumbling`、`clue_shootout_wallet` | 条目级抽取的硬天花板（`报亭`/`警察局` 一个 `▶` 都没有；钱包是「只写了内容不写容器」，见上节） |
| (b) 引擎合成，本就不来自 PDF | `clue_trap_detected` | `TrapMechanics.detectedByClue` 的标记线索 |
| (c) **上游丢的**：自己的 `▶` 行被判成了标题 | `clue_newspaper_kidnapper`、`clue_emily_birth`、`clue_police_evidence_room`、`clue_final_pipe`、`clue_final_coffin` | 见下表 |
| (d) 跨场景聚合，没有单一条目对应 | `clue_adrian_wallet` | 它一条盖住 `p7:L1`/`p7:L3`/`p7:L11`/`p7:L12` 四个物品条目（description 逐个点名了农场照片、驾驶证、住宅钥匙），而键按「条目实际是什么」标，标的是那四个物品 |

**(c) 那一类是可修的，而且是本轮最值得记的一条。** 全书 45 个行首 `▶` 里有 6 行是
「`▶X：`」冒号后无内容，`sectionize` 把它们判成标题，于是 45 → 39。逐行核出来是这六行：

| 行 | 原文 | 它其实是 |
|---|---|---|
| p5:L7 | `▶绑架犯的报道：` | `clue_newspaper_kidnapper`（名字逐字相同） |
| p5:L13 | `▶与艾德里安的会面：` | 真的是场景标题，判对了 |
| p6:L2 | `▶关于艾米丽难产的事件：` | `clue_emily_birth`（名字逐字相同） |
| p6:L14 | `▶证物室：` | `clue_police_evidence_room`（名字逐字相同，同时也确实是子场景） |
| p13:L8 | `▶比较大的奇怪管道：` | `clue_final_pipe`（基准名 `奇怪管道与青色按钮`） |
| p13:L12 | `▶艾米丽与爱莉的棺材：` | `clue_final_coffin`（名字逐字相同） |

**六行里有五行在基准里有同名线索**（`p6:L14` 两者皆是——它既是子场景也是一条线索），
只有 `p5:L13` 纯粹是场景标题。所以这不是「冒号后无内容 ⇒ 标题」这条规则太粗，
是原文作者拿同一个 `▶` 既写小节标题又写线索，正文落在下一行——判成标题不算错，
错在那条线索从此没有任何条目承载。

**算一下上限**：32 − 4(a) − 1(b) − 5(c) − 1(d) = **21**，正好等于键当前引用的 21 条。
这不是巧合：键覆盖的就是「按条目能够到的全部」。所以
**线索轮按 `▶` 条目计分的召回上限是 21/32，不是 32/32**，报告里引用召回率时要带上这个分母。
把 (c) 那五行捡回来能把上限抬到 26；捡法与根因 B 是同一件事
（`▶` 之后到下一个 `▶`/标题之间的行归谁），**归 LLM 那一层**。

> **一条被证伪的猜想。** 复核时曾猜「`黑色钱包` 与 `clue_final_coffin` 同因，都是 `▶` 行变标题」。
> `clue_final_coffin` 对，`黑色钱包` 错——上面那张六行表里没有它，全书也搜不到 `▶黑色钱包`。
> 两条线索长得像，成因完全不同，**合并成一句话写就会让 (a) 和 (c) 的修法混在一起**。

**键的左手边现在也有人看了。** 单测只验键名形态（`/^p\d+:L\d+$/`），`"p99:L99"` 照样过；
而键自己的文件头就写着行号是**清洗后**的、「清洗逻辑一变行号就漂」。漂一行那条就永远配不上，
不报错不报红，只是从此不参与计分。这个检查需要 PDF（在仓库之外），所以**同 `pdf-source` 的内容保真一样
归实跑器报，不进单测**：`_run-ingest.ts` 现在断言「抽出的 `sourceKey` 集合 == 键名集合」并**印两个方向的差**
（只印一侧的话，「漂了一行」看起来就只是「少了一条」，看不出是同一条挪了位置）。
当前实跑：`抽出条目 39 / 键 39 —— 完全一致`。

### 线索轮的依赖顺序：findMethods 不能先做（2026-08-20，量过）

开线索轮时的直觉是先做 `findMethods`——技能名与难度词是死板形态、与 `extract-trap` 同一类，
而且**基准里的技能名逐字来自原文**（16 条 `type=skill` 里 15 条的 `skillName` 就写在
它自己的 description 里），所以「每个场景的技能多重集」看起来是个可对齐、不需要人工评分键的口径。
量完之后这条路被否了，理由不是口径不好，是**它的上游还没就位**。

**先量的第一件事：基准的 `type` 自身不一致。** 3 条 `observation` 的 description 里写着 `侦查`
（`侦查或挪开床头柜`、`声明仔细检查路周围物品或者一个成功的侦查`、`侦查餐厅/宣言仔细检查餐桌`），
而另外 3 条同样是侦查的标成 `skill`。**所以别拿 `type` 计分**——那是拿一个自身有噪的标签计分。
技能名多重集不受这个影响。另有 1 处基准写 `话术` 而原文写「通过**社交**技能」，是手写替换，
抽不到——上限 18/19 不是 19/19。

**第二件：原文技能词比基准记录的多 2.8×**（54 处 vs 19 处，`tools/_diag-skillwords.ts`）。
超产的 33 处集中在七个「基准记 0」的场景，而它们记 0 不是遗漏——**那些技能属于别的结构**：
`农场外围` 那 12 处是陷阱区的 `幸运/侦查` 探查与捕兽夹的 `力量` 挣脱（→ `TrapMechanics`）；
`谷仓形建筑` 那 7 处是 `攀爬/跳跃/锁匠/力量` **进入方式**（→ `SceneConnection.checkRequired`）；
`农场主别墅` 的 `急救/闪避` 属硫酸陷阱。
**技能词好抽，难的是判断每一处属于哪个结构**——又是「六种东西里的哪一种」那个问题。

**第三件，决定性的：限定「已判为 `clue` 的条目」之后，超产 2.8× 变成产不足 0.6×**
（12 处 vs 19 处，`tools/_diag-skill-scoped.ts`）。精确率上去了，召回塌了，而塌在哪很说明问题：

| 场景 | 基准 | 只 clue | 塌陷原因 |
|---|---|---|---|
| 加比的拖车房 | 3（侦查×3） | 0 | 三个条目**就是**基准那三条线索，却被判成 `item` |
| 交火现场 | 2 | 0 | 同上 |
| 艾德里安的卧室 | 2 | 0 | 同上 |
| 与艾德里安的会面 | 2 | 0 | 被判成 `event` |
| 报亭 / 霍姆斯医院 / 警察局 | 4 | 0 | **一个 `▶` 都没有**，技能写在块正文里 |

前四行是**分类器的错误在往下传**——正是上面记的那个系统性误报（物品/线索边界）。
后一行是条目级抽取的硬天花板。

**结论（依赖顺序）：**

1. **先修物品/线索边界。** `findMethods` 的抽取质量被它上界，先做 findMethods 等于在错分类上
   建指标。而修它大概率不是改 prompt 文字——prompt 里已经拿 `床头柜` 当「这是线索」的范例，
   模型仍判成 item。
2. **findMethods 抽取必须能读块正文，不能只读条目**，否则 `报亭`/`霍姆斯医院`/`警察局`
   永远为 0。而读正文就要面对根因 B（同页续句归属）。
3. 计分用**技能名多重集**，不用 `type`；上限 18/19。

### `▶` 不是线索标记（2026-08-19）

上一轮把 39 个 `▶` 条目整批丢弃，理由写的是「属线索/物品，留给下一轮」。
这轮逐条对回基准，那句话说得太粗——`▶` 底下混着六种东西：

| `▶` 条目 | 在基准里其实是 |
|---|---|
| `捕兽夹` / `锯短霰弹枪拌锁陷阱` / `音响陷阱` / `硫酸陷阱` | `ModuleItem.trap` |
| `防盗门的钥匙` / `农场的照片` / `驾驶证` / `住宅钥匙` / `老旧文件` | `ModuleItem` |
| `侧面的防盗门` / `一旁的杂物堆` / `拉门` | `SceneConnection`——进入方式，不是线索 |
| 菲碧·特里坎名下 2 条 | `ModuleNPC.knowledge` 与 `.secrets` |
| 与艾德里安会面的 3 条 | 分支结局叙事 |
| `侦查休息区/宣言仔细检查床底` 等 | 才是 `Clue` |

**先做物品不做线索，是因为只有物品能按名字计分**：基准 10 个 `ModuleItem` 里 9 个的
`name` 能在 `▶` 名字里原样找到，缺的是 `黑色钱包`，所以**上限就是 9 不是 10**。
先前这里只写「PDF 里没有对应条目」，那句话对但没说出原因，而原因是可查的：
**原文把钱包的「内容」写成了条目，没写容器本身**——`交火现场` 全块只有两个 `▶`，
`▶驾驶证` 与 `▶住宅钥匙`，而基准 `clue_shootout_wallet` 的 description 正是
「翻看钱包可以获取：驾驶证…、住宅钥匙…」。全书 45 个行首 `▶` 里**没有任何一行是 `▶黑色钱包`**
（逐行核过，见下面 §评分键的覆盖分析 的表），所以它既不是被清洗吃掉的，也不是被判成了标题。
而 32 条线索的 `name` 是重写过的——`床头柜` → `日记本与老旧文件`，
`中控台的开关` → `中控台拉杆`——39 个条目里只有 2 个逐字命中。没有可对齐的名字就没有分数。

**三处结构性错位**，说明「一个 `▶` 对一条线索」根本不成立：`证物室` 有 3 个 `▶` 却 0 条线索
（三个全是物品，而名叫「证物室」的线索挂在 `警察局` 名下）；`维修间` 只有 1 个 `▶` 却有 4 条线索；
`报亭`、`霍姆斯医院`、`警察局` 一个 `▶` 都没有，它们的线索写在正文里。

**分类不是互斥的**：`老旧文件` 在基准里同时是 `ModuleItem old_document` 与
`Clue clue_bedroom_old_doc`。39 条里只此一例，所以本轮用单标签——但下一轮做线索时
**不能假设「已判为 item ⇒ 不是 clue」**，那种假设正是会静默丢东西的那一类。

**引用字段与内容分开算**：`ModuleItem.sceneId` 指向场景 id，生成侧是 `scene_NN`、
基准是手写意译，按名字配上后会全部报成 `changed`。这不是生成器不准，是
「id 是内部句柄」往下再走一层。`diffValues` 新增 `refFields`，这类差异单列成
`ref-mismatch`（实跑 9 处），不进 `changed`。
**注意它只拦对象的键**：`connections[].targetSceneId` 管得住，
而 `npcIds[]` 这种「引用本身就是数组元素」的形态管不住——那条路走 `walkArray`、
退回按下标比两个标量，键名在那儿不存在。做 NPC 那一轮要在数组侧另做一套。

### 实跑数（2026-08-19，`temperature: 0.1`，跑了 4 次）

**非确定性有了实证**：块分类的分布在两次跑之间变过——`npc 3 / rule 5` → `npc 2 / rule 6`，
一个块从 npc 挪到了 rule。判成场景数（27）与全部物品数字都没动，但这说明
**表里任何一个数都不能当回归基线直接比**，要比先把温度降到 0 并定方差。


| | 数 |
|---|---|
| 条目送分类 / 返回 | 37 / **37**（全文 39 个 `▶`，2 个在 npc 块上不进） |
| 条目分类分布 | item 15 / clue 11 / event 4 / trap 4 / connection 3 |
| 建成物品 | 19 个，`provenance` **9 条**（第一次有代码往 `Provenance[]` 里写东西。注意它**没有**放进被 diff 的那份 `ModuleData`——生成留痕不是模组内容，基准永远不会有，塞进去只会凭空多十几条 `extra`。它单独落 `provenance.json`） |
| 基准物品覆盖 | **9 / 10**（上限 9） |
| 精确率 | **9 / 19** |
| 误报 | 9 个，**全部是基准里的 `Clue`**，一个凭空的都没有 |
| 19 个怎么分的 | 9 真阳 + 9 误报 + **1 个重复**（`驾驶证`，PDF 里写了两次而基准只收一个）。这一项必须单列：第一次实跑正是因为把它算进真阳，报出了 `10/10`——比理论上限还好 |
| 差异总数 | 179 处（changed 26 / missing 96 / extra 22 / id 不一致 26 / 引用不一致 9） |

**误报是单一系统性失效：物品/线索边界**，集中在「容器家具 / 搜查动作」这类条目
（`枪械柜`、`床头柜`、`在一旁的冰箱与储物柜`、`侦查餐厅/宣言仔细检查餐桌`…）。
最要紧的一条诊断：**prompt 里拿 `床头柜` 当「这是线索」的范例，模型仍把 `床头柜` 判成了 item**。
这是不遵循指令，不是歧义——所以「再多写点说明」大概率修不好它，下一轮得换别的手段。

**独立复查发现的、不属于本轮但优先级更高的一条**（见下节）。

### 根因：条目正文丢后半截，是两个原因而不是一个（待修）

> **先纠正一个错诊断。** 这一节原先写的是「PDF 读取顺序把整行甩出了条目」。
> 逐层取证之后确认**读取顺序完全正确**，问题在别处，而且是**两个互不相干的原因**。
> 取证脚本留在 `tools/_diag-strand.ts`，产物 `tools/ingest-out/diag-strand.txt`，
> 它在 `extractPages` / `cleanPageText` / `sectionize` 三个边界上各打一份，重跑即可复现。

**根因 A —— `cleanPageText` 的作用域是单页，而句子会跨页。**

`证物室` 的 `▶防盗门的钥匙` 生成侧截断成「…这种先进防盗门可」，基准是「…这种先进防盗门可不多见。」。
取证显示：**第 6 页原始文本的最后一行就是那个 `▶` 行**，页面在「防盗门可」处结束，
「不多见。」是第 7 页的第一行。而 `raw.map(cleanPageText)` 是**逐页**调用的，
行连接只在页内做，页边界上的续行接不回来。随后 `sectionize` 逐页逐行走，
第 7 页首行既不是 `▶` 也不是标题，于是归 `bodyLines` —— 而 `cur` 还停在 `证物室`
（跨页接续是 `sectionize` 有意设计的，见其文件头）。

**根因 B —— `sectionize` 的条目只吃 `▶` 所在的那一行。**

第 9 页原始第 44 行是「…捕兽夹会造成额外的 1d3 伤害。」，以句号收尾，
`cleanPageText` 判为句子结束、不与下一行连接 —— **这是它的既定行为，不是 bug**。
第 45–46 行于是自己接成「如果伤害大于调查员耐久最大值的一半，则有截肢的风险。」。
原文作者在这个条目里写了**两句**，第二句成了独立行，而条目只取第一行，
所以条目正文天然缺后半截。同一形态还有 `▶锯短霰弹枪拌锁陷阱` 的
「并且因为枪管太短，射出的弹丸往往也无法全部命中。」。

**这才是 `maimAtHpRatio` 没抽到的真原因，不是抽取器弱。** 而且这个区别很要紧：
它不是「机制写在场景正文里」（那需要跨场景推理），而是「机制写在条目的第二句、
被切成了独立行」—— 只需把 `▶` 之后、下一个 `▶` 或标题之前的行并回该条目即可。

> **根因 A 已修（`joinPages`，见 `clean-text.ts`）。** 下面这一节保留是因为它记着 B 为什么不能用规则做，
> 以及那两个诊断脚本怎么用。A 修完的实测效果与一个意外发现记在本节末尾。

**修法：A 能用规则，B 不能。这一条是量出来的，不是估的。**

「条目吃到下一个 `▶`/标题为止」这条贪心规则复现了一遍（`tools/_diag-absorb.ts`，
产物 `tools/ingest-out/diag-absorb.txt`）：39 个条目里 19 个会吸收后续行，共 25 行，
**其中跨页 4 行、同页 21 行**。

| | 行数 | 性质 | 规则能否判 |
|---|---|---|---|
| 根因 A · 跨页续行 | **4** | 上一页末行没有终止标点，纯排版换行 | **能**——`cleanPageText` 页内已经在做这件事，只是看不到跨页 |
| 根因 B · 同页续句 | **21** | 约一半是条目续句，一半已回到场景叙述 | **不能** |

同页那 21 行里，是续句的有 `如果伤害大于调查员耐久最大值的一半，则有截肢的风险。`、
`并且因为枪管太短…`、硫酸陷阱的 `必须使用清水进行急救…清水清理后不会继续伤害`、
`SC1d3+1/1d6+1。`、`1911 手枪：故障值 90…`；已经回到场景叙述的有
`特里坎夫人还有一个小女儿，年仅 5 岁。`、`导航失败的情况，调查员可以寻求本地 NPC 的帮助`、
`继续在周边搜索的话，可以应用临时武器规则`、音响陷阱之后的
`如果调查员声明以一字队伍前进…通过陷阱区需要 3 次鉴定`、`前往通道，可以看到通向两个房间…`。

两边都有以「如果」开头的（`如果伤害大于…` 属条目，`如果调查员声明…` 属场景），
所以**连词/句式这类形态判据分不开它们**。这与「这一块是不是场景」（引文启发式 15/6/5）
和「这个 `▶` 是什么」是同一类问题——**归 LLM 那一层**。

> **一条被推翻的判据。** 这一节先前写过「B 更小、收益更直接，改完 `maimAtHpRatio` 与
> `firstAid` 两处应当消失」。量完发现两件事都不对：B 比 A 大（21 行 vs 4 行）且不能用规则做；
> 而那两处的出处**全在同页**，所以修 A 不会让它们消失。别照那句话去验收。

**下一轮的顺序建议**：先做 A——4 行、形态可判、收益确定（`item_12` 的
「…这种先进防盗门可」截断就在里面），且改动局限在页边界的续接判断上。
`shouldJoin(prev, next)` 这个判据 `clean-text.ts` 里已经有了，A 要的就是在页边界上再调它一次，
别重写一份。B 留到做线索那一轮一并处理：那时本来就要对条目正文调 LLM，
「这一行还属不属于上面那个条目」正好是同一次调用能顺带回答的判断。

#### A 修完之后（`joinPages`）

现在接 **5 处**页边界（p4→p5、p5→p6、p6→p7、p10→p11、p17→p18）。
**两个分母都要写出来**：其中 **4 处**的上一行是 `▶` 条目，`_diag-absorb` 报的「跨页 4 行」
数的就是这 4 处（它只管跟在 `▶` 后面的续行）；第 5 处（p17→p18）是附录里的普通正文，
`joinPages` 连普通正文的跨页也接。这不是矛盾，但只写小的那个分母会害人——
见下面那条实际发生的缺陷。

> **第一版接了 6 处，其中 1 处是错的（已修）。** 多出来的是 **p1→p2**：它把 p2 的首行
> `事件真相（想跑的人请不要继续往下看了。）：`——一个章节标签——焊到了 p1 末尾，
> 变成「…固话号码和一行联系地址....事件真相（想跑的人请不要继续往下看了。）：」。
> 两道该拦住它的闸门同时失效：`SENTENCE_END` 里有 Unicode 的 `…`(U+2026) 但没有 ASCII 的 `.`，
> 所以 p1 末行的 `....` 不算句末；`▶`/标签那道闸门确实认出了冒号，但它还要求
> `next.length <= 12`，而这个标签 21 字。
> **当初没查出来，有两个叠在一起的原因。** 一是验收只审了「碰到 `▶` 正文」的那 4 处——
> 照小分母去审，会正好在第 5、6 处上停下，而缺陷就在那里。
> 二是**这个缺陷不改变管线印出来的任何一个数**：实测（`tools/_diag-blocks.ts`，
> 把那一处错接手工补回去再逐项比）块数两边都是 **44**、标题集合完全相同、
> 39 个条目与 44 个块的 `sourceRef` **一行都没挪**。唯一的差别是
> `导入/车卡规则` 这一块的**正文里多了一个焊进来的章节标签**——
> 而正文正是喂给两个分类器的东西。没有任何计数会动，所以任何对数的验收都抓不到它。
> （先前这一段写的「带缺陷跑出来是 43 块」是推理出来的，量了之后不成立，已删。）
> 修法是在 `joinPages` 里加两条**只在页边界成立**的否决，`shouldJoin` 的页内语义一个字没动：
> 页顶的冒号收尾行一律不接（不看长度），上一页末行 ASCII 连续句点算句末。
> 为什么不并进共用的 `SENTENCE_END`：并进去之后逐字节比过全书 `cleanPageText` 输出，
> 变了 2 页 5 处——p15 四个结局标签不再被粘成一行（改好了），
> 但 p12 那段法语疯话被从句子中间劈开（改坏了，`...` 在那里是句内停顿）。
> 页内的 `...` 两种含义都有，页边界上（全书仅 p1 末行一处）只有句末那种。
> **p15 那 4 处是 `cleanPageText` 的一个独立潜在缺陷**（叙述被焊到 `Good End`/`Bad End`/`True End`
> 这些结构标签上，p15 的 6.0× 压缩比全书最高就是它），留给单独一轮 + 单独一份审计。

4 个条目的正文因此变完整，其中两处实质性：`防盗门的钥匙` 补回「不多见。」
（`item_12` 的截断症状消失）；`其他受害者的床位` 补回一整段，含 `极难的急救`、
`成功的力量` 这些真机制。

`捕兽夹` 仍然没有 `maimAtHpRatio`、硫酸陷阱仍然没有 `firstAid` —— **符合预期**，
那两处出自**同页**续句（根因 B），`joinPages` 只管跨页。

#### 一个意外发现：分类器的逐条输出不是独立的

改完之后精确率从 **9/17 变成 9/19**（多了 2 个误报：`受害者床位边上`、`中控台的开关`，
基准里都是 `Clue`）。而 `tools/_diag-joined.ts` 实测：**这两个条目的正文一个字都没变。**

我先据此判定「与 joinPages 无关，是采样漂」——**这个判断是错的**。
接着连跑 4 次，全部稳定在 9/19；而改之前两次都是 9/17。

真机制是：`buildItemPrompt` 把 37 个条目**塞进同一个 prompt**。
`joinPages` 改了 4 个条目的正文 → 整个 prompt 变了 → 模型对**其他**条目的判断跟着翻。

两条后果要记住：

1. **分类变化不能归因于正文发生变化的那个条目。** 想知道某处改动的影响，看整批分布，
   别看单条。
2. **拿一个文本处理改动去 A/B 一个批量分类器，本身是混淆的。** 要干净地测 `joinPages`
   的收益，得看条目正文的完整度（可确定性验证，如上面那 4 处），而不是看下游分类指标。

顺带修正一条更早的说法：同 prompt 下的采样方差**很小但不是零**——块分类的分布曾在两次跑之间
从 `npc 3 / rule 5` 变成 `npc 2 / rule 6`（挪了一个块）。物品那边 4 次跑完全一致。

### `sourceRef` 的行号不是 PDF 的行号（文档已订正）

查 A 的修法时顺手发现的，而且这条比 A 本身重要：**`sourceKey` 产出的 `p9:L13` 里，
页码是真的，行号是「清洗后」的索引。** `cleanPageText` 把栏宽硬换行接回去，
各页压缩 **1.8×–6.0×**，所以两者差得很远。

下表是**真管线**（`joinPages(raw.map(cleanPageText))`）量出来的：

| 条目 | `sourceRef` 写的 | 只 `cleanPageText` | PDF 实际 | 差 |
|---|---|---|---|---|
| `捕兽夹` | p9:L13 | p9:L13 | p9:L40 | 27 行 |
| `防盗门的钥匙` | **p6:L16** | p6:L17 | p6:L67 | **51 行** |
| `中控台的开关` | **p11:L9** | p11:L10 | p11:L58 | 49 行 |
| `硫酸陷阱` | p10:L4 | p10:L4 | p10:L12 | 8 行 |

> **中间那一列为什么单列。** `tools/_diag-lineno.ts` 起初只调 `cleanPageText`，不调 `joinPages`，
> 于是量出的是管线里并不存在的一组行号（本表先前写的 p6:L17 / p11:L10 就是它）。脚本已订正成与
> `_run-ingest.ts` 同一个组合。
>
> 这一行之差还纠正了一条写错的理由：先前 `joinPages` 的注释说条目的键不受影响，
> 因为「条目自身的位置不变（它在上一页）」。那只看了孤立的一处边界。
> **p5→p6 与 p6→p7 是连着的**：p6 既把首行捐给 p5，又收下 p7 的首行，
> 所以留在 p6 上的 `▶防盗门的钥匙` 也跟着从 L17 挪到 L16（`▶中控台的开关` 同理 L10→L9）。
> 结论仍然成立，但理由是另一条：`line` 每次跑都重新生成，而 `item_NN` 是按条目顺序编号的，
> 接续不改变条目之间的先后。**原来那个理由恰恰在 `tail` 指针专门为之而写的那种情形下最错。**

而 `Provenance.sourceRef` 的文档原本写的是「PDF 页号 + 页内行号」——
**照它去 PDF 第 6 页数到第 16 行，落点跟 `防盗门的钥匙` 差 51 行**。
`sourceRef` 存在的全部理由是能追回原文，而它追不回去。
`types.ts` 与 `sectionize.ts` 两处注释已订正（实测脚本 `tools/_diag-lineno.ts`）。

**它现在能干什么、不能干什么**：能唯一标识「这条改写来自哪一处」（同一清洗行不会有两个条目），
做不到「带你翻到 PDF 那一行」。要后者，得让 `cleanPageText` 把原始行号一路带出来——
它现在是丢掉的，而且改这个会动 `SourceRef` 的形状，进而动条目分类的键，是独立一轮的活。

四个陷阱与基准逐字段比，8 处分歧里：3 处基准对（`maimAtHpRatio` / `ongoing.until` / `firstAid`
——前两者是上面根因 B 直接造成的，`ongoing.until` 是生成侧从否定句「如果调查员没有摆脱硫酸」
里取了「摆脱」，成了循环定义），3 处生成物对（音响陷阱的 `sanCost`、硫酸陷阱的 `avoid: 闪避`、
以及正确地没编造 `immuneNarration`），2 处是尚未实现的线索交叉引用。
**其中 2 处「生成物更对」还被报告记成了 `extra`**——按既定立场，该改的是基准。

`maimAtHpRatio` 与 `firstAid` 这两处「基准对」，出处都在**同页续句**里（根因 B），
所以它们要等语义层，不是规则能捡回来的。上面那节量过：B 是 21 行、四成会误吃场景正文。

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

**全量 `expect()` 计数不能当回归信号，只有测试条数能**
- 实测：同为 1156 个测试的两次跑，`expect()` 总数是 9412 与 9410；1151 个测试那次是 9443。
  摆动幅度远超测试数变化能解释的范围。原因大概率就是上面那条无种子的随机测试
  （断言数随分支走向变化），但无论原因如何，结论一样：**比 `expect()` 数会被噪音骗到。**
- 代价要说清楚：**条数管不住「断言被就地改弱」**。把 `toEqual([...])` 改成 `toContain("2")`
  条数不变而测试变瞎，本仓已经因为这个吃过三次亏。
- 所以改断言的轮次必须额外做两件事：看**逐文件**的 `expect()` 增量（单文件是稳定的），
  以及对新断言做**变异检验**（把实现按发现描述的方式改坏，确认测试变红，再还原）。
  本轮那个 `llm-json` 的裸围栏用例就是这么抓出来的——它一开始是假绿的。

**环境陷阱（踩过）**
- 本仓源文件**不能过 PowerShell 写**（`Set-Content` 会把中文 mojibake）。读也一样，用 Read 工具。
- `bash` 工具的 `workdir` 参数会卡死，用 `cd C:\aitrpg\poc; ...`
- 精确分析写临时 `.ts` 用 bun 跑，并让脚本自己 `Bun.write` 落盘，不要经控制台
