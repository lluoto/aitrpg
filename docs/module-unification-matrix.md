# 谷仓模组统一类型迁移矩阵

步骤 5A-5E 于 2026-09-09 完成。谷仓唯一维护入口是
`src/module/barn-of-premier.ts` 的 `BARN_OF_PREMIER`；不再存在谷仓
`MythosModule` 适配对象、投影函数或冻结旧 loader fixture。

## 当前基线

| 对象 | 实测数量 | 唯一数据源 | 验收 |
|---|---:|---|---|
| 场景 / connections | 21 / 46 | `Scene.description/connections` | direct loader |
| NPC / narrative_noncombat | 14 / 3 | `ModuleNPC` / `.runtime` | GameSession |
| rich Clue | 32 | `Scene.clues` | SAN/unlocks/difficulty/matchTexts |
| trap 条目 / TrapMechanics | 4 / 3 | `ModuleData.items` | direct loader |
| EndNarration / display endings / legacyEndings | 5 / 5 / 5 | `END_NARRATIONS` + ModuleData | id 集合一致 |
| spells / tomes / rewards / hooks | 4 / 1 / 9 / 34 | `BARN_OF_PREMIER.runtime` | direct loader |
| scene BGM / aliases | 19 / 1 | `BARN_OF_PREMIER.runtime` | direct loader |

## 字段落点

| 原字段类别 | 保留位置 | 当前消费者 | 说明 |
|---|---|---|---|
| 场景描述与出口 | `Scene.description/connections` | `ModuleDataRuntimeLoader` | 删除 `loaderSceneDescriptions/loaderExits` |
| 丰富线索 | `Scene.clues` | `ModuleDataRuntimeLoader` | 删除 `clueBindings`；旧十条内容由 rich Clue 或 NPC knowledge/secrets 承载 |
| 运行 NPC | `ModuleNPC.runtime` | direct loader | 11 个 snapshot 由 `runtime-npc-attachment.ts` 在模块组装时附着 |
| identity、activation、difficulty、intro、spells、tomes、rewards、KP、hooks、BGM、aliases | `ModuleData.runtime` | direct loader / voice script / diagnostic probe | 无旧 Mythos 投影 |
| 展示型 legacy endings / item placements | `ModuleData.runtime` | direct loader / 结局 id 判据 | 保留，因为仍有统一 ModuleData 消费者 |

## 退役项

- 删除 `rules/custom-modules/premiers_barn.ts` 与 `MODULE_PREMIERS_BARN`。
- 删除 `unified-module.ts` 的旧投影/回投/派生路径及 loader snapshot fixture。
- 删除 `representation-consistency.ts` 的两份内容比对器。
- 删除 `loaderSceneDescriptions`、`loaderExits`、`clueBindings` 类型字段与谷仓数据。

`barn-unification-sentinel.test.ts` 取代跨表示内容比对：它用
`scanImports`/`findReverseImports` 检查旧适配不可复生、registry 直接导入
`BARN_OF_PREMIER`、三项过渡字段不回到类型/数据/direct loader，且谷仓路径
不导入旧适配。

## Legacy 边界

`MythosModule` 与 `MythosModuleLoader` 继续服务 `ARKHAM_LIBRARY_MODULE` 和
`INNSMOUTH_MODULE`。它们没有谷仓 adapter，也不共享谷仓运行数据；两条 legacy
GameSession 路径由独立测试覆盖。

## 步骤 5E 单一数据源哨兵

5E 不再删除数据或改变运行行为；它补强 `barn-unification-sentinel.test.ts` 的
已知符号、对象身份、过渡字段和谷仓 legacy-loader 边界，并记录其能力边界。
该哨兵能防止已知 wrapper/symbol/bridge 回流，不能识别改名后的语义重复、外部
仓库数据或运行时动态生成的重复表示。历史 fabrication guard 继续从统一
`BARN_OF_PREMIER.runtime` 核对四条已修复的 runtime NPC 事实。

将 Arkham/InnsMouth 迁成 `ModuleData` 或收敛 CLI、ScriptedSession 与通用 loader
是新的工作，不属于谷仓单一数据源完成条件。
