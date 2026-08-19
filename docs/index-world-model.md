# 内容索引 — 世界模型与模组

> 用途：世界模型这一侧可能由多个 agent 分别推进，这份索引是共同的地图。
> 姊妹篇是 `docs/index-program.md`（引擎与程序）。
>
> 建立方式：逐文件读取头部注释归纳 + 全盘清查 `C:\aitrpg`，2026-08-19。
> **本文件的路径跨出 git 仓库**：`poc/` 开头的在仓库内，其余相对 `C:\aitrpg\`。
>
> **维护约定**：新增素材请顺手补一行，并标明「已接入 / 未接入」。
> 「未接入」那一节是这份索引最有价值的部分，不要让它烂掉。

## 一句话现状

素材远多于接进去的。模组的**真正源头是 PDF**，但从 PDF 到运行模组这一步**从来没有程序做过**——现有模组数据是人/LLM 手写的产物。上层目录另有约 120KB 成套的规则原材料一行未接。

---

## 三层结构（务必分清）

这三者名字都带「模组」或「神话」，职责完全不同：

| 层 | 文件 | 职责 |
|---|---|---|
| **原著世界模型** | `poc/src/rules/mythos-expansion.ts`（1603 行） | 洛夫克拉夫特原著内容（公共领域）：神话生物/典籍/法术/场景模板。**跨模组可复用**，与具体模组无关 |
| **摄取目标（中间表示）** | `poc/src/module/types.ts` 的 `ModuleData` | 文件头原文：「用于将原始模组 PDF 文本解析为结构化数据」。**这就是读取模块该产出的类型** |
| **运行期导入容器** | `poc/src/rules/mythos-module.ts` 的 `MythosModule` | 「剧本杀式模组导入系统」：activation 条件、loader、hooks、initialEffects。是消费者，不是世界模型 |

目标架构：

```
PDF ──[读取模块 + LLM + 世界模型约束]──> ModuleData（权威源）
              ↑                              │
      mythos-expansion                       ├──> 剧本引擎 play-module.ts
      （构建时引用）                          └──投影──> MythosModule ──> game-session.ts
              │
        留痕 Provenance（原文/结果/理由）
