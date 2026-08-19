# 设计 · 模组摄取：id 命名与场景骨架

日期：2026-08-19
状态：待实现
上游：`docs/index-program.md` §模组摄取（在建）——「LLM 插槽 · 其余语义字段」的第一个切片

## 要解决的问题

摄取管线目前停在「分好类的 `Section`」这一步。`b1e84bc` 让模型判定了哪些块是场景（命中 20 / 误报 7 / 漏报 0），但下游没有任何东西把 `Section[] + Map<title, SectionKind>` 变成 `Scene[]`。

不能直接开始抽字段，因为**还没有能测量的地基**：`calibrate.ts` 的数组配对按 `id` 走，而基准 `barn-of-premier.ts` 的 id 是带上下文的人工意译——

- `霍姆斯医院` → `hospital`（人名丢了）
- `与艾德里安的会面` → `adrian_hospital_meeting`（反而加了原标题没有的 hospital）
- `证物室` → `police_evidence_room`、`卧室` → `adrian_bedroom`（补了父场景前缀）

指望生成器逐字复现这 20 个串不现实；把基准 id 塞进 prompt 当范例则是泄题，测出的命中率不说明任何事——与已被否掉的「靠引文判场景」是同一类自我验证错误。

id 对不上时，`diffValues` 会把每个场景都报成「缺失 + 多余」，真实差异被噪音埋掉。这与当初按下标比较是同一个坑。

**所以本轮买的是「可测量」，不是「更准」。**

## 范围

做：`pdf-source.ts`、id 生成、场景骨架（id/name/description）、校准器的名称配对。

不做：description/atmosphere 切分、clues、npcIds、connections、NPC 字段、`Provenance` 落地、修分类器以标题为键的重名缺陷。

## 已确认的前提

读代码得到的事实，设计依赖它们：

- `sectionize` 的 `body` **不含 `▶` 条目**（`sectionize.ts:100-106` 遇条目行直接 `continue`，不进 `bodyLines`）
- `classifySections` 返回 `Map<string, SectionKind>`，**以标题为键**，重名标题会静默互相覆盖
- `sectionize` 会产出一个 `title: ""` 的前置块（第 1 页的书名等）
- `package.json` 的 dependencies 只有 `pdf-parse` 和 `yaml`，**没有拼音库**
- `clean-text.ts:3` 引用了一个不存在的 `pdf-source.ts`；PDF → 逐页从未固化成模块
- `classifySections` 至今**零调用方**，`Section` 到 `ClassifyInput` 没有适配器
- 素材可用：`C:\aitrpg\MikuFan-普瑞米尔的谷仓\普瑞米尔的谷仓 ver1.03.pdf`，切片 `tools/modules/raw/00_header.txt` + `section_01..17.txt`

## 架构

```
PDF 文件 ──(tools 脚本读盘)──> Uint8Array
  │
  ├─ extractPages()            src/ingest/pdf-source.ts        【新】
  ▼ string[]  逐页原文
  ├─ cleanPageText() ×N        src/ingest/clean-text.ts        【已有，不动】
  ▼ string[]  逐页清洗文本
  ├─ sectionize()              src/ingest/sectionize.ts        【已有，不动】
  ▼ Section[]  带 {page,line}
  ├─ toClassifyInputs()        src/ingest/classify-sections.ts 【补导出】
  ▼ ClassifyInput[]
  ├─ classifySections()        src/ingest/classify-sections.ts 【已有，首次有调用方】
  ▼ Map<title, SectionKind>
  ├─ assignSceneIds()          src/ingest/scene-id.ts          【新】
  ▼ string[]
  ├─ buildScenes()             src/ingest/build-scenes.ts      【新】
  ▼ Scene[]
  └─ diffValues(基准, 候选, { pairBy })  src/ingest/calibrate.ts 【改】
     ▼ FieldDiff[] → formatDiff() → 报告
```

两条边界规则：

