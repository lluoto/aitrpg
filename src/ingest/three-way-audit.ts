// 摄取管线 · 三方比对——原文 ⟷ 生成物 ⟷ 手写基准。
//
// 背景：calibrate.ts 只做两方比对（基准 vs 生成物），差异分四类
// （changed/missing/extra/id-mismatch），但"基准有、生成物没有"这个形状
// 含义可以完全相反：
//   Scene.atmosphere（14 处）  原文【有】——文本已混在生成的 description 里
//                              （管线抽到了，塞进了错的字段）→ 漏抽
//   【共鸣特质】                原文【无】——18 个切片命中 0 → 臆造
//                              （开发·摄取管线校准 阶段3 已按原文改写，
//                              这里仍留作"臆造长什么样"的说明性例子）
//   prologue.lines             原文【无】但引擎需要 → 创作层
// 只有引入原文当第三方才能裁决。
//
// ⚠ 臆造与创作层的区别是【判断】，不能自动化——本文件只负责"原文里有没有
// 这段内容"这个可判定的事实，真正的分类（这是臆造还是刻意的创作层）落在
// 下面的显式登记名单里，照 end-narration-clue-reachability.test.ts 的
// KNOWN_UNREACHABLE 模式：名单内是已裁决的，名单外任何新的"原文无据"发现
// 都会让判据变红——让"无据"成为显式事实，不是靠人记得
// （barn-of-premier.ts:1317-1321「让不可达成为显式事实」同一个设计意图）。
//
// ⚠⚠ 能力边界（阶段3 实测确认的负面结果，别让下一个人以为绿了就没问题）：
// 这套审计只能判定"这个方括号术语/这段文本，原文里字面上有没有"——
// 纯粹的存在性检查。它**看不见语义矛盾**。真实案例：True End 曾经写着
// "艾米丽……但她知道，米—戈欺骗了他们所有人"，这句话不带任何方括号，
// 每个词单独查都能在原文找到出处（"艾米丽""知道""欺骗"都是原文词汇），
// 可整句话的意思与原文（section_12:12-18、:61-71）直接矛盾——原文明确
// 写着艾米丽被艾德里安瞒着，根本不知道自己是缸中脑。把这句话原样加回去
// 重跑这份审计的所有判据，**不会有任何一条变红**：术语审计只查方括号，
// 而这句话没有方括号；字段级判据只查"缺不缺"，这句话既没缺也没多。
// 想抓这类问题，得让人或模型读懂两段话在"说什么"而不是"有没有"，这套
// 工具目前完全做不到，也没打算做——语义比对是另一个数量级的工程，加进
// 这份存在性检查会让"通过"这件事看起来比它实际验证的范围大得多，比不做
// 更危险。发现这类问题目前只能靠人工通读原文 + 通读生成文案，逐句核对。
//
// ⚠⚠⚠ `FABRICATION_REGISTRY.length === 0`（下面就能看到）不等于"没有
// 臆造过"，准确含义只是"没有原文查无出处的方括号术语"——上面这条
// "但她知道"就是原地反例：它在 `FABRICATION_REGISTRY` 显示 0 的整段
// 时间里一直存在于数据里，从没被这份 0 反映出来过，直到人工读原文才
// 发现。这不是唯一一次：同一种"语义矛盾，工具看不见"的问题在
// mythos-module.ts 的 NPC secrets 里又出现过一次（写反了"是否知情"），
// 另有一次是完全不同的类别——`ModuleItem.revelation` 编造了一个原文
// 没有的机制细节（不是语义矛盾，是凭空发明）。三条真实实例、发现方式
// 与修复 commit 都记在 `src/ingest/confirmed-fabrication-log.ts`
// 里——那份存档不是重复这里的能力边界声明，是把"曾经真的看漏过什么"
// 变成机器能核对的事实：每条断言它不再逐字出现在数据里，防止已经
// 修过的臆造又用同一个措辞悄悄写回来。它同样解决不了"看不见语义矛盾"
// 这条根本限制——见该文件自己的能力边界说明，只是把已知实例钉死。
//
// ⚠ 原文切片（tools/modules/raw/*.txt）是派生物，不进版本库
// （module/types.ts:76「切片是派生物且不进版本库，PDF 才是权威源」）。本地有、
// CI 可能没有——所有依赖切片的判据都要能在切片缺失时优雅降级：明确报
// "跳过"并告警，不能静默通过（那等于什么都没测，却显示成绿的）。

