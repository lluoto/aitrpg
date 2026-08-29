# 世界模型索引归档（2026-08）

> 来源：从 `docs/index-world-model.md` 的 2026-08-29 精简中移出。原文提交见 git 历史
> `0880f754dae8e54b91013fbe4fedade76e5715a1:docs/index-world-model.md`。
> 归档标准：D 盘旧料的一次性核对记录、已被更新的审计取代的旧清点、或独立的
> 「遗物母版工程」子项目记录——都不是当前活跃工作的地图,但保留原始描述以备查。
> 主文档见 `docs/index-world-model.md`；若某节内容仍在被引用，主文档里应有指回本文件的链接。

## 原文与 raw/ 的血缘已确认（2026-08-19）

`tools/modules/raw/` 的切片**确实出自这份 PDF**，逐字一致（空白归一化后）：

| PDF | raw 文件 | 结果 |
|---|---|---|
| page 1 | `00_header.txt` | 完全一致 |
| page 2–18 | `section_01..17.txt` | **17/17 完全一致** |
| — | `section_18.txt` | 0 字节，是旧切分器 off-by-one 留下的空壳 |

即 `section_NN` 对应 **PDF 第 NN+1 页**。全文 18 页 / 21032 字符。

意义：这批 raw 切片可以当作**已知正确的基准**——重建摄取时，第一段的输出应当与它逐字相同。

## 摄取相关脚本（poc/tools/ 遗留脚本，2026-08-19 状态）

这批遗留脚本均在 `poc/tools/`，整个目录被 `.gitignore` 排除——不是「全部摄取相关脚本」，
见下表后的限定语；新的入口 `scripts/ingest/run.ts` 已入库，不在这批里。

| 脚本 | 作用 | 状态 |
|---|---|---|
| split-modules.mjs | raw.txt → 18 章节 txt；.ts → 15 字段 txt | 输入文件已缺失 |
| calibrate.mjs | 原文 vs 结构化数据逐项比对，出报告 | 指向旧 .ts |
| verify-module.mjs | 文本扫描式 CI 校验，返回 0/1 | 指向旧 .ts |
| extract-hooks.mjs | **唯一会生成 TS 代码的脚本**，但只生成 `hooks:` 一个字段，输出到 generated-hooks.txt 等人工回贴，约 1/5 条目是"(原始文本中无对应段落)"占位 | 半成品 |

> `poc/src/module/extract-tools/` 曾有这批脚本的第二份副本，且因 `BASE = resolve(__dirname, "..")` 在搬家后失效（解析成不存在的 `src/module/src/rules/...`）整体不可运行，已于 2026-08-19 删除。`src/module/` 现在只剩三个 .ts。

**结论（就上面这批 `tools/*.mjs` 遗留脚本而言）：不存在从原文端到端产出完整模组
.ts 的自动化路径。** 15 个字段里 14 个靠手工维护。这个结论已被 `src/ingest/`
+ `scripts/ingest/run.ts` 的新管线部分取代（见 `docs/notes/ingest.md`），但新管线同样
止步于「产出可对比的候选」，还没有自动写出最终 `ModuleData` .ts 的一步。

## 归档完整性核对（2026-08-21）

跑 `tools/_audit-workdir.ts` + `tools/_audit-orphans.ts` 全量盘了一次
`C:\aitrpg`，结论：**没有未归档的内容**。上面几张表覆盖了顶层全部 24 项。

| | |
|---|---|
| 顶层条目 | 24（6 目录 + 18 文件） |
| 在版本控制里 | **只有 `poc/`** |
| 有远端 | **只有 `poc/`**（github.com/lluoto/aitrpg） |
| 总体量 | 3.86 GB，其中 `世界模型/` 占 3.66 GB / 99453 文件 |

⚠ **记录不等于备份**。`世界模型/v18_output/v18_all_master.jsonl`（229MB）
是唯一一份，运行时默认直接读它（`DEFAULT_V18_PATH`）——丢了整层就没了。
已记入 `docs/todo.json` 的 `risk-01`。

