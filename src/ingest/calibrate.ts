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
  kind: "missing" | "extra" | "changed" | "id-mismatch";
  /** 基准侧的值（kind=extra 时无） */
  baseline?: unknown;
  /** 候选侧的值（kind=missing 时无） */
  candidate?: unknown;
}

export interface DiffOptions {
  /**
   * 数组元素的配对键，按给定顺序逐个认领：前一个键配不上的，才轮到后一个键。
   * 默认 ["id"]，即现有行为。
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

/** 选出两侧都能用的配对键，按 pairBy 给定的先后；空列表表示退回按下标 */
function pickPairKeys(baseline: unknown[], candidate: unknown[], pairBy: string[]): string[] {
  if (baseline.length === 0 && candidate.length === 0) return [];
  return pairBy.filter((key) => allHaveKey(baseline, key) && allHaveKey(candidate, key));
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
  const keys = pickPairKeys(baseline, candidate, pairBy);

  // 没有可用配对键时顺序就是身份，只能按下标
  if (keys.length === 0) {
    const n = Math.max(baseline.length, candidate.length);
    for (let i = 0; i < n; i++) walk(baseline[i], candidate[i], `${path}[${i}]`, out, pairBy);
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
    const bMap = new Map(bRest.map((v) => [keyOf(v, key) as string, v]));
    const cMap = new Map(cRest.map((v) => [keyOf(v, key) as string, v]));
    const bLeft: unknown[] = [];
    const cLeft: unknown[] = [];
    for (const k of new Set([...bMap.keys(), ...cMap.keys()])) {
      const b = bMap.get(k);
      const c = cMap.get(k);
      if (b !== undefined && c !== undefined) pairs.push({ key, seg: k, baseline: b, candidate: c });
      else if (b !== undefined) bLeft.push(b);
      else cLeft.push(c);
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
        walk(pair.baseline, pair.candidate, p, out, pairBy, "id");
        continue;
      }
    }
    walk(pair.baseline, pair.candidate, p, out, pairBy);
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
  walk(baseline, candidate, "", out, opts.pairBy ?? ["id"]);
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