import { existsSync, readFileSync } from "fs";
import { join } from "path";

export type ThreeWayVerdict = "fabrication" | "missing-extraction" | "creative-layer";

// ============================================================
// 原文语料读取
// ============================================================

/**
 * 原文切片文件清单——00_header + section_01..17，**不含 section_18**
 * （0 字节空壳，旧切分器 off-by-one 留下的，见血缘核对
 * docs/archive-world-model-2026-08.md:9-21）。
 */
const RAW_SECTION_FILES = [
  "00_header.txt",
  ...Array.from({ length: 17 }, (_, i) => `section_${String(i + 1).padStart(2, "0")}.txt`),
];

export type OriginalCorpusResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * 读取全部原文切片并拼成一份语料。任何一个文件缺失都整体判定不可用——
 * 不拼一份"缺了几页"的语料悄悄用，那样"原文没有"和"原文那几页刚好不在"
 * 会分不清，静默产出错误结论比明确报"没跑"更糟。
 */
export function readOriginalCorpus(rawDir: string = "tools/modules/raw"): OriginalCorpusResult {
  const parts: string[] = [];
  for (const name of RAW_SECTION_FILES) {
    const p = join(rawDir, name);
    if (!existsSync(p)) {
      return { ok: false, reason: `缺少切片文件：${p}（tools/ 不进版本库，本地/CI 环境可能没有）` };
    }
    parts.push(readFileSync(p, "utf8"));
  }
  return { ok: true, text: parts.join("\n") };
}

// ============================================================
// 归一化匹配
// ============================================================

/**
 * 归一化：去空白（含全角空格、PDF 抽取遗留的跳页换行/制表符）、去半角/
 * 全角连字符与破折号。
 *
 * ⚠ 这一步不能省——"米戈联络术"（生成物/游戏文案的写法）与"米-戈联络术"
 * （原文实际写法，section_11.txt:38）只差一个连字符，不做这层归一化会把
 * 一个纯粹的写法差异误判成"原文查无此词"，制造假阳性臆造。
 */
export function normalizeForMatch(s: string): string {
  return s.replace(/[\s\u3000]+/g, "").replace(/[-－—]/g, "");
}

/** 归一化后做子串检查：`term` 是否在 `corpusText` 里出现过 */
export function termAppearsInCorpus(term: string, corpusText: string): boolean {
  return normalizeForMatch(corpusText).includes(normalizeForMatch(term));
}

// ============================================================
// 语料来源——开发·无基准模式 任务②
// ============================================================
//
// `readOriginalCorpus()` 读的是仓库里预先切好、经过人工核对的谷仓切片
// （`tools/modules/raw/`）——这份语料只对这一本模组存在，摄取一本新
// PDF 时用不上它。三方审计真正需要的只是"这次摄取的原文全文"，而
// `scripts/ingest/run.ts` 在切分之前就已经从 PDF 里解码出了逐页文本
// （`extractPages` 的产物）——那份数据本来就是"这次到底摄取的是什么"
// 的第一手来源，不需要额外读一份仓库里的切片才能拿到语料。
//
// `pdf-source.ts` 的内容保真已经实跑验证过（与 `tools/modules/raw/`
// 切片逐字一致 17/17，空白归一化后），所以理论上两种来源对同一份 PDF
// 应该产出等价的语料——但"理论上应该"与"这次真的量过"是两回事，
// `compareCorpusSources` 就是为了把这次的量测结果如实记下来，不是
// 假设新路径一定等价就跳过验证。

export interface CorpusSourceComparison {
  identical: boolean;
  /** 归一化（去空白/破折号）之后的字符数，用来判断差异量级 */
  pageCorpusLength: number;
  sliceCorpusLength: number;
}

