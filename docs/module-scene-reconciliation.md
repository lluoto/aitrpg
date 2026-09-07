# 场景图收敛裁决

开发·场景集合收敛 N12 步骤 5C，2026-09-07。

输入：`BARN_OF_PREMIER.scenes`（21 场景、46 连接）与迁移前冻结的
Mythos loader 图（19 descriptions、41 exits）。本文件是 direct
ModuleData loader 使用 Scene.description/Scene.connections 的裁决依据。

分类：A 相同；B ModuleData 更完整，采用 ModuleData；C legacy 独有但原文
支持，已迁入 ModuleData；D 语义冲突，必须停下询问。结论：D 为 0。

## 描述

| 场景 | 类别 | 裁决 |
|---|---|---|
| 特里坎家 | B | ModuleData 保留原文已有的拖车房括号解释（section_02:7-9）。 |
| 加比的拖车房、普瑞米尔、维森酒吧、霍姆斯医院、警察局、艾德里安的农场、农场主别墅、中控室 | A | 逐字相同。 |
| 报亭、农场外围 | B | legacy 没有描述；采用 ModuleData 场景描述。 |
| 与艾德里安的会面 | C | legacy 独有的喃喃自语是原文初见描写（section_04:58-64），已迁入 Scene.description；rich Clue 仍保留，提供后续检定/解锁。 |
| 证物室 | C | legacy 独有的物品清单来自原文（section_05:60-66），已迁入 Scene.description；rich Clue 仍保留门禁和揭示。 |
| 旅店 | C | 两边内容同义，ModuleData 的误插入引号已修为原文两段格式（section_06:14-27）。 |
| 交火现场、艾德里安在镇子内的住宅、谷仓形建筑、建筑内、艾德里安的卧室、下水道 | B | ModuleData 增补均来自原文的场景内物件/通道/声响描述（section_06、09-11），采用更完整版本。 |
| 维修间 | C | legacy 管道文本（section_12:25-35）与 ModuleData 脑罐文本（section_12:19-21）不冲突，均已并入 Scene.description；rich Clue 保留交互。 |

## 出口

共有 41 条共同目标边、5 条 ModuleData 独有边、0 条 legacy-only 边。

所有共同目标边采用 **B**：`SceneConnection.condition` 是源文本支持的玩家
可行动/门禁文案，直接 loader 将其写为 exits 的 `desc`；旧 `desc` 是较短的
展示别名，不再作为维护源。两者没有目标或事实冲突。

5 条 ModuleData 独有边采用 **B**，保留为有意行为改善：

| 来源场景 | 目标 | 原因 |
|---|---|---|
| 报亭 | 霍姆斯医院 | 报道指向医院，`根据报道前往霍姆斯医院`。 |
| 与艾德里安的会面 | 艾德里安的农场 | 认罪后告知农场位置。 |
| 警察局 | 艾德里安在镇子内的住宅 | 警方/地址线索可指向住宅。 |
| 艾德里安在镇子内的住宅 | 艾德里安的农场 | 转购协议与住宅线索指向农场。 |
| 维修间 | 下水道（第二条） | 奇怪管道仍是回到下水道的叙事出口；保留两条不同条件文本。 |

## 临时字段与退役条件

`runtime.loaderSceneDescriptions` 与 `runtime.loaderExits` 保留到 5C
行为快照、direct loader 与上述裁决全部稳定后。5C direct loader 不读取它们；
它们只供迁移前 fixture 对账。5D 在确认没有兼容消费者后删除，届时
`Scene.description/connections` 成为唯一场景图维护位置。
