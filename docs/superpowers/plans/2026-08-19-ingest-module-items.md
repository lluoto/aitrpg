# 模组摄取 · `▶` 条目分类与 ModuleItem 抽取 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 39 个 `▶` 条目按语义分类，并把其中的物品与陷阱建成 `ModuleItem[]`，拿到「基准 10 个物品按 name 命中几个」这个数（上限 9）。

**Architecture:** 三个新的纯函数模块（`toItemInputs` → `classifyItems` → `buildItems`）挂在已有管线旁路上；陷阱直接接已验证的 `extractTrapMechanics`；校准器加引用字段处理，好让 `sceneId` 的差异不污染 `changed`。

**Tech Stack:** Bun + TypeScript，`bun test` 内置测试器。

**Spec:** `docs/superpowers/specs/2026-08-19-ingest-module-items-design.md`

## Global Constraints

- 运行时是 Bun。测试 `bun test`，类型检查 `bun run typecheck`。两者都必须绿。
- **不新增任何依赖。** `package.json` 的 dependencies 保持 `pdf-parse` + `yaml` 两项。
- **源文件不要用 PowerShell 写或读**：`Set-Content` 会把中文写成 mojibake，`Get-Content` 读出来也是花的。一律用编辑/读取工具。
- shell 的 `workdir` 参数在本机会卡死。要在仓库里跑命令，写 `cd C:\aitrpg\poc; <命令>`。
- `tools/` 整个目录被 `.gitignore` 排除，不能承载任何需要被测试的逻辑。
- 注释用中文，写「为什么这么定」而不是「这行在干什么」。
- commit message 用 conventional commits，描述句用英文小写陈述句。
- 现有 8 个 ingest 测试文件共 **147 个测试**，零回归是每一步的硬前提。全量基线 **1127 pass / 0 fail**。
- 已知既存偶发：`src/__tests__/coc-engine.test.ts:131` 约 1%/次失败（`SanityEngine(1)` 配 `roll <= 1`，无种子 d100）。见到**只有这一条**红就重跑确认并记下，不要去追。
- 本轮明确不做：线索、`connections`、NPC 字段、`description`/`atmosphere` 切分、修分类器以标题为键的重名缺陷。

## 三处已知会产生的差异，是对的，不要去修

| 差异 | 原因 |
|---|---|
| `驾驶证` 一个配上、一个报 `extra` | PDF 在 `证物室` 与 `交火现场` 各写一次，基准只收了一个 |
| `黑色钱包` 报 `missing` | 基准有，PDF 没有对应 `▶` 锚点。所以命中上限是 9/10 |
| `母女的缸中脑` 报 `ref-mismatch` | 它长在 `比较大的奇怪管道` 块上（上一轮判成场景的误报之一），基准里属 `维修间` |

## 文件结构

| 文件 | 责任 |
|---|---|
| `src/ingest/sectionize.ts`【改】 | 加 `sourceKey(ref)` —— `SourceRef` 是它定义的，怎么变成字符串该由它负责 |
| `src/ingest/scene-id.ts` → `src/ingest/ids.ts`【改名+扩】 | 两种 id 分配共处一室，共用编号实现 |
| `src/ingest/classify-items.ts`【新】 | `Section` → `ItemInput`，以及 `▶` 属于哪一类的 LLM 判断 |
| `src/ingest/build-items.ts`【新】 | item/trap 两类 → `ModuleItem[]` + rebase 过的 `Provenance[]` |
| `src/ingest/calibrate.ts`【改】 | `refFields` 与 `ref-mismatch` |
| `src/module/types.ts`【改】 | 两处文档注释：`Provenance.sourceRef` 的坐标系、`Provenance.path` 的形式 |
| `tools/_run-ingest.ts`【改，不进版本库】 | 串上新的一段，落盘 |

---

### Task 1: sourceKey 与 id 模块合并

**Files:**
- Modify: `src/ingest/sectionize.ts`（在 `SourceRef` 定义之后追加一个导出）
- Rename: `src/ingest/scene-id.ts` → `src/ingest/ids.ts`，并追加 `assignItemIds`
- Rename: `src/__tests__/ingest-scene-id.test.ts` → `src/__tests__/ingest-ids.test.ts`
- Modify: `src/ingest/build-scenes.ts`（改一行 import）
- Modify: `src/module/types.ts`（`Provenance.sourceRef` 的文档注释）

**Interfaces:**
- Produces:
  ```ts
  function sourceKey(ref: SourceRef): string            // "p9:L13"
  function assignSceneIds(sections: Section[]): string[] // 不变
  function assignItemIds(sections: Section[]): Map<string, string> // key 是 sourceKey，值是 item_NN
  ```

- [ ] **Step 1: 写失败的测试**

先用 `git mv` 保住历史：

```bash
cd C:\aitrpg\poc; git mv src/ingest/scene-id.ts src/ingest/ids.ts; git mv src/__tests__/ingest-scene-id.test.ts src/__tests__/ingest-ids.test.ts
```

把 `src/__tests__/ingest-ids.test.ts` 顶部的 import 从 `../ingest/scene-id` 改成 `../ingest/ids`，**其余 8 个测试一字不动**。然后在文件末尾追加：

文件顶部已有一行 `import { assignSceneIds } from "../ingest/ids";` 和一行
`import type { Section } from "../ingest/sectionize";`（改完路径之后）。把 `assignItemIds`
并进前者、`SectionItem` 并进后者，另起一行加值导入 `sourceKey`——**不要为同一个模块
新开三条 import**（上一轮已经因为这个被评审点过）。

```ts
// 顶部：assignItemIds 并进 ids 那行；SectionItem 并进类型导入那行；sourceKey 单起一行
import { sourceKey } from "../ingest/sectionize";

const item = (name: string, page: number, line: number): SectionItem => ({
  name,
  text: "x",
  source: { page, line },
});

const secWith = (title: string, items: SectionItem[]): Section => ({
  title,
  body: "",
  items,
  source: { page: 1, line: 1 },
});

describe("sourceKey", () => {
  test("形态是 pN:LN", () => {
    expect(sourceKey({ page: 9, line: 13 })).toBe("p9:L13");
  });

  test("不补零 —— 页码行号本来就是数，补零只会多一套要记的规矩", () => {
    expect(sourceKey({ page: 1, line: 1 })).toBe("p1:L1");
  });
});

describe("assignItemIds", () => {
  test("以 sourceKey 为键 —— 标题会重复，页内行号不会", () => {
    const ids = assignItemIds([secWith("农场外围", [item("捕兽夹", 9, 13)])]);
    expect(ids.get("p9:L13")).toBe("item_01");
  });

  test("跨块连续编号", () => {
    const ids = assignItemIds([
      secWith("甲", [item("a", 1, 1), item("b", 1, 2)]),
      secWith("乙", [item("c", 2, 1)]),
    ]);
    expect([...ids.values()]).toEqual(["item_01", "item_02", "item_03"]);
  });

  test("覆盖全部条目，不只是场景块上的 —— 筛选依赖分类结果，编号不能跟着它漂", () => {
    // 一个块从 scene 翻成 npc，它名下的条目就消失。若只给筛选后的编号，
    // 后面所有 id 会集体挪位，跨版本 diff 就没法比了。
    const ids = assignItemIds([
      secWith("菲碧·特里坎", [item("", 3, 8)]),
      secWith("农场外围", [item("捕兽夹", 9, 13)]),
    ]);
    expect(ids.size).toBe(2);
    expect(ids.get("p9:L13")).toBe("item_02");
  });

  test("同一份输入两次跑出同一批 id", () => {
    const input = [secWith("甲", [item("a", 1, 1), item("b", 1, 2)])];
    expect([...assignItemIds(input)]).toEqual([...assignItemIds(input)]);
  });

  test("全部唯一且纯 ASCII", () => {
    const items = Array.from({ length: 39 }, (_, i) => item(`条目${i}`, 1, i + 1));
    const ids = assignItemIds([secWith("甲", items)]);
    expect(new Set(ids.values()).size).toBe(39);
    for (const id of ids.values()) expect(id).toMatch(/^[a-z0-9_]+$/);
  });

  test("没有条目时给空表", () => {
    expect(assignItemIds([secWith("甲", [])]).size).toBe(0);
  });
});
```