/**
 * 把本次摄取（`extractPages` 的产物，逐页文本）拼成一份语料——与
 * `readOriginalCorpus()` 拼切片用同一种方式（按顺序 `\n` 连接），
 * 使得两份语料在做 `termAppearsInCorpus` 这类检查时行为一致。
 *
 * 对任意模组都能用：不像 `readOriginalCorpus()` 依赖仓库里预先切好的
 * 某一本模组的切片，这里只需要"这次摄取解码出来的页文本"，跑哪本 PDF
 * 就是哪本 PDF 自己的语料。
 */
export function buildCorpusFromPages(pages: string[]): string {
  return pages.join("\n");
}

/**
 * 比较"这次摄取解码出的语料"与"仓库里预先切好的切片语料"是否等价
 * （归一化之后逐字相等）——只在两者理论上应该对应同一份文档时才有
 * 意义（目前只有谷仓这一本模组两条语料源都存在）。
 *
 * 不假设"应该一样"就直接判等：真的返回比较结果，不一样时如实报出来，
 * 由调用方决定这个差异要不要紧、需不需要进一步排查。
 */
export function compareCorpusSources(pageCorpus: string, sliceCorpus: string): CorpusSourceComparison {
  const a = normalizeForMatch(pageCorpus);
  const b = normalizeForMatch(sliceCorpus);
  return { identical: a === b, pageCorpusLength: a.length, sliceCorpusLength: b.length };
}

// ============================================================
// 方括号术语审计
// ============================================================

/**
 * 从源码文本里抽出所有方括号术语（去重）。只看**数据行**，跳过注释——
 * 注释是给开发者看的说明，不是玩家会读到的叙事正文，混进来会把"这里曾经
 * 有个标记常量【原文】"这种开发笔记也当成需要对原文负责的游戏文案。
 *
 * 阶段7 扩展到 mythos-module.ts/premiers_barn.ts 后发现的真实假阳性：
 * 全仓普遍用 `【${x.name}】` 这种写法给 UI 消息里的动态值加强调括号
 * （技能检定播报、战斗播报、政经引擎事件……19 处，跨十几个文件），这类
 * 括号里装的是运行时才确定的变量，不是"某个具体术语原文里有没有"这种
 * 可判定的静态声明——`剧本杀模组：${module.name}` 这段源码字面文本本身
 * 永远不会逐字出现在任何原文里（模组名是运行时插进来的），拿它去查语料
 * 库注定是假阳性，不是真的漏检。跳过含 `${` 的方括号内容——这类内容
 * 天生不属于"能对原文负责"的范畴，与跳过注释是同一个理由的延伸。
 */
export function extractBracketTerms(sourceText: string): string[] {
  const seen = new Set<string>();
  for (const line of sourceText.split("\n")) {
    if (line.trim().startsWith("//")) continue;
    for (const m of line.matchAll(/【([^】]+)】/g)) {
      if (m[1].includes("${")) continue;
      seen.add(m[1]);
    }
  }
  return [...seen];
}

// ============================================================
// 显式登记名单
// ============================================================

export interface FabricationEntry {
  term: string;
  location: string;
  note: string;
}

/**
 * 已确证"原文查无此词"的方括号术语——只收录确认无据的。能在原文查到的
 * （"原文"是注释产物、"救出"在 section_10.txt:62、"伎俩"在
 * section_14.txt:6）不是问题，不需要登记。
 *
 * 判据用法：对 barn-of-premier.ts 的每个方括号术语查原文，"查无此词"的
 * 集合必须与这份名单的 term 集合**精确相等**——名单外新冒出的"无据"发现
 * 会让判据变红，逼着人显式裁决它是臆造还是创作层，不能被悄悄漏过。
 *
 * 开发·摄取管线校准 阶段3：这份名单原来有 4 条——【共鸣特质】
 * 【谢谢你们……】【谢谢你们……它不会回来了。】【照顾好爱莉……】，
 * True End 与 ENCOUNTER_NARRATIONS 里的臆造台词已经按原文
 * （section_01/12/13）重写，4 处臆造连同它们的方括号一起从数据里删掉了
 * （不是留着方括号换一套说法——重写后的文本干脆不再用方括号标注"重要
 * 术语"这个风格）。名单因此清空：**空数组不是没有认真查，是真的一处
 * 无据的方括号术语都不剩了**，与下面判据"空集合 = 空集合"精确相等。
 * 顺带：【米戈联络术】这个写法此前只出现在被删的那句 True End 文案里，
 * 其余出现（老旧文件展示名/revelation）用的是圆括号或直角引号，本来就
 * 不会被 extractBracketTerms() 当成方括号术语——它从"对照组（能查到，
 * 不该登记）"的成员，变成了"压根不再被抽取到"，见判据里的相应更新。
 */
