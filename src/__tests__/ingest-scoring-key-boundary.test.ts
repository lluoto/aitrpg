// 摄取管线 · 评分键的边界
//
// 这份测试守的不是 scoring-key 的内容，是它的**用途边界**：
// 它绝不能被任何构造 prompt 的代码引用。把基准答案喂给模型，
// 测出来的准确率不说明任何事 —— 与「靠引文判场景」自我验证是同一类错误。
//
// 为什么用测试而不是注释：本仓已经有九处「注释断言了代码没有的性质」的先例。
// 口头约定拦不住下一个人手快，import 一加就过了。这条断言会红。
//
// 与 rule-content-boundary.test.ts 同一路数：只断言机器可查的结构事实
// （谁 import 了谁），不断言任何叙事文本。

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, join, resolve } from "path";

import { ENTRY_SCORING_KEY, keyDistribution } from "../ingest/scoring-key";

const SRC_ROOT = resolve(import.meta.dir, "..");
/** tools/ 与 src/ 平级。它被 .gitignore 排除，所以 clean checkout 上不存在 —— 下面按不存在处理。 */
const TOOLS_ROOT = resolve(SRC_ROOT, "..", "tools");

/** 递归收集某个目录下所有 .ts 源文件 */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * tools/ 里**准许**引用评分键的脚本（按文件名，不含路径）。
 *
 * 为什么必须逐个写出理由：没写理由的白名单只会越加越长 —— 下一个人看到一条
 * 没有解释的豁免，默认自己那条也一样正当，于是这道闸门在半年内烂掉。
 * 这三条各自的理由是：
 *
 *  · `_gen-key-worksheet.ts` —— 键的**重建路径**。PDF 换版本或清洗逻辑一改行号就漂，
 *    重建时它要把现有标注并排印出来供复核。它不调 LLM，不构造任何 prompt。
 *  · `_diag-confusion.ts`   —— 混淆矩阵/准确率诊断。算准确率就得读评分口径，
 *    这是键存在的**全部目的**。同样不调 LLM。
 *  · `_run-ingest.ts`       —— 端到端实跑器里**算分的那一段**。
 *
 * 最后一条是这份白名单里唯一有残余风险的：`_run-ingest.ts` 同时也是拼 prompt 的地方
 *（它 import 了 classify-sections / classify-items）。白名单管得住「谁能 import」，
 * 管不住「import 进来之后往哪儿传」。所以那份文件里有一条约定：
 * **评分键只在分类返回之后读，绝不进 `toClassifyInputs` / `toItemInputs` 的任何参数。**
 * 这一条目前只有人能看住，写在这里是为了让下一个人知道它是个约定而不是保证。
 */
const TOOLS_KEY_ALLOWLIST = new Set([
  "_gen-key-worksheet.ts",
  "_diag-confusion.ts",
  "_run-ingest.ts",
  // `_exp-clue-followup.ts` —— 检验「对 item/event 两族追问一次能否提高线索召回」的实验。
  // 它调 LLM，所以是这份白名单里风险最高的一条：同一个文件里既有 prompt 又有键。
  // 约定与 `_run-ingest.ts` 相同 —— **键只在两次分类都返回之后才读**，
  // 文件里有一行 `到这里为止没读过评分键` 标着分界。同样是约定不是保证。
  "_exp-clue-followup.ts",
]);

/**
 * 会构造或发送 prompt 的模块 —— 评分键对它们必须不可见。
 *
 * **这一条被下面那条全仓扫描严格包含**：这七个文件全都在 `SRC_ROOT` 底下，
 * 而下面那条扫 `SRC_ROOT` 里除测试与键自身之外的**每一个** .ts。
 * 所以「加一个 import 会红两条」是包含关系的必然结果，不是两层独立防御 ——
 * 别把它当成冗余保障来算。留着它只为一件事：报错时能直接指出「是 llm/narrator.ts」，
 * 而全仓那条只会吐一个绝对路径列表。
 */
const PROMPT_BUILDERS = [
  "ingest/classify-sections.ts",
  "ingest/classify-items.ts",
  "llm/client.ts",
  "llm/npc-dialogue-prompts.ts",
  "llm/generate-llm-expanded.ts",
  "llm/intent.ts",
  "llm/narrator.ts",
];

