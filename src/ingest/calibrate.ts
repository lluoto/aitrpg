// 摄取管线 · 校准器
//
// 读取模块的产出不覆盖现有模组文件，并排放着做逐字段对比。
// 现有的 barn-of-premier.ts 是被实跑校准过的（tools/modules/CALIBRATION_REPORT.md），
// 拿它当基准，差异清单就是"读取模块还差多少"的度量。
//
// 反过来也成立：如果生成物在某个字段上比基准更准，那说明该改的是基准。
// 校准器只报告事实，不判断谁对——判断留给人。

/** 一条差异 */
export interface FieldDiff {
  /** 字段路径，如 `scenes[farm_periphery].clues[trap_bear].description` */
  path: string;
  kind: "missing" | "extra" | "changed" | "id-mismatch" | "ref-mismatch";
  /** 基准侧的值（kind=extra 时无） */
  baseline?: unknown;
  /** 候选侧的值（kind=missing 时无） */
  candidate?: unknown;
}

export interface DiffOptions {
  /**
   * 数组元素的配对键，按给定顺序逐个认领：前一个键配不上的，才轮到后一个键。
   * 默认 ["id"]。
   *
   * 但「默认 ["id"]」≠「不传就是本轮之前的行为」——**默认这条路本身也改了**，三处：
   *
   * 1. **空数组现在平凡满足 `allHaveKey`**（见 `allHaveKey` 注释）。有意为之：
   *    这正是让候选侧 `clues: []` 印出 `scenes[维森酒吧].clues[clue_bar_ask_around]`
   *    而不是一堆重复 `clues[0]…clues[3]` 的那一改。不传 opts 就能走到它 ——
   *    `ingest-calibrate.test.ts:219` 钉的就是这条，调的是 `diffValues(a, b)`。
   * 2. **同键值的元素改成分桶两两配**（见 `bucketBy` 注释）。有意为之：
   *    原来的 `new Map(arr.map(...))` 在默认路径上一样会让后来者顶掉前者，
   *    被顶掉的既配不上也不进 missing/extra，从报告里消失。
   * 3. **没认领到的元素统一排在所有配对元素之后**，不再按键并集的顺序穿插其间
   *    （见函数末尾那两个循环）。这条是分轮认领写法的顺带产物，不是设计出来的，
   *    也没有测试钉它 —— 要依赖 `FieldDiff[]` 顺序的地方，先自己排一遍。
   *
   * 前两条是本轮买的东西，第三条只是没拦住。区别在于：前两条改了报出什么，
   * 第三条只改了印出来的先后。
   *
   * 传 ["id","name"] 是为了比对生成物：生成的 id 是内部句柄（scene_07），
   * 基准那份是带上下文的人工意译（adrian_bedroom），两者本就不会一样。
   * 按 id 硬配会把每个场景都报成「缺失 + 多余」，真实差异被噪音埋掉 ——
   * 与当初按下标比较是同一个坑。
   */
  pairBy?: string[];

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
}

