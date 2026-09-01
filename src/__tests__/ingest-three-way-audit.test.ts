// 开发·三方比对器 + 臆造清单验收（阶段2，只产清单，不修数据）。
//
// 背景：calibrate.ts 只做两方比对（基准 vs 生成物），"基准有、生成物没有"
// 这个差异形状含义可以完全相反——Scene.atmosphere 是漏抽（原文有，管线
// 抽到了但塞进了错的字段），【共鸣特质】是臆造（原文查无此词）。只有引入
// PDF 原文当第三方才能裁决，而"臆造 vs 创作层"这个裁决本身不能自动化，
// 靠显式登记名单（FABRICATION_REGISTRY / FIELD_OMISSION_REGISTRY），同
// end-narration-clue-reachability.test.ts 的 KNOWN_UNREACHABLE 模式。
//
// ⚠ tools/modules/raw/*.txt、tools/ingest-out/scenes.json 都是派生物，
// 不进版本库（module/types.ts:76）。依赖它们的判据必须能在缺失时优雅
// 降级——明确报"跳过"并告警，不能静默通过。
//
// bun test src/__tests__/ingest-three-way-audit.test.ts

import { describe, it, expect, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  normalizeForMatch,
  termAppearsInCorpus,
  readOriginalCorpus,
  extractBracketTerms,
  classifyFieldOmission,
  FABRICATION_REGISTRY,
  FIELD_OMISSION_REGISTRY,
} from "../ingest/three-way-audit";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";

describe("normalizeForMatch：写法差异不能误判成臆造", () => {
  it("半角/全角连字符、破折号会被抹平——「米戈联络术」与「米-戈联络术」归一化后相等", () => {
    expect(normalizeForMatch("米戈联络术")).toBe(normalizeForMatch("米-戈联络术"));
    expect(normalizeForMatch("米戈联络术")).toBe(normalizeForMatch("米－戈联络术"));
    expect(normalizeForMatch("米戈联络术")).toBe(normalizeForMatch("米—戈联络术"));
  });

  it("空白（含全角空格、制表符、换行）会被抹平——PDF 抽取常见的跳页断词", () => {
    expect(normalizeForMatch("米戈联络术")).toBe(normalizeForMatch("米戈\t联络术"));
    expect(normalizeForMatch("米戈联络术")).toBe(normalizeForMatch("米戈\n联络\u3000术"));
  });

  it("**错误行为的红线**：归一化不能把两个本来不同的词抹成一样——只去连字符/空白，不做别的", () => {
    expect(normalizeForMatch("共鸣特质")).not.toBe(normalizeForMatch("共鸣"));
    expect(termAppearsInCorpus("共鸣特质", "这段话只提到共鸣，没提特质")).toBe(false);
  });
});

describe("extractBracketTerms：只看数据行，不看注释", () => {
  it("跳过以 // 开头的注释行——开发笔记不是玩家会读到的叙事正文", () => {
    const src = [
      '// 原先这里有个 `RAW = "【原文】"` 标记常量，没有任何引用',
      '      description: "一个成功的力量可以掰开仪器【救出】受害者",',
    ].join("\n");
    expect(extractBracketTerms(src)).toEqual(["救出"]);
  });

  it("去重——同一个术语出现多次只算一条", () => {
    const src = [
      '"下次会选择什么更好的【伎俩】呢..."',
      '"下次会选择什么更好的【伎俩】呢..."',
    ].join("\n");
    expect(extractBracketTerms(src)).toEqual(["伎俩"]);
  });
});

describe("字段级「漏抽 vs 臆造」分类（FIELD_OMISSION_REGISTRY）", () => {
  it("**关键测例**：Scene.atmosphere 分类为「漏抽」，不是「臆造」——差异形状与臆造相同，含义相反", () => {
    expect(classifyFieldOmission("scenes[特里坎家].atmosphere")).toBe("missing-extraction");
    expect(classifyFieldOmission("scenes[特里坎家].atmosphere")).not.toBe("fabrication");
  });

  it("按字段名后缀匹配，覆盖任意场景——不需要为 14 处出现各写一条规则", () => {
    expect(classifyFieldOmission("scenes[加比的拖车房].atmosphere")).toBe("missing-extraction");
    expect(classifyFieldOmission("scenes[维修间].atmosphere")).toBe("missing-extraction");
  });

  it("没有登记规则的字段路径返回 null，不硬猜一个结论", () => {
    expect(classifyFieldOmission("scenes[特里坎家].someUnregisteredField")).toBeNull();
  });

  it("FIELD_OMISSION_REGISTRY 里 atmosphere 这条确实是 missing-extraction——防止有人把登记表本身改错", () => {
    const rule = FIELD_OMISSION_REGISTRY.find((r) => r.fieldSuffix === ".atmosphere");
    expect(rule).toBeDefined();
    expect(rule!.verdict).toBe("missing-extraction");
  });
});

