# 模组摄取 · id 命名与场景骨架 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把摄取管线从「分好类的 `Section`」接到「带稳定 id 的 `Scene[]`」，并让校准器能按名称配对，从而第一次拿到「基准 20 个场景命中几个」这个数。

**Architecture:** 五段纯函数（`extractPages` → `cleanPageText` → `sectionize` → `toClassifyInputs`/`classifySections` → `assignSceneIds` → `buildScenes`）加一个改造过的校准器；所有 IO（读盘、调 LLM、落盘）只在 `tools/_run-ingest.ts` 这一个不进版本库的脚本里。

**Tech Stack:** Bun + TypeScript，`bun test` 内置测试器，`pdf-parse` v2.4.5。

**Spec:** `docs/superpowers/specs/2026-08-19-ingest-scene-skeleton-design.md`

## Global Constraints

- 运行时是 Bun。测试 `bun test`，类型检查 `bun run typecheck`（即 `tsc --noEmit`）。两者都必须绿。
- **不新增任何依赖。** `package.json` 的 dependencies 保持 `pdf-parse` + `yaml` 两项。
- **源文件不要用 PowerShell 写或读**：`Set-Content` 会把中文写成 mojibake，`Get-Content` 读出来也是花的。一律用编辑/读取工具。
- shell 的 `workdir` 参数在本机会卡死。要在仓库里跑命令，写 `cd C:\aitrpg\poc; <命令>`。
- `tools/` 整个目录被 `.gitignore` 排除，里面的东西不进版本库，因此**不能承载任何需要被测试的逻辑**。
- 注释用中文，写「为什么这么定」而不是「这行在干什么」。仓库既有注释都是这个口径，照着来。
- commit message 用 conventional commits，描述句用英文小写陈述句（照 `feat(ingest): pull trap mechanics out of the prose, with provenance` 的样子）。
- 现有 5 个 ingest 测试文件共 101 个测试，**零回归**是每一步的硬前提。
- 本轮明确不做：description/atmosphere 切分、clues、npcIds、connections、NPC 字段、`Provenance` 落地、修分类器以标题为键的重名缺陷。

## 文件结构

| 文件 | 责任 |
|---|---|
| `src/ingest/scene-id.ts`【新】 | 只做一件事：按顺序给块分配稳定 ASCII id |
| `src/ingest/build-scenes.ts`【新】 | 把分好类的块变成 `Scene[]`，只填 id/name/description |
| `src/ingest/pdf-source.ts`【新】 | PDF 二进制 → 逐页文本，唯一依赖 `pdf-parse` 的模块 |
| `src/ingest/classify-sections.ts`【改】 | 加 `toClassifyInputs`——`ClassifyInput` 是它定义的，怎么从 `Section` 造该由它负责 |
| `src/ingest/calibrate.ts`【改】 | 配对键可配置、`id-mismatch` 单列、路径用配对键、空数组修正 |
| `tools/_run-ingest.ts`【新，不进版本库】 | 串起整条链的一次性脚本，所有 IO 在此 |

任务顺序：纯函数先（1–4），带外部依赖的后（5），整合与实跑最后（6）。

---

### Task 1: 场景 id 分配

**Files:**
- Create: `src/ingest/scene-id.ts`
- Test: `src/__tests__/ingest-scene-id.test.ts`

**Interfaces:**
- Consumes: `Section` from `src/ingest/sectionize.ts`（已存在，不改）
- Produces: `assignSceneIds(sections: Section[]): string[]` —— 与输入等长、按下标一一对应

- [ ] **Step 1: 写失败的测试**

创建 `src/__tests__/ingest-scene-id.test.ts`：

```ts
// 摄取管线 · 场景 id 分配
//
// id 是内部句柄，不与基准的手写意译 id 对齐（那是语义翻译，机械复现不了，
// 把基准 id 喂进 prompt 又等于泄题）。所以这里能测的只有四条功能需求：
// 唯一、同输入稳定、纯 ASCII、与输入一一对应。

import { describe, test, expect } from "bun:test";
import { assignSceneIds } from "../ingest/scene-id";
import type { Section } from "../ingest/sectionize";

const sec = (title: string): Section => ({
  title,
  body: "",
  items: [],
  source: { page: 1, line: 1 },
});

describe("assignSceneIds", () => {
  test("与输入等长", () => {
    expect(assignSceneIds([sec("甲"), sec("乙"), sec("丙")])).toHaveLength(3);
  });

  test("空输入给空数组", () => {
    expect(assignSceneIds([])).toEqual([]);
  });

  test("同一份输入两次跑出同一批 id —— 稳定性是 diff 有意义的前提", () => {
    const input = [sec("甲"), sec("乙")];
    expect(assignSceneIds(input)).toEqual(assignSceneIds(input));
  });

  test("全部唯一", () => {
    const ids = assignSceneIds(Array.from({ length: 44 }, (_, i) => sec(`块${i}`)));
    expect(new Set(ids).size).toBe(44);
  });

  test("重名标题各得各的 id —— 以标题为键会静默丢块", () => {
    const ids = assignSceneIds([sec("卧室"), sec("卧室")]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test("纯 ASCII —— 中文 id 会渗进存档文件名与 Provenance.path", () => {
    for (const id of assignSceneIds([sec("特里坎家"), sec("霍姆斯医院")])) {
      expect(id).toMatch(/^[a-z0-9_]+$/);
    }
  });

  test("序号是块在文中的序号，不是场景的序号", () => {
    // 只有一部分块会被判成场景。按块编号，分类结果变化时
    // 仍是场景的那些块 id 不会漂移；按场景编号则会全体挪位。
    const ids = assignSceneIds([sec("前言"), sec("特里坎家"), sec("附录")]);
    expect(ids).toEqual(["scene_01", "scene_02", "scene_03"]);
  });

  test("超过 99 块自然进位成三位，不截断", () => {
    const ids = assignSceneIds(Array.from({ length: 100 }, (_, i) => sec(`块${i}`)));
    expect(ids[99]).toBe("scene_100");
    expect(new Set(ids).size).toBe(100);
  });
});
```

