# 内容开发任务书

> 给接手**内容开发**的模型看的。工程纪律看 `docs/handoff.md`，状态看 `docs/now.md`。
> 这一份只讲：**这个引擎实际支持什么，你写的东西才会真的发生。**

---

## 一、这是什么项目

`C:\aitrpg\poc` —— CoC 7e（克苏鲁的呼唤第七版）跑团引擎。
「模组数据 + 规则引擎 + LLM 叙事」跑完一局《普瑞米尔的谷仓》。

**三条并行的局面驱动是有意为之，不是重复实现：**

| 入口 | 文件 | 用途 |
|---|---|---|
| 剧本杀（自动跑完整局） | `src/play-module.ts` → `src/play/*` | 主力，判据都跑它 |
| 自由跑团（服务器/网页） | `src/api/game-session.ts` | 玩家逐条输入 |
| 命令行 | `src/index.ts` | 手动调试 |

⚠ **这三条路的行为不一致，而且是反复出问题的地方。** 已经修过六处
「同一件事两个入口两种做法」。你写内容时默认按**剧本杀那条**（`play/*`）来想，
因为模组数据主要由它消费。

## 二、你的活儿和我的活儿

- **你**：写内容 —— 场景、线索、NPC、对话、结局、氛围文本。
- **我**：审查 —— 主要盯三件事，见第六节。

---

## 三、内容长什么样

模组是**一个 TypeScript 文件导出的数据结构**，不是 JSON、不是 YAML。
样板：`src/module/barn-of-premier.ts`（1525 行，20 个场景，32 条线索）。
类型定义：`src/module/types.ts`（580 行）。

```
ModuleData    id, title, version, ruleset, era, summary, scenes, npcs, meta,
              endings, items, prologue?, partySetup?, epilogues?, narrative?
Scene         id, name, description, clues, npcIds, connections,
              order?, visibleEntities?, skillChecks?, events?, atmosphere?,
              openingAtmosphere?, isHome?, stateVars?, bgmHint?, imageHint?
Clue          id, name, description, findMethods, revelation, unlocks,
              found, importance, hint?, failback?, setStateVar?
FindMethod    type: "skill"|"observation"|"npc_dialogue"|"item"|"automatic"
              skillName?, difficulty?: "regular"|"hard"|"extreme", description
SceneConnection  targetSceneId, condition, requiredClueId?, checkRequired?
Ending        id, name, description, conditions, sanReward?, cmReward?
ModuleNPC     id, name, role, description, personality, knowledge, secrets,
              sceneId, entrance?, age?, behaviors?, llmExpanded?
```

### findMethods 的真实语义（**量出来的，不是文档说的**）

| type | 引擎实际怎么处理 |
|---|---|
| `skill` | 掷 `skillName` 的检定，按 `difficulty` 定阈值。**这是唯一会掷骰的一种** |
| `observation` / `item` / `automatic` | 被动：技能路径失败到阈值后作为兜底揭示 |
| `npc_dialogue` | **场景里遇到任一 NPC 就白送**——不检定，也不指定是哪个 NPC |

⚠ 两条实测出来的坑：

1. **`npc_dialogue` 不是「要跟人谈才给」**，是「进场碰到人就给」。
   想让线索有门槛，用 `skill`。
2. `src/play/clue-check.ts` 的被动兜底集合是 `["observation","automatic","item"]`，
   **不含 `npc_dialogue`**。所以只写 `npc_dialogue` 的线索完全依赖上面那条白送路径。
   模组现在有 2 条 core 线索是这个情况（`clue_adrian_farm_location`、
   `clue_police_missing_cases`）——能跑通，但不是靠检定跑通的。

### 技能名怎么写

用中文技能名，引擎按 `SKILL_NAME_MAP` 翻成内部键。**56 项技能表**在
`src/character/coc-character.ts`。已验证可用的例子：

```
侦查 → spot_hidden      聆听 → listen        图书馆使用 → library_use
说服 → persuade         取悦 → charm         恐吓 → intimidate
话术 → fast_talk        急救 → first_aid     精神分析 → psychoanalysis
医学 → medicine         潜行 → stealth       母语 → language_own
```

属性也能当检定目标（力量/幸运/敏捷…），走 `ATTRIBUTE_NAME_MAP`。

---

## 四、**引擎实际支持什么** ← 这一节最重要

写内容前对照这张表。写了不支持的东西，**不会报错，只会安静地什么都不发生**。

### 能用（本轮逐条实跑验证过）