文件顶部原有的 `Section` 类型导入若尚未存在，一并补上。

- [ ] **Step 2: 跑一次确认它失败**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-ids.test.ts`
Expected: FAIL，`sourceKey` 与 `assignItemIds` 都不是导出

- [ ] **Step 3: 写实现**

在 `src/ingest/sectionize.ts` 的 `SourceRef` 接口（第 29–35 行那段）之后插入：

```ts
/**
 * 位置的字符串形式，如 `p9:L13`。
 *
 * 条目分类以它为键。不能像块分类那样以名字为键 —— 标题会重复
 * （`驾驶证` 在证物室和交火现场各出现一次），而页内行号天然唯一，
 * 同一行不会有两个条目。
 *
 * 它同时充当 Provenance.sourceRef。注意这确立的是「PDF 页号 + 页内行号」
 * 这个坐标系：raw 切片文件加行号是另一套，两者指的不是同一个东西，别混着长。
 */
export function sourceKey(ref: SourceRef): string {
  return `p${ref.page}:L${ref.line}`;
}
```

把 `src/ingest/ids.ts` 的头部注释首行由 `// 摄取管线 · 场景 id 分配` 改为：

```ts
// 摄取管线 · id 分配
//
// 模块原名 scene-id.ts。改名是因为它给的从来就不只是场景的 id ——
// assignSceneIds 给**每个块**编号（含前言、附录、空标题前置块），
// 而本轮又要给 ▶ 条目编号，两者共用同一套编号实现。
```

（其下原有的四条 id 需求与形态理由整段保留，一字不改。）

在 `assignSceneIds` 之后追加：

```ts
/**
 * 给全文的 ▶ 条目分配 id，键是 sourceKey（`p9:L13`）。
 *
 * 必须覆盖**全部**条目，不能只覆盖「长在场景块上」的那批：那个筛选依赖块分类结果，
 * 一个块从 scene 翻成 npc，它名下的条目就消失，后面所有 id 集体挪位。
 * assignSceneIds 按全部块编号，正是为了避开这件事。
 *
 * 返回 Map 而不是像 assignSceneIds 那样返回等长数组，是因为键的性质不同：
 * 标题会重复，p{page}:L{line} 不会。以它为键既安全，下游也不必再维护一层下标对应。
 */
export function assignItemIds(sections: Section[]): Map<string, string> {
  const out = new Map<string, string>();
  let n = 0;
  for (const s of sections) {
    for (const it of s.items) {
      n++;
      out.set(sourceKey(it.source), `item_${pad(n)}`);
    }
  }
  return out;
}
```

`ids.ts` 顶部的 import 改成：

```ts
import type { Section } from "./sectionize";
import { sourceKey } from "./sectionize";
```

`src/ingest/build-scenes.ts` 里那行 `from "./scene-id"` 改成 `from "./ids"`（若它导入的是类型以外的东西；只导入类型时同样要改路径）。用 grep 确认全仓再无 `scene-id` 引用：

```bash
cd C:\aitrpg\poc; Select-String -Path src\*.ts,src\**\*.ts -Pattern "scene-id" -SimpleMatch
```

Expected: 无输出。

最后改 `src/module/types.ts` 里 `Provenance.sourceRef` 的注释：

```ts
  /**
   * 原文位置。摄取管线给的形态是 `p9:L13`（PDF 页号 + 页内行号），
   * 由 sectionize 的 sourceKey() 产出。
   *
   * 别和 `raw/section_09.txt:L42` 那种写法混着用 —— 后者指的是 raw 切片文件，
   * 而切片是派生物且不进版本库，PDF 才是权威源。
   */
  sourceRef?: string;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-ids.test.ts`
Expected: PASS，8 + 8 = 16 tests

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd C:\aitrpg\poc; bun test; bun run typecheck`
Expected: 全部通过，1127 → 1135

- [ ] **Step 6: 提交**

```bash
cd C:\aitrpg\poc; git add -A src/ingest/ids.ts src/ingest/sectionize.ts src/ingest/build-scenes.ts src/module/types.ts src/__tests__/ingest-ids.test.ts; git commit -m "feat(ingest): number the entries too, and give positions a name"
```

---

### Task 2: `▶` 条目分类

**Files:**
- Create: `src/ingest/classify-items.ts`
- Test: `src/__tests__/ingest-classify-items.test.ts`

**Interfaces:**
- Consumes: `Section` / `SectionItem` / `sourceKey`（`sectionize.ts`）、`SectionKind`（`classify-sections.ts`）、`LLMClient`（`llm/client.ts`）
- Produces:
  ```ts
  type ItemKind = "clue" | "item" | "trap" | "connection" | "npc_knowledge" | "event"
  interface ItemInput { key: string; sceneTitle: string; sceneId: string; name: string; text: string }
  function toItemInputs(sections: Section[], kinds: Map<string, SectionKind>, ids: string[]): ItemInput[]
  function buildItemPrompt(inputs: ItemInput[]): string
  function parseItemResponse(text: string, knownKeys: string[]): Map<string, ItemKind>
  function classifyItems(inputs: ItemInput[], client: LLMClient): Promise<Map<string, ItemKind>>
  ```

- [ ] **Step 1: 写失败的测试**

创建 `src/__tests__/ingest-classify-items.test.ts`：

```ts
// 摄取管线 · ▶ 条目分类
//
// LLM 的回答本身没法做确定性单测，能测的是它两侧的纯函数：
// 输入组装有没有把该给的都给全，以及回答坏掉时解析器扛不扛得住。
// 模型行为靠实跑对基准验证，不靠单测假装验证。

import { describe, test, expect } from "bun:test";
import { toItemInputs, buildItemPrompt, parseItemResponse } from "../ingest/classify-items";
import type { Section, SectionItem } from "../ingest/sectionize";
import type { SectionKind } from "../ingest/classify-sections";

const item = (name: string, text: string, page: number, line: number): SectionItem => ({
  name,
  text,
  source: { page, line },
});

const sec = (title: string, items: SectionItem[]): Section => ({
  title,
  body: "",
  items,
  source: { page: 1, line: 1 },
});