## 备份分层：不必全备，只有 ~500MB 是不可再生的

⚠ 下面这份是**只扫 `poc/` 自身范围**的旧结果。后来另跑过一次**全 `C:\aitrpg`**
范围的审计，产物在 `analysis/diag/audit-backup.md`——但那份自己声明
「审计未完成，不给精确总量」，数字比下面这份更粗，不能拿它的总量替换
下面的结论；两份的范围本来就不同（下面这份只看 poc/，那份连世界模型原始
素材所在的父目录都扫了）。谁需要更全的口径去看那份，日常判断仍以下表为准。

`scripts/diag/audit-backup.ts` 按「丢了怎么办」分了层：

| 类别 | 文件数 | 大小 | 丢了怎么办 |
|---|---|---|---|
| 抽取产物 | 858 | 2590 MB | 能重跑（源材料 + 脚本都在就行） |
| **源材料** | 111 | **474 MB** | **找不回来** — 小说全文、模组 PDF、原著 txt |
| **脚本** | 4229 | **13 MB** | **找不回来** — 抽取管线（Python + mjs） |
| **手写设计** | 899 | **12 MB** | **找不回来** — yaml / md |
| 其它 | — | ~600 MB | 章节切片等中间产物 |

**不可再生合计 5239 个文件 / 500 MB** —— 3.7GB 里只有这些真的需要异地留一份。

执行：`bun scripts/backup-critical.ts --out <目标盘>`
（`--dry` 先看清单；复制而非压缩，因为大头本就是 epub/pdf 这类已压缩格式；
会在目标目录留 `_manifest.txt` 便于核对）

⚠ **判据在这里错过一次，值得记**：头一版把 `.txt` 只在
「路径含 来源/原著/raw」时才算源材料，于是 `世界模型/` 根目录下那些
**15~18MB 的小说全文**全被归进「其它」，算出来「不可再生只有 53MB」。
实际是 489MB —— **漏掉的正是整条抽取链的根**。
按「直接躺在 `世界模型\` 下且是 .txt」补上判据才对。

**盘点时判据错过两次，都是同一类**：

1. 先用 PowerShell 列目录，中文名全是乱码 → 换 `fs.readdirSync`
2. 判断「文件名有没有被 poc 引用」时，用去掉扩展名的短词做子串匹配，
   于是 `PLAN`、`docs` 这种词到处命中，**18 个文件全部"被引用"** ——
   收紧成「带扩展名的完整文件名」才对。

第 2 条的教训跟这轮反复踩的是同一个：**判据没验就用**。
收紧后重跑，仍是 18/18 命中，但这次是真的 ——
`docs/index-world-model.md` 里那张 yaml 表逐个索引了它们。

## 不在范围内（已确认）

- `消弭/` —— 另一份在别处开发中的原创模组（《璀璨欢宴》），未完成。其中 `AI_KP与TTRPG相关学术工作备忘录_v1.docx` 是 `DESIGN-LOG.md` 引用的那份综述来源
- `《苍青之剑》-改.txt` —— 不处理
- D&D 职业体系设计 vs qiankun-subclasses —— 不同材料，不合并

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
poc 目录体积从 409MB 降了下来——具体数字会随依赖/构建产物变化持续漂移
（实测过一次是 303.6MB，含 node_modules，与本节写的 179.6MB 口径不同，
按 `index-program.md` 的规矩不再写死数字），要精确值现测：
`du`/`Get-ChildItem -Recurse | Measure-Object -Property Length -Sum`。

## 世界模型语料工程旧清点（`世界模型/`，2026-08-19 状态：98,269 文件 / 1.5GB）

> 此清点在 C 盘 `世界模型/` 迁到 D 盘之前做的。此后目录结构、文件数（现约
> 100,030 文件 / 2.74 GiB）都已变化，当前状态见主文档「D 盘小说语料与新版提取」。
> 保留本节是因为它记录了更细的构成分类，主文档没有逐一复述。

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

### 重复与占位（清理线索，2026-08-19 状态）

> 此清单已被主文档「重复审计（2026-08-29）」的 SHA-256 全量扫描取代（121,433 文件 /
> 4,263 组字节级重复）。保留本节是因为它按类型归了因，全量扫描的重复分组表没有这个粒度。

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

## 遗物母版工程（`relics/`，URF v0.5）

独立的遗物提取与框架化工程。已产出 56 本书的母版，正在推进 worldmodel 管道化。

### 核心文档

| 路径 | 内容 |
|---|---|
| `relics/_standard/处理标准_v1.md` | 提取判据标准（T0–TΩ 判据、术语碰撞、铁律、校验器规定） |
| `relics/_tools/worldmodel/WORKFLOW.md` | **P0 管道工作流**（2026-08-19 新建） |
| `relics/末法王座/母版_v1.md` | 首个实证批次，17 件遗物 |
| `relics/疯巫妖的实验日志/母版_v1.md` | v1.1 更新：补录两件神器 + T5 边界验证 |

### P0 世界模型管道（`relics/_tools/worldmodel/`）

从原文到 D&D 5e 可接入规则的完整管道。去掉角色/剧情后，提取法术、物品、生物、机制等世界观设定。

#### 管道结构

```
01_discover_mentions  →  mentions.jsonl (全文位置锚点，无上限)
          ↓