- **技能检定**：三档难度，阈值会印给玩家（`49% 困难→24 → d100=92 → 失败`）
- **线索 failback**：连续失败 N 次后强制揭示（关键线索不会卡死）
- **SAN 全套**：检定、损失、临时疯狂（单次 ≥5）、不定疯狂（累计 20%）、
  疯狂表、恐惧症/狂躁症、角色卡显示、`疯狂指引` 给本人实际情况
- **神话生物目击 SAN**：按 `src/combat/coc-npc.yaml` 里每种生物的 `san_cost`，
  首次目击掷一次（修格斯 `1d6/1d20`、深潜者 `0/1d6`…）
- **战斗**：双向。玩家攻击 + 敌人还手；重伤判定、命中部位、流血、昏迷、致残描写
- **限时状态**：流血/中毒/燃烧每回合推进并到期（流血每回合 1 HP）
- **模组难度画像**：easy/medium/hard/nightmare → 惩罚骰 + SAN 倍率（0.5/1/1.5/2）
- **陷阱**（`play/traps.ts`）、**追逐**、**场景连接与出口**、**结局判定**
- **NPC 人格与对话**：性格、知识、秘密、首见/回访分支

### 不能用（实测够不着，写了也白写）

| 系统 | 实际状态 |
|---|---|
| **商店 / 购买 / 出售** | 没有商店。**钱不是数字** —— `"$50现金"` 是背包里的一个字符串 |
| **同伴** | `CompanionManager.recruit()` 生产代码零调用方，招不到人；就算有也不行动 |
| **弹药** | 只在命令行那条路记，服务器/网页端一格不记 |
| **经济/派系/金融/贸易/政策** | 整套没接线 |
| **NPC 技能字段** | `entities` 表没有 `skills` 列，模组传了也会在落库时被丢弃 |
| **疯狂的惩罚骰** | 疯狂指引里写着「获得 1 个惩罚骰」，**引擎没有任何地方施加它** |

⚠ 所以：**别写需要花钱的关卡、别写靠同伴才能过的桥段、别给 NPC 配技能值。**
模组现在把这些都处理得很好 —— 每一处「要钱」的地方（酒吧前台的 10$ 小费、
流浪汉「只认钱」）在结构化的 `findMethods` 里都同时给了技能路径，
钱只写在散文描述里当 KP 的备选。**照这个写法。**

---

## 五、内容本身的规矩

1. **每条 core 线索必须有可达路径**，最好带 `failback`。
   已经有判据在守「必定通关」这件事，但它只认结构。
2. **别在标题里许诺数量**（「所有 8 个生物」实际 40 个 —— 这条栽过，
   已经编成判据第 ④ 条）。
3. **年代约束**：模组设定在 1921 年。`ConstraintEngine` 会过滤时代错误的物品
   （`src/rules/coc-cr.ts` 的 `worldModelItemFilter`）。别写手机、别写抗生素。
4. **NPC 台词别写死一句**。`templateRevisitEncounter` 就是按性格各写死一句，
   结果玩家来回进同一个场景听到一字不差的重复 —— 这是本轮修过的真问题。
   要么给池子，要么让它跟进展走。
5. **文案与机制必须对得上**。「每回合失去 1 HP」这句话印出去了，实现就得是 1 点。
   本轮修过两处这类偏差（流血按 10% 扣、疯狂惩罚骰没施加）。
   **你写的每一句机制描述，我都会去对实现。**

---

## 六、我审查时会盯什么

1. **写的东西会不会真的发生。** 对照第四节那张表。
   我会实跑一局读播报，而不是只看代码。
2. **文案与实现对不对得上。** 你写「掷困难侦查」，我去看它是不是真掷了、
   阈值印出来对不对。
3. **有没有把「没做」说成别的。** 桩可以「没做」，
   但不能报告一件没发生的事（本轮修过三处这类：出售从不查背包就说你没有、
   装填谎报弹药补满、购买把没做说成缺货）。

---

## 七、开工前

```bash
bun scripts/preflight.ts        # 确认接手时是干净的（11 项，含断线判据）
bun test                        # 当前基线见 docs/test-baseline.json
bun scripts/docs-index.ts todo warn   # 动手前要扫的坑
```

改完模组数据后**至少跑一次实局**读播报 —— 类型对不等于内容对。

⚠ 环境：Windows PowerShell 5.1，源码 UTF-8 无 BOM。
读中文**别用 `Get-Content`/`Select-String`**（会 mojibake），
用 Read 工具或 `fs.readFileSync(..., "utf8")`。
`bun -e` 里带正则或中文极易被 PowerShell 吃掉转义 —— 写临时 `.ts` 文件再跑。
