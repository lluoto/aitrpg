# 设计 · 模组摄取：`▶` 条目分类与 ModuleItem 抽取

日期：2026-08-19
状态：待实现
上游：`docs/superpowers/specs/2026-08-19-ingest-scene-skeleton-design.md`（场景骨架，已完成并合入）

## 要解决的问题

上一轮把 44 个块变成了 `Scene[]`，实跑对基准 20 个场景按 name 命中 17（按场景身份 20/20）。
差异报告里的 87 条 missing 按字段分布是：

| 条数 | 字段 |
|---|---|
| 36 | `scenes[].connections[]` |
| 25 | `scenes[].clues[]` |
| 12 | `scenes[].atmosphere` |
| 7 | `scenes[].npcIds[]` |
| 3 | 整个场景（名字变体） |
| 各 1 | `visibleEntities` / `openingAtmosphere` / `isHome` / `stateVars` |

上一轮丢弃了全部 39 个 `▶` 条目，理由是「它们属线索/物品，留给下一轮」。

**本轮开工前把这 39 条逐条对回基准，发现那句话说得太粗：`▶` 不是线索标记，是通用的子条目标记。**

| `▶` 条目 | 在基准里其实是 |
|---|---|
| `捕兽夹` / `锯短霰弹枪拌锁陷阱` / `音响陷阱` / `硫酸陷阱` | `ModuleItem.trap` |
| `防盗门的钥匙` / `农场的照片` / `驾驶证` / `住宅钥匙` / `老旧文件` | `ModuleItem` |
| `侧面的防盗门` / `一旁的杂物堆` / `拉门` | `SceneConnection`——进入方式，不是线索 |
| 菲碧·特里坎名下 2 条 | `ModuleNPC.knowledge` 与 `.secrets` |
| 与艾德里安会面的 3 条 | 分支结局叙事 |
| `侦查休息区/宣言仔细检查床底` 等 | 才是 `Clue` |

## 为什么这一轮做物品而不做线索

**线索没法按名字计分。** 基准 32 条线索的 `name` 是重写过的：`床头柜` → `日记本与老旧文件`，
`侦查餐厅/宣言仔细检查餐桌` → `奇怪的卡片`，`中控台的开关` → `中控台拉杆`。
39 个条目里只有 `枪械柜`、`母女的缸中脑` 两个逐字命中。

**物品的名字则几乎逐字相同：10 个 `ModuleItem` 里 9 个能在 `▶` 名字里原样找到。**
唯一的例外是 `黑色钱包`，PDF 里没有对应条目。所以本轮命中上限是 **9/10，不是 10**。

结构性错位还有三处，进一步说明「一个 `▶` 对一条线索」不成立：

- `证物室` 有 3 个 `▶`、**0 条线索**——三个全是 `ModuleItem`；而名叫「证物室」的那条线索挂在 `警察局` 名下
- `维修间` 只有 1 个 `▶`，却有 4 条线索
- `农场外围` 那条线索 `陷阱区已通过` 是引擎层构造，PDF 原文根本没有
- 有 6 条线索所在的场景（`报亭`、`霍姆斯医院`、`警察局`）**一个 `▶` 都没有**，线索写在正文里

## 范围

做：`▶` 条目分类、`ModuleItem[]` 构建（含接上已有的陷阱抽取器）、校准器的引用字段处理、id 模块合并。

不做：线索、`connections`、NPC 字段、`description`/`atmosphere` 切分、修分类器以标题为键的重名缺陷。

## 已确认的前提

实测得到，设计依赖它们：

