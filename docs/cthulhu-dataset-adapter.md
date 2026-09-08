# Cthulhu 数据集 adapter

## 目标与边界

`src/dataset/cthulhu-manifest.ts` 是外部 Cthulhu 数据集的事实清单；
`src/dataset/cthulhu-dataset.ts` 验证清单并把 JSONL 行转换为
`LoreClaimCandidate`。候选不是 `RuleArtifact`，不会写入 `ModuleData`，不会执行
`game_rule`，也没有接入现有世界模型运行时。

数据集根目录通过 `CTHULHU_DATASET_PATH` 或调用方传入的 `datasetPath` 解析。
adapter 启动时报告最终绝对路径；库代码不保存本机绝对路径。

## Manifest

manifest 登记数据集 id/version、7 部作品、作者、原始出版证据、Gutenberg 来源、
源文本及 SHA-256、章节目录及每部 txt/meta hash 清单的固定 SHA-256、7 个分作品 JSONL
及 SHA-256、许可证据和派生产物状态。

当前数据事实：

- 151 个章节对；每对必须同时有 `.txt` 与 `.meta.json`。
- 7 个分作品 JSONL 共 145 行，覆盖 76 个章节。
- `cthulhu_world_model.jsonl` 是分作品记录去掉 `dnd_mapping` 后的重复聚合物，
  状态为 `migration_analysis_only`，不得与分作品文件同时加载。
- `cthulhu_all.jsonl` 是 0 字节旧产物，状态为
  `ignored_empty_legacy_artifact`，不得标记为已加载。
- README 声称的根级 junction 和 pipeline 脚本预期目录与当前文件系统不一致；
  adapter 不依赖这两项假设。

来源文本携带 Project Gutenberg 声明，但 adapter 不做司法辖区或下游用途判断。
每条候选的 `rightsStatus` 因此固定为 `unknown`，只回传可审计的
`rightsEvidence`。

## Typed Adapter

每条 `LoreClaimCandidate` 保留 `workId`、作品名、实体、claim type、payload、
chapter、confidence、extractionModel、块级 evidence、rights evidence、warnings
和未知字段 `extras`。`properties` 同时接受 object 与 array；当前实物只观测到
array。JSONL 没有逐 claim 的原文跨度，因此 evidence 只能诚实标为章节块级，
不能伪造成句级引用。

`source` 字段表示作品内引语署名，映射为 `payload.quoteAttribution`；例如
`Borellus` 不是数据集来源。`dnd_mapping` 不进入 lore payload，也不进入规则层；
未保留它时不创建伪造的规则来源。将来若保留，必须由独立的
`unverified_ruleset_adapter` 输出，并把来源、模型和版本标为 unknown，直到有
独立证据。`game_rule:true` 只形成 extraction warning/flag，不赋予执行语义。

## Scope 与查询

`queryLoreCandidates` 要求非空 `allowedWorkIds`；缺失或空集合直接抛出
`LoreScopeError`。同名实体默认按 `workId` 隔离，`Yog-Sothoth` 在三部作品中的
记录不会自动合并。

候选排序优先级固定为：

1. 同作品且同章节。
2. 同作品。
3. 同 corpus、年代兼容且调用方显式允许 `analogy_only`。
4. 无证据时返回空候选，不自动扩 scope。

实体名、claim type、chapter 和 era 只是显式过滤条件，不会扩大作品范围。

## 验证与运行时隔离

加载时验证文件 hash、章节成对、metadata 配对与首行预览、JSONL 行数、章节覆盖、
重复 claim 和派生产物状态。测试直接读取真实数据集，并覆盖 aggregate 重复、
空 artifact、缺 metadata、dnd mapping 隔离、空 scope、作品隔离与 analogy policy。

现有 `src/world/world-model-loader.ts`、`world-model-integrator.ts`、
`mythos-expansion.ts` 和 `ModuleData` 路径不 import 本 adapter。运行时切换必须是
单独任务，先解决 `docs/todo.json` 中登记的 scope 与属性污染风险。