export const FABRICATION_REGISTRY: FabricationEntry[] = [];

// ============================================================
// 字段级"漏抽 vs 臆造"分类
// ============================================================

export interface FieldOmissionRule {
  /** 匹配 FieldDiff.path 的后缀——按字段名而不是逐场景硬编码，一条规则管住同类字段的全部出现 */
  fieldSuffix: string;
  verdict: ThreeWayVerdict;
  note: string;
}

/**
 * calibrate.ts 报出的 "missing"（基准有、生成物没有）差异里，哪些字段
 * 已经裁决过属于哪一类。目前只有 atmosphere 这一类已核实：某次真实摄取
 * 产出的生成 description（271 字，"特里坎家"）实测包含基准 atmosphere
 * 全文（70 字，见 barn-of-premier.ts:169）——管线确实抽到了这段内容，
 * 只是没有拆分成独立字段，不是无中生有。这与臆造的差异**形状相同**
 * （基准有、生成物没有）但**含义相反**，是这份判据要区分的关键测例。
 * 这次摄取产出本身是派生物（tools/ 不进版本库），可复核性靠
 * ingest-three-way-audit.test.ts 那份"缺失时跳过+告警"的判据，不靠
 * 这条注释指名道姓某个具体文件。
 */
export const FIELD_OMISSION_REGISTRY: FieldOmissionRule[] = [
  {
    fieldSuffix: ".atmosphere",
    verdict: "missing-extraction",
    note: "生成物的 description 字段包含基准 atmosphere 的全文（如「特里坎家」：生成 description 271 字，末尾即基准 atmosphere 70 字原样）——管线抽到了内容，只是没拆分成独立字段。",
  },
];

/** 按字段路径查表；没有登记规则时返回 null——不能自动裁决的字段不该被硬猜一个结论 */
export function classifyFieldOmission(fieldPath: string): ThreeWayVerdict | null {
  for (const rule of FIELD_OMISSION_REGISTRY) {
    if (fieldPath.endsWith(rule.fieldSuffix)) return rule.verdict;
  }
  return null;
}

// ============================================================
// 多文件覆盖 + 声明实体审计（开发·三档约束 阶段7 任务②）
// ============================================================
//
// 背景：阶段3 的方括号术语审计只扫过 barn-of-premier.ts 一个文件。这一轮
// 漏检的语义矛盾（mythos-module.ts:1061 的 secrets 写反）恰好就在别的
// 文件里——不是这套审计"测不出语义矛盾"这条已知能力边界的问题（它确实
// 测不出，见文件头注释），是它连"扫没扫到"这一步都没做全：同样是它能
// 判定的"字面存在性"这类问题，如果发生在 mythos-module.ts/
// premiers_barn.ts 里，之前的版本根本不会去看。

/**
 * 审计覆盖的模组数据源文件——**谷仓这一个模组的默认值**，不是"审计能
 * 覆盖的文件就只有这三个"。同一个模组（普瑞米尔的谷仓）历史上有三份
 * 并行的数据实现，todo-19 统一之前各自独立维护，各自都可能出现字面
 * 臆造，这份名单因此列了三个——换一本模组，这份名单就该是那本模组
 * 自己的数据源文件，不是硬凑这三个路径。
 */