- 39 个 `▶` 条目落在 16 个块里；44 个块中 28 个没有条目
- **8 个条目整行没有冒号**，`SectionItem.name` 为空串，正文全在 `text` 里
- `驾驶证` 在 `证物室` 与 `交火现场` 各出现一次，基准只收了一个
- 基准 `ModuleItem` 的 `type` 分布：`key` 2 / `document` 3 / `loot` 1 / `trap` 4；`weapon` 未使用
- `extract-trap.ts` 已验证：四个陷阱的伤害骰、难度、体型阈值、以及「躲避 vs 挣脱」之分全部抽对
- `ModuleData.provenance` 至今没有任何代码写入过；`extractTrapMechanics` 产出的 `Provenance.path`
  是相对的（`trap.damage`），从未被 rebase 到根路径
- `sectionize` 的 `SourceRef {page, line}` 与 `Provenance.sourceRef: string` 一直没有桥接

## 架构

```
Section[] ─┬→ toClassifyInputs → classifySections → Map<title, SectionKind>   【已有】
           ├→ assignSceneIds → string[]                                        【已有】
           ├→ buildScenes(sections, kinds, ids) → Scene[]                       【已有】
           │
           └→ toItemInputs(sections, kinds, ids)          【新】只取 scene 块上的 ▶
                    ↓ ItemInput[]
              classifyItems(inputs, client)               【新】LLM
                    ↓ Map<key, ItemKind>
              buildItems(inputs, itemKinds)               【新】
                    ↓ { items: ModuleItem[], provenance: Provenance[], warnings }
              diffValues(基准, 候选, { pairBy: ["id","name"], refFields: ["sceneId"] })
```

IO 边界不变：新模块全部无 IO 无 fs，LLM 调用只在 `classifyItems` 一处，读盘与落盘留在
`tools/_run-ingest.ts`。

## 组件

### `src/ingest/ids.ts`【由 `scene-id.ts` 改名】

```ts
export function assignSceneIds(sections: Section[]): string[];
/** 键是条目的 `p{page}:L{line}`，值是 `item_NN` */
export function assignItemIds(sections: Section[]): Map<string, string>;
```

两者共用私有的 `sequential(prefix, n)`。分成两个近乎逐字相同的函数会被判「逐字重复」，
而合并成一个泛型 `assignIds(prefix, n)` 又丢掉了「参数即下标对应契约」这层文档作用——
所以是两个薄导出加一个共用实现。

改名同时解决最终评审记下的一条：`assignSceneIds` 名为 scene，实际给**每个块**编号
（含前言、附录、空标题前置块）。模块叫 `ids.ts` 之后这个名字不再误导。
有两个导入方要跟着改：`build-scenes.ts` 与 `ingest-scene-id.test.ts`（测试文件一并改名 `ingest-ids.test.ts`）。

物品 id 形态 `item_01…item_NN`，对**全部 39 个 `▶`** 按文中出现顺序编号——与 `scene_NN`
同一套理由：唯一、同一 PDF 重跑稳定、纯 ASCII。

编号必须覆盖全部条目，不能只覆盖 `toItemInputs` 过滤后的那批：过滤依赖块分类结果，
一个块从 `scene` 翻成 `npc`，它名下的条目就会消失，后面所有物品 id 集体挪位。
`scene_NN` 特意按全部块编号就是为了避开这件事。

返回 `Map<sourceKey, id>` 而不是等长数组，与 `assignSceneIds` 的形状不同，是因为
键的性质不同：标题会重复（分类器正栽在这上面），而 `p{page}:L{line}` 天然唯一，
同一行不会有两个条目。以它为键既安全，又让下游不必再维护一层下标对应。

### `src/ingest/classify-items.ts`【新】

```ts
export type ItemKind = "clue" | "item" | "trap" | "connection" | "npc_knowledge" | "event";

export interface ItemInput {
  /** 唯一键，形如 "p9:L13" */
  key: string;
  /** 所属块标题，给模型上下文 */
  sceneTitle: string;
  /** 所属场景 id */
  sceneId: string;
  /** ▶ 与第一个冒号之间那截；8 个条目没有，为空串 */
  name: string;
  /** 冒号之后的正文；没有冒号时是整行 */
  text: string;
}

export function toItemInputs(sections: Section[], kinds: Map<string, SectionKind>, ids: string[]): ItemInput[];
export function buildItemPrompt(inputs: ItemInput[]): string;
export function parseItemResponse(text: string, knownKeys: string[]): Map<string, ItemKind>;
export function classifyItems(inputs: ItemInput[], client: LLMClient): Promise<Map<string, ItemKind>>;
```