- [ ] **Step 2: 跑一次确认它失败**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-scene-id.test.ts`
Expected: FAIL，报找不到模块 `../ingest/scene-id`

- [ ] **Step 3: 写实现**

创建 `src/ingest/scene-id.ts`：

```ts
// 摄取管线 · 场景 id 分配
//
// id 的功能需求只有四条：唯一、同一 PDF 重跑稳定、纯 ASCII、能被 targetSceneId 解析。
// 可读性不在其中 —— 中文原名在 Scene.name 里，校准报告按 name 配对之后
// 路径印的也是中文名，看报告的人不需要认得 id。
//
// 所以形态定为 scene_01…scene_NN：
//   零依赖 —— 拼音要加一个字典包，而 te_li_kan_jia 并不比 特里坎家 多告诉你任何东西；
//   天然不冲突 —— 重名标题各得各的号，不必再写消歧逻辑；
//   标题哈希相对它只多一个「跨 PDF 版本稳定」的优势，而我们不需要那个：
//   稳定性的用途是「同一份 PDF 重跑，diff 只反映生成器的改动」。
//
// 编号按**块**走而不是按场景走。只有一部分块会被判成场景，按场景编号的话，
// 分类器换一次结果，所有场景 id 会集体挪位；按块编号则各归各位。

import type { Section } from "./sectionize";

/** 两位起步，够 44 块用；超过 99 自然变三位，不截断 */
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 按顺序给每个块分配 id，返回与输入等长、按下标一一对应的数组。
 *
 * 不返回 Map<title, id>：标题可能重复（分类器正是栽在以标题为键上），
 * 以标题为键会静默丢块。调用方按下标取。
 */
