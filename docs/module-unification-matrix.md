# 谷仓模组统一类型迁移矩阵

开发·场景集合收敛 N12 步骤 5A，2026-09-07。

目标是让 `ModuleData` 能表达 `ModuleData` 与 `MythosModule` 的全部
现有字段。步骤 5B 已将运行字段迁入 `BARN_OF_PREMIER.runtime`；最终
统一类型仍是 `ModuleData`，以可选 `runtime` 分组承载运行时专属数据。
`MODULE_PREMIERS_BARN` 保留原导出接口，但只是从该统一入口确定性派生，
不是第二份可维护数据，也不是第三份权威表示。加载器尚未切换。

## 基线

| 对象 | 实测数量 | 数据源 |
|---|---:|---|
| ModuleData 场景 / NPC / 丰富 Clue | 21 / 14 / 32 | `BARN_OF_PREMIER` |
| trap 条目 / `TrapMechanics` | 4 / 3 | `BARN_OF_PREMIER.items` |
| 可求值 `EndNarration` / epilogue | 5 / 4 | `END_NARRATIONS` / ModuleData |
| Mythos NPC / spells / tomes | 11 / 4 / 1 | `MODULE_PREMIERS_BARN` |
| Mythos rewards / KP notes / hooks | 9 / 8 / 34 | `MODULE_PREMIERS_BARN` |
| Mythos sceneBgm / sceneAliases | 19 / 1 | `MODULE_PREMIERS_BARN` |

任务提示写「4 个 TrapMechanics」不准确：四个 `type: "trap"` 条目中，
`trap_sound` 是原文明确已失效的纯叙事陷阱，刻意没有 `trap` 结构；真正
带 `TrapMechanics` 的是捕兽夹、霰弹枪、硫酸三项。无损对账必须同时钉住
4 个 trap 条目和 3 个 `TrapMechanics`，不能把两种计数混成一个。

## 统一落点

| 字段来源 | 统一落点 | 处理 | 当前消费方 | 验收 |
|---|---|---|---|---|
| `Scene` / `connections` / 门禁 | 既有 `ModuleData.scenes` | 直接保留 | `play/scene-pipeline.ts`、摄取 | narrative 投影逐字段对账 |
| `Scene.bgmHint` | 既有字段 | 直接保留；旧 loader map 暂存 `runtime.sceneBgm` | 尚无 ModuleData 运行消费方 | 冻结 loader BGM 对账 |
| `sceneAliases` | `runtime.sceneAliases` | 单一维护位置；`Scene.aliases?` 仅是未来逐场语义落点，未双填 | `game-session.ts` | aliases map 对账 |
| `Clue.findMethods/unlocks/importance/matchTexts/failback/setStateVar` | 既有 `Clue` | 直接保留 | clue bridge / match / play | 32 条丰富 Clue 对账 |
| `TrapMechanics` | 既有 `ModuleItem.trap` | 直接保留 | `play-module.ts` / traps | 4 trap / 3 mechanics 对账 |
| `EndNarration.condition/priority` | 既有 `EndNarration` | 直接保留 | `evaluateEndNarration` | 5 条求值结局对账 |
| `epilogues/prologue/partySetup/narrative.entities` | 既有 `ModuleData` | 直接保留 | play module / narrative | 4 epilogue 等对账 |
| 叙事 NPC `entrance/knowledge/secrets/behaviors/llmExpanded` | 既有 `ModuleNPC` | 直接保留 | LLM / play / registry | 14 NPC 对账 |
| 战斗 NPC `type/hp/ac/attributes/skills/faction/gender/goals/dialogHints` | `ModuleNPC.runtime?` 的显式嵌套 | 需要重命名；不覆盖叙事字段 | loader / GameSession | 11 NPC runtime 对账 |
| `activation/difficulty/source/introNarration` | `ModuleData.runtime?` | 已迁入；`introNarration` 不等于 `prologue` | loader / voice plan | raw input 投影对账 |
| `spells/tomes` | `ModuleData.runtime?` | 已迁入，共享中立类型 | `MythosModuleLoader` | 4 / 1 对账 |
| `rewards` | `ModuleData.runtime?` | 已迁入；不降级 `reputation/skillGrowth` | loader | 9 条奖励对账/漏赋值变异 |
| `kpNotes/initialEffects/hooks` | `ModuleData.runtime?` | 已迁入；hooks 与 `Scene.events` 分开 | loader / GameSession | map / array 对账 |
| Mythos `endings/clues/items` | `ModuleData.runtime?` 的 `legacy*` 字段 | 已迁入，显式命名，不与丰富对象交叉 | loader | 5 / 10 / 10 对账 |
| `exits/sceneDescriptions` | `runtime.loaderExits/loaderSceneDescriptions` 过渡字段 | 已迁入，保留旧 loader 精确输入；最终语义落点仍是 `Scene.connections/description` | loader / scene graph | 冻结 loader 场景/出口对账 |

## 同名不同义

