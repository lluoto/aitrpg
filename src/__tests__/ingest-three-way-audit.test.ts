// 开发·三方比对器 + 臆造清单验收（阶段2，只产清单，不修数据）。
//
// 背景：calibrate.ts 只做两方比对（基准 vs 生成物），"基准有、生成物没有"
// 这个差异形状含义可以完全相反——Scene.atmosphere 是漏抽（原文有，管线
// 抽到了但塞进了错的字段），【共鸣特质】是臆造（原文查无此词）。只有引入
// PDF 原文当第三方才能裁决，而"臆造 vs 创作层"这个裁决本身不能自动化，
// 靠显式登记名单（FABRICATION_REGISTRY / FIELD_OMISSION_REGISTRY），同
// end-narration-clue-reachability.test.ts 的 KNOWN_UNREACHABLE 模式。
//
// 生产来源断言读取 docs/evidence/barn-source-v1.03/ 的受控语料。它绑定原始
// PDF 的字节哈希和逐段哈希；输入缺失或损坏必须明确失败，不能跳过或改读 tools/。
//
// bun test src/__tests__/ingest-three-way-audit.test.ts

import { describe, it, expect, afterAll } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  normalizeForMatch,
  termAppearsInCorpus,
  fieldValueAppearsInCorpus,
  readOriginalCorpus,
  extractBracketTerms,
  classifyFieldOmission,
  FABRICATION_REGISTRY,
  FIELD_OMISSION_REGISTRY,
  AUDITED_MODULE_FILES,
  extractBracketTermsAcrossFiles,
  stripDisplayAnnotation,
  auditDeclaredEntities,
  ENTITY_FABRICATION_REGISTRY,
  buildCorpusFromPages,
  compareCorpusSources,
  readAuditedModuleSources,
  BARN_SOURCE_EVIDENCE_MANIFEST_PATH,
  BARN_SOURCE_EVIDENCE_MANIFEST_SHA256,
  BARN_SOURCE_PDF_SHA256,
  BARN_SOURCE_SECTION_FILES,
  canonicalizeSourceEvidenceText,
  canonicalizeSourceEvidenceManifestText,
  readSourceBoundCorpus,
  readSourceEvidenceManifest,
  type DeclaredEntityRef,
  type SourceEvidenceManifest,
} from "../ingest/three-way-audit";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import { sha256 } from "../ingest/document-ir";