1. **IO 只在两端。** `pdf-source.ts` 收 `Uint8Array` 不收路径；`buildScenes` 不调 LLM。读盘、调模型、落盘全部在 `tools/_run-ingest.ts`。理由：中间四个模块因此都能纯逻辑单测，而 `tools/` 被 `.gitignore` 排除——把逻辑放那里等于放弃测试。
2. **`toClassifyInputs` 归 `classify-sections.ts`。** `ClassifyInput` 是它定义的，怎么从 `Section` 造出来该由它负责。代价是 `classify-sections` 从此依赖 `sectionize`（同层下游依赖，可接受）。

`title: ""` 的前置块在 `toClassifyInputs` 里滤掉——没有标题就进不了以标题为键的管线，也不可能是场景。

## 组件

### `src/ingest/pdf-source.ts`【新】

```ts
export function extractPages(data: Uint8Array): Promise<string[]>;
```

唯一依赖 `pdf-parse` 的模块，不碰 fs。用法见 `docs/index-program.md` 记的那个坑：依赖是 v2.4.5，导出的是 `PDFParse` **类**，不是默认函数。

```ts
const { PDFParse } = require("pdf-parse");
const res = await new PDFParse({ data }).getText();
// res.total → 页数；res.pages[] → 逐页
```

本仓是 `"type": "module"`。上面这段 `require` 是文档里记下的实测写法；实现时若 ESM 下 `require` 不可用或 `tsc --noEmit` 报错，改用 `import { PDFParse } from "pdf-parse"`，以 `bun test` 与 `bun run typecheck` 双绿为准，不要两种写法都留着。

### `src/ingest/scene-id.ts`【新】

```ts
/** 输入按顺序给，序号即顺序；返回与输入等长，一一对应 */
export function assignSceneIds(sections: Section[]): string[];
```

id 的功能需求只有四条：**唯一、同一 PDF 重跑稳定、ASCII、可被 `targetSceneId` 解析**。可读性不在其中——中文原名在 `name` 里，校准报告按 name 配对后路径也印中文名。

形态定为 `scene_01` … `scene_NN`，按块在文中的出现顺序编号。

**为什么不用拼音**：`te_li_kan_jia` 并不比 `特里坎家` 多告诉你任何东西，只是换了种写法；为此给一个总共 2 个依赖的仓库加一个字典包不划算。

**为什么不用标题哈希**：`scene_a3f2c1d8` 相对序号只多一个优势——跨 PDF 版本稳定——而我们不需要那个。稳定性的用途是「同一份 PDF 重跑，diff 只反映生成器的改动」，序号完全满足。唯一优势用不上，就只剩不可读与要处理重名冲突两个缺点。

**为什么不用中文名当 id**：仓库既有 id 全是 ASCII snake_case；中文 id 会一路渗进运行期数据、存档文件名与 `Provenance.path`。

**代价（不粉饰）**：做到 `connections` 时报告里会出现 `scene_12 → scene_03`，看的人要查表。缓解：`tools/_run-ingest.ts` 在产物顶部写 `id ↔ name` 对照表，且校准报告本身印中文名。等拼音真的值那个依赖了再换——`assignSceneIds` 的接口不用动。

**返回数组而非 `Map<title, id>`**：标题可能重复，以标题为键会静默丢块。

### `src/ingest/build-scenes.ts`【新】

```ts
export interface BuildScenesResult {
  scenes: Scene[];
  /** 跳过的块、未消费的条目等——不静默丢东西 */
  warnings: string[];
}

export function buildScenes(
  sections: Section[],
  kinds: Map<string, SectionKind>,
  ids: string[],
): BuildScenesResult;
```

取 `kinds.get(section.title) === "scene"` 的块。查不到分类的块**跳过并计入 warnings**，不猜。