`ModuleNPC`、`ModuleItem`、`Ending`、`Clue` 在两侧名字重叠但不是可
直接交叉的同一个结构。5A 用 `RuntimeNpcConfig`、`RuntimeItemPlacement`、
`RuntimeModuleEnding`、`RuntimeClueBinding` 显式区分运行时数据，禁止
`any`、强制断言或交叉类型伪装成已经合并。

`hooks` 不是 `Scene.events`：前者的 `condition` 可指向场景、典籍、线索，
且可在战斗开始/读典籍/调查时触发；后者是本地场景事件。名字相近，触发域
不同，保留为 `runtime.hooks`。

`introNarration` 不是 `prologue`：前者是 loader 导入时单段 KP 旁白；后者
是剧本杀路径按调查员模板渲染的多行开场。二者并存，不能覆盖。

Mythos 可选字段值为 `undefined` 时，“对象上是否有这个 own property”不作为
兼容契约：旧 loader 全部通过可选读取消费，JSON 持久化也不会保存 undefined。
兼容契约是定义字段的值、数组顺序和冻结 loader 输出；这些均逐字段对账。

## 5A 范围

步骤 5B 已迁入运行数据并改写旧导出为薄适配。明确仍不做：

- 删除 `BARN_OF_PREMIER` 或 `MODULE_PREMIERS_BARN`
- 切换 `GameSession` 或剧本杀加载器
- 切换 `GameSession` 或剧本杀 loader 读取 `ModuleData.runtime`
- 删除 `representation-consistency.ts`

## 步骤 5B 单一维护入口

唯一维护入口是 `src/module/barn-of-premier.ts` 的
`BARN_OF_PREMIER`，其中 `runtime: BARN_RUNTIME` 保存原 Mythos 运行字段，
`NPC_STATS` 原样挂入 `runtime.npcStats`（保留 `"?"`、`"无"`、`"+1d4"`
等特殊值），11 个运行 NPC snapshot 则嵌入对应叙事 NPC 的 `runtime`。

旧路径 `src/rules/custom-modules/premiers_barn.ts` 只做
`deriveMythosModule(BARN_OF_PREMIER)` 并保留 `MODULE_PREMIERS_BARN` 与
`MODULE_REGISTRY` 导出接口。它不再有独立数据正文，也不会被统一来源反向
import。迁移前 loader 输出被冻结在
`src/__tests__/fixtures/premiers-barn-loader-snapshot.json`，适配测试独立
比较场景/出口、NPC/人格、线索、法术、典籍物品、奖励、KP notes、hooks 与
导入消息。

## 探针纪律

“5A 尚未切换加载路径”不是 grep 字符串结论。`unified-module.test.ts`
对 `game-session.ts`、`play-module.ts`、`index.ts`、`scripted-session.ts`
用 `diagnostics/source-scan.ts` 的 `scanImports` + `importPointsTo` 解析
运行时 import，断言没有一个入口指向 `unified-module`。解析器或读取失败
会让测试失败；探针不会在命令失败后继续打印“0 个引用”的成功摘要。

## 步骤 5C 直接加载

`src/module/module-data-runtime-loader.ts` 直接消费 `ModuleData` 和
`ModuleData.runtime`，不 import `unified-module` 或 `mythos-module`。
custom registry 的谷仓条目返回 `BARN_OF_PREMIER`；GameSession 对谷仓走
direct loader，对 Arkham/InnsMouth 保留明确 MythosModule legacy 分支。

**等价迁移**：11 个 runtime NPC、spells/tomes/item placements/rewards/
KP notes/hooks/BGM/aliases、intro narration 均保持旧 loader 输入或输出；
冻结 fixture 持续对账旧接口。10 个 legacy clueBindings 只保留迁移对账，
已退出生产注册：clue_2..9 由 rich Clue 承载，clue_0/1 由菲碧的
knowledge/secrets 承载。可匹配 id 不变；特里坎家从误导性的“仔细搜查”
恢复为“环顾四周”是有意修复。

**有意行为修复**：direct loader 采用 21 个 ModuleData Scene 与 46 条
connections（比 legacy 多 2 descriptions/5 edges），加载 32 条 rich Clue
及其 findMethods/matchTexts/difficulty/unlocks/revelation/SAN，加载 4 trap
条目/3 个 TrapMechanics，并激活前台、报亭老板、医护人员三个
`narrative_noncombat` NPC。具体场景裁决见 `docs/module-scene-reconciliation.md`。

**5D 删除条件**：`MODULE_PREMIERS_BARN`/`deriveMythosModule` 当前仍有 11 个
兼容消费方（审计、旧适配 fixture、结局/白名单测试、语音脚本与 registry）。
这些消费方全部改读 ModuleData/direct loader 后，方可删除适配导出、冻结旧
Mythos fixture 和 `loaderSceneDescriptions/loaderExits` 过渡字段；届时再退役
`representation-consistency.ts`。`MythosModuleLoader` 仍服务另外两个模组，
不在 5D 删除范围。