**键用 `p{page}:L{line}`，不用名字。** `classifySections` 以标题为键、重名静默覆盖，
这个缺陷本轮不能重演——而 `驾驶证` 正好在两个块里各出现一次。`SourceRef` 天然唯一
（同一行不会有两个条目）。

这个键同时充当 `Provenance.sourceRef`，补上 `SourceRef {page,line}` 与
`Provenance.sourceRef: string` 之间一直缺的那段转换。**但要注意它换了口径**：
`ingest-extract-trap.test.ts` 里现有的 fixture 用的是 `"raw/section_09.txt:L42"`，
即 raw 切片文件加行号；`p9:L13` 是 PDF 页加页内行号。两者指的不是同一个坐标系。
本轮确立页号口径，理由是 raw 切片在 `.gitignore` 之外且是派生物，PDF 才是权威源。
既有 fixture 是测试自造的字符串、不是产出，不受影响，但这条口径要写进
`Provenance.sourceRef` 的文档注释，免得后面两种格式混着长。

`toItemInputs` 只取 `kinds.get(section.title) === "scene"` 的块上的条目。菲碧·特里坎名下
那两条属 npc 块，本轮不进——它们在基准里是 `ModuleNPC.knowledge`/`.secrets`，是另一轮的事。

失败降级沿用 `classifySections` 的既定语义：`console.warn` 并返回空 Map，由调用方决定怎么降级。
本轮调用方的降级是零个物品，实跑报告如实显示 0/10——不猜、不把所有条目当物品。

解析侧必须做键归一化。上一轮的教训写在 `docs/index-program.md`：prompt 里把标题展示成
`【农场外围】`，模型就照这个格式返回键，43 条全被丢弃，表现成「模型没干活」，
实际它全做对了。**展示格式不该变成输出格式的契约。**

### `src/ingest/build-items.ts`【新】

```ts
export interface BuildItemsResult {
  items: ModuleItem[];
  /** 陷阱抽取的改写留痕，path 已 rebase 到根 */
  provenance: Provenance[];
  warnings: string[];
}

export function buildItems(
  inputs: ItemInput[],
  kinds: Map<string, ItemKind>,
  ids: Map<string, string>,
): BuildItemsResult;
```

三个入参都以 `ItemInput.key` 对齐，没有下标耦合。某个 input 的 key 不在 `ids` 里是编程错误，抛。

只取 `item` 与 `trap` 两类。字段填法：

| 字段 | 值 |
|---|---|
| `id` | `ids[i]` |
| `name` | `input.name` |
| `sceneId` | `input.sceneId` |
| `description` | `input.text`，原文照抄 |
| `type` | 规则判定，见下 |
| `trap` | 仅 `trap` 类：`extractTrapMechanics(name, text, key)` 的 `mech` |
| 其余可选字段 | **不写这个 key** |

**`type` 归规则，「是不是物品」归 LLM。** 只拿 **`name` 匹配，不看 `text`**——正文里出现
「钥匙」的条目多得是（`床头柜` 那条正文就写着钥匙），拿正文匹配会把一堆东西判成 `key`。
依次匹配，都不中则 `loot`：

```ts
const TYPE_RULES: Array<[RegExp, ModuleItem["type"]]> = [
  [/钥匙/, "key"],
  [/照片|驾驶证|证件|文件|协议|日记|信件/, "document"],
];
```

对基准全中：`防盗门的钥匙`/`住宅钥匙` → `key`，`农场的照片`/`驾驶证`/`老旧文件` → `document`。
`trap` 类直接 `"trap"`，不过规则。`weapon` 不加规则——基准里没有非陷阱物品用它，YAGNI。