```

`MythosModule` 应当是**生成物**，不再手写。`mythos-expansion` 是共享库，读取模块构建时**引用**它（米戈的属性块该来自 `MYTHOS_CREATURES`，而不是模组里再抄一份）。

## ⚠ 同一模组存在三份表述

| 文件 | 类型 | 谁在用 |
|---|---|---|
| `poc/src/module/barn-of-premier.ts`（79KB，手写） | `ModuleData` | `play-module.ts`（剧本引擎） |
| `poc/src/rules/custom-modules/premiers_barn.ts`（51KB，**生成物**，中文场景 ID） | `MythosModule` | `game-session.ts`、`gen-speech.ts` |
| `poc/src/rules/mythos-module.ts:918` 内联的 `PREMIERS_BARN_MODULE`（简版，ASCII 场景 ID） | `MythosModule` | `game-session.ts` 按显示名二选一 |

三者 `id` 都是 `premiers_barn`。`mythos-module.ts:931` 的注释自己承认这是同一模组的两套 ID 映射。**收敛前不要在任何一份上继续加内容。**

---

## 模组内容（仓库内）

| 路径 | 职责 | 状态 |
|---|---|---|
| poc/src/module/types.ts | 模组类型契约（523 行，23 个 interface）：ModuleData / Scene / Clue / ModuleItem / TrapMechanics / Provenance / ModuleSupport / ModuleState | 已接入 |
| poc/src/module/barn-of-premier.ts | 《普瑞米尔的谷仓》ver1.03 结构化数据本体（1500 行） | 已接入 |
| poc/src/module/threat-analyzer.ts | 从模组反推难度并据此发枪：敌对 NPC 数、最大伤害、陷阱数、困难/极限检定数、最大 SAN 损失、有无 Boss | 已接入 |
| poc/src/rules/custom-modules/premiers_barn.ts | 同模组的 MythosModule 版，2026-07-06 由 extract-module.ts 自动提取 | 已接入（另一条路径） |
| poc/src/rules/custom-modules/index.ts | 社区模组注册表与查询入口 | 已接入 |
| poc/src/rules/mythos-module.ts | MythosModule 类型契约 + 导入器 + 三个内联模组（印斯茅斯 / 阿卡姆图书馆 / 谷仓简版） | 已接入 |
| poc/src/rules/mythos-expansion.ts | 原著世界内容数据库：MYTHOS_CREATURES / TOMES / SPELLS / LOCATIONS | **仅 LLM prompt 层引用；剧本引擎零引用** |

## 世界模型运行时（仓库内）

| 路径 | 职责 |
|---|---|
| poc/src/world/world-model-loader.ts | v18 语料加载器（383K 条 / 73 部小说，v15+v16+v17 合并）：按小说/类型/关键词多重索引，带幻觉风险标记与共享单例 |
| poc/src/world/world-model-integrator.ts | 把语料按场景/行为/因果注入运行时，产出在场 NPC 人设卡，防 LLM 臆造事实 |
| poc/src/world/world-constraint.ts | 约束引擎：四级优先级下对物品与对话文本做 block/replace/allow_with_cost/redirect |
| poc/src/world/module-loader.ts | 把 ModuleData 的场景/NPC/物品灌进 SQLite（`populateWorldFromModule`） |
| poc/src/world/state.ts | 内存态模组进度追踪（当前场景、已发现线索、NPC 状态、剧情状态变量） |
| poc/src/investigation/investigation-engine.ts + poc/src/rules/investigation.yaml | 复合线索系统：一条线索多技能入口，各给不同信息层 |

### 约束层的实际覆盖面（重要）

`DEFAULT_CONSTRAINTS` 目前**只有两个域**：

1. **时代错置** —— 1920s 设定下拦手机/电脑/互联网/扫码，以及"打他电话"（联系失效是模组戏剧核心）
2. **对话 meta 词汇** —— 场景/关卡、线索/任务/道具、调查员/KP/跑团/存档、NPC/PC

框架本身支持 `matchItem` / `matchText` / `matchPredicate` 三种匹配与四种处置，也支持模组 override，**但没有身体状态、行动力、物理后果任何一个域**。

`DESIGN-LOG.md §1` 声明的优先级是：

> 模组特殊规则 > 当前场景与已确认世界事实 > CoC通用规则 > LLM的一般常识

陷阱结算此前一路穿透到最底层，正是因为上面三层对物理后果**都是空的**。`TrapMechanics` 是「模组特殊规则」这一层第一次有内容。

---

## 模组原材料（仓库外）

| 路径 | 内容 | 状态 |
|---|---|---|
| `MikuFan-普瑞米尔的谷仓/普瑞米尔的谷仓 ver1.03.pdf` | **4.36MB，真正的源头** | 未被任何程序读取 |
| `MikuFan-普瑞米尔的谷仓/附件/B照片 (1)~(6).png` | 6 张模组配图，共 2.2MB | **完全未使用** |
| `MikuFan-普瑞米尔的谷仓.zip`（根目录） | 与上面解压目录重复 | 冗余，可删 |
| `poc/tools/modules/raw/` | 原文按章节切分，19 个 txt | **唯一一份**（`src/module/raw/` 的重复副本已于 2026-08-19 删除） |
| `poc/tools/modules/structured/` | 从旧 .ts 反向拆出的 15 个字段 txt | 是派生物，不是来源 |

**注意方向**：`tools/split-modules.mjs` 的输入是 `premiers_barn_raw.txt` **和已经写好的 .ts**，输出到 `tools/modules/`。也就是说 `structured/*.txt` 是**从 TS 反向拆出来的**，不是生成 TS 的来源。`premiers_barn_raw.txt` 目前**已不存在**，摄取需从 PDF 重跑。

### 摄取相关脚本（均在 `poc/tools/`，整个目录被 .gitignore 排除）

| 脚本 | 作用 | 状态 |
|---|---|---|
| split-modules.mjs | raw.txt → 18 章节 txt；.ts → 15 字段 txt | 输入文件已缺失 |
| calibrate.mjs | 原文 vs 结构化数据逐项比对，出报告 | 指向旧 .ts |
| verify-module.mjs | 文本扫描式 CI 校验，返回 0/1 | 指向旧 .ts |
| extract-hooks.mjs | **唯一会生成 TS 代码的脚本**，但只生成 `hooks:` 一个字段，输出到 generated-hooks.txt 等人工回贴，约 1/5 条目是"(原始文本中无对应段落)"占位 | 半成品 |

> `poc/src/module/extract-tools/` 曾有这批脚本的第二份副本，且因 `BASE = resolve(__dirname, "..")` 在搬家后失效（解析成不存在的 `src/module/src/rules/...`）整体不可运行，已于 2026-08-19 删除。`src/module/` 现在只剩三个 .ts。

**结论：不存在从原文端到端产出完整模组 .ts 的自动化路径。** 15 个字段里 14 个靠手工维护。

---

## 未接入的规则原材料 ⚠

`C:\aitrpg` 根目录有 11 份成套 yaml，与 `poc/src/rules/` 的三份 **md5 无一匹配**，但内容同源——是同一设计的不同版本或从未移植的部分。

| 文件 | 大小 | 内容 | poc |
|---|---|---|---|
| `forensic_rules.yaml` | **76.2KB** | 尸检与世界物理规则，跨世界观通用，声明不含版权内容 | **未接入** |
| `mythos_rules.yaml` | **40.5KB** | 克苏鲁神话规则，从 Lovecraft 1920–1937 原著推导，非 Chaosium | **未接入** |
| `investigation_system.yaml` | 23.3KB | 复合线索系统完整版 | poc 有**裁剪版** |
| `miskatonic_professors.yaml` | 12.4KB | 密大教授数值化，据原著行为推导 | 未接入 |
| `miskatonic_reference.yaml` | 9.3KB | 密大设定参考，描述均来自原著 | 未接入 |
| `mythos_taxonomy.yaml` | 8.8KB | 神话实体分类体系 | 未接入 |
| `dnd_rules.yaml` | 8.3KB | D&D 5e SRD 施法规则 | poc 有**另一版** |
| `cr_replacement.yaml` | 5.5KB | CR 替换助手：按队伍等级推荐怪物替换 | 未接入 |
| `module_integration.yaml` | 4.5KB | 模组接入系统设计 | 未接入 |
| `narrative_style.yaml` | 3.6KB | **Lovecraft 叙事风格特征库，7 篇原著提取** | **未接入** |
| `pigeon_takeover.yaml` | 2.9KB | 鸽子接管系统（玩家缺席时的处理） | 未接入 |

**其中三份直接对应当前正在做的事**：

- `narrative_style.yaml` —— 我们一直在手工修「叙事像不像人话」，而这份从原著提取的风格特征库一行没接
- `mythos_rules.yaml`（40KB）+ `forensic_rules.yaml`（76KB）—— 正是「世界模型常理约束」缺的那层内容。约束引擎现在只有时代错置和 meta 词汇两个文本域，身体状态/物理后果全空

其他原材料：`COC七版规则空白卡CY20.06.1.xlsx`、`论萌新跑团的正确姿势1.1.pdf`(+ .txt)、`骰子姬食用一览.txt`。`test.jsonl` 内容是 `{"a":1}` `{"b":2}`，纯占位。

---

## 世界模型语料工程（`世界模型/`，98,269 文件 / 1.5GB）

一个独立的、未收尾的语料工程。**当前与 poc 的唯一接口是一个文件**：

| 文件 | 大小 | 说明 |
|---|---|---|
| `世界模型/v18_output/v18_all_master.jsonl` | 229.3MB | **唯一一份**。`DEFAULT_V18_PATH` 默认就指向它（`../世界模型/v18_output/...`） |
| `世界模型/cthulhu_extracted/cthulhu_world_model.jsonl` | 67.7KB | 同上，`DEFAULT_CTHULHU_PATH` |

`poc/assets/` 的两份副本已于 2026-08-19 删除（md5 校验与原件完全一致）。它只服务于 Docker
（`COPY assets/` + `ENV WORLD_MODEL_PATH=/app/assets/...`）。**要构建镜像时按 Dockerfile 第 5–8 行重建**：

```
cp ../世界模型/v18_output/v18_all_master.jsonl assets/
cp ../世界模型/cthulhu_extracted/cthulhu_world_model.jsonl assets/
```

开发期不需要——运行时默认读仓库外的原件。

构成：
- **语料原材料**：顶层 79 个 .txt 小说（435.9MB）+ 5 个 .epub + 73 个 `chapters_*` 章节切分目录
- **克苏鲁子集**：`cthulhu_raw/`(7)、`chapters_cthulhu/`(302)、`cthulhu_extracted/`(9)、`extract_cthulhu.mjs`、`split_cthulhu.mjs`、`cthulhu_extract_rules.md`
- **产物**：`v18_output/`、`v14_output/`、`output/`、`flop_output/`、`results/`、`relics/`(291)
- **校验**：`verification_work/`(8121)、`verification_pipeline/`(3228)、`verification_report.md`、`tests/test_strong_entities_validator.py`、`scripts/strong_entities_*.py`
- **D&D 职业体系设计**（与 poc 的 qiankun 是不同材料，不必合并）：`races_md/`(107)、`德鲁伊能力体系.md`、`战士能力体系.md`、`圣名体系.md`、`法师多维融合与DND对接设计.md`、`data/races*.json`、`data/holy_names.json`
- **独立生成实验**：`deepgen_trpg_generator.py` + 8 个 `test_*.py`（hf/vlm/minimal 等），与主线无关

### 重复与占位（清理线索）

- **合并脚本 5 个版本**：`merge_v11.ps1` / `merge_v12.mjs` / `merge_v13.mjs` / `merge_v14.mjs` / `merge_final.mjs`
- **切章脚本 3 份**：`split_chapters.py` / `split_chapters.mjs` / `split_chapters_generic.mjs`
- **同名双语言**：`scan_suffix.cjs` + `scan_suffix.mjs`
- **抽取脚本 6 变体**：`extract.mjs` / `extract_book.cjs` / `batch_extract.cjs` / `v13_extract.mjs` / `v14_extract.mjs` / `extract_cthulhu.mjs`
- **下载脚本带序号**：`download_奥法权杖.mjs` + `2.mjs`；`download_焚尽八荒.mjs` + `_88` + `_续`
- **手工版本管理**：`data/holy_names.json` 有 `.bak` ~ `.bak5_design` **五份**；`strong_entities.json.bak_before_sleeping_witness`
- **分批与合并并存**：`races.json` 与 `races_batch1..8.json`
- **清洗前后并存**：`奥法权杖_全文.txt` + `_clean.txt`；`网游之焚尽八荒` 同样
- **空目录占位**：`世界模型/来源/`（0 文件）
- `poc/src/module/raw/section_18.txt` 为 0 字节

---

## 不在范围内（已确认）

- `消弭/` —— 另一份在别处开发中的原创模组（《璀璨欢宴》），未完成。其中 `AI_KP与TTRPG相关学术工作备忘录_v1.docx` 是 `DESIGN-LOG.md` 引用的那份综述来源
- `《苍青之剑》-改.txt` —— 不处理
- D&D 职业体系设计 vs qiankun-subclasses —— 不同材料，不合并

## 待办

1. **摄取管线重跑**：从 PDF 出发（可重跑），产出 `ModuleData`，带 `Provenance` 留痕
2. ~~副本各留一份~~ —— 已完成 2026-08-19，见下「去重记录」
3. **三份模组表述收敛**：确定权威源，其余改为生成物
4. **接入未用的原材料**：优先 `narrative_style.yaml`、`mythos_rules.yaml`、`forensic_rules.yaml`
5. **约束层补物理域**：身体状态/行动力，作为 CoC 通用规则而非模组规则
6. `mythos-expansion.ts` 接进剧本引擎（现在剧本引擎零引用）
7. 6 张模组附件图未使用

## 去重记录（2026-08-19）

删除前均以 md5 逐文件校验内容一致，保留侧已核对存在。

| 删除 | 保留 | 依据 |
|---|---|---|
| `poc/src/module/raw/`（19 txt） | `poc/tools/modules/raw/` | 19 个文件 md5 全同；保留侧与 structured/ 及脚本同处，是管线的自然位置 |
| `poc/src/module/extract-tools/`（5 mjs） | `poc/tools/*.mjs` | 5 个文件 md5 全同，且被删的那份因 `__dirname` 变化整体不可运行 |
| `poc/src/module/calibration-report.md` | `poc/tools/modules/CALIBRATION_REPORT.md` | md5 相同（3243B） |
| `poc/src/module/extraction-summary.md` | `poc/tools/modules/SUMMARY.md` | md5 相同（1330B） |
| `poc/assets/`（229.4MB） | `世界模型/v18_output/` 与 `cthulhu_extracted/` | md5 相同；运行时默认读原件，副本仅供 Docker，重建方式已在 Dockerfile 注释 |

连带修正：`barn-of-premier.ts` 头部的来源注释、`tsconfig.json` 对 `src/module/raw` 的 exclude、
`.gitignore` 里 `src/module/raw/` 与 `src/module/*.md` 两条失效条目。

结果：`src/module/` 只剩 `barn-of-premier.ts` / `threat-analyzer.ts` / `types.ts` 三个源码文件；
poc 目录（不含 node_modules 与 .git）从 409MB 降到 **179.6MB**。