03_stream_cluster     →  clusters.jsonl (流式去重)
          ↓                   ↑
          ↓             [bge-m3 替换 Jaccard — 待部署]
          ↓
05_fusion             →  enriched_mentions.jsonl (+ v17 分类)
          ↓
06_surface_summary    →  surface_summary.jsonl (纯逻辑合并)
          ↓
07_classify_entries   →  world_entries.jsonl (qwen 分类过滤)
          ↓
08_dnd_convert        →  dnd_rules.jsonl (GPT/Claude → D&D 5e)
```

#### 脚本清单

| 脚本 | 功能 | 依赖 | 状态 |
|---|---|---|---|
| `01_discover_mentions.mjs` | 原文 n-gram 发现 → mentions.jsonl | 无 | ✅ 完整运行 |
| `02_collect_contexts.mjs` | 多层上下文 → contexts.jsonl | 01 | ✅ 224K 条 |
| `03_stream_cluster.mjs` | **流式聚类去重** → clusters.jsonl | 01 | ✅ **2026-08-20 新建** |
| `03_embed_mentions.mjs` | 真 embedding → vectors.jsonl | 01 | ⏳ 待 bge-m3 |
| `03_pseudo_embed.mjs` | LLM 伪 embedding → pseudo_vectors.jsonl | 01 | ✅ 备用 |
| `04_candidate_pairs.mjs` | 候选实体对 → candidate_pairs.jsonl | 03 | ✅ 就绪 |
| `05_fusion.mjs` | v17 分类 + P0 位置锚点融合 | 01+02 | ✅ 中文匹配已修复 |
| `06_surface_summary.mjs` | **纯逻辑合并** clusters → surface_summary | 03 | ✅ **2026-08-20 新建** |
| `07_classify_entries.mjs` | **qwen 分类**过滤 → world_entries + junk | 06 | ✅ **2026-08-20 新建** |
| `08_dnd_convert.mjs` | **GPT/Claude → D&D 5e** 规则格式 | 07 | ✅ **2026-08-20 新建** |

#### 关键修复（2026-08-20）

- **去掉 maxPositions=100 上限**：原来每个 surface 只保留前 100 个位置，导致高频词（林云、死亡之书等）只覆盖前几章，后期战斗完全丢失。现在无上限，由流式聚类去重控制产出量。
- **流式聚类**（03_stream_cluster）：读一条 mention → 与已有簇比较 → 语义相似则丢弃，不同则新建簇。「林云点了点头」保留第一次，后续自动去重；「林云取出死亡之书」是新语义，自动保留。
- **中文匹配修复**（05_fusion）：禁用 Levenshtein 模糊匹配（中文字形无语义关联），调严 contains 匹配阈值。
- **io.mjs 流式读取**：支持超大 JSONL 文件（224K+ 条），避免 `ERR_STRING_TOO_LONG`。

#### 验证：148-150 章战斗场景

用末法王座第 148-150 章（林云 vs 凯恩/死亡之书化身）验证管道效果：

| 修复前 | 修复后 |
|---|---|
| 关键实体命中：0 个 | 关键实体命中：全部 |
| 林云/死亡之书/凯恩/毁灭之日：全 MISS | 凯恩 37 簇、毁灭之日 20 簇、死亡之书 16 簇 |
| 原因：maxPositions=100 在前几章耗尽配额 | 流式聚类覆盖全文，语义去重 |

#### 执行示例

```powershell
$src = "C:\aitrpg\世界模型\末法王座-庄毕凡.txt"
$out = "C:\aitrpg\世界模型\relics\_scan\_末法王座_worldmodel"