export function assignSceneIds(sections: Section[]): string[] {
  return sections.map((_, i) => `scene_${pad(i + 1)}`);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-scene-id.test.ts`
Expected: PASS，8 tests

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd C:\aitrpg\poc; bun test; bun run typecheck`
Expected: 全部通过，ingest 相关从 101 涨到 109

- [ ] **Step 6: 提交**

```bash
cd C:\aitrpg\poc; git add src/ingest/scene-id.ts src/__tests__/ingest-scene-id.test.ts; git commit -m "feat(ingest): give blocks stable handles instead of hoping to match hand-written ids"
```

---

### Task 2: Section → ClassifyInput 适配

**Files:**
- Modify: `src/ingest/classify-sections.ts`（在 `ClassifyInput` 定义之后追加一个导出，其余不动）
- Test: `src/__tests__/ingest-classify.test.ts`（追加一个 describe 块）

**Interfaces:**
- Consumes: `Section` from `src/ingest/sectionize.ts`
- Produces: `toClassifyInputs(sections: Section[]): ClassifyInput[]` —— 滤掉空标题块，其余保序

- [ ] **Step 1: 写失败的测试**

在 `src/__tests__/ingest-classify.test.ts` 末尾追加。文件顶部已有一行从 `../ingest/classify-sections` 的导入，把 `toClassifyInputs` 并进那一行（不要新开一条同源 import），再单独加一行 `Section` 的类型导入：

```ts
// 顶部已有的那行加上 toClassifyInputs，另起一行加类型导入：
import type { Section } from "../ingest/sectionize";

const sec = (title: string, body: string): Section => ({
  title,
  body,
  items: [],
  source: { page: 1, line: 1 },
});

describe("toClassifyInputs", () => {
  test("标题与正文原样传下去", () => {
    const out = toClassifyInputs([sec("农场外围", "泥泞的车辙一直通向谷仓。")]);
    expect(out).toEqual([{ title: "农场外围", excerpt: "泥泞的车辙一直通向谷仓。" }]);
  });

  test("滤掉标题为空的前置块 —— 它进不了以标题为键的分类结果", () => {
    // sectionize 会把首个标题之前的内容（第 1 页的书名等）归入 title 为空串的块
    const out = toClassifyInputs([sec("", "普瑞米尔的谷仓"), sec("报亭", "镇口的报亭。")]);
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("报亭");
  });

  test("保序 —— 下游按下标取回原块", () => {
    const out = toClassifyInputs([sec("甲", "a"), sec("乙", "b"), sec("丙", "c")]);
    expect(out.map((s) => s.title)).toEqual(["甲", "乙", "丙"]);
  });

  test("空输入给空数组", () => {
    expect(toClassifyInputs([])).toEqual([]);
  });

  test("正文不在这里截断 —— 截断是 buildClassifyPrompt 的事，只该有一处", () => {
    const long = "描".repeat(500);
    expect(toClassifyInputs([sec("甲", long)])[0]?.excerpt).toHaveLength(500);
  });
});
```

- [ ] **Step 2: 跑一次确认它失败**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-classify.test.ts`
Expected: FAIL，`toClassifyInputs` 不是一个导出

- [ ] **Step 3: 写实现**

在 `src/ingest/classify-sections.ts` 的 `ClassifyInput` 接口（第 18–21 行）之后插入。同时在文件顶部 `import type { LLMClient }` 之后加一行 `import type { Section } from "./sectionize";`：

```ts
/**
 * Section → ClassifyInput。
 *
 * 放在这一侧而不是切分那一侧：ClassifyInput 是本模块定义的，
 * 怎么从上游结构造出来该由本模块负责。
 *
 * 滤掉标题为空的块 —— sectionize 会把首个标题之前的内容（第 1 页的书名等）
 * 归入一个 title 为空串的前置块。它进不了以标题为键的分类结果，也不可能是场景。
 *
 * 正文原样带过去，不在这里截断：截断口径由 buildClassifyPrompt 的 EXCERPT_MAX 独占，
 * 两处各截一次会让「模型到底看到了多少字」说不清。
 */
export function toClassifyInputs(sections: Section[]): ClassifyInput[] {
  return sections
    .filter((s) => s.title !== "")
    .map((s) => ({ title: s.title, excerpt: s.body }));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-classify.test.ts`
Expected: PASS，15 + 5 = 20 tests

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd C:\aitrpg\poc; bun test; bun run typecheck`
Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
cd C:\aitrpg\poc; git add src/ingest/classify-sections.ts src/__tests__/ingest-classify.test.ts; git commit -m "feat(ingest): connect the sectionizer to the classifier that had no caller"
```

---

### Task 3: 场景骨架

**Files:**
- Create: `src/ingest/build-scenes.ts`
- Test: `src/__tests__/ingest-build-scenes.test.ts`

**Interfaces:**
- Consumes: `Section`（`sectionize.ts`）、`SectionKind`（`classify-sections.ts`）、`assignSceneIds` 的返回值、`Scene`（`src/module/types.ts`）
- Produces:
  ```ts
  interface BuildScenesResult { scenes: Scene[]; warnings: string[] }
  function buildScenes(sections: Section[], kinds: Map<string, SectionKind>, ids: string[]): BuildScenesResult
  ```

- [ ] **Step 1: 写失败的测试**

创建 `src/__tests__/ingest-build-scenes.test.ts`：

```ts
// 摄取管线 · 场景骨架
//
// 本轮只填 id / name / description 三个字段。其余一律不填 ——
// 没抽就是没抽，填 undefined 或编一个值都会让校准报告读不出「还差多少」。
// 这一轮买的是「可测量」，不是「更准」。

import { describe, test, expect } from "bun:test";
import { buildScenes } from "../ingest/build-scenes";
import type { Section, SectionItem } from "../ingest/sectionize";
import type { SectionKind } from "../ingest/classify-sections";

const item = (name: string, text: string): SectionItem => ({
  name,
  text,
  source: { page: 1, line: 1 },
});

const sec = (title: string, body = "", items: SectionItem[] = []): Section => ({
  title,
  body,
  items,
  source: { page: 1, line: 1 },
});

const kinds = (pairs: Array<[string, SectionKind]>) => new Map<string, SectionKind>(pairs);

describe("挑块", () => {
  test("只取 scene 类", () => {
    const secs = [sec("农场外围"), sec("菲碧·特里坎"), sec("附录"), sec("米戈属性")];
    const r = buildScenes(
      secs,
      kinds([["农场外围", "scene"], ["菲碧·特里坎", "npc"], ["附录", "structure"], ["米戈属性", "rule"]]),
      ["scene_01", "scene_02", "scene_03", "scene_04"],
    );
    expect(r.scenes.map((s) => s.name)).toEqual(["农场外围"]);
  });

  test("没有分类结果的块跳过，并计入 warnings —— 不猜", () => {
    const r = buildScenes([sec("农场外围"), sec("来路不明")], kinds([["农场外围", "scene"]]), ["scene_01", "scene_02"]);
    expect(r.scenes).toHaveLength(1);
    expect(r.warnings.join()).toContain("没有分类结果");
  });

  test("标题为空的前置块跳过", () => {
    const r = buildScenes([sec("", "普瑞米尔的谷仓"), sec("报亭")], kinds([["报亭", "scene"]]), ["scene_01", "scene_02"]);
    expect(r.scenes.map((s) => s.name)).toEqual(["报亭"]);
  });

  test("空分类表给零个场景 —— LLM 挂掉时如实显示 0，不把所有块当场景", () => {
    const r = buildScenes([sec("农场外围"), sec("报亭")], kinds([]), ["scene_01", "scene_02"]);
    expect(r.scenes).toEqual([]);
  });
});

describe("字段口径", () => {
  test("id 按下标取自 assignSceneIds 的结果", () => {
    const r = buildScenes([sec("前言"), sec("报亭")], kinds([["报亭", "scene"]]), ["scene_01", "scene_02"]);
    expect(r.scenes[0]?.id).toBe("scene_02");
  });

  test("name 是中文原名，description 是整块 body", () => {
    const r = buildScenes([sec("报亭", "镇口的报亭，老板正在打盹。")], kinds([["报亭", "scene"]]), ["scene_01"]);
    expect(r.scenes[0]?.name).toBe("报亭");
    expect(r.scenes[0]?.description).toBe("镇口的报亭，老板正在打盹。");
  });

  test("三个必填数组存在且为空", () => {
    const r = buildScenes([sec("报亭", "x")], kinds([["报亭", "scene"]]), ["scene_01"]);
    expect(r.scenes[0]?.clues).toEqual([]);
    expect(r.scenes[0]?.npcIds).toEqual([]);
    expect(r.scenes[0]?.connections).toEqual([]);
  });

  test("可选字段一个都不写进对象 —— 写 undefined 也不行", () => {
    const r = buildScenes([sec("报亭", "x")], kinds([["报亭", "scene"]]), ["scene_01"]);
    expect(Object.keys(r.scenes[0] ?? {}).sort()).toEqual(
      ["clues", "connections", "description", "id", "name", "npcIds"],
    );
  });

  test("▶ 条目不混进 description —— 它们是线索/物品，不是场景描述", () => {
    const s = sec("农场外围", "泥泞的车辙。", [item("捕兽夹", "踩中时造成1D4+1伤害")]);
    const r = buildScenes([s], kinds([["农场外围", "scene"]]), ["scene_01"]);
    expect(r.scenes[0]?.description).toBe("泥泞的车辙。");
    expect(r.scenes[0]?.description).not.toContain("捕兽夹");
  });

  test("丢弃的条目要报数 —— 不静默丢东西", () => {
    const s = sec("农场外围", "x", [item("捕兽夹", "a"), item("霰弹枪", "b")]);
    const r = buildScenes([s], kinds([["农场外围", "scene"]]), ["scene_01"]);
    expect(r.warnings.join()).toContain("2");
  });
});

describe("重名标题", () => {
  test("各得各的 id", () => {
    const r = buildScenes([sec("卧室", "a"), sec("卧室", "b")], kinds([["卧室", "scene"]]), ["scene_01", "scene_02"]);
    expect(r.scenes.map((s) => s.id)).toEqual(["scene_01", "scene_02"]);
  });

  test("报一条 warning —— 分类器以标题为键，两块只能拿到同一类", () => {
    const r = buildScenes([sec("卧室", "a"), sec("卧室", "b")], kinds([["卧室", "scene"]]), ["scene_01", "scene_02"]);
    expect(r.warnings.join()).toContain("卧室");
  });
});

describe("调用契约", () => {
  test("ids 与 sections 长度不符直接抛 —— 那是编程错误，不是数据问题", () => {
    expect(() => buildScenes([sec("甲"), sec("乙")], kinds([]), ["scene_01"])).toThrow();
  });
});
```

- [ ] **Step 2: 跑一次确认它失败**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-build-scenes.test.ts`
Expected: FAIL，找不到模块 `../ingest/build-scenes`

- [ ] **Step 3: 写实现**

创建 `src/ingest/build-scenes.ts`：

```ts
// 摄取管线 · 场景骨架
//
// 把分好类的块变成 Scene[]。本轮只填 id / name / description 三个字段，
// 其余一律不填 —— 没抽就是没抽。填 undefined 或编一个占位值，
// 都会让校准报告读不出「还差多少」，而那份差异清单正是下一轮的路线图。
//
// ▶ 条目本轮丢弃：基准里 ▶捕兽夹 是 ModuleItem，▶ 搜查项是 Clue，
// 都不属于场景描述。混进 description 会让下一轮抽线索时
// 面对一份已经被污染的正文。丢弃不是遗漏，是分工。

import type { Scene } from "../module/types";
import type { Section } from "./sectionize";
import type { SectionKind } from "./classify-sections";

export interface BuildScenesResult {
  scenes: Scene[];
  /** 跳过的块、未消费的条目、重名标题 —— 不静默丢东西 */
  warnings: string[];
}

/**
 * 建场景骨架。
 *
 * ids 必须与 sections 等长且按下标对应（见 assignSceneIds）。
 * kinds 以标题为键，是 classifySections 的原样产出。
 */
export function buildScenes(
  sections: Section[],
  kinds: Map<string, SectionKind>,
  ids: string[],
): BuildScenesResult {
  if (ids.length !== sections.length) {
    throw new Error(`[ingest] ids 与 sections 长度不符：${ids.length} vs ${sections.length}`);
  }

  const scenes: Scene[] = [];
  const warnings: string[] = [];
  const titleCount = new Map<string, number>();
  let unclassified = 0;
  let droppedItems = 0;

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i] as Section;
    if (s.title === "") continue; // 前置块，没有标题就不是内容

    const kind = kinds.get(s.title);
    if (kind === undefined) {
      unclassified++;
      continue;
    }
    if (kind !== "scene") continue;

    titleCount.set(s.title, (titleCount.get(s.title) ?? 0) + 1);
    droppedItems += s.items.length;

    scenes.push({
      id: ids[i] as string,
      name: s.title,
      description: s.body,
      clues: [],
      npcIds: [],
      connections: [],
    });
  }

  if (unclassified > 0) warnings.push(`${unclassified} 个块没有分类结果，已跳过`);
  if (droppedItems > 0) warnings.push(`${droppedItems} 个 ▶ 条目本轮未消费（属线索/物品，留给下一轮）`);
  for (const [title, n] of titleCount) {
    if (n > 1) {
      warnings.push(`标题「${title}」出现 ${n} 次；分类器以标题为键，这几块只能拿到同一类，但 id 各自独立`);
    }
  }

  return { scenes, warnings };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-build-scenes.test.ts`
Expected: PASS，13 tests

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd C:\aitrpg\poc; bun test; bun run typecheck`
Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
cd C:\aitrpg\poc; git add src/ingest/build-scenes.ts src/__tests__/ingest-build-scenes.test.ts; git commit -m "feat(ingest): turn classified blocks into scenes, and say what was dropped"
```

---

### Task 4: 校准器按名称配对

**Files:**
- Modify: `src/ingest/calibrate.ts`（`FieldDiff`、`walk`、`walkArray`、`diffValues`、`formatDiff`）
- Test: `src/__tests__/ingest-calibrate.test.ts`（追加，现有 21 个测试一个都不许改）

**Interfaces:**
- Produces:
  ```ts
  interface FieldDiff { path: string; kind: "missing" | "extra" | "changed" | "id-mismatch"; baseline?: unknown; candidate?: unknown }
  interface DiffOptions { pairBy?: string[] }
  function diffValues(baseline: unknown, candidate: unknown, opts?: DiffOptions): FieldDiff[]
  ```

- [ ] **Step 1: 写失败的测试**

在 `src/__tests__/ingest-calibrate.test.ts` 末尾追加：

```ts
describe("配对键可配置", () => {
  test("不传 opts 与显式传 ['id'] 完全等价 —— 现有 21 个测试是这条的基线", () => {
    const a = { scenes: [{ id: "s1", name: "甲" }] };
    const b = { scenes: [{ id: "s2", name: "甲" }] };
    expect(diffValues(a, b)).toEqual(diffValues(a, b, { pairBy: ["id"] }));
  });

  test("按 name 配对：id 不同但 name 相同的两个元素被认成同一个", () => {
    // 生成的 id 是内部句柄（scene_07），基准是手写意译（adrian_bedroom），
    // 按 id 配会把每个场景都报成「缺失 + 多余」，真实差异被噪音埋掉
    const a = { scenes: [{ id: "adrian_bedroom", name: "卧室", description: "床头柜" }] };
    const b = { scenes: [{ id: "scene_18", name: "卧室", description: "床头柜" }] };
    const d = diffValues(a, b, { pairBy: ["id", "name"] });
    expect(d.filter((x) => x.kind === "missing" || x.kind === "extra")).toEqual([]);
  });

  test("路径段用实际配对键的值 —— 序号 id 不可读，中文名可读", () => {
    const a = { scenes: [{ id: "adrian_bedroom", name: "卧室", description: "床头柜" }] };
    const b = { scenes: [{ id: "scene_18", name: "卧室", description: "床边" }] };
    expect(at(diffValues(a, b, { pairBy: ["id", "name"] }), "scenes[卧室].description")).toBeDefined();
  });

  test("先按 id 配，配不上的才按 name 配", () => {
    const a = { scenes: [{ id: "s1", name: "甲", v: 1 }, { id: "s2", name: "乙", v: 2 }] };
    const b = { scenes: [{ id: "s1", name: "甲", v: 1 }, { id: "scene_02", name: "乙", v: 2 }] };
    const d = diffValues(a, b, { pairBy: ["id", "name"] });
    expect(d.filter((x) => x.kind !== "id-mismatch")).toEqual([]);
  });

  test("配对键在两侧都不可用时退回按下标 —— 与现在的行为一致", () => {
    const d = diffValues({ tags: ["a", "b"] }, { tags: ["a", "c"] }, { pairBy: ["id", "name"] });
    expect(at(d, "tags[1]")).toMatchObject({ kind: "changed" });
  });
});

describe("id-mismatch 单列", () => {
  test("按 name 配上但 id 不同 → id-mismatch，不计入 changed", () => {
    const a = { scenes: [{ id: "adrian_bedroom", name: "卧室" }] };
    const b = { scenes: [{ id: "scene_18", name: "卧室" }] };
    const d = diffValues(a, b, { pairBy: ["id", "name"] });
    expect(d.filter((x) => x.kind === "changed")).toEqual([]);
    expect(at(d, "scenes[卧室].id")).toMatchObject({
      kind: "id-mismatch",
      baseline: "adrian_bedroom",
      candidate: "scene_18",
    });
  });

  test("同一件事只报一次 —— 不再另出一条 .id 的 changed", () => {
    const a = { scenes: [{ id: "adrian_bedroom", name: "卧室" }] };
    const b = { scenes: [{ id: "scene_18", name: "卧室" }] };
    const d = diffValues(a, b, { pairBy: ["id", "name"] }).filter((x) => x.path === "scenes[卧室].id");
    expect(d).toHaveLength(1);
  });

  test("按 id 配对时不会产出 id-mismatch", () => {
    const a = { scenes: [{ id: "s1", name: "甲" }] };
    const b = { scenes: [{ id: "s1", name: "乙" }] };
    expect(diffValues(a, b).filter((x) => x.kind === "id-mismatch")).toEqual([]);
  });

  test("一侧压根没有 id 时如实报 missing，不被跳过吞掉", () => {
    const a = { scenes: [{ id: "adrian_bedroom", name: "卧室" }] };
    const b = { scenes: [{ name: "卧室" }] };
    const d = diffValues(a, b, { pairBy: ["id", "name"] });
    expect(at(d, "scenes[卧室].id")).toMatchObject({ kind: "missing" });
  });
});

describe("空数组仍按 id 配对", () => {
  test("候选侧 clues 为空 → 路径带线索 id，而不是下标", () => {
    // 这份缺失清单就是下一轮的路线图。印成 clues[0]…clues[31] 则一文不值
    const a = { scenes: [{ id: "s1", clues: [{ id: "clue_bar_ask_around", name: "打听" }] }] };
    const b = { scenes: [{ id: "s1", clues: [] }] };
    expect(at(diffValues(a, b), "scenes[s1].clues[clue_bar_ask_around]")).toMatchObject({ kind: "missing" });
  });

  test("两侧皆空 → 无差异", () => {
    expect(diffValues({ clues: [] }, { clues: [] })).toEqual([]);
  });

  test("空数组对上无 id 的数组仍退回下标", () => {
    const d = diffValues({ tags: ["a"] }, { tags: [] });
    expect(at(d, "tags[0]")).toMatchObject({ kind: "missing" });
  });
});

describe("报告含 id-mismatch 计数", () => {
  test("统计行列出 id 不一致的条数", () => {
    const a = { scenes: [{ id: "adrian_bedroom", name: "卧室" }] };
    const b = { scenes: [{ id: "scene_18", name: "卧室" }] };
    expect(formatDiff(diffValues(a, b, { pairBy: ["id", "name"] }))).toContain("id");
  });
});
```

- [ ] **Step 2: 跑一次确认它失败**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-calibrate.test.ts`
Expected: FAIL，`diffValues` 只接受两个参数、没有 `id-mismatch` 这一类

- [ ] **Step 3: 改实现**

替换 `src/ingest/calibrate.ts` 第 10–92 行（从 `/** 一条差异 */` 到 `diffValues` 结束）为：

```ts
/** 一条差异 */
export interface FieldDiff {
  /** 字段路径，如 `scenes[farm_periphery].clues[trap_bear].description` */
  path: string;
  kind: "missing" | "extra" | "changed" | "id-mismatch";
  /** 基准侧的值（kind=extra 时无） */
  baseline?: unknown;
  /** 候选侧的值（kind=missing 时无） */
  candidate?: unknown;
}

export interface DiffOptions {
  /**
   * 数组元素的配对键，按顺序取第一个可用的。默认 ["id"]，即现有行为。
   *
   * 传 ["id","name"] 是为了比对生成物：生成的 id 是内部句柄（scene_07），
   * 基准那份是带上下文的人工意译（adrian_bedroom），两者本就不会一样。
   * 按 id 硬配会把每个场景都报成「缺失 + 多余」，真实差异被噪音埋掉 ——
   * 与当初按下标比较是同一个坑。
   */
  pairBy?: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** 取元素上某个键的值，要求是非空字符串；否则视为「没有这个键」 */
function keyOf(v: unknown, key: string): string | null {
  if (isObj(v) && typeof v[key] === "string" && v[key] !== "") return v[key] as string;
  return null;
}

/**
 * 数组里的元素是否都带该键。
 *
 * 只要有一个没有就整体退回按下标比 —— 混着比会让路径含义不一致，
 * 报告里一半是 `[s1]` 一半是 `[3]`，看的人无法判断下标指的是原序还是新序。
 *
 * 空数组平凡成立。否则候选侧 clues: [] 会把整个数组拖回按下标比，
 * 32 条缺失全印成 clues[0]…clues[31]，而这份清单本该是下一轮的路线图。
 */
function allHaveKey(arr: unknown[], key: string): boolean {
  return arr.every((v) => keyOf(v, key) !== null);
}

/** 选出两侧都能用的配对键；都不可用返回 null，退回按下标 */
function pickPairKey(baseline: unknown[], candidate: unknown[], pairBy: string[]): string | null {
  if (baseline.length === 0 && candidate.length === 0) return null;
  for (const key of pairBy) {
    if (allHaveKey(baseline, key) && allHaveKey(candidate, key)) return key;
  }
  return null;
}

const join = (base: string, seg: string) => (base ? `${base}${seg.startsWith("[") ? "" : "."}${seg}` : seg);

function walk(
  baseline: unknown,
  candidate: unknown,
  path: string,
  out: FieldDiff[],
  pairBy: string[],
  skipKey?: string,
): void {
  // 两侧都当"没有"处理：ModuleData 里可选字段极多，
  // 写 undefined 和干脆不写在语义上没区别，算成差异会淹掉真问题。
  const bMissing = baseline === undefined;
  const cMissing = candidate === undefined;
  if (bMissing && cMissing) return;
  if (bMissing) { out.push({ path, kind: "extra", candidate }); return; }
  if (cMissing) { out.push({ path, kind: "missing", baseline }); return; }

  if (Array.isArray(baseline) && Array.isArray(candidate)) {
    walkArray(baseline, candidate, path, out, pairBy);
    return;
  }

  if (isObj(baseline) && isObj(candidate)) {
    for (const k of new Set([...Object.keys(baseline), ...Object.keys(candidate)])) {
      if (k === skipKey) continue;
      walk(baseline[k], candidate[k], join(path, k), out, pairBy);
    }
    return;
  }

  if (baseline !== candidate) out.push({ path, kind: "changed", baseline, candidate });
}

function walkArray(baseline: unknown[], candidate: unknown[], path: string, out: FieldDiff[], pairBy: string[]): void {
  // 按身份配对：生成物的场景/线索顺序不必与手写那份一致，
  // 按下标比会把"顺序不同"报成"每一项都不同"，真实差异被噪音埋掉。
  const key = pickPairKey(baseline, candidate, pairBy);
  if (key !== null) {
    const bMap = new Map(baseline.map((v) => [keyOf(v, key) as string, v]));
    const cMap = new Map(candidate.map((v) => [keyOf(v, key) as string, v]));
    for (const k of new Set([...bMap.keys(), ...cMap.keys()])) {
      const b = bMap.get(k);
      const c = cMap.get(k);
      const p = `${path}[${k}]`;

      // 按非 id 键配上的一对：两侧 id 不同是预期内的（内部句柄 vs 手写意译），
      // 单列一类，不去污染 changed 那个计数。报完把 id 从递归里摘掉，
      // 否则同一件事会再以 `.id` 的 changed 说一遍。
      // 只有一侧带 id 时不摘 —— 那是真缺字段，该照常报 missing/extra。
      if (key !== "id" && isObj(b) && isObj(c)) {
        const bid = keyOf(b, "id");
        const cid = keyOf(c, "id");
        if (bid !== null && cid !== null) {
          if (bid !== cid) out.push({ path: `${p}.id`, kind: "id-mismatch", baseline: bid, candidate: cid });
          walk(b, c, p, out, pairBy, "id");
          continue;
        }
      }
      walk(b, c, p, out, pairBy);
    }
    return;
  }

  // 没有可用配对键时顺序就是身份，只能按下标
  const n = Math.max(baseline.length, candidate.length);
  for (let i = 0; i < n; i++) walk(baseline[i], candidate[i], `${path}[${i}]`, out, pairBy);
}

/**
 * 逐字段对比两份结构。
 *
 * baseline = 已校准的基准，candidate = 读取模块的产出。
 */
export function diffValues(baseline: unknown, candidate: unknown, opts: DiffOptions = {}): FieldDiff[] {
  const out: FieldDiff[] = [];
  walk(baseline, candidate, "", out, opts.pairBy ?? ["id"]);
  return out;
}
```

再替换 `formatDiff`（原第 105–120 行）为：

```ts
/** 把差异清单渲染成可读报告 */
export function formatDiff(diffs: FieldDiff[]): string {
  if (diffs.length === 0) return "✓ 无差异";

  const lines: string[] = [];
  const byKind: Record<FieldDiff["kind"], number> = { missing: 0, extra: 0, changed: 0, "id-mismatch": 0 };
  for (const d of diffs) byKind[d.kind]++;

  lines.push(
    `差异 ${diffs.length} 处 — changed ${byKind.changed} / missing ${byKind.missing} / extra ${byKind.extra} / id 不一致 ${byKind["id-mismatch"]}`,
  );
  lines.push("");
  for (const d of diffs) {
    if (d.kind === "changed") lines.push(`  [changed] ${d.path}\n      基准: ${show(d.baseline)}\n      生成: ${show(d.candidate)}`);
    else if (d.kind === "missing") lines.push(`  [missing] ${d.path}   基准有而生成缺: ${show(d.baseline)}`);
    else if (d.kind === "extra") lines.push(`  [extra]   ${d.path}   生成多出: ${show(d.candidate)}`);
    else lines.push(`  [id 不一致] ${d.path}   基准 ${show(d.baseline)} ↔ 生成 ${show(d.candidate)}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-calibrate.test.ts`
Expected: PASS，21 + 13 = 34 tests。**若原有 21 个中有任何一个红了，是改动破坏了默认行为，回到 Step 3 修，不要改老测试。**

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd C:\aitrpg\poc; bun test; bun run typecheck`
Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
cd C:\aitrpg\poc; git add src/ingest/calibrate.ts src/__tests__/ingest-calibrate.test.ts; git commit -m "feat(ingest): pair by name when ids were never meant to match"
```

---

### Task 5: PDF → 逐页文本

**Files:**
- Create: `src/ingest/pdf-source.ts`
- Test: `src/__tests__/ingest-pdf-source.test.ts`
- Probe（临时，不提交）：`tools/_probe-pdf.ts`

**Interfaces:**
- Produces: `extractPages(data: Uint8Array): Promise<string[]>`

- [ ] **Step 1: 先探明 pdf-parse v2 的返回形状**

不要照着记忆写。文档只记了「`res.total` → 页数；`res.text` → 全文；`res.pages[]` → 逐页」，逐页元素的字段名没记。创建 `tools/_probe-pdf.ts`：

```ts
// 一次性探针：确认 pdf-parse v2.4.5 的返回形状。跑完即可删。
import { readFileSync } from "fs";
const { PDFParse } = require("pdf-parse");

const buf = readFileSync("C:\\aitrpg\\MikuFan-普瑞米尔的谷仓\\普瑞米尔的谷仓 ver1.03.pdf");
const res = await new PDFParse({ data: new Uint8Array(buf) }).getText();

await Bun.write("tools/_probe-out.txt", [
  `顶层键: ${Object.keys(res).join(", ")}`,
  `total: ${res.total}`,
  `pages 是数组: ${Array.isArray(res.pages)}`,
  `pages 长度: ${res.pages?.length}`,
  `首页元素类型: ${typeof res.pages?.[0]}`,
  `首页键: ${typeof res.pages?.[0] === "object" ? Object.keys(res.pages[0]).join(", ") : "(非对象)"}`,
].join("\n"));
```

Run: `cd C:\aitrpg\poc; bun tools/_probe-pdf.ts`
然后用读取工具看 `tools/_probe-out.txt`（**不要用 PowerShell 读，中文会花**）。

记下逐页文本的取法。下面 Step 3 的实现按探针结果落笔。若 `import { PDFParse } from "pdf-parse"` 能过 `bun run typecheck`，优先用 import 形式，不要两种写法都留着。

- [ ] **Step 2: 写失败的测试**

创建 `src/__tests__/ingest-pdf-source.test.ts`：

```ts
// 摄取管线 · PDF → 逐页文本
//
// 这里只测形态，不测内容保真。
//
// 内容保真需要原文切片，而切片在被 .gitignore 排除的 tools/ 下，
// 且 `0fbf778 chore: keep one copy of the raw material` 明确只留一份素材。
// 把 PDF 文本复制进 fixtures 既违背那个决定，也等于把模组原文又铺进一处。
// 保真靠实跑对 tools/modules/raw/ 逐字比对（已验证 17/17），不靠单测假装验证。
//
// 别把这条当成漏测顺手补上。

import { describe, test, expect } from "bun:test";
import { extractPages } from "../ingest/pdf-source";

describe("extractPages", () => {
  test("空数据直接抛 —— 返回空数组会让整条管线安静地产出零个场景", () => {
    // 那种失败会表现成「模型没干活」，而真正的原因在最上游
    expect(extractPages(new Uint8Array(0))).rejects.toThrow();
  });

  test("不是 PDF 的字节也要抛，不能假装成功", () => {
    expect(extractPages(new TextEncoder().encode("这不是 PDF"))).rejects.toThrow();
  });
});
```

- [ ] **Step 3: 跑一次确认它失败**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-pdf-source.test.ts`
Expected: FAIL，找不到模块 `../ingest/pdf-source`

- [ ] **Step 4: 写实现**

创建 `src/ingest/pdf-source.ts`。最后那行取逐页文本的写法按 Step 1 探针的结果落笔：

```ts
// 摄取管线 · 第一段：PDF → 逐页文本
//
// 依赖是 pdf-parse v2.4.5，导出的是 PDFParse **类**，不是网上示例里那个默认函数。
// require("pdf-parse")(buffer) 会抛 pdfParse is not a function ——
// 这个坑值半小时，写在这儿免得下一个人再踩。
//
// 本模块只收 Uint8Array，不收路径、不碰 fs：读盘是 tools 脚本的事。
// 中间这几段保持无 IO，才能被纯逻辑单测（tools/ 不进版本库，放那里等于放弃测试）。
//
// getText() 之外还有 getPageTables / getImage / getHyperlinks，
// 模组附件是 6 张图，将来用得上。

import { PDFParse } from "pdf-parse";

/**
 * 抽出逐页原始文本。下游是 cleanPageText。
 *
 * 坏输入一律抛，不返回空数组：空数组会让整条管线安静地产出零个场景，
 * 表现成「模型没干活」，而真正的原因在最上游。
 */
export async function extractPages(data: Uint8Array): Promise<string[]> {
  if (data.length === 0) throw new Error("[ingest] PDF 数据为空");
  const res = await new PDFParse({ data }).getText();

  // 逐页元素的形状由 Step 1 探针实测确定，不照记忆写。
  // 这里的取法两种都兜住：元素本身是字符串，或是带 text 字段的对象。
  const pages: unknown = (res as { pages?: unknown }).pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("[ingest] pdf-parse 未返回逐页结果");
  }
  return pages.map((p) =>
    typeof p === "string" ? p : String((p as { text?: string } | null)?.text ?? ""),
  );
}
```

若 Step 1 探针显示逐页元素的文本字段不叫 `text`，改那一行，并把真实字段名写进上面的注释。`pages.length === 0` 一并抛，是为了让「不是 PDF 的字节」这类输入不至于安静地返回空数组。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd C:\aitrpg\poc; bun test src/__tests__/ingest-pdf-source.test.ts`
Expected: PASS，2 tests

若「不是 PDF 的字节」那条没抛而是返回了空结果，说明 `pdf-parse` 在这种输入下不抛。这时**改实现让它抛**（结果为空或页数为 0 时抛出可读错误），不要改测试去迁就。

- [ ] **Step 6: 删掉探针**

```bash
cd C:\aitrpg\poc; Remove-Item tools/_probe-pdf.ts, tools/_probe-out.txt
```

- [ ] **Step 7: 全量回归 + 类型检查**

Run: `cd C:\aitrpg\poc; bun test; bun run typecheck`
Expected: 全部通过

- [ ] **Step 8: 提交**

```bash
cd C:\aitrpg\poc; git add src/ingest/pdf-source.ts src/__tests__/ingest-pdf-source.test.ts; git commit -m "feat(ingest): commit the pdf stage that clean-text has been importing all along"
```

---

### Task 6: 串起来实跑，把数字写进索引

**Files:**
- Create: `tools/_run-ingest.ts`（**被 .gitignore 排除，不进版本库**）
- Modify: `docs/index-program.md`（§模组摄取 的状态表与正文）

**Interfaces:**
- Consumes: `extractPages`、`cleanPageText`、`sectionize`、`toClassifyInputs`、`classifySections`、`assignSceneIds`、`buildScenes`、`diffValues`、`formatDiff`、`BARN_OF_PREMIER`（`src/module/barn-of-premier.ts`）、`LLMClient`（`src/llm/client.ts`）、`loadConfig`（`src/config.ts`）
- Produces: 三个落盘产物 + 一个可写进文档的数字

- [ ] **Step 1: 先确认 LLM 真的通**

不要拿 `bun test` 的输出或历史记录当证据 —— `[config] No LLM_API_KEY set` 是测试在验证无 key 的降级路径，不是配置故障。判断 LLM 通不通必须实际发一次请求。

创建 `tools/_probe-llm.ts`：

```ts
import { loadConfig } from "../src/config";
import { LLMClient } from "../src/llm/client";

const client = new LLMClient(loadConfig());
const reply = await client.chat([{ role: "user", content: "只回复两个字：收到" }], { temperature: 0 });
await Bun.write("tools/_probe-llm-out.txt", `回复: ${reply}`);
```

Run: `cd C:\aitrpg\poc; bun tools/_probe-llm.ts`
用读取工具看 `tools/_probe-llm-out.txt`。拿不到回复就先解决 key/网络，不要带着一个熔断的客户端往下跑——那样只会得到 0/20 而不知道原因。

跑通后删掉：`cd C:\aitrpg\poc; Remove-Item tools/_probe-llm.ts, tools/_probe-llm-out.txt`

- [ ] **Step 2: 写实跑脚本**

创建 `tools/_run-ingest.ts`：

```ts
// 一次性实跑：PDF → 清洗 → 切分 → 分类 → 场景骨架 → 对基准 diff。
//
// 所有 IO 集中在这里。src/ingest/ 那几个模块保持无 IO 才能被纯逻辑单测，
// 而本文件在 .gitignore 之外，放逻辑进来等于放弃测试。

import { readFileSync } from "fs";
import { loadConfig } from "../src/config";
import { LLMClient } from "../src/llm/client";
import { extractPages } from "../src/ingest/pdf-source";
import { cleanPageText } from "../src/ingest/clean-text";
import { sectionize } from "../src/ingest/sectionize";
import { toClassifyInputs, classifySections } from "../src/ingest/classify-sections";
import { assignSceneIds } from "../src/ingest/scene-id";
import { buildScenes } from "../src/ingest/build-scenes";
import { diffValues, formatDiff } from "../src/ingest/calibrate";
import { BARN_OF_PREMIER } from "../src/module/barn-of-premier";

const PDF = "C:\\aitrpg\\MikuFan-普瑞米尔的谷仓\\普瑞米尔的谷仓 ver1.03.pdf";
const OUT = "tools/ingest-out";

const raw = await extractPages(new Uint8Array(readFileSync(PDF)));
const pages = raw.map(cleanPageText);
const sections = sectionize(pages);
const inputs = toClassifyInputs(sections);

const kinds = await classifySections(inputs, new LLMClient(loadConfig()));
const ids = assignSceneIds(sections);
const { scenes, warnings } = buildScenes(sections, kinds, ids);

// 候选产物：只有 scenes 换成生成的，其余顶层字段沿用基准。
// 这样 diff 里只剩本轮该负责的部分 —— npcs/items/endings 尚未开工，
// 让它们整片报 missing 只会把 scenes 内部的真实差异淹掉。
// 下一轮的路线图仍然看得见：生成场景的 clues/npcIds/connections 是空的，
// 会逐条报成 scenes[卧室].clues[clue_bedroom_diary] 这样的 missing。
const candidate = { ...BARN_OF_PREMIER, scenes };
const diffs = diffValues(BARN_OF_PREMIER, candidate, { pairBy: ["id", "name"] });

// 基准 20 个场景里，按 name 配上的有几个
const baseNames = new Set(BARN_OF_PREMIER.scenes.map((s) => s.name));
const hit = scenes.filter((s) => baseNames.has(s.name));

await Bun.write(`${OUT}/scenes.json`, JSON.stringify(scenes, null, 2));

await Bun.write(
  `${OUT}/id-name.txt`,
  ["id ↔ name 对照表", "", ...scenes.map((s) => `${s.id}\t${s.name}`)].join("\n"),
);

await Bun.write(
  `${OUT}/report.txt`,
  [
    `页数 ${pages.length} / 块 ${sections.length} / 送分类 ${inputs.length} / 分类返回 ${kinds.size}`,
    `判成场景 ${scenes.length} 个`,
    `基准 ${BARN_OF_PREMIER.scenes.length} 个场景，按 name 命中 ${hit.length}`,
    `未命中基准的生成场景（疑似误报）: ${scenes.filter((s) => !baseNames.has(s.name)).map((s) => s.name).join("、") || "无"}`,
    `基准里没被生成出来的（漏报）: ${BARN_OF_PREMIER.scenes.filter((s) => !scenes.some((g) => g.name === s.name)).map((s) => s.name).join("、") || "无"}`,
    "",
    "warnings:",
    ...warnings.map((w) => `  ${w}`),
    "",
    formatDiff(diffs),
  ].join("\n"),
);

console.log(`命中 ${hit.length}/${BARN_OF_PREMIER.scenes.length}，产物在 ${OUT}/`);
```

- [ ] **Step 3: 跑**

Run: `cd C:\aitrpg\poc; bun tools/_run-ingest.ts`
Expected: 打印一行命中数，`tools/ingest-out/` 下出现三个文件。

用读取工具看 `tools/ingest-out/report.txt`（**不要用 PowerShell 读**）。记下四个数：块数、判成场景数、命中数、漏报名单。

若命中数明显低于上一轮分类实跑的 20，先看 `report.txt` 里「分类返回」这个数：为 0 说明 LLM 那一环挂了或键归一化又出问题——把原始响应打出来看，别猜（上一轮就是被 `【农场外围】` 这个格式坑了 43 条）。

- [ ] **Step 4: 把数字写进索引**

修改 `docs/index-program.md` 的 §模组摄取 · 状态 表格。当前最后两行是：

```
| LLM 插槽 · 块分类 | `src/ingest/classify-sections.ts` | **已完成**，15 测试。实跑 **命中 20 / 误报 7 / 漏报 0** |
| LLM 插槽 · 其余语义字段 | — | 未做（`findMethods`、NPC 字段、`connections`、id 命名） |
```

改成（下表里的 `N` 用 Step 3 的实测值替换，不要留占位符）：

```
| LLM 插槽 · 块分类 | `src/ingest/classify-sections.ts` | **已完成**，20 测试。实跑 **命中 20 / 误报 7 / 漏报 0** |
| PDF → 逐页文本 | `src/ingest/pdf-source.ts` | **已完成**，2 测试（只测形态，内容保真靠实跑） |
| id 命名 | `src/ingest/scene-id.ts` | **已完成**，8 测试。形态 `scene_NN`，按块编号 |
| 场景骨架 | `src/ingest/build-scenes.ts` | **已完成**，13 测试。实跑 **基准 20 个场景按 name 命中 N** |
| LLM 插槽 · 其余语义字段 | — | 未做（`findMethods`、NPC 字段、`connections`） |
```

并在该节末尾追加一段（同样用实测值）：

```markdown
### id 是内部句柄，不与基准对齐（2026-08-19）

基准的场景 id 是带上下文的人工意译：`霍姆斯医院 → hospital`（人名丢了）、
`与艾德里安的会面 → adrian_hospital_meeting`（反而加了原标题没有的 hospital）、
`证物室 → police_evidence_room`（补了父场景前缀）。这是语义翻译，机械复现不了；
把基准 id 塞进 prompt 当范例又等于泄题，测出的命中率不说明任何事。

所以生成的 id 只保证唯一、同一 PDF 重跑稳定、纯 ASCII、可被 `targetSceneId` 解析，
形态是 `scene_NN`（按**块**编号，不按场景——分类结果一变，按场景编号会让所有 id 集体挪位）。
配对改由 `diffValues(..., { pairBy: ["id","name"] })` 承担：先按 id 配，配不上按 name 配，
id 不同的单列成 `id-mismatch`，不去污染 changed 那个计数。

顺带修掉校准器一处会埋掉信息的地方：`allHaveId` 原本要求数组非空，
于是候选侧 `clues: []` 会把整个数组拖回按下标比，32 条缺失全印成 `clues[0]`…`clues[31]`。
空数组现在平凡成立，路径变成 `scenes[卧室].clues[clue_bar_ask_around]` —— 这份清单直接是下一轮的路线图。
```

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd C:\aitrpg\poc; bun test; bun run typecheck`
Expected: 全部通过。ingest 测试合计 101 + 8 + 5 + 13 + 13 + 2 = 142。

- [ ] **Step 6: 提交**

`tools/` 被 `.gitignore` 排除，所以这次只提交文档。

```bash
cd C:\aitrpg\poc; git add docs/index-program.md; git commit -m "docs: record what the scene skeleton actually recovered from the pdf"
```

- [ ] **Step 7: 确认工作树干净**

Run: `cd C:\aitrpg\poc; git status --short`
Expected: 只剩 ` M docs/index-world-model.md` 这一条——那是本任务开始前就存在的、属于 relics/ 那条任务线的未提交改动，**不要动它**。

---

## 完成判据

1. `bun test` 全绿，142 个 ingest 测试，原有 101 个零回归
2. `bun run typecheck` 无错
3. `tools/ingest-out/report.txt` 里有「基准 20 个场景按 name 命中 N」这个实测数
4. `docs/index-program.md` 的状态表与新增小节写的是实测值，没有占位符
5. `git status` 除 `docs/index-world-model.md` 外干净