/** 逐层传递的比对配置 */
interface WalkCtx {
  pairBy: string[];
  refFields: string[];
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
 * 有一个没有，这个键就整体不可用 —— 但只是这个键：剩下的键接着认，
 * 全都不可用才退回按下标。所以一个数组里的路径段可以既有 `[s1]` 又有 `[卧室]`。
 *
 * 界线不在「混不混」，而在混的是什么：两个都是身份值就无所谓，
 * 每个路径段仍然指名道姓，照着能找到它指的那个东西。身份值混下标才不行 ——
 * `[3]` 里的 3 是基准的顺序还是生成物的顺序，看的人无从判断，
 * 而且两侧任一边重排它就漂了。
 *
 * 空数组平凡成立。否则候选侧 clues: [] 会把整个数组拖回按下标比，
 * 基准那 32 条线索全印成纯下标路径 —— 而且它们散在 14 个场景里、单场景最多 4 条，
 * 每个数组各自从 0 数起，所以印出来的是一堆重复的 clues[0]…clues[3]，
 * 既认不出缺的是哪条，也没法拿去干活；而这份清单本该是下一轮的路线图。
 */
function allHaveKey(arr: unknown[], key: string): boolean {
  return arr.every((v) => keyOf(v, key) !== null);
}

/** 选出两侧都能用的配对键，按 pairBy 给定的先后；空列表表示退回按下标 */
function pickPairKeys(baseline: unknown[], candidate: unknown[], pairBy: string[]): string[] {
  if (baseline.length === 0 && candidate.length === 0) return [];
  return pairBy.filter((key) => allHaveKey(baseline, key) && allHaveKey(candidate, key));
}

/**
 * 按键值把数组分桶。同一个值下有几个元素，桶里就有几个，一个都不丢。
 *
 * 不用 `new Map(arr.map(...))`：那样建索引，同键者只留最后一个，被顶掉的
 * 既配不上对、也进不了后面的 missing/extra，直接从报告里消失。
 * id 在实践中唯一，name 不唯一 —— 分类器以标题为键的重名缺陷本轮不修，
 * 真实数据里就有两个「卧室」—— 所以传 ["id","name"] 时这条路必被踩到。
 * 度量工具最不能有的就是这个失败方向：报出的差异数偏小，且不留痕迹。
 */
function bucketBy(arr: unknown[], key: string): Map<string, unknown[]> {
  const buckets = new Map<string, unknown[]>();
  for (const v of arr) {
    const k = keyOf(v, key) as string;
    const bucket = buckets.get(k);
    if (bucket) bucket.push(v);
    else buckets.set(k, [v]);
  }
  return buckets;
}

/** 配上的一对，外加它是靠哪个键配上的 —— 路径段和 id 怎么处理都取决于这个键 */
interface Pair {
  key: string;
  seg: string;
  baseline: unknown;
  candidate: unknown;
}

const join = (base: string, seg: string) => (base ? `${base}${seg.startsWith("[") ? "" : "."}${seg}` : seg);

function walk(
  baseline: unknown,
  candidate: unknown,
  path: string,
  out: FieldDiff[],
  ctx: WalkCtx,
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
    walkArray(baseline, candidate, path, out, ctx);
    return;
  }

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

  if (baseline !== candidate) out.push({ path, kind: "changed", baseline, candidate });
}

function walkArray(baseline: unknown[], candidate: unknown[], path: string, out: FieldDiff[], ctx: WalkCtx): void {
  const keys = pickPairKeys(baseline, candidate, ctx.pairBy);

  // 没有可用配对键时顺序就是身份，只能按下标
  if (keys.length === 0) {
    const n = Math.max(baseline.length, candidate.length);
    for (let i = 0; i < n; i++) walk(baseline[i], candidate[i], `${path}[${i}]`, out, ctx);
    return;
  }

  // 按身份配对：生成物的场景/线索顺序不必与手写那份一致，
  // 按下标比会把"顺序不同"报成"每一项都不同"，真实差异被噪音埋掉。
  //
  // 逐键分轮认领：先按 id 认，认不出来的再按 name 认。整个数组只挑一个键是不够的 ——
  // 两边的 id 都是齐的，挑一个就永远挑中 id，而这两套 id 本就不会一样
  // （生成的是内部句柄 scene_07，基准是手写意译 adrian_bedroom），name 那轮根本轮不上，
  // pairBy 传了也白传。
  const pairs: Pair[] = [];
  let bRest = baseline;
  let cRest = candidate;
  for (const key of keys) {
    const bBuckets = bucketBy(bRest, key);
    const cBuckets = bucketBy(cRest, key);
    const bLeft: unknown[] = [];
    const cLeft: unknown[] = [];
    for (const k of new Set([...bBuckets.keys(), ...cBuckets.keys()])) {
      const bs = bBuckets.get(k) ?? [];
      const cs = cBuckets.get(k) ?? [];
      // 桶内按出现次序两两配。同名的两个「卧室」谁对谁本就无从判断，
      // 按次序配至少保证两侧都在场、都被比过。长的那侧多出来的推回
      // bLeft/cLeft，跟着走后面的轮次，最终照常报 missing/extra —— 关键是不消失。
      const paired = Math.min(bs.length, cs.length);
      for (let i = 0; i < paired; i++) pairs.push({ key, seg: k, baseline: bs[i], candidate: cs[i] });
      for (let i = paired; i < bs.length; i++) bLeft.push(bs[i]);
      for (let i = paired; i < cs.length; i++) cLeft.push(cs[i]);
    }
    bRest = bLeft;
    cRest = cLeft;
    if (bRest.length === 0 && cRest.length === 0) break;
  }

  for (const pair of pairs) {
    const p = `${path}[${pair.seg}]`;

    // 按非 id 键配上的一对：两侧 id 不同是预期内的（内部句柄 vs 手写意译），
    // 单列一类，不去污染 changed 那个计数。报完把 id 从递归里摘掉，
    // 否则同一件事会再以 `.id` 的 changed 说一遍。
    // 只有一侧带 id 时不摘 —— 那是真缺字段，该照常报 missing/extra。
    if (pair.key !== "id") {
      const bid = keyOf(pair.baseline, "id");
      const cid = keyOf(pair.candidate, "id");
      if (bid !== null && cid !== null) {
        if (bid !== cid) out.push({ path: `${p}.id`, kind: "id-mismatch", baseline: bid, candidate: cid });
        walk(pair.baseline, pair.candidate, p, out, ctx, "id");
        continue;
      }
    }
    walk(pair.baseline, pair.candidate, p, out, ctx);
  }

  // 每一轮都没人认领的：路径段用首选键（默认就是 id）。
  // allHaveKey 已经保证了每个元素都带得上这个键，取不到 null。
  const primary = keys[0];
  for (const v of bRest) out.push({ path: `${path}[${keyOf(v, primary)}]`, kind: "missing", baseline: v });
  for (const v of cRest) out.push({ path: `${path}[${keyOf(v, primary)}]`, kind: "extra", candidate: v });
}