| 字段 | 值 |
|---|---|
| `id` | `ids[i]` |
| `name` | `section.title`，中文原样 |
| `description` | `section.body`，整块原样，本轮不切 KP/玩家 |
| `clues` / `npcIds` / `connections` | `[]`（类型必填） |
| 其余全部可选字段 | **不写这个 key**，不是写 `undefined` |

`section.items`（`▶` 条目）本轮**丢弃**，数量计入 warnings。这不是遗漏而是分工：基准里 `▶捕兽夹` 是 `ModuleItem`，`▶` 搜查项是 `Clue`，都不属于场景描述。混进 description 会让下一轮抽线索时面对一份已被污染的正文。

不做：跨块合并同名场景、推断父子层级、填 `order`。

**重名标题**：`classifySections` 以标题为键，重名时两个同名块被判成同一类。本轮**不修**——那属于分类器，改它会动到上一轮已实跑校准过的行为。本轮做法：同一 kind 处理，但 id 各自独立，重名情况计入 warnings。实跑若发现 44 块里确实有重名，再单开一轮。

### `src/ingest/calibrate.ts`【改】

```ts
export interface DiffOptions {
  /** 数组元素配对键，依次尝试。默认 ["id"]——不传时行为与现在完全一致 */
  pairBy?: string[];
}
export function diffValues(baseline: unknown, candidate: unknown, opts?: DiffOptions): FieldDiff[];
```

> **执行期勘误（`db2075a` + `48667bd`）——下面第 1 条与第 4 条的措辞被实现推翻了两处：**
>
> 1. 「选定键后一次配完，不混用多个键」**没这么做，也做不成**。两侧元素都带 `id`，
>    「选一个键」就永远选中 `id`，`name` 那一轮根本轮不上，`pairBy` 在它唯一存在的场景里是个空操作。
>    实现改成**逐键分轮认领**：`pickPairKeys` 返回全部可用键，按序每键一轮，上一轮没认领到的落到下一轮
>    （`calibrate.ts:151-170`）。混两个**身份值**没问题——每个路径段仍指得出它指的是谁；
>    不能混的是身份值与**位置下标**。
> 2. 第 4 条那句「不传时行为与现在完全一致」与它自己的正文矛盾：空数组改成平凡成立，
>    改的正是**默认路径**（`diffValues(a, b)` 不传 opts 也会走到）。同一轮还把
>    `new Map(arr.map(...))` 换成了分桶，默认路径上一样不再让同键值的后来者顶掉前者。
>    默认值仍是 `["id"]`，但「默认」不等于「和以前一样」。
>
> 完整推理见计划 `docs/superpowers/plans/2026-08-19-ingest-scene-skeleton.md` §Step 3 开头的勘误块。
> 本节正文不改：它记的是当时怎么决定的，勘误记的是执行把哪句话证伪了。

`FieldDiff.kind` 增加 `"id-mismatch"`。四处改动：

1. **依次配对**。按 `pairBy` 顺序取第一个「可用」的键：某键可用，当且仅当**两侧的非空数组里每个元素都带该键且值为非空字符串**。全部键都不可用时退回按下标——即现有行为。选定键后一次配完，不混用多个键（混用会让路径含义不一致，与现有 `allHaveId` 全有或全无的理由相同）。

2. **`id-mismatch` 单列**。仅当配对键 ≠ `"id"`、且两侧元素都带 `id`、且两个 id 不同时，产出一条 `kind: "id-mismatch"`，不计入 changed；同时该对元素递归时**跳过 `id` 字段**，否则同一件事会再报一条 `.id` 的 changed。按 `"id"` 配对时两侧 id 必然相等，无需特殊处理。

3. **路径段用实际配对键的值**。按 id 配 → `scenes[scene_07]`；按 name 配 → `scenes[特里坎家]`。这是序号 id 可读性差的主要解药。