describe("Scene.atmosphere 漏抽的具体证据——对照真实生成物快照，缺失时跳过+告警", () => {
  const scenesJsonPath = "tools/ingest-out/scenes.json";
  const hasSnapshot = existsSync(scenesJsonPath);
  const tricamHouse = BARN_OF_PREMIER.scenes.find((s) => s.id === "tricam_house");

  it.skipIf(!hasSnapshot)(
    "基准 atmosphere 全文（barn-of-premier.ts:169）是生成物 description 的子串——管线抽到了内容，只是塞进了错的字段",
    () => {
      expect(tricamHouse?.atmosphere).toBeTruthy();
      const generated = JSON.parse(readFileSync(scenesJsonPath, "utf8")) as { name: string; description: string }[];
      const scene = generated.find((s) => s.name === "特里坎家");
      expect(scene).toBeDefined();
      expect(scene!.description.includes(tricamHouse!.atmosphere!)).toBe(true);
    },
  );

  if (!hasSnapshot) {
    console.warn(`[ingest-three-way-audit] 跳过：${scenesJsonPath} 不存在（tools/ 不进版本库，本地/CI 环境可能没有），这不是"测过了没问题"`);
  }
});

describe("方括号术语审计：原文查无此词的集合与 FABRICATION_REGISTRY 精确相等", () => {
  const corpus = readOriginalCorpus();
  const barnSource = readFileSync("src/module/barn-of-premier.ts", "utf8");
  const terms = extractBracketTerms(barnSource);

  it.skipIf(!corpus.ok)("**主判据**：查无此词的方括号术语必须一个不多一个不少地出现在登记名单里", () => {
    if (!corpus.ok) return;
    const notFound = terms.filter((t) => !termAppearsInCorpus(t, corpus.text));
    expect(new Set(notFound)).toEqual(new Set(FABRICATION_REGISTRY.map((e) => e.term)));
  });

  it.skipIf(!corpus.ok)("初始清单确实包含题面给出的 3 条已确证臆造", () => {
    if (!corpus.ok) return;
    const registryTerms = new Set(FABRICATION_REGISTRY.map((e) => e.term));
    expect(registryTerms.has("共鸣特质")).toBe(true);
    expect(registryTerms.has("谢谢你们……")).toBe(true);
    expect(registryTerms.has("照顾好爱莉……")).toBe(true);
  });

  it.skipIf(!corpus.ok)("**对照**：能在原文查到的术语不在名单里——写法差异不该被当成臆造", () => {
    if (!corpus.ok) return;
    const registryTerms = new Set(FABRICATION_REGISTRY.map((e) => e.term));
    for (const attested of ["救出", "伎俩", "米戈联络术"]) {
      expect(terms.includes(attested)).toBe(true); // 前提：这个术语确实在数据里
      expect(termAppearsInCorpus(attested, corpus.text)).toBe(true);
      expect(registryTerms.has(attested)).toBe(false);
    }
  });

  if (!corpus.ok) {
    console.warn(`[ingest-three-way-audit] 跳过方括号术语审计：${(corpus as { ok: false; reason: string }).reason}`);
  }
});

describe("切片缺失时优雅降级——判据要能在切片不存在时明确报「跳过」，不能静默通过", () => {
  const scratchDir = join(".opencode", "tmp-three-way-audit-scratch");

  afterAll(() => {
    rmSync(scratchDir, { recursive: true, force: true });
  });

  it("目录整个不存在——返回 ok:false 且带上具体原因，不是抛异常或悄悄返回空字符串", () => {
    const result = readOriginalCorpus(join(scratchDir, "does-not-exist"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).toContain("00_header.txt");
    }
  });

  it("目录存在但只有部分切片——同样判定整体不可用，不拼一份不完整的语料悄悄用", () => {
    const partialDir = join(scratchDir, "partial");
    mkdirSync(partialDir, { recursive: true });
    writeFileSync(join(partialDir, "00_header.txt"), "头部内容");
    writeFileSync(join(partialDir, "section_01.txt"), "第一节内容");
    // 故意不写 section_02..17——模拟"只下载了一部分切片"的真实场景。
    const result = readOriginalCorpus(partialDir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("section_02.txt");
  });

  it("**回归**：真的把切片全部凑齐时返回 ok:true——上面两条不是把判据写死成了永远失败", () => {
    const completeDir = join(scratchDir, "complete");
    mkdirSync(completeDir, { recursive: true });
    writeFileSync(join(completeDir, "00_header.txt"), "头部");
    for (let i = 1; i <= 17; i++) {
      writeFileSync(join(completeDir, `section_${String(i).padStart(2, "0")}.txt`), `第${i}节`);
    }
    const result = readOriginalCorpus(completeDir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain("第1节");
  });
});