/**
 * 逐字段对比两份结构。
 *
 * baseline = 已校准的基准，candidate = 读取模块的产出。
 */
export function diffValues(baseline: unknown, candidate: unknown, opts: DiffOptions = {}): FieldDiff[] {
  const out: FieldDiff[] = [];
  walk(baseline, candidate, "", out, {
    pairBy: opts.pairBy ?? ["id"],
    refFields: opts.refFields ?? [],
  });
  return out;
}

/** 报告里单个值的最大展示长度 —— 场景描述动辄几百字，整段糊进去没法读 */
const MAX_SHOW = 60;

function show(v: unknown): string {
  if (v === undefined) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s === undefined) return String(v);
  return s.length > MAX_SHOW ? s.slice(0, MAX_SHOW) + `…(共${s.length}字)` : s;
}

/** 把差异清单渲染成可读报告 */
export function formatDiff(diffs: FieldDiff[]): string {
  if (diffs.length === 0) return "✓ 无差异";

  const lines: string[] = [];
  const byKind: Record<FieldDiff["kind"], number> = {
    missing: 0, extra: 0, changed: 0, "id-mismatch": 0, "ref-mismatch": 0,
  };
  for (const d of diffs) byKind[d.kind]++;

  lines.push(
    `差异 ${diffs.length} 处 — changed ${byKind.changed} / missing ${byKind.missing} / extra ${byKind.extra} / id 不一致 ${byKind["id-mismatch"]} / 引用不一致 ${byKind["ref-mismatch"]}`,
  );
  lines.push("");
  for (const d of diffs) {
    if (d.kind === "changed") lines.push(`  [changed] ${d.path}\n      基准: ${show(d.baseline)}\n      生成: ${show(d.candidate)}`);
    else if (d.kind === "missing") lines.push(`  [missing] ${d.path}   基准有而生成缺: ${show(d.baseline)}`);
    else if (d.kind === "extra") lines.push(`  [extra]   ${d.path}   生成多出: ${show(d.candidate)}`);
    else if (d.kind === "id-mismatch") lines.push(`  [id 不一致] ${d.path}   基准 ${show(d.baseline)} ↔ 生成 ${show(d.candidate)}`);
    else lines.push(`  [引用不一致] ${d.path}   基准 ${show(d.baseline)} ↔ 生成 ${show(d.candidate)}`);
  }
  return lines.join("\n");
}