这条分工是仓库既定的：能用规则抽的不交给 LLM。名字里有没有「钥匙」是死板形态，
可复现、可解释、不要 API key。

**名字为空的条目若被判成 item/trap，跳过并计入 warnings。** 物品没有名字就没法被
`pairBy: ["name"]` 认领，也没法在叙事里被提起。8 个无名条目在基准里没有一个是物品，
所以这条不会误伤；真触发了说明分类错了，该看见。

**Provenance 的 path 要 rebase。** `extractTrapMechanics` 产出的是相对路径（`trap.damage`），
`Provenance.path` 的语义是根路径。rebase 成 `items[<item.id>].trap.damage`——用 id 而不是下标，
因为上一轮已经确认下标路径在配对之后毫无意义。`src/module/types.ts` 里 `Provenance.path`
的文档示例写的是 `"items[3].trap.damage"`，一并改成 id 形式。

这是 `ModuleData.provenance` 第一次被代码写入。不做的话，`extractTrapMechanics` 一直在产出
却从没有人接的那份留痕就等于白抽。

### `src/ingest/calibrate.ts`【改】

```ts
export interface DiffOptions {
  pairBy?: string[];
  /** 引用字段：值是指向别处 id 的句柄，不算内容差异 */
  refFields?: string[];
}
```

`FieldDiff.kind` 增加 `"ref-mismatch"`。

**为什么需要它**：基准 `key_anti_theft.sceneId` 是 `police_evidence_room`，生成侧只会是 `scene_NN`。
按名字配上之后这 9 个物品的 `sceneId` 会全部报成 `changed`——但那不是生成器不准，
它是「id 是内部句柄」往下再走一层：`sceneId` 是**指向 id 的引用**。
不摘出去，`changed` 就和上一轮 `.id` 会重复报一样，混进了不该算的东西，
而下一轮 `connections[].targetSceneId`、`npcIds[]` 只会让这个污染更重。

行为：在对象分支里，若键在 `refFields` 内、且两侧都是非空字符串、且不相等，
产出 `kind: "ref-mismatch"` 并跳过该键的递归；其余情况一律走原有逻辑
（一侧缺失仍报 `missing`/`extra`，那是真缺字段）。`id` 不放进 `refFields`——
它已由 `id-mismatch` 处理，两者重叠会同一件事报两遍。

`formatDiff` 的计数行相应加一项。不传 `refFields` 时行为与现在完全一致。

### `tools/_run-ingest.ts`【改，不进版本库】

在既有链路后追加：`toItemInputs` → `classifyItems` → `assignItemIds` → `buildItems`，
候选产物变为 `{ ...BARN_OF_PREMIER, scenes, items, provenance }`，
diff 传 `{ pairBy: ["id","name"], refFields: ["sceneId"] }`。
落盘增加 `items.json` 与按类别统计的条目分类结果。

## 一个必须写下来的例外：分类不是互斥的

`老旧文件` 在基准里**同时是** `ModuleItem old_document` 和 `Clue clue_bedroom_old_doc`
（后者 name 为 `老旧文件（米-戈联络术）`）。39 个条目里只此一例。

本轮仍用单标签——为一个案例上多标签不划算。但下一轮做线索时
**不能假设「已判为 item ⇒ 不是 clue」**。这种假设正是会静默丢东西的那一类，
而静默丢失是这套工具最不能有的失败方向。

## 三处已知会产生的差异，都是对的

| 差异 | 原因 |
|---|---|
| `驾驶证` 一个配上、一个报 `extra` | PDF 两处各写一次，基准只收了一个。上一轮的分桶修复就是为这个买的 |
| `黑色钱包` 报 `missing` | 基准有，PDF 没有对应 `▶` 锚点。所以命中上限是 9/10 |
| `母女的缸中脑` 报 `ref-mismatch` | 它长在 `比较大的奇怪管道` 块上（上一轮判成场景的误报之一），基准里属 `维修间`。块边界与基准场景边界本就不一致，这条如实反映了它 |