function requireSourceCorpus(): string {
  const result = readOriginalCorpus();
  if (!result.ok) throw new Error(result.reason);
  return result.text;
}

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

  it("**错误行为红线**：跳过含 ${...} 模板插值的方括号内容——那是 UI 强调括号，不是对原文的静态声明（阶段7 扩展到 mythos-module.ts 时抓到的真实假阳性：`【剧本杀模组：${module.name}】`）", () => {
    const src = 'lines.push(`【剧本杀模组：${module.name}】`);';
    expect(extractBracketTerms(src)).toEqual([]);
  });

  it("回归：不含插值的方括号内容仍然正常抽取，不是把整个功能关掉了", () => {
    const src = '"下次会选择什么更好的【伎俩】呢..."\nlines.push(`【剧本杀模组：${module.name}】`);';
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

describe("Scene.atmosphere 漏抽的具体证据——由受控原文语料约束", () => {
  const tricamHouse = BARN_OF_PREMIER.scenes.find((s) => s.id === "特里坎家");

  it("基准 atmosphere 全文有受控原文依据；字段注册仅声明它是漏抽，不把旧快照当生产真相", () => {
    expect(tricamHouse?.atmosphere).toBeTruthy();
    expect(fieldValueAppearsInCorpus(tricamHouse!.atmosphere!, requireSourceCorpus())).toBe(true);
    expect(classifyFieldOmission("scenes[特里坎家].atmosphere")).toBe("missing-extraction");
  });

  it("atmosphere 文本被篡改或不再可由原文支撑时必须失败", () => {
    expect(tricamHouse?.atmosphere).toBeTruthy();
    const mutatedCorpus = normalizeForMatch(requireSourceCorpus()).replaceAll(normalizeForMatch(tricamHouse!.atmosphere!), "");
    expect(fieldValueAppearsInCorpus(tricamHouse!.atmosphere!, mutatedCorpus)).toBe(false);
  });
});

describe("方括号术语审计：原文查无此词的集合与 FABRICATION_REGISTRY 精确相等", () => {
  const barnSource = readFileSync("src/module/barn-of-premier.ts", "utf8");
  const terms = extractBracketTerms(barnSource);

  it("**主判据**：查无此词的方括号术语必须一个不多一个不少地出现在登记名单里", () => {
    const notFound = terms.filter((t) => !termAppearsInCorpus(t, requireSourceCorpus()));
    expect(new Set(notFound)).toEqual(new Set(FABRICATION_REGISTRY.map((e) => e.term)));
  });

  // 开发·摄取管线校准 阶段3：初始清单原来有 4 条已确证臆造，True End 与
  // ENCOUNTER_NARRATIONS 里的臆造台词已按原文改写，方括号连同臆造内容
  // 一起从数据里删掉了——名单因此清空。这条测例从"确认清单包含 3 条"
  // 改成"确认清单确实是空的、且不是因为判据坏了"：先证明现在真的一处
  // 无据的方括号术语都不剩（notFound 为空），名单也确实清空且不多不少
  // （上面的主判据已经在验证这个精确相等关系，这里只是从"清单该有什么"
  // 的角度再钉一遍，防止未来有人往空名单里加一条却忘了这本该是无据的）。
  it("清单已按阶段3的修正清空——不是没查，是真的不再有无据的方括号术语", () => {
    expect(FABRICATION_REGISTRY).toEqual([]);
    const notFound = terms.filter((t) => !termAppearsInCorpus(t, requireSourceCorpus()));
    expect(notFound).toEqual([]);
  });

  it("**对照**：能在原文查到的术语依旧不在名单里——写法差异不该被当成臆造", () => {
    const corpus = requireSourceCorpus();
    const registryTerms = new Set(FABRICATION_REGISTRY.map((e) => e.term));
    for (const attested of ["救出", "伎俩"]) {
      expect(terms.includes(attested)).toBe(true); // 前提：这个术语确实在数据里
      expect(termAppearsInCorpus(attested, corpus)).toBe(true);
      expect(registryTerms.has(attested)).toBe(false);
    }
    // "米戈联络术"曾经是这份对照组的第三个成员——它此前只在被删掉的那句
    // True End 文案里带过方括号，其余出现（展示名/revelation）用的是
    // 圆括号或直角引号，本来就不会被 extractBracketTerms() 当成方括号
    // 术语。删掉那句臆造台词之后，它从"能查到但不该登记"变成了"压根
    // 不再被抽取到"——两种都不该出现在名单里，但理由不同，钉在这里
    // 别让人以为是判据漏查了它。
    expect(terms.includes("米戈联络术")).toBe(false);
  });

  it("语料中被移除的方括号术语必须让生产审计失败", () => {
    const mutatedCorpus = normalizeForMatch(requireSourceCorpus()).replaceAll(normalizeForMatch("救出"), "");
    const notFound = terms.filter((term) => !termAppearsInCorpus(term, mutatedCorpus));
    expect(notFound).toContain("救出");
    expect(new Set(notFound)).not.toEqual(new Set(FABRICATION_REGISTRY.map((entry) => entry.term)));
  });
});

describe("多文件覆盖：方括号术语审计不再只看 barn-of-premier.ts（阶段7 任务②）", () => {
  const sources = readAuditedModuleSources();
  const termMap = extractBracketTermsAcrossFiles(sources);

  it("**回归**：AUDITED_MODULE_FILES 只审计唯一谷仓维护文件，不能重复扫描旧投影", () => {
    expect(AUDITED_MODULE_FILES).toEqual(["src/module/barn-of-premier.ts"]);
  });

  it("跨文件收词会记下每个术语出现在哪些文件——同一个术语在两个文件里都出现时两个文件都在列", () => {
    const src = [
      { file: "a.ts", text: '"【伎俩】"' },
      { file: "b.ts", text: '"【伎俩】"' },
      { file: "c.ts", text: '"【共鸣特质】"' },
    ];
    const merged = extractBracketTermsAcrossFiles(src);
    expect(new Set(merged.get("伎俩"))).toEqual(new Set(["a.ts", "b.ts"]));
    expect(merged.get("共鸣特质")).toEqual(["c.ts"]);
  });

  it("**主判据**：唯一谷仓维护文件里查无此词的方括号术语集合必须与 FABRICATION_REGISTRY 精确相等", () => {
    const notFound = [...termMap.keys()].filter((t) => !termAppearsInCorpus(t, requireSourceCorpus()));
    expect(new Set(notFound)).toEqual(new Set(FABRICATION_REGISTRY.map((e) => e.term)));
  });
});

describe("readAuditedModuleSources 参数化——开发·无基准模式 任务③：常量只是谷仓的默认值", () => {
  it("不传参数时默认读 AUDITED_MODULE_FILES（谷仓），行为与改动前一致", () => {
    const sources = readAuditedModuleSources();
    expect(sources.map((s) => s.file)).toEqual([...AUDITED_MODULE_FILES]);
    expect(sources.every((s) => s.text.length > 0)).toBe(true);
  });

  it("传自定义文件列表时读那些文件，不是硬编码的谷仓三个文件——换一本模组直接可用", () => {
    const sources = readAuditedModuleSources(["src/ingest/three-way-audit.ts"]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.file).toBe("src/ingest/three-way-audit.ts");
    expect(sources[0]?.text).toContain("readAuditedModuleSources");
  });

  it("extractBracketTermsAcrossFiles 本身早就是通用的（收 sources 参数）——这条只是回归确认，不是本轮改的", () => {
    const sources = readAuditedModuleSources(["src/ingest/three-way-audit.ts"]);
    const map = extractBracketTermsAcrossFiles(sources);
    expect(map instanceof Map).toBe(true);
  });
});

describe("声明实体审计：NPC 名/场景名是否在原文里真实存在（阶段7 任务②）", () => {
  function collectEntities(): DeclaredEntityRef[] {
    return [
      ...BARN_OF_PREMIER.npcs.map((npc) => ({ name: npc.name, kind: "npc" as const, source: "src/module/barn-of-premier.ts" })),
      ...BARN_OF_PREMIER.scenes.map((scene) => ({ name: scene.name, kind: "scene" as const, source: "src/module/barn-of-premier.ts" })),
    ];
  }

  it("stripDisplayAnnotation：去掉尾部括号注解，不去掉正文里的括号", () => {
    expect(stripDisplayAnnotation("维修间（终局场景）")).toBe("维修间");
    expect(stripDisplayAnnotation("Mi-Go（来自尤格斯的真菌）")).toBe("Mi-Go");
    expect(stripDisplayAnnotation("食尸鬼（可选）")).toBe("食尸鬼");
    expect(stripDisplayAnnotation("普瑞米尔")).toBe("普瑞米尔"); // 没有括号，原样返回
  });

  it("auditDeclaredEntities：括号注解会先归一化，不会被误判成查无此名", () => {
    const fakeCorpus = "维修间的墙壁上长满了青苔。";
    const notFound = auditDeclaredEntities(
      [{ name: "维修间（终局场景）", kind: "scene", source: "test" }],
      fakeCorpus,
    );
    expect(notFound).toEqual([]);
  });

  it("auditDeclaredEntities：真查无此名的实体会被报出来", () => {
    const fakeCorpus = "维修间的墙壁上长满了青苔。";
    const notFound = auditDeclaredEntities(
      [{ name: "凭空捏造的角色", kind: "npc", source: "test" }],
      fakeCorpus,
    );
    expect(notFound).toEqual([{ name: "凭空捏造的角色", kind: "npc", source: "test" }]);
  });

  it("**主判据**：唯一谷仓数据声明的 NPC/场景名，查无此名的集合必须与 ENTITY_FABRICATION_REGISTRY 精确相等", () => {
    const notFound = auditDeclaredEntities(collectEntities(), requireSourceCorpus());
    const notFoundKeys = new Set(notFound.map((e) => `${e.kind}:${stripDisplayAnnotation(e.name)}`));
    const registryKeys = new Set(ENTITY_FABRICATION_REGISTRY.map((e) => `${e.kind}:${e.name}`));
    expect(notFoundKeys).toEqual(registryKeys);
  });

  it("清单确实是空的——不是没查，是统一谷仓数据里的人名地名一个不剩地能在原文查到", () => {
    expect(ENTITY_FABRICATION_REGISTRY).toEqual([]);
    const notFound = auditDeclaredEntities(collectEntities(), requireSourceCorpus());
    expect(notFound).toEqual([]);
  });

  it("**回归**：统一谷仓源贡献 NPC 和 scene 两种实体", () => {
    const entities = collectEntities();
    const sources = new Set(entities.map((e) => e.source));
    expect(sources).toEqual(new Set(["src/module/barn-of-premier.ts"]));
    expect(entities.some((e) => e.kind === "npc")).toBe(true);
    expect(entities.some((e) => e.kind === "scene")).toBe(true);
  });

  it("语料中被移除的声明实体必须让生产审计失败", () => {
    const target = "米尔·特里坎";
    const notFound = auditDeclaredEntities(collectEntities(), requireSourceCorpus().replaceAll(target, ""));
    expect(notFound).toContainEqual(expect.objectContaining({ name: target, kind: "npc" }));
  });
});

describe("受控来源语料：PDF binding、清单和段落哈希", () => {
  const scratchDir = join(".opencode", "tmp-source-evidence-scratch");

  function writeBoundFixture(directory: string): { manifestPath: string; corpusDirectory: string } {
    const corpusDirectory = join(directory, "corpus");
    mkdirSync(corpusDirectory, { recursive: true });
    const sections = BARN_SOURCE_SECTION_FILES.map((file, index) => {
      const text = `第 ${index + 1} 页`;
      writeFileSync(join(corpusDirectory, file), text);
      return { file, pdfPage: index + 1, canonicalTextSha256: sha256(text) };
    });
    const manifest: SourceEvidenceManifest = {
      schemaVersion: 1,
      source: {
        title: "synthetic test source",
        version: "test",
        originalPdfSha256: "a".repeat(64),
        provenance: "Synthetic fixture; never production source evidence.",
      },
      derivation: {
        method: "test fixture",
        canonicalization: "CRLF/CR to LF",
      },
      corpusDirectory: "corpus",
      sections,
    };
    const manifestPath = join(directory, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    return { manifestPath, corpusDirectory };
  }

  afterAll(() => {
    rmSync(scratchDir, { recursive: true, force: true });
  });

  it("默认生产输入具有非 synthetic 的 PDF 字节绑定、18 段 inventory 和可追溯说明", () => {
    const manifest = readSourceEvidenceManifest();
    if ("ok" in manifest) {
      if (!manifest.ok) throw new Error(manifest.reason);
      throw new Error("source-evidence manifest reader returned a corpus result");
    }
    expect(BARN_SOURCE_EVIDENCE_MANIFEST_PATH).toBe("docs/evidence/barn-source-v1.03/manifest.json");
    expect(manifest.source.originalPdfSha256).toBe(BARN_SOURCE_PDF_SHA256);
    const manifestText = readFileSync(BARN_SOURCE_EVIDENCE_MANIFEST_PATH, "utf8");
    const canonical = canonicalizeSourceEvidenceManifestText(manifestText);
    expect(sha256(canonical)).toBe(BARN_SOURCE_EVIDENCE_MANIFEST_SHA256);
    expect(sha256(canonicalizeSourceEvidenceManifestText(canonical.replace(/\n/g, "\r\n")))).toBe(BARN_SOURCE_EVIDENCE_MANIFEST_SHA256);
    expect(manifest.source.provenance).toContain("authorized");
    expect(manifest.sections.map((section) => section.pdfPage)).toEqual(Array.from({ length: 18 }, (_, index) => index + 1));
  });

  it("缺失 manifest 是显式 source-evidence input 错误，不是绿 skip", () => {
    const result = readSourceBoundCorpus(join(scratchDir, "missing", "manifest.json"));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("[source-evidence] input missing");
  });

  it("一个缺失或篡改的受控段落分别触发 input 和 hash 错误", () => {
    const missing = writeBoundFixture(join(scratchDir, "missing-section"));
    rmSync(join(missing.corpusDirectory, "section_02.txt"));
    const missingResult = readSourceBoundCorpus(missing.manifestPath);
    expect(missingResult).toMatchObject({ ok: false });
    if (!missingResult.ok) expect(missingResult.reason).toContain("section_02.txt");

    const altered = writeBoundFixture(join(scratchDir, "altered-section"));
    writeFileSync(join(altered.corpusDirectory, "section_02.txt"), "被篡改的页面");
    const alteredResult = readSourceBoundCorpus(altered.manifestPath);
    expect(alteredResult).toMatchObject({ ok: false });
    if (!alteredResult.ok) expect(alteredResult.reason).toContain("section hash mismatch: p3");
  });

  it("无效 PDF provenance hash 不能作为 source-bound corpus 通过", () => {
    const fixture = writeBoundFixture(join(scratchDir, "invalid-provenance"));
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8")) as SourceEvidenceManifest;
    manifest.source.originalPdfSha256 = "not-a-sha256";
    writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest)}\n`);
    const result = readSourceBoundCorpus(fixture.manifestPath);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("manifest provenance invalid");
  });

  it("生产来源断言不得用 it.skipIf 条件跳过", () => {
    const testSource = readFileSync(import.meta.path, "utf8");
    expect(testSource).not.toMatch(/\bit\.skipIf\(/);
  });
});

describe("合成语料缺段时 fail closed——仅验证解析路径，不构成生产来源证据", () => {
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

describe("语料来源——开发·无基准模式 任务②：语料来自这次摄取自己的页文本，不再只认谷仓切片", () => {
  it("buildCorpusFromPages 按顺序拼接逐页文本", () => {
    const text = buildCorpusFromPages(["第一页", "第二页", "第三页"]);
    expect(text).toBe("第一页\n第二页\n第三页");
  });

  it("compareCorpusSources：两份语料归一化后逐字一致时 identical 为 true", () => {
    const r = compareCorpusSources("在1921年  发生了一件事", "在1921年发生了一件事");
    expect(r.identical).toBe(true); // 只差空白，normalizeForMatch 会去掉
  });

  it("compareCorpusSources：内容真的不同时如实报 identical:false，不强行判定为一致", () => {
    const r = compareCorpusSources("这是页语料", "这是切片语料，内容不一样");
    expect(r.identical).toBe(false);
    expect(r.pageCorpusLength).toBeGreaterThan(0);
    expect(r.sliceCorpusLength).toBeGreaterThan(r.pageCorpusLength);
  });

  it("**真实回归**：受控语料按 manifest 的 PDF 页序重建后与生产审计语料完全相同", () => {
    const manifest = readSourceEvidenceManifest();
    if ("ok" in manifest) {
      if (!manifest.ok) throw new Error(manifest.reason);
      throw new Error("source-evidence manifest reader returned a corpus result");
    }
    const corpusDirectory = join(dirname(BARN_SOURCE_EVIDENCE_MANIFEST_PATH), manifest.corpusDirectory);
    const pages = manifest.sections.map((section) => canonicalizeSourceEvidenceText(readFileSync(join(corpusDirectory, section.file), "utf8")));
    const cmp = compareCorpusSources(buildCorpusFromPages(pages), requireSourceCorpus());
    expect(cmp.identical).toBe(true);
  });
});
