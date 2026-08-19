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
  kind: "missing" | "extra" | "changed";
  /** 基准侧的值（kind=extra 时无） */
  baseline?: unknown;
  /** 候选侧的值（kind=missing 时无） */
  candidate?: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** 元素带 id 就按 id 认领；这是数组能不能按身份比对的前提 */
function idOf(v: unknown): string | null {
  if (isObj(v) && typeof v.id === "string" && v.id !== "") return v.id;
  return null;
}

/**
 * 数组里的元素是否都带 id。
 *
 * 只要有一个没有就整体退回按下标比 —— 混着比会让路径含义不一致，
 * 报告里一半是 `[s1]` 一半是 `[3]`，看的人无法判断下标指的是原序还是新序。
 */
function allHaveId(arr: unknown[]): boolean {
  return arr.length > 0 && arr.every((v) => idOf(v) !== null);
}

const join = (base: string, seg: string) => (base ? `${base}${seg.startsWith("[") ? "" : "."}${seg}` : seg);

function walk(baseline: unknown, candidate: unknown, path: string, out: FieldDiff[]): void {
  // 两侧都当"没有"处理：ModuleData 里可选字段极多，
  // 写 undefined 和干脆不写在语义上没区别，算成差异会淹掉真问题。
  const bMissing = baseline === undefined;
  const cMissing = candidate === undefined;
  if (bMissing && cMissing) return;
  if (bMissing) { out.push({ path, kind: "extra", candidate }); return; }
  if (cMissing) { out.push({ path, kind: "missing", baseline }); return; }

  if (Array.isArray(baseline) && Array.isArray(candidate)) {
    walkArray(baseline, candidate, path, out);
    return;
  }

  if (isObj(baseline) && isObj(candidate)) {
    for (const k of new Set([...Object.keys(baseline), ...Object.keys(candidate)])) {
      walk(baseline[k], candidate[k], join(path, k), out);
    }
    return;
  }

  if (baseline !== candidate) out.push({ path, kind: "changed", baseline, candidate });
}

function walkArray(baseline: unknown[], candidate: unknown[], path: string, out: FieldDiff[]): void {
  // 带 id 的按 id 配对：生成物的场景/线索顺序不必与手写那份一致，
  // 按下标比会把"顺序不同"报成"每一项都不同"，真实差异被噪音埋掉。
  if (allHaveId(baseline) && allHaveId(candidate)) {
    const bMap = new Map(baseline.map((v) => [idOf(v) as string, v]));
    const cMap = new Map(candidate.map((v) => [idOf(v) as string, v]));
    for (const id of new Set([...bMap.keys(), ...cMap.keys()])) {
      walk(bMap.get(id), cMap.get(id), `${path}[${id}]`, out);
    }
    return;
  }

  // 没有 id 时顺序就是身份，只能按下标
  const n = Math.max(baseline.length, candidate.length);
  for (let i = 0; i < n; i++) walk(baseline[i], candidate[i], `${path}[${i}]`, out);
}

/**
 * 逐字段对比两份结构。
 *
 * baseline = 已校准的基准，candidate = 读取模块的产出。
 */
export function diffValues(baseline: unknown, candidate: unknown): FieldDiff[] {
  const out: FieldDiff[] = [];
  walk(baseline, candidate, "", out);
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
  const byKind = { missing: 0, extra: 0, changed: 0 };
  for (const d of diffs) byKind[d.kind]++;

  lines.push(`差异 ${diffs.length} 处 — changed ${byKind.changed} / missing ${byKind.missing} / extra ${byKind.extra}`);
  lines.push("");
  for (const d of diffs) {
    if (d.kind === "changed") lines.push(`  [changed] ${d.path}\n      基准: ${show(d.baseline)}\n      生成: ${show(d.candidate)}`);
    else if (d.kind === "missing") lines.push(`  [missing] ${d.path}   基准有而生成缺: ${show(d.baseline)}`);
    else lines.push(`  [extra]   ${d.path}   生成多出: ${show(d.candidate)}`);
  }
  return lines.join("\n");
}