评审与实跑时不要把这三条当缺陷去修。

## 错误处理

- `classifyItems`：失败 `console.warn` 返回空 Map，调用方降级为零个物品，实跑如实显示 0/10
- `buildItems`：不抛，除非某个 `input.key` 不在 `ids` 里（编程错误）。名字为空、查不到分类、
  分类为非 item/trap，全部计入 warnings
- `extractTrapMechanics` 返回 `null`（正文里一条机制都没抽到）：仍产出 `ModuleItem`，
  但不带 `trap` 字段，并计入 warnings。基准里 `trap` 缺省的语义是「该陷阱纯叙事，不结算」，
  与此一致

## 测试

单测在 `src/__tests__/`，`bun test`。

- `ingest-ids.test.ts`（由 `ingest-scene-id.test.ts` 改名）—— 原有 8 个测试保留，
  追加 `assignItemIds`：确定性、唯一性、ASCII、键形态 `p9:L13`、
  **覆盖全部条目而非过滤后的子集**（跨块编号连续，不因块分类而变）
- `ingest-classify-items.test.ts` —— `toItemInputs` 只取 scene 块、键形态 `p9:L13`、
  无名条目的 name 为空串仍进；prompt 把名字与正文都给全；解析器丢掉编造的键 / 非字符串 /
  枚举外的值；键归一化能吃掉 `【】`；坏响应不崩
- `ingest-build-items.test.ts` —— 只取 item/trap；`type` 三条规则各一例加兜底 `loot`；
  trap 类接上 `extractTrapMechanics` 且 `mech` 落到 `trap` 字段；`provenance.path` 已 rebase 成
  `items[<id>].trap.<field>`；名字为空被跳过并 warn；同名条目各得各的 id；
  可选字段确实没写进对象
- `ingest-calibrate.test.ts` 扩充 —— **不传 `refFields` 时行为不变（回归锁）**；
  `refFields` 命中产出 `ref-mismatch` 且不计入 `changed`；一侧缺该字段仍报 `missing`/`extra`；
  非字符串值不被拦截；`formatDiff` 计数行含该类

沿用既有约定：LLM 行为本身不做确定性单测，只测它两侧的纯函数。

## 验收

1. `bun test` 全绿，现有 147 个 ingest 测试零回归
2. 实跑产出「基准 10 个 `ModuleItem` 按 name 命中 N」，**上限 9**
3. 四个陷阱的 `TrapMechanics` 与基准逐字段 diff 并记录。`extract-trap` 首次校准时对出 9 处差异，
   其中 2 处是生成物比手写版更忠实原文（音响陷阱的 `sc0/1d3`、硫酸陷阱的闪避）——
   这次若复现，该改的是基准
4. `ModuleData.provenance` 第一次有内容，且 path 可解析
5. `docs/index-program.md` 状态表加行，写实测值，并标明是否单次采样

## 已否决的方案

| 方案 | 否决理由 |
|---|---|
| 本轮做线索 | 基准线索名是重写过的，39 个条目里只有 2 个逐字命中，没法按名字计分 |
| 分类器直接返回 `ModuleItem.type` | 把「是不是物品」与「是哪种物品」焊成一个判断，前者错了后者无意义，实跑出问题分不开层 |
| 用规则筛「像物品的条目」 | 「这一块是不是 X」是语义判断，文本形态定不了——引文判场景 15/6/5 已经验证过 |
| 只做分类不建物品 | 39 个条目里只有 9 个能被名字验证，其余 30 个分得对不对无从得知 |
| 手建 39 行评分键 | 人工标注，且那份键必须永远不进 prompt；建物品能用现成校准器拿到同等信息 |
| 实跑脚本里把引用解析成场景名再比 | 比对前动了数据；上一轮已因这个理由否掉过一次同类做法 |