const kinds = (pairs: Array<[string, SectionKind]>) => new Map<string, SectionKind>(pairs);

describe("toItemInputs", () => {
  test("只取场景块上的条目", () => {
    const secs = [
      sec("农场外围", [item("捕兽夹", "1D4+1", 9, 13)]),
      sec("菲碧·特里坎", [item("", "她只知道加比比较叛逆", 3, 8)]),
    ];
    const out = toItemInputs(secs, kinds([["农场外围", "scene"], ["菲碧·特里坎", "npc"]]), ["scene_01", "scene_02"]);
    expect(out.map((i) => i.key)).toEqual(["p9:L13"]);
  });

  test("带上所属场景的 id 与标题 —— 物品要知道自己在哪个场景", () => {
    const out = toItemInputs(
      [sec("前言", []), sec("农场外围", [item("捕兽夹", "x", 9, 13)])],
      kinds([["农场外围", "scene"]]),
      ["scene_01", "scene_02"],
    );
    expect(out[0]).toMatchObject({ sceneId: "scene_02", sceneTitle: "农场外围" });
  });

  test("无名条目照样进 —— 39 个里有 8 个整行没冒号，名字为空串", () => {
    const out = toItemInputs(
      [sec("维森酒吧", [item("", "使用卡片询问免费饮品", 4, 12)])],
      kinds([["维森酒吧", "scene"]]),
      ["scene_01"],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("");
  });

  test("查不到分类的块不取 —— 不猜", () => {
    const out = toItemInputs([sec("来路不明", [item("x", "y", 1, 2)])], kinds([]), ["scene_01"]);
    expect(out).toEqual([]);
  });

  test("ids 与 sections 长度不符直接抛", () => {
    expect(() => toItemInputs([sec("甲", []), sec("乙", [])], kinds([]), ["scene_01"])).toThrow();
  });
});

describe("buildItemPrompt", () => {
  test("键、场景、名字、正文都进 prompt", () => {
    const p = buildItemPrompt([
      { key: "p9:L13", sceneTitle: "农场外围", sceneId: "scene_11", name: "捕兽夹", text: "造成 1D4+1 的伤害" },
    ]);
    expect(p).toContain("p9:L13");
    expect(p).toContain("农场外围");
    expect(p).toContain("捕兽夹");
    expect(p).toContain("造成 1D4+1 的伤害".replace(/\s+/g, ""));
  });

  test("六个类别名都在 prompt 里 —— 少一个模型就永远不会返回它", () => {
    const p = buildItemPrompt([{ key: "p1:L1", sceneTitle: "甲", sceneId: "scene_01", name: "x", text: "y" }]);
    for (const k of ["clue", "item", "trap", "connection", "npc_knowledge", "event"]) {
      expect(p).toContain(k);
    }
  });

  test("无名条目也要能渲染，不能塌成空行", () => {
    const p = buildItemPrompt([
      { key: "p4:L12", sceneTitle: "维森酒吧", sceneId: "scene_04", name: "", text: "使用卡片询问免费饮品" },
    ]);
    expect(p).toContain("p4:L12");
    expect(p).toContain("使用卡片询问免费饮品");
  });
});

describe("parseItemResponse", () => {
  const known = ["p9:L13", "p4:L12"];

  test("认得干净的 JSON", () => {
    const m = parseItemResponse('{"p9:L13":"trap","p4:L12":"clue"}', known);
    expect(m.get("p9:L13")).toBe("trap");
    expect(m.get("p4:L12")).toBe("clue");
  });

  test("代码围栏里的也认", () => {
    const m = parseItemResponse('```json\n{"p9:L13":"trap"}\n```', known);
    expect(m.get("p9:L13")).toBe("trap");
  });

  test("模型把整行抄回来当键也认 —— 展示格式不该变成输出格式的契约", () => {
    // 上一轮就栽在这：prompt 里标题展示成【农场外围】，模型照抄回来，
    // 43 条全被丢弃，表现成「模型没干活」，实际它全做对了。
    const m = parseItemResponse('{"p9:L13 【农场外围】捕兽夹":"trap"}', known);
    expect(m.get("p9:L13")).toBe("trap");
  });

  test("编造的键丢掉", () => {
    expect(parseItemResponse('{"p99:L99":"trap"}', known).size).toBe(0);
  });

  test("枚举外的类别丢掉，不做兜底猜测", () => {
    expect(parseItemResponse('{"p9:L13":"物品"}', known).size).toBe(0);
  });

  test("值不是字符串就丢掉", () => {
    expect(parseItemResponse('{"p9:L13":["trap"]}', known).size).toBe(0);
  });

  test("整个回答不是 JSON 时给空表，不崩", () => {
    expect(parseItemResponse("我认为第一条是陷阱。", known).size).toBe(0);
  });

  test("空回答给空表", () => {
    expect(parseItemResponse("", known).size).toBe(0);
  });
});
```

- [ ] **Step 2: 跑一次确认它失败**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-classify-items.test.ts`
Expected: FAIL，找不到模块 `../ingest/classify-items`

- [ ] **Step 3: 写实现**

创建 `src/ingest/classify-items.ts`：

```ts
// 摄取管线 · ▶ 条目分类（LLM 层）
//
// ▶ 不是线索标记，是通用的子条目标记。把 39 个条目逐条对回基准，底下混着六种东西：
// 陷阱、可拿走的物品、场景之间的进入方式、NPC 知道的事、分支结局叙事，才是线索。
// 「这一条是哪一种」是语义判断，与块分类同一类问题，归 LLM。
//
// 键用 sourceKey 而不是名字。块分类以标题为键，重名时静默互相覆盖 ——
// 那个缺陷本轮不修，但不能在这里重演一遍：`驾驶证` 在证物室和交火现场各出现一次。

import type { LLMClient } from "../llm/client";
import type { Section } from "./sectionize";
import { sourceKey } from "./sectionize";
import type { SectionKind } from "./classify-sections";

export type ItemKind = "clue" | "item" | "trap" | "connection" | "npc_knowledge" | "event";

const VALID: readonly string[] = ["clue", "item", "trap", "connection", "npc_knowledge", "event"];

/** 单条给模型看的正文上限。39 条乘全文会把 prompt 撑大，且条目正文本就不长 */
const EXCERPT_MAX = 160;

export interface ItemInput {
  /** 唯一键，形如 `p9:L13`；同时就是这条的 Provenance.sourceRef */
  key: string;
  /** 所属块标题，给模型上下文 */
  sceneTitle: string;
  /** 所属场景 id */
  sceneId: string;
  /** ▶ 与第一个冒号之间那截；39 条里有 8 条没有，为空串 */
  name: string;
  /** 冒号之后的正文；没有冒号时是整行 */
  text: string;
}

/**
 * Section → ItemInput。只取被判成 scene 的块上的条目。
 *
 * npc 块上的条目（菲碧·特里坎名下那两条）在基准里是 ModuleNPC.knowledge / .secrets，
 * 是另一轮的事；rule/structure 块上的条目不属于任何场景。查不到分类的块一律不取，不猜。
 */
export function toItemInputs(
  sections: Section[],
  kinds: Map<string, SectionKind>,
  ids: string[],
): ItemInput[] {
  if (ids.length !== sections.length) {
    throw new Error(`[ingest] ids 与 sections 长度不符：${ids.length} vs ${sections.length}`);
  }

  const out: ItemInput[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i] as Section;
    if (s.title === "") continue;
    if (kinds.get(s.title) !== "scene") continue;
    for (const it of s.items) {
      out.push({
        key: sourceKey(it.source),
        sceneTitle: s.title,
        sceneId: ids[i] as string,
        name: it.name,
        text: it.text,
      });
    }
  }
  return out;
}

export function buildItemPrompt(inputs: ItemInput[]): string {
  const list = inputs
    .map((it) => {
      const head = it.name === "" ? "(无标题)" : it.name;
      return `${it.key} 【${it.sceneTitle}】${head}：${it.text.slice(0, EXCERPT_MAX).replace(/\s+/g, "")}`;
    })
    .join("\n");

  return `下面是一个克苏鲁的呼唤（CoC）跑团模组里，各个场景名下用 ▶ 标出的条目。请判断每一条属于哪一类。

类别：
- item：调查员可以拿走、之后还能用的实体物品。钥匙、照片、证件、文件之类。
- trap：会对调查员造成伤害或理智损失的机关。
- clue：调查员通过搜查、检定或观察得知的信息。它本身不是能拿走的东西，是"知道了某件事"。
- connection：进入或离开这个场景的方式。门、梯子、可以爬上去的杂物堆之类。
- npc_knowledge：某个人物知道的事或隐瞒的事，说的是人不是地方。
- event：条件触发的一段剧情或结局分支，通常写成"如果调查员……就会……"。

注意：
- 拿得走的是 item，知道了的是 clue。"床头柜里有日记本"重点是发现了这件事，算 clue；"防盗门的钥匙"本身就是那件东西，算 item。
- 有的条目没有标题，只有正文，照样要判。

条目：
${list}

只输出 JSON，不要任何解释文字。格式为 {"条目键": "类别"}，键必须是每行开头那个 pN:LN。`;
}

/** 从可能夹着解释文字或代码围栏的回答里抠出 JSON 对象 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? (fenced[1] as string) : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 归一化模型给回来的键。
 *
 * 上一轮的教训：prompt 里把标题展示成 `【农场外围】`，模型就照这个格式返回键，
 * 43 条全被解析器丢掉，表现成「模型没干活」，实际它全做对了。
 * 展示格式不该变成输出格式的契约，解析这边兜住。
 *
 * 这里键是行首的 pN:LN，模型可能只回它，也可能把整行抄回来。认行首那段即可。
 */
function normalizeKey(k: string): string {
  const m = k.match(/p\d+:L\d+/);
  return m ? m[0] : k.trim();
}

/**
 * 解析分类结果。认不出的一律丢弃，不做兜底猜测：
 * 把不认识的东西默认成某一类，会让分类结果虚高而没人察觉。
 */
export function parseItemResponse(text: string, knownKeys: string[]): Map<string, ItemKind> {
  const out = new Map<string, ItemKind>();
  const obj = extractJson(text ?? "");
  if (!obj || typeof obj !== "object") return out;
  const known = new Set(knownKeys);
  for (const [rawKey, v] of Object.entries(obj as Record<string, unknown>)) {
    const k = normalizeKey(rawKey);
    if (!known.has(k)) continue;
    if (typeof v !== "string") continue;
    if (!VALID.includes(v)) continue;
    out.set(k, v as ItemKind);
  }
  return out;
}

/**
 * 调 LLM 做分类。失败返回空表，由调用方决定怎么降级 ——
 * 不在这里静默塞一个「全都是 clue」的结果。
 */
export async function classifyItems(
  inputs: ItemInput[],
  client: LLMClient,
): Promise<Map<string, ItemKind>> {
  if (inputs.length === 0) return new Map();
  const prompt = buildItemPrompt(inputs);
  try {
    // 分类是判断题，低温度：DESIGN-LOG §4（检定低温度、叙事高温度）
    const reply = await client.chat([{ role: "user", content: prompt }], { temperature: 0.1 });
    return parseItemResponse(reply, inputs.map((i) => i.key));
  } catch (e) {
    console.warn(`[ingest] 条目分类失败，未产出分类: ${e instanceof Error ? e.message : String(e)}`);
    return new Map();
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-classify-items.test.ts`
Expected: PASS，16 tests（toItemInputs 5 / buildItemPrompt 3 / parseItemResponse 8）

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd C:\aitrpg\poc; bun test; bun run typecheck`
Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
cd C:\aitrpg\poc; git add src/ingest/classify-items.ts src/__tests__/ingest-classify-items.test.ts; git commit -m "feat(ingest): ask what each triangle actually is, since it marks six different things"
```

---

### Task 3: 建 ModuleItem

**Files:**
- Create: `src/ingest/build-items.ts`
- Test: `src/__tests__/ingest-build-items.test.ts`
- Modify: `src/module/types.ts`（`Provenance.path` 的文档注释）

**Interfaces:**
- Consumes: `ItemInput` / `ItemKind`（`classify-items.ts`）、`extractTrapMechanics`（`extract-trap.ts`）、`ModuleItem` / `Provenance`（`module/types.ts`）
- Produces:
  ```ts
  interface BuildItemsResult { items: ModuleItem[]; provenance: Provenance[]; warnings: string[] }
  function buildItems(inputs: ItemInput[], kinds: Map<string, ItemKind>, ids: Map<string, string>): BuildItemsResult
  ```

- [ ] **Step 1: 写失败的测试**

创建 `src/__tests__/ingest-build-items.test.ts`：

```ts
// 摄取管线 · ModuleItem 构建
//
// 本轮只取 item 与 trap 两类。type 由规则定（名字里有没有「钥匙」是死板形态），
// 陷阱机制接已经校准过的 extractTrapMechanics ——
// 能用规则抽的不交给 LLM，这是仓库既定的分工。

import { describe, test, expect } from "bun:test";
import { buildItems } from "../ingest/build-items";
import type { ItemInput, ItemKind } from "../ingest/classify-items";

const input = (key: string, name: string, text: string, sceneId = "scene_01"): ItemInput => ({
  key,
  sceneTitle: "某场景",
  sceneId,
  name,
  text,
});

const kinds = (pairs: Array<[string, ItemKind]>) => new Map<string, ItemKind>(pairs);
const ids = (pairs: Array<[string, string]>) => new Map<string, string>(pairs);

describe("挑条目", () => {
  test("只取 item 与 trap", () => {
    const ins = [
      input("p1:L1", "防盗门的钥匙", "用来打开谷仓的门"),
      input("p1:L2", "捕兽夹", "造成 1D4+1 的伤害"),
      input("p1:L3", "床头柜", "可以看到一本日记本"),
      input("p1:L4", "侧面的防盗门", "可以通过钥匙打开门"),
    ];
    const r = buildItems(
      ins,
      kinds([["p1:L1", "item"], ["p1:L2", "trap"], ["p1:L3", "clue"], ["p1:L4", "connection"]]),
      ids([["p1:L1", "item_01"], ["p1:L2", "item_02"], ["p1:L3", "item_03"], ["p1:L4", "item_04"]]),
    );
    expect(r.items.map((i) => i.name)).toEqual(["防盗门的钥匙", "捕兽夹"]);
  });

  test("查不到分类的跳过并计入 warnings —— 不猜", () => {
    const r = buildItems([input("p1:L1", "钥匙", "x")], kinds([]), ids([["p1:L1", "item_01"]]));
    expect(r.items).toEqual([]);
    expect(r.warnings.join()).toContain("没有分类结果");
  });

  test("空分类表给零个物品 —— LLM 挂掉时如实显示 0，不把所有条目当物品", () => {
    const ins = [input("p1:L1", "钥匙", "x"), input("p1:L2", "照片", "y")];
    const r = buildItems(ins, kinds([]), ids([["p1:L1", "item_01"], ["p1:L2", "item_02"]]));
    expect(r.items).toEqual([]);
  });
});

describe("字段口径", () => {
  test("id 按 key 取自 assignItemIds 的结果", () => {
    const r = buildItems(
      [input("p9:L13", "捕兽夹", "造成 1D4+1 的伤害")],
      kinds([["p9:L13", "trap"]]),
      ids([["p9:L13", "item_07"]]),
    );
    expect(r.items[0]?.id).toBe("item_07");
  });

  test("name 与 description 原样，sceneId 来自 input", () => {
    const r = buildItems(
      [input("p1:L1", "农场的照片", "可以对照着找到农场", "scene_09")],
      kinds([["p1:L1", "item"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(r.items[0]).toMatchObject({
      name: "农场的照片",
      description: "可以对照着找到农场",
      sceneId: "scene_09",
    });
  });

  test("可选字段一个都不写进对象", () => {
    const r = buildItems(
      [input("p1:L1", "农场的照片", "x")],
      kinds([["p1:L1", "item"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(Object.keys(r.items[0] ?? {}).sort()).toEqual(["description", "id", "name", "sceneId", "type"]);
  });
});

describe("type 由规则定", () => {
  const t = (name: string) =>
    buildItems([input("p1:L1", name, "x")], kinds([["p1:L1", "item"]]), ids([["p1:L1", "item_01"]]))
      .items[0]?.type;

  test("名字含「钥匙」→ key", () => {
    expect(t("防盗门的钥匙")).toBe("key");
    expect(t("住宅钥匙")).toBe("key");
  });

  test("名字含「照片/证/文件」→ document", () => {
    expect(t("农场的照片")).toBe("document");
    expect(t("驾驶证")).toBe("document");
    expect(t("老旧文件")).toBe("document");
  });

  test("都不中 → loot", () => {
    expect(t("黑色钱包")).toBe("loot");
  });

  test("只看 name 不看 text —— 正文里出现「钥匙」的条目多得是", () => {
    // 基准的「床头柜」正文就写着钥匙。拿正文匹配会把一堆东西判成 key
    const r = buildItems(
      [input("p1:L1", "黑色钱包", "里面有一把钥匙")],
      kinds([["p1:L1", "item"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(r.items[0]?.type).toBe("loot");
  });

  test("trap 类直接是 trap，不过 name 规则", () => {
    const r = buildItems(
      [input("p1:L1", "钥匙形状的陷阱", "造成 1d6 的伤害")],
      kinds([["p1:L1", "trap"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(r.items[0]?.type).toBe("trap");
  });
});

describe("陷阱接上已有的抽取器", () => {
  const bear = "体形小于 35 的角色会免疫这种陷阱，当踩中时陷阱会牢牢咬住被害者的腿，造成 1D4+1 的伤害。挣脱需要困难成功的力量来打开陷阱。";

  test("机制落到 trap 字段", () => {
    const r = buildItems(
      [input("p9:L13", "捕兽夹", bear)],
      kinds([["p9:L13", "trap"]]),
      ids([["p9:L13", "item_07"]]),
    );
    expect(r.items[0]?.trap).toMatchObject({ damage: "1D4+1", sizImmunityBelow: 35 });
  });

  test("provenance 的 path 已 rebase 到根，且用 id 不用下标", () => {
    // 下标路径在按名字配对之后没有意义 —— 上一轮已经确认过
    const r = buildItems(
      [input("p9:L13", "捕兽夹", bear)],
      kinds([["p9:L13", "trap"]]),
      ids([["p9:L13", "item_07"]]),
    );
    expect(r.provenance.map((p) => p.path)).toContain("items[item_07].trap.damage");
  });

  test("sourceRef 就是条目的键", () => {
    const r = buildItems(
      [input("p9:L13", "捕兽夹", bear)],
      kinds([["p9:L13", "trap"]]),
      ids([["p9:L13", "item_07"]]),
    );
    expect(r.provenance[0]?.sourceRef).toBe("p9:L13");
  });

  test("一条机制都抽不到时仍产出物品，只是不带 trap，并计入 warnings", () => {
    // 基准里 trap 缺省的语义就是「该陷阱纯叙事，不结算」
    const r = buildItems(
      [input("p1:L1", "看起来吓人的东西", "调查员会感到不安。")],
      kinds([["p1:L1", "trap"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(r.items).toHaveLength(1);
    expect("trap" in (r.items[0] ?? {})).toBe(false);
    expect(r.warnings.join()).toContain("抽不到");
  });
});

describe("无名条目", () => {
  test("被判成物品但没名字 → 跳过并 warn，因为没法被指认", () => {
    const r = buildItems([input("p4:L12", "", "使用卡片询问免费饮品")], kinds([["p4:L12", "item"]]), ids([["p4:L12", "item_01"]]));
    expect(r.items).toEqual([]);
    expect(r.warnings.join()).toContain("没有名字");
  });
});

describe("调用契约", () => {
  test("条目的 key 不在 ids 里直接抛 —— 那是编程错误", () => {
    expect(() => buildItems([input("p1:L1", "钥匙", "x")], kinds([["p1:L1", "item"]]), ids([]))).toThrow();
  });

  test("同名条目各得各的 id —— 驾驶证在两个块里各出现一次", () => {
    const r = buildItems(
      [input("p6:L17", "驾驶证", "住址"), input("p7:L12", "驾驶证", "住址")],
      kinds([["p6:L17", "item"], ["p7:L12", "item"]]),
      ids([["p6:L17", "item_10"], ["p7:L12", "item_14"]]),
    );
    expect(r.items.map((i) => i.id)).toEqual(["item_10", "item_14"]);
  });
});
```

- [ ] **Step 2: 跑一次确认它失败**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-build-items.test.ts`
Expected: FAIL，找不到模块 `../ingest/build-items`

- [ ] **Step 3: 写实现**

创建 `src/ingest/build-items.ts`：

```ts
// 摄取管线 · ModuleItem 构建
//
// 只取分类为 item 与 trap 的条目。基准 10 个物品里有 9 个的 name 能在 ▶ 名字里
// 原样找到，所以这一批是整条管线上少有的、能靠名字直接对分的字段。
//
// type 归规则、「是不是物品」归 LLM —— 名字里有没有「钥匙」是死板文本形态，
// 规则抽取可复现、可解释、不要 API key。

import type { ModuleItem, Provenance } from "../module/types";
import type { ItemInput, ItemKind } from "./classify-items";
import { extractTrapMechanics } from "./extract-trap";

export interface BuildItemsResult {
  items: ModuleItem[];
  /** 陷阱抽取的改写留痕，path 已 rebase 到根 */
  provenance: Provenance[];
  /** 跳过的条目、抽不到机制的陷阱 —— 不静默丢东西 */
  warnings: string[];
}

/**
 * 只拿 name 匹配，不看 text。
 *
 * 正文里出现「钥匙」的条目多得是 —— 基准的「床头柜」正文就写着钥匙 ——
 * 拿正文匹配会把一堆东西判成 key。
 *
 * weapon 不设规则：基准里没有非陷阱物品用它，凭空加一条只会多一个没人验证过的分支。
 */
const TYPE_RULES: Array<[RegExp, ModuleItem["type"]]> = [
  [/钥匙/, "key"],
  [/照片|驾驶证|证件|文件|协议|日记|信件/, "document"],
];

function itemType(name: string): ModuleItem["type"] {
  for (const [re, t] of TYPE_RULES) if (re.test(name)) return t;
  return "loot";
}

/**
 * 建物品。三个入参都以 ItemInput.key 对齐，没有下标耦合。
 */
export function buildItems(
  inputs: ItemInput[],
  kinds: Map<string, ItemKind>,
  ids: Map<string, string>,
): BuildItemsResult {
  const items: ModuleItem[] = [];
  const provenance: Provenance[] = [];
  const warnings: string[] = [];
  let unclassified = 0;
  let nameless = 0;
  let noMech = 0;

  for (const input of inputs) {
    const id = ids.get(input.key);
    if (id === undefined) throw new Error(`[ingest] 条目 ${input.key} 没有分到 id`);

    const kind = kinds.get(input.key);
    if (kind === undefined) {
      unclassified++;
      continue;
    }
    if (kind !== "item" && kind !== "trap") continue;

    // 物品没有名字就没法被指认 —— 校准器按 name 配对，叙事里也没法提起它。
    // 39 个条目里那 8 个无名的，基准里没有一个是物品，所以这条不会误伤；
    // 真触发了说明分类错了，该看见。
    if (input.name === "") {
      nameless++;
      continue;
    }

    const item: ModuleItem = {
      id,
      name: input.name,
      sceneId: input.sceneId,
      description: input.text,
      type: kind === "trap" ? "trap" : itemType(input.name),
    };

    if (kind === "trap") {
      const ex = extractTrapMechanics(input.name, input.text, input.key);
      if (ex) {
        item.trap = ex.mech;
        // rebase：抽取器产出的是相对路径（trap.damage），而 Provenance.path 的语义是根路径。
        // 用 id 不用下标 —— 下标路径在按身份配对之后没有意义，上一轮已经确认过。
        for (const p of ex.provenance) provenance.push({ ...p, path: `items[${id}].${p.path}` });
      } else {
        // 基准里 trap 缺省的语义就是「该陷阱纯叙事，不结算」，与此一致
        noMech++;
      }
    }

    items.push(item);
  }

  if (unclassified > 0) warnings.push(`${unclassified} 个条目没有分类结果，已跳过`);
  if (nameless > 0) warnings.push(`${nameless} 个条目被判成物品/陷阱但没有名字，已跳过`);
  if (noMech > 0) warnings.push(`${noMech} 个陷阱条目一条机制都抽不到，按纯叙事处理（不带 trap 字段）`);

  return { items, provenance, warnings };
}
```

改 `src/module/types.ts` 里 `Provenance.path` 的注释：

```ts
  /**
   * 被改写的字段路径。数组段用元素的 id，如 `items[item_07].trap.damage`。
   *
   * 不用下标：产出物的顺序不必与手写那份一致，下标路径在按身份配对之后
   * 既指不出是哪一条，也会随任一侧重排而漂。
   */
  path: string;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-build-items.test.ts`
Expected: PASS，18 tests（挑条目 3 / 字段口径 3 / type 5 / 陷阱 4 / 无名 1 / 契约 2）

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd C:\aitrpg\poc; bun test; bun run typecheck`
Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
cd C:\aitrpg\poc; git add src/ingest/build-items.ts src/__tests__/ingest-build-items.test.ts src/module/types.ts; git commit -m "feat(ingest): build the items, and finally keep the trap provenance someone was already producing"
```

---

### Task 4: 校准器认识引用字段

**Files:**
- Modify: `src/ingest/calibrate.ts`
- Test: `src/__tests__/ingest-calibrate.test.ts`（追加；现有 **38** 个测试一个都不许改）

**Interfaces:**
- Produces:
  ```ts
  interface FieldDiff { path: string; kind: "missing" | "extra" | "changed" | "id-mismatch" | "ref-mismatch"; baseline?: unknown; candidate?: unknown }
  interface DiffOptions { pairBy?: string[]; refFields?: string[] }
  ```

- [ ] **Step 1: 写失败的测试**

在 `src/__tests__/ingest-calibrate.test.ts` 末尾追加：

```ts
describe("引用字段", () => {
  test("refFields 里的字段值不同 → ref-mismatch，不计入 changed", () => {
    // sceneId 是指向 id 的引用，不是内容。生成侧只会是 scene_NN，
    // 基准是手写意译 police_evidence_room，两者本就不会一样
    const a = { items: [{ id: "key_anti_theft", name: "防盗门的钥匙", sceneId: "police_evidence_room" }] };
    const b = { items: [{ id: "item_10", name: "防盗门的钥匙", sceneId: "scene_09" }] };
    const d = diffValues(a, b, { pairBy: ["id", "name"], refFields: ["sceneId"] });
    expect(d.filter((x) => x.kind === "changed")).toEqual([]);
    expect(at(d, "items[防盗门的钥匙].sceneId")).toMatchObject({
      kind: "ref-mismatch",
      baseline: "police_evidence_room",
      candidate: "scene_09",
    });
  });

  test("不传 refFields 时该字段仍是 changed —— 默认行为不变", () => {
    const a = { items: [{ id: "k", name: "钥匙", sceneId: "police_evidence_room" }] };
    const b = { items: [{ id: "k", name: "钥匙", sceneId: "scene_09" }] };
    expect(at(diffValues(a, b), "items[k].sceneId")?.kind).toBe("changed");
  });

  test("值相同则无差异", () => {
    const a = { items: [{ id: "k", sceneId: "s1" }] };
    const b = { items: [{ id: "k", sceneId: "s1" }] };
    expect(diffValues(a, b, { refFields: ["sceneId"] })).toEqual([]);
  });

  test("一侧压根没有该字段仍报 missing —— 那是真缺字段，不是引用对不上", () => {
    const a = { items: [{ id: "k", sceneId: "s1" }] };
    const b = { items: [{ id: "k" }] };
    expect(at(diffValues(a, b, { refFields: ["sceneId"] }), "items[k].sceneId")?.kind).toBe("missing");
  });

  test("值不是字符串就不拦截 —— 引用只可能是 id 字符串", () => {
    const a = { items: [{ id: "k", sceneId: 1 }] };
    const b = { items: [{ id: "k", sceneId: 2 }] };
    expect(at(diffValues(a, b, { refFields: ["sceneId"] }), "items[k].sceneId")?.kind).toBe("changed");
  });

  test("多个引用字段一起声明", () => {
    const a = { x: { aId: "p", bId: "q" } };
    const b = { x: { aId: "r", bId: "s" } };
    const d = diffValues(a, b, { refFields: ["aId", "bId"] });
    expect(d.filter((x) => x.kind === "ref-mismatch")).toHaveLength(2);
  });

  test("统计行列出引用不一致的条数", () => {
    const a = { items: [{ id: "k", sceneId: "s1" }] };
    const b = { items: [{ id: "k", sceneId: "s2" }] };
    expect(formatDiff(diffValues(a, b, { refFields: ["sceneId"] }))).toContain("引用不一致 1");
  });
});
```

- [ ] **Step 2: 跑一次确认它失败**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-calibrate.test.ts`
Expected: FAIL，`DiffOptions` 没有 `refFields`

- [ ] **Step 3: 改实现**

`src/ingest/calibrate.ts` 五处改动。

**其一**，`FieldDiff.kind` 加一项：

```ts
  kind: "missing" | "extra" | "changed" | "id-mismatch" | "ref-mismatch";
```

**其二**，`DiffOptions` 加字段（`pairBy` 及其长注释一字不动）：

```ts
  /**
   * 引用字段：值是指向别处 id 的句柄，不是内容。
   *
   * 基准 `key_anti_theft.sceneId` 是 `police_evidence_room`，生成侧只会是 `scene_NN`。
   * 按名字配上之后这些字段会全部报成 changed —— 但那不是生成器不准，
   * 它是「id 是内部句柄」往下再走一层：sceneId 是指向 id 的引用。
   * 不摘出去，changed 就混进了不该算的东西，而 connections[].targetSceneId、
   * npcIds[] 只会让这个污染更重。
   *
   * `id` 不要放进来 —— 它已由 id-mismatch 处理，重叠会同一件事报两遍。
   */
  refFields?: string[];
```

**其三**，把逐层传递的 `pairBy: string[]` 换成一个上下文对象。`walk` 现在有 6 个参数，再加一个只会更难读，而这两项配置本就是一伙的：

```ts
/** 逐层传递的比对配置 */
interface WalkCtx {
  pairBy: string[];
  refFields: string[];
}
```

`walk` 与 `walkArray` 的签名相应改为收 `ctx: WalkCtx`，函数体内所有 `pairBy` 的引用改成 `ctx.pairBy`，所有递归调用传 `ctx`。`pickPairKeys(baseline, candidate, ctx.pairBy)` 保持原样不变。

**其四**，`walk` 的对象分支加引用字段拦截：

```ts
  if (isObj(baseline) && isObj(candidate)) {
    for (const k of new Set([...Object.keys(baseline), ...Object.keys(candidate)])) {
      if (k === skipKey) continue;
      const b = baseline[k];
      const c = candidate[k];
      // 引用字段只在「两侧都有值、且值不同」时拦截。
      // 一侧缺失是真缺字段，非字符串是形状问题 —— 两者都该照常报，
      // 交给下面的 walk 处理。
      if (
        ctx.refFields.includes(k) &&
        typeof b === "string" && b !== "" &&
        typeof c === "string" && c !== "" &&
        b !== c
      ) {
        out.push({ path: join(path, k), kind: "ref-mismatch", baseline: b, candidate: c });
        continue;
      }
      walk(b, c, join(path, k), out, ctx);
    }
    return;
  }
```

**其五**，`diffValues` 与 `formatDiff`：

```ts
export function diffValues(baseline: unknown, candidate: unknown, opts: DiffOptions = {}): FieldDiff[] {
  const out: FieldDiff[] = [];
  walk(baseline, candidate, "", out, {
    pairBy: opts.pairBy ?? ["id"],
    refFields: opts.refFields ?? [],
  });
  return out;
}
```

`formatDiff` 里计数表加一项、统计行加一段、渲染分支加一条：

```ts
  const byKind: Record<FieldDiff["kind"], number> = {
    missing: 0, extra: 0, changed: 0, "id-mismatch": 0, "ref-mismatch": 0,
  };
```

```ts
  lines.push(
    `差异 ${diffs.length} 处 — changed ${byKind.changed} / missing ${byKind.missing} / extra ${byKind.extra} / id 不一致 ${byKind["id-mismatch"]} / 引用不一致 ${byKind["ref-mismatch"]}`,
  );
```

```ts
    else if (d.kind === "id-mismatch") lines.push(`  [id 不一致] ${d.path}   基准 ${show(d.baseline)} ↔ 生成 ${show(d.candidate)}`);
    else lines.push(`  [引用不一致] ${d.path}   基准 ${show(d.baseline)} ↔ 生成 ${show(d.candidate)}`);
```

（原先最后那个 `else` 处理的是 `id-mismatch`，现在要显式判掉它，否则 `ref-mismatch` 会被印成 id 的格式。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-calibrate.test.ts`
Expected: PASS，38 + 7 = 45 tests。**若原有 38 个中有任何一个红了，是改动破坏了默认行为，回到 Step 3 修，不要改老测试。**

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd C:\aitrpg\poc; bun test; bun run typecheck`
Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
cd C:\aitrpg\poc; git add src/ingest/calibrate.ts src/__tests__/ingest-calibrate.test.ts; git commit -m "feat(ingest): tell a pointer apart from a value"
```

---

### Task 5: 串起来实跑，把数字写进索引

**Files:**
- Modify: `tools/_run-ingest.ts`（**被 .gitignore 排除，不进版本库**）
- Modify: `docs/index-program.md`

**Interfaces:**
- Consumes: 上面四个任务的全部导出，加已有的 `extractPages` / `cleanPageText` / `sectionize` / `toClassifyInputs` / `classifySections` / `assignSceneIds` / `buildScenes` / `BARN_OF_PREMIER`

- [ ] **Step 1: 先确认 LLM 真的通**

不要拿 `bun test` 的 `[config] No LLM_API_KEY set` 或历史文档当证据——那是测试在验证无 key 的降级路径。判断 LLM 通不通必须实际发一次请求。

创建 `tools/_probe-llm.ts`：

```ts
import { loadConfig } from "../src/config";
import { LLMClient } from "../src/llm/client";

const client = new LLMClient(loadConfig());
const reply = await client.chat([{ role: "user", content: "只回复两个字：收到" }], { temperature: 0 });
await Bun.write("tools/_probe-llm-out.txt", `回复: ${reply}`);
```

Run: `cd C:\aitrpg\poc; bun tools/_probe-llm.ts`，用读取工具看 `tools/_probe-llm-out.txt`。
拿不到回复就报 BLOCKED，不要带着熔断的客户端往下跑——那样只会得到 0/10 而不知道原因。

跑通后删掉：`cd C:\aitrpg\poc; Remove-Item tools/_probe-llm.ts, tools/_probe-llm-out.txt`

- [ ] **Step 2: 扩实跑脚本**

`tools/_run-ingest.ts` 现有内容读一遍再改（它比上一轮计划里那份长，含一个记录原始响应的 `RecordingClient`）。在既有的 `buildScenes` 之后追加：

```ts
import { toItemInputs, classifyItems } from "../src/ingest/classify-items";
import { assignItemIds } from "../src/ingest/ids";
import { buildItems } from "../src/ingest/build-items";

// ── 条目：分类 → 建物品 ──
const itemInputs = toItemInputs(sections, kinds, ids);
const itemKinds = await classifyItems(itemInputs, client);
const itemIds = assignItemIds(sections);
const { items, provenance, warnings: itemWarnings } = buildItems(itemInputs, itemKinds, itemIds);

const baseItemNames = new Set(BARN_OF_PREMIER.items.map((i) => i.name));
const itemHit = items.filter((i) => baseItemNames.has(i.name));

const kindTally: Record<string, number> = {};
for (const k of itemKinds.values()) kindTally[k] = (kindTally[k] ?? 0) + 1;
```

候选产物与 diff 改为：

```ts
const candidate = { ...BARN_OF_PREMIER, scenes, items, provenance };
const diffs = diffValues(BARN_OF_PREMIER, candidate, {
  pairBy: ["id", "name"],
  refFields: ["sceneId"],
});
```

报告追加这几行（`items.json` 单独落盘）：

```ts
await Bun.write(`${OUT}/items.json`, JSON.stringify(items, null, 2));
await Bun.write(`${OUT}/provenance.json`, JSON.stringify(provenance, null, 2));
```

```ts
  `条目 ${itemInputs.length} 送分类 / 分类返回 ${itemKinds.size}`,
  `分类分布: ${Object.entries(kindTally).map(([k, n]) => `${k}=${n}`).join(" ")}`,
  `建成物品 ${items.length} 个，provenance ${provenance.length} 条`,
  `基准 ${BARN_OF_PREMIER.items.length} 个物品，按 name 命中 ${itemHit.length}（上限 9）`,
  `未命中基准的生成物品: ${items.filter((i) => !baseItemNames.has(i.name)).map((i) => i.name).join("、") || "无"}`,
  `基准里没被生成出来的: ${BARN_OF_PREMIER.items.filter((i) => !items.some((g) => g.name === i.name)).map((i) => i.name).join("、") || "无"}`,
  "",
  "item warnings:",
  ...itemWarnings.map((w) => `  ${w}`),
```

- [ ] **Step 3: 跑**

Run: `cd C:\aitrpg\poc; bun tools/_run-ingest.ts`

用读取工具看 `tools/ingest-out/report.txt`（**不要用 PowerShell 读**）。记下：条目分类返回数、分类分布、建成物品数、命中数、未命中与漏掉的名单、四个陷阱的 `TrapMechanics` 差异。

若分类返回为 0，先把 `classify-raw.txt` 里的原始响应打出来看，别猜——上一轮就是被键格式坑了 43 条。

- [ ] **Step 4: 把数字写进索引**

修改 `docs/index-program.md` 的 §模组摄取 · 状态表，在 `场景骨架` 那行之后加两行（`N` 用实测值替换，不留占位符）：

```
| 条目分类（▶ 是什么） | `src/ingest/classify-items.ts` | **已完成**，16 测试。实跑分类返回 N/39 |
| ModuleItem 抽取 | `src/ingest/build-items.ts` | **已完成**，18 测试。实跑 **基准 10 个物品按 name 命中 N**（上限 9） |
```

并在 §端到端实跑 之后追加一节（用实测值）：

```markdown
### `▶` 不是线索标记（2026-08-19）

上一轮把 39 个 `▶` 条目整批丢弃，理由写的是「属线索/物品，留给下一轮」。
这轮逐条对回基准，那句话说得太粗——`▶` 底下混着六种东西：

| `▶` 条目 | 在基准里其实是 |
|---|---|
| `捕兽夹` / `硫酸陷阱` 等四个 | `ModuleItem.trap` |
| `防盗门的钥匙` / `农场的照片` / `驾驶证` / `住宅钥匙` / `老旧文件` | `ModuleItem` |
| `侧面的防盗门` / `一旁的杂物堆` / `拉门` | `SceneConnection`——进入方式，不是线索 |
| 菲碧·特里坎名下 2 条 | `ModuleNPC.knowledge` 与 `.secrets` |
| 与艾德里安会面的 3 条 | 分支结局叙事 |
| `侦查休息区/宣言仔细检查床底` 等 | 才是 `Clue` |

**先做物品不做线索，是因为只有物品能按名字计分**：基准 10 个 `ModuleItem` 里 9 个的
`name` 能在 `▶` 名字里原样找到（缺的是 `黑色钱包`，PDF 里没有对应条目），
而 32 条线索的 `name` 是重写过的——`床头柜` → `日记本与老旧文件`，
`中控台的开关` → `中控台拉杆`——39 个条目里只有 2 个逐字命中。没有可对齐的名字就没有分数。

**另外三处结构性错位**，说明「一个 `▶` 对一条线索」根本不成立：`证物室` 有 3 个 `▶` 却 0 条线索
（三个全是物品，而名叫「证物室」的线索挂在 `警察局` 名下）；`维修间` 只有 1 个 `▶` 却有 4 条线索；
`报亭`、`霍姆斯医院`、`警察局` 一个 `▶` 都没有，它们的线索写在正文里。

**分类不是互斥的**：`老旧文件` 在基准里同时是 `ModuleItem old_document` 与
`Clue clue_bedroom_old_doc`。39 条里只此一例，所以本轮用单标签——但下一轮做线索时
**不能假设「已判为 item ⇒ 不是 clue」**，那种假设正是会静默丢东西的那一类。

**引用字段与内容分开算**：`ModuleItem.sceneId` 指向场景 id，生成侧是 `scene_NN`、
基准是手写意译，按名字配上后会全部报成 `changed`。这不是生成器不准，是
「id 是内部句柄」往下再走一层。`diffValues` 新增 `refFields`，这类差异单列成
`ref-mismatch`，不进 `changed`——否则下一轮的 `targetSceneId`、`npcIds` 只会让污染更重。
```

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd C:\aitrpg\poc; bun test; bun run typecheck`
Expected: 全部通过。ingest 测试合计 147 + 8 + 16 + 18 + 7 = 196。

- [ ] **Step 6: 提交**

`tools/` 被 `.gitignore` 排除，所以这次只提交文档。

```bash
cd C:\aitrpg\poc; git add docs/index-program.md; git commit -m "docs: record that the triangle marks six things, not one"
```

- [ ] **Step 7: 确认工作树干净**

Run: `cd C:\aitrpg\poc; git status --short`
Expected: 只剩 ` M docs/index-world-model.md`——那是 relics/ 那条任务线的未提交改动，**不要动它**。

---

## 完成判据

1. `bun test` 全绿，196 个 ingest 测试，原有 147 个零回归
2. `bun run typecheck` 无错
3. `tools/ingest-out/report.txt` 里有「基准 10 个物品按 name 命中 N」这个实测数
4. `ModuleData.provenance` 第一次有内容，`provenance.json` 里的 path 形如 `items[item_07].trap.damage`
5. 四个陷阱的 `TrapMechanics` 与基准的差异已记录（`extract-trap` 首次校准对出 9 处，其中 2 处是生成物更忠实原文）
6. `docs/index-program.md` 写的是实测值，没有占位符
7. `git status` 除 `docs/index-world-model.md` 外干净