# 阶段1-3: 本地纯计算
node 03_stream_cluster.mjs $src --out-dir $out --chapter-range 148-150
node 06_surface_summary.mjs --data-dir $out

# 阶段4: qwen 分类 (LiteLLM)
node 07_classify_entries.mjs --data-dir $out --model qwen3.5-9b

# 阶段5: D&D 转换 (GPT)
$env:OPENAI_API_KEY="sk-..."
node 08_dnd_convert.mjs --data-dir $out --type spell,item,creature
```

### 战斗展开（设计方向，未实现）

原文中强者对战常有大段省略（如「三小时战斗」用几句话带过）。未来 `09_battle_expand.mjs` 的设计方向：

- **不是提取，是约束生成**：原文没写的内容，根据已有 world_entries 中的法术/机制规则补全
- **输出战斗骨架**：标记哪些阶段原文有写（直接提取），哪些省略（标注约束条件供人工/LLM 填充）
- **输入依赖**：world_entries（法术列表）+ 全书其他详细战斗作为 few-shot 样本
- **需要更多战斗场景数据后再开发**

### 神器对决启发式

独立文件：`relics/_standard/artifact_conflict_heuristics.yaml`

- 定位为 GM 参考，非硬规则
- 适用 T5 级效果互相作用等边缘情况
- 核心理念：叙事决策 > 规则推导

### T5 判据更新（2026-08-19）

`处理标准_v1.md` §3.4.10 更新：

> **核心：效果受规则裁决（T4），还是效果定义规则如何运行（T5）？**
>
> - T4 = 规则裁决效果的成败（有判定、有边界）
> - T5 = 效果定义规则如何运行（移除后规则本身变化）
>
> **边界验证**：
> 1. 有失败/被抵抗/上限记录？→ T4
> 2. 无使用记录？→ 默认 T4，标注「有 T5 路径」
> 3. 无边界 + 有记录证明无豁免 → 移除测试 → T5
>
> **注意**：「神权」「至高」等标签仅供参考，不自动升级

### 待办（relics/ 工程自身的，2026-08-19 状态）

- [x] P0 完整运行末法王座（224K mentions）
- [x] 05_fusion.mjs 融合（enriched 14200 / new 210062 / orphans 5887）
- [x] 流式聚类脚本 + 148-150 章验证
- [x] 06/07/08 三阶段脚本编写
- [ ] 部署 bge-m3 embedding 模型（WSL + vllm，替换 Jaccard）
- [ ] 07 qwen 分类全量测试
- [ ] 08 GPT/Claude D&D 转换测试
- [ ] 战斗展开脚本设计（需更多战斗样本）
- [ ] 推广至其他书籍
