# 谷仓模组统一类型迁移矩阵

开发·场景集合收敛 N12 步骤 5A，2026-09-07。

目标是让 `ModuleData` 能表达 `ModuleData` 与 `MythosModule` 的全部
现有字段，不切换任何加载路径、不删除 `BARN_OF_PREMIER` 或
`MODULE_PREMIERS_BARN`，也不迁移实际数据。最终统一类型仍是
`ModuleData`，以可选 `runtime` 分组承载运行时专属数据；这不是第三份
权威表示，而是未来步骤 5B 的数据迁移目标。

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
| `Scene.bgmHint` | 既有字段 | 直接保留；未来逐场映射 `sceneBgm` | 尚无 ModuleData 运行消费方 | `sceneBgm` 原 map 对账 |
| `sceneAliases` | `Scene.aliases?` + `runtime.sceneAliases` | 重命名；两份同时存在直到迁移 | `game-session.ts` | aliases map 对账 |
| `Clue.findMethods/unlocks/importance/matchTexts/failback/setStateVar` | 既有 `Clue` | 直接保留 | clue bridge / match / play | 32 条丰富 Clue 对账 |
| `TrapMechanics` | 既有 `ModuleItem.trap` | 直接保留 | `play-module.ts` / traps | 4 trap / 3 mechanics 对账 |
| `EndNarration.condition/priority` | 既有 `EndNarration` | 直接保留 | `evaluateEndNarration` | 5 条求值结局对账 |
| `epilogues/prologue/partySetup/narrative.entities` | 既有 `ModuleData` | 直接保留 | play module / narrative | 4 epilogue 等对账 |
| 叙事 NPC `entrance/knowledge/secrets/behaviors/llmExpanded` | 既有 `ModuleNPC` | 直接保留 | LLM / play / registry | 14 NPC 对账 |
| 战斗 NPC `type/hp/ac/attributes/skills/faction/gender/goals/dialogHints` | `ModuleNPC.runtime?` 的显式嵌套 | 需要重命名；不覆盖叙事字段 | loader / GameSession | 11 NPC runtime 对账 |
| `activation/difficulty/source/introNarration` | `ModuleData.runtime?` | 新运行配置字段；`introNarration` 不等于 `prologue` | loader / voice plan | runtime 投影对账 |
| `spells/tomes` | `ModuleData.runtime?` | 共享中立类型 | `MythosModuleLoader` | 4 / 1 对账 |
| `rewards` | `ModuleData.runtime?` | 共享中立类型；不能降级为 `Ending.sanReward/cmReward` | loader | 9 条含 reputation/skillGrowth 对账 |
| `kpNotes/initialEffects/hooks` | `ModuleData.runtime?` | hooks 与 `Scene.events` 语义冲突，分开保留 | loader / GameSession | map / array 对账 |
| Mythos `endings/clues/items` | `ModuleData.runtime?` 的 `legacy*` 字段 | 同名不同义，显式命名，不与丰富 `Ending/Clue/ModuleItem` 交叉 | loader | 5 / 10 / 10 对账 |
| `exits/sceneDescriptions` | 既有 `Scene.connections/description` 的未来迁移目标 | 形状冲突；5A 不转换实际数据 | loader / scene graph | runtime 原形对账 |

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

## 5A 范围

本轮只建立类型、投影和无损对账。明确不做：

- 删除 `BARN_OF_PREMIER` 或 `MODULE_PREMIERS_BARN`
- 切换 `GameSession` 或剧本杀加载器
- 迁移两份活跃数据到 `ModuleData.runtime`
- 删除 `representation-consistency.ts`