4. **`allHaveId` 的空数组修正**。现在它要求 `arr.length > 0`，所以候选侧 `clues: []` 会让整个数组退回按下标比，32 条缺失全印成 `clues[0]`…`clues[31]`。改成：**空数组不参与「每个元素都带该键」的判定**（空集合上该条件平凡成立），于是「一侧空、另一侧元素都带 id」仍按 id 配，路径变为 `scenes[特里坎家].clues[clue_bar_ask_around]`——这份清单直接是下一轮的路线图，按下标印则一文不值。两侧皆空时无差异可报，与现在一致。

`formatDiff` 的计数行相应加一项。

### `tools/_run-ingest.ts`【新，不进版本库】

读 PDF → 清洗 → 切分 → 分类 → 建场景 → diff。落盘：候选产物、`id ↔ name` 对照表、diff 报告。下划线前缀表示一次性脚本（沿用 `_verify-read-build.ts` 的约定）。

## 错误处理

- `extractPages`：空/损坏 buffer 抛出，带可读消息，不返回空数组假装成功
- `classifySections`：已有行为——失败时 `console.warn` 并返回空 Map，「由调用方决定怎么降级」。本轮调用方的降级是：空 Map ⇒ 零个场景 ⇒ 实跑报告如实显示 0/20，不猜、不把所有块当场景
- `buildScenes`：不抛。查不到分类、标题为空、标题重名，全部计入 warnings 由脚本打出
- 无 LLM key 时：`LLMClient` 熔断 → 分类空 Map → 上一条。管线不崩，但本轮的核心数字（N/20）拿不到，这是诚实的结果而非降级兜底

## 测试

单测在 `src/__tests__/`，`bun test`。

- `ingest-scene-id.test.ts` — 确定性（同输入两次同输出）、唯一性、纯 ASCII、与输入等长一一对应、空标题块的处理
- `ingest-build-scenes.test.ts` — 只取 `scene` 类、必填字段齐全、可选字段确实没写进对象、`▶` 条目没混进 description、未分类块被跳过且计入 warnings、重名标题各得各的 id
- `ingest-calibrate.test.ts` 扩充 — **默认 `pairBy` 行为不变（回归锁，现有 21 测试是基线）**、name 配对生效、`id-mismatch` 不污染 changed、空数组走 id 路径而非下标
- `ingest-pdf-source.test.ts` — **只测形态**：空/损坏 buffer 抛得干净、返回长度等于页数

**内容保真为什么不进单测**：原文切片在被 `.gitignore` 排除的 `tools/` 下，而 `0fbf778 chore: keep one copy of the raw material` 明确只留一份素材。把 PDF 文本复制进 `src/__tests__/fixtures/` 既违背那个决定，也等于把模组原文又铺进一处。这条理由写进测试文件头注释，免得下一个人当成漏测顺手补上。

沿用既有约定：LLM 行为本身不做确定性单测，只测它两侧的纯函数（见 `ingest-classify.test.ts:6-8`）。

## 验收

1. `bun test` 全绿，现有 101 个 ingest 测试零回归
2. 实跑跑通，产出「基准 20 个场景按 name 命中 N/20」这个数
3. diff 的 missing 清单可直接当下一轮路线图
4. `docs/index-program.md` 状态表加行，写入实跑数字

## 已否决的方案

| 方案 | 否决理由 |
|---|---|
| 追求 id 与基准完全对上 | 要把命名约定和已有 id 喂进 prompt，等于泄题，数字不可信 |
| 人工维护 id 映射表 | 每改一次生成器可能要重维护映射 |
| 中文名直接当 id | 会渗进运行期数据与存档文件名；与仓库既有 ASCII 约定冲突 |
| 拼音 id | 需新依赖，且信息量不比中文原名多 |
| 标题哈希 id | 唯一优势（跨 PDF 版本稳定）本轮用不上 |
| 本轮顺手切 description/atmosphere | 多一个变量，失败时读不出是哪一环坏的 |
| 四项语义字段一起做 | 中途无法验证，且 `findMethods` 实含「抽线索」，比另外三项都重 |