export const AUDITED_MODULE_FILES = [
  "src/module/barn-of-premier.ts",
  "src/rules/mythos-module.ts",
  "src/rules/custom-modules/premiers_barn.ts",
] as const;

export interface SourceTextRef {
  file: string;
  text: string;
}

/**
 * 读取一批模组数据源文件的内容，配上路径——开发·无基准模式 任务③：
 * 不传参数时默认审计 `AUDITED_MODULE_FILES`（谷仓），传别的路径列表
 * 就审计别的模组，常量因此从"审计范围写死在这里"降级成"没指定时用
 * 这个默认值"。IO 集中在这一个函数里，`extractBracketTermsAcrossFiles`
 * 本身不碰文件系统，保持纯函数、可单测。
 */
export function readAuditedModuleSources(files: readonly string[] = AUDITED_MODULE_FILES): SourceTextRef[] {
  return files.map((file) => ({ file, text: readFileSync(file, "utf8") }));
}

/**
 * 跨多个源文件收方括号术语，记下每个术语出现在哪些文件里（供报告定位——
 * 判据本身只关心去重后的词集合，但排查时需要知道是哪个文件写的）。
 */
export function extractBracketTermsAcrossFiles(sources: SourceTextRef[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const { file, text } of sources) {
    for (const term of extractBracketTerms(text)) {
      if (!map.has(term)) map.set(term, new Set());
      map.get(term)!.add(file);
    }
  }
  const out = new Map<string, string[]>();
  for (const [term, files] of map) out.set(term, [...files]);
  return out;
}

/**
 * 去掉展示名尾部的括号注解（如"维修间（终局场景）"→"维修间"、
 * "Mi-Go（来自尤格斯的真菌）"→"Mi-Go"）——这类注解是数据作者给自己看的
 * 提示，原文自然不会逐字重复它，不做这层归一化会把纯粹的写法差异误判
 * 成"原文查无此实体"，制造假阳性（阶段7 实测：不做归一化会在
 * BARN_OF_PREMIER 里假阳性报出 5 处，逐一核对后确认全部是括号注解）。
 *
 * 与 game-session.ts:4069 的 stripBracketSuffix 是同一种归一化（那边给
 * 场景 id 桥接用），各自独立成一行是因为用途不同、规则本身足够简单，
 * 不值得为共用一行正则在审计工具与游戏引擎之间建立依赖。
 */
export function stripDisplayAnnotation(name: string): string {
  return name.replace(/[（(][^）)]*[）)]$/, "");
}

export interface DeclaredEntityRef {
  name: string;
  kind: "npc" | "scene";
  source: string;
}

/**
 * 审计一批"声明实体"（NPC 名/场景名）——归一化括号注解后，检查每个名字
 * 是否在原文语料里出现过。按 kind+归一化后的名字去重（同一个实体在多个
 * 文件里重复声明只报一次，source 取第一次出现的那个）。
 */
export function auditDeclaredEntities(entities: DeclaredEntityRef[], corpusText: string): DeclaredEntityRef[] {
  const seen = new Set<string>();
  const notFound: DeclaredEntityRef[] = [];
  for (const e of entities) {
    const normalized = stripDisplayAnnotation(e.name);
    const key = `${e.kind}:${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!termAppearsInCorpus(normalized, corpusText)) notFound.push(e);
  }
  return notFound;
}

export interface EntityFabricationEntry {
  name: string;
  kind: "npc" | "scene";
  location: string;
  note: string;
}

/**
 * 已确证"原文查无此实体"的 NPC/场景名——目前是空的。阶段7 实测跑过
 * BARN_OF_PREMIER 的全部 npcs/scenes、PREMIERS_BARN_MODULE 的全部
 * npcs、MODULE_PREMIERS_BARN 的全部 npcs/scenes，归一化括号注解后一个
 * 不剩地能在原文查到。判据用法与 FABRICATION_REGISTRY 相同：查无此名
 * 的集合必须与这份名单精确相等——空数组不是没有认真查，是真的一个
 * 无据的人名/地名都不剩。
 */
export const ENTITY_FABRICATION_REGISTRY: EntityFabricationEntry[] = [];