describe("评分键的用途边界", () => {
  test("没有构造 prompt 的模块引用评分键", () => {
    const offenders: string[] = [];
    for (const rel of PROMPT_BUILDERS) {
      const full = join(SRC_ROOT, rel);
      let text: string;
      try {
        text = readFileSync(full, "utf-8");
      } catch {
        continue; // 文件不存在就跳过，别让边界测试变成存在性测试
      }
      if (text.includes("scoring-key") || text.includes("ENTRY_SCORING_KEY")) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("src 下只有测试可以引用它", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      if (file.includes("__tests__")) continue;
      if (file.endsWith("scoring-key.ts")) continue;
      const text = readFileSync(file, "utf-8");
      if (text.includes("scoring-key") || text.includes("ENTRY_SCORING_KEY")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("tools 下只有白名单里的脚本可以引用它", () => {
    // **管线真正跑起来的地方是 tools/，不是 src/。** 只扫 src 的话，
    // 一个 tools/ 里的 runner 加一行 `import { ENTRY_SCORING_KEY } from "../src/ingest/scoring-key"`
    // 就能把基准答案和分类 prompt 拼在同一个文件里，而上面两条断言全绿 ——
    // 那是泄题最短的一条路，也是唯一一条实际有人会走的。
    //
    // tools/ 被 .gitignore 排除：clean checkout 上它不存在。这里**跳过而不是报红** ——
    // 一个在干净检出上必红的边界测试，活不过第二次 CI，会被人直接删掉，
    // 那时连 tools/ 存在的那台机器上也没人守了。
    if (!existsSync(TOOLS_ROOT)) return;

    const offenders: string[] = [];
    for (const file of collectSourceFiles(TOOLS_ROOT)) {
      if (TOOLS_KEY_ALLOWLIST.has(basename(file))) continue;
      const text = readFileSync(file, "utf-8");
      if (text.includes("scoring-key") || text.includes("ENTRY_SCORING_KEY")) offenders.push(basename(file));
    }
    expect(offenders).toEqual([]);
  });
});

describe("评分键的形状", () => {
  test("39 条，与全书 ▶ 条目数一致", () => {
    // 实测全书 45 个行首带 ▶ 的行，其中 6 个是「▶X：」冒号后无内容、被判成标题，
    // 最终 SectionItem 39 个。键要一一对应。
    expect(Object.keys(ENTRY_SCORING_KEY)).toHaveLength(39);
  });

  test("键的形态是 sourceKey 的 pN:LN", () => {
    // **这只验形态，不验存在** —— `"p99:L99"` 照样过这一条。
    // 而键的文件头写着行号是清洗后的、「清洗逻辑一变行号就漂」：漂一行那条就永远配不上任何条目，
    // 不报错不报红，只是悄悄不参与计分，指标看起来像是模型退步了。
    // 存在性要 PDF（在仓库之外），所以同 pdf-source 的内容保真一样**归实跑器报，不进单测**：
    // `tools/_run-ingest.ts` 断言「抽出的 sourceKey 集合 == 键名集合」并印两个方向的差。
    // 单测里塞一个读绝对路径的用例，换台机器就红，最后会被删掉。
    for (const k of Object.keys(ENTRY_SCORING_KEY)) expect(k).toMatch(/^p\d+:L\d+$/);
  });

  test("每条至少标了一个类别", () => {
    for (const [k, v] of Object.entries(ENTRY_SCORING_KEY)) {
      expect(v.length, `${k} 没有标类别`).toBeGreaterThan(0);
    }
  });

  test("clue 与 item 的 id 非空、无工作表前缀、同一条目内不重复", () => {
    // **先前这里还有一个 else 分支**：`expect("id" in x).toBe(false)`。它永远不会红 ——
    // 无 id 的那几种是模块级单例、由字面量构造，而 `ActualKind` 的联合类型压根不允许它们带 id，
    // 真出现违例是**类型错误**，在 `bun run typecheck` 就拦下了，走不到这条断言。
    // 一条不可能失败的断言比没有断言更糟：它让这个用例看上去覆盖了两侧。已删，换成三件能红的事。
    for (const [k, kinds] of Object.entries(ENTRY_SCORING_KEY)) {
      const seen = new Set<string>();
      for (const x of kinds) {
        if (x.kind !== "clue" && x.kind !== "item") continue;
        expect(x.id, `${k} 的 ${x.kind} 缺 id`).not.toBe("");
        // 工作表里候选是按 `clue:<id>` / `item:<id>` 印的，照抄进 `clue("…")` 会带上前缀。
        // 下面「id 都能在基准里找到」那条也会红，但报错读作「基准里没有 clue:clue_card」，
        // 看的人第一反应是去基准里找，而错在这一侧。
        expect(x.id, `${k} 的 id 带了工作表前缀`).not.toMatch(/^(clue|item):/);
        // 同一条目里标两次同一个对象：`[clue("x"), clue("x")]` 会让标记数与覆盖数对不上，
        // 而两个计数都不会红。现在有三条一对多条目，这个手滑面积比只有一条时大三倍。
        const mark = `${x.kind}:${x.id}`;
        expect(seen.has(mark), `${k} 重复标了 ${mark}`).toBe(false);
        seen.add(mark);
      }
    }
  });

  test("只有一条是**跨类别**双角色 —— 老旧文件同时是 Clue 与 ModuleItem", () => {
    // 这一条是量出来的，不是猜的（见 tools/_diag-confusion.ts）。
    // 下一轮做线索时不能假设「已判为 item ⇒ 不是 clue」，而这条测试钉住那个例外只有一个。
    //
    // 注意它数的是**类别**不同，不是标记数大于一：p8:L5 与 p5:L17 都是一条对两条 clue，
    // 同类别，不属于这里说的「双角色」。一对多条目一共三条，见下一条断言。
    const dual = Object.entries(ENTRY_SCORING_KEY).filter(
      ([, v]) => new Set(v.map((x) => x.kind)).size > 1,
    );
    expect(dual.map(([k]) => k)).toEqual(["p12:L6"]);
  });

  test("陷阱条目 ↔ type=trap 的基准物品（双向）", async () => {
    // `ActualKind` 没有 trap 变体，而分类器的六类里有，且它 4/4 全判对。
    // 这 4 条（39 条的 10%）算不算得中，全看算分那一步会不会把 item id 解回 `ModuleItem.type` ——
    // 一条写在谁的脑子里都不算数的约定。这条测试把它变成断言：**两个方向都钉。**
    // 只钉正向（陷阱条目 → trap 物品）挡不住把一个非陷阱条目误标成 trap 物品；
    // 反向那半是为这个写的。
    const { BARN_OF_PREMIER } = await import("../module/barn-of-premier");
    const typeById = new Map(BARN_OF_PREMIER.items.map((i) => [i.id, i.type]));

    /** 分类器会答 `trap` 的那几条 —— 与 docs/index-program.md 的混淆矩阵同一批 */
    const TRAP_ENTRIES = ["p9:L13", "p9:L15", "p9:L17", "p10:L4"];

    const mapsToTrap = (key: string) =>
      (ENTRY_SCORING_KEY[key] ?? []).some((x) => x.kind === "item" && typeById.get(x.id) === "trap");

    for (const k of TRAP_ENTRIES) {
      expect(mapsToTrap(k), `${k} 该指向一个 type=trap 的基准物品`).toBe(true);
    }
    const strays = Object.keys(ENTRY_SCORING_KEY).filter(
      (k) => !TRAP_ENTRIES.includes(k) && mapsToTrap(k),
    );
    expect(strays, "非陷阱条目指到了 trap 物品").toEqual([]);
  });

  test("引用的 clue / item id 都能在基准里找到", async () => {
    // 键写错 id 是最容易犯又最难发现的错：拼错一个字，那条就永远算不中，
    // 而指标只会低一点，不会红
    const { BARN_OF_PREMIER } = await import("../module/barn-of-premier");
    const clueIds = new Set(BARN_OF_PREMIER.scenes.flatMap((s) => s.clues.map((c) => c.id)));
    const itemIds = new Set(BARN_OF_PREMIER.items.map((i) => i.id));
    const bad: string[] = [];
    for (const [k, kinds] of Object.entries(ENTRY_SCORING_KEY)) {
      for (const x of kinds) {
        if (x.kind === "clue" && !clueIds.has(x.id)) bad.push(`${k} → clue:${x.id}`);
        if (x.kind === "item" && !itemIds.has(x.id)) bad.push(`${k} → item:${x.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("分布与手判的一致", () => {
    // 数的是**类别标记数**不是条目数：39 条目 → 42 个标记，因为有三条一对多（见下一条）。
    // 第一版这里写 clue: 20，是把条目数当成了标记数，被这条测试抓住。
    //
    // 这一版的数是复核之后重算的，改了三处：
    //   · p7:L11 由 `none` 改成 `item:drivers_license` —— 旧标是错的，见键里那条注释。
    //     `none` 因此 5→4，`item` 9→10。
    //   · p5:L17 补上 clue_adrian_psychoanalysis（条目正文逐字就是它的 description 结尾）。
    //     `clue` 因此 21→22。
    // 别照注释里的算术填，跑 `keyDistribution()` 看它实际返回什么。
    expect(keyDistribution()).toEqual({
      clue: 22,
      item: 10,
      connection: 3,
      npc_knowledge: 1,
      npc_secret: 1,
      event: 1,
      none: 4,
    });
  });

  test("标记总数 = 条目数 + 一对多的额外标记", () => {
    const marks = Object.values(keyDistribution()).reduce((a, b) => a + b, 0);
    const extra = Object.values(ENTRY_SCORING_KEY).reduce((n, v) => n + v.length - 1, 0);
    expect(marks).toBe(Object.keys(ENTRY_SCORING_KEY).length + extra);
    // 一对多的三条，连名字一起钉住 —— 只钉数字的话，一条被误删同时另一条被误加会平掉
    const multi = Object.entries(ENTRY_SCORING_KEY)
      .filter(([, v]) => v.length > 1)
      .map(([k]) => k);
    expect(multi).toEqual(["p5:L17", "p8:L5", "p12:L6"]);
    expect(extra).toBe(3);
  });
});
