// `scenes.exits` 那一列怎么读 —— **读取层与写入层共用的唯一一份解析**。
//
// 起因：扫「无声吞掉错误的 catch」时发现同一份数据有**两套解析**，
// 而且两套各有各的病：
//
// 写入层（`rules/mythos-module.ts` 两处）
//     let existing = [];
//     try { existing.push(...JSON.parse(row.exits ?? "[]")); } catch {}
//     db.run("UPDATE scenes SET exits = ?", [JSON.stringify([...existing, ...新出口])]);
//   解析失败时 `existing` 保持空，**接着照样写回去** —— 原有出口被静默抹掉。
//   catch 里一个字都没有：没日志、没返回值、没人会知道。
//
// 读取层（`WorldStateManager.parseExits`）
//   宽容得多（容忍历史上的纯字符串写法、支持 `sighted`），但
//   `catch { return [] }` —— 数据坏了和「这个场景本来就没出口」**返回一模一样**。
//
// docs/kp-tool-surface-assessment.md §八 记的两次事故正是这一类，原话：
// 「被 catch 降级成一行警告，模组场景出口整段失效」
// 「类型检查与 710 个测试全绿，只有真实跑团暴露了它」。
//
// 所以合成一份，同时回答两个问题：
//   `exits`  尽力解析出来的东西 —— 读取层要它来显示
//   `ok`     这份数据是不是**完整读懂了** —— 写入层要它来决定敢不敢覆盖
// 一份数据两套解析，迟早会漂；而漂的那一刻没有任何测试会红。

export interface SightedEntity {
  entityId: string;
  name: string;
  mentionKeywords: string[];
  noticedBy: string[];
  recognition: string;
}

export interface ExitRecord {
  target: string;
  desc: string;
  sighted?: SightedEntity;
}

interface ExitParse {
  /** 尽力解析出来的出口。即便 `ok` 为 false 也可能非空（部分可用） */
  exits: ExitRecord[];
  /** 整份数据是否完整读懂。**false 时不许拿 `exits` 去覆盖原数据** */
  ok: boolean;
  /** 出了什么问题；ok 时为空串 */
  reason: string;
  /** 被跳过的畸形条目数 */
  skipped: number;
}

/**
 * 出口上的叙事实体。字段不全就整个丢掉而不是补默认值 ——
 * 这段数据是拿来播识别桥段的，半截的识别文本比没有更糟。
 */
export function parseSighted(raw: unknown): SightedEntity | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.entityId !== "string" || typeof o.name !== "string") return undefined;
  if (typeof o.recognition !== "string" || o.recognition.length === 0) return undefined;
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    entityId: o.entityId,
    name: o.name,
    mentionKeywords: strList(o.mentionKeywords),
    noticedBy: strList(o.noticedBy),
    recognition: o.recognition,
  };
}

/**
 * 解析 `scenes.exits`。
 *
 * 必须能区分三件事 —— 混作一谈就是上面那个 bug：
 *   没有出口     → `ok: true, exits: []`     （新场景的正常状态）
 *   有且读得懂   → `ok: true, exits: [...]`
 *   读不懂／有残 → `ok: false`                （调用方按自己的立场决定）
 *
 * 「读不懂」不代表 `exits` 一定是空的：JSON 是数组但里面混了畸形条目时，
 * 好的那些照样返回（读取层要显示），同时 `ok=false`（写入层不许覆盖）。
 * 两种立场用同一份解析结果，各取所需 —— 这样它们不会漂。
 */
export function parseExits(raw: unknown): ExitParse {
  if (raw === null || raw === undefined) return { exits: [], ok: true, reason: "", skipped: 0 };
  if (typeof raw !== "string") {
    return { exits: [], ok: false, reason: `exits 不是字符串（${typeof raw}）`, skipped: 0 };
  }
  if (raw.length === 0) return { exits: [], ok: true, reason: "", skipped: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { exits: [], ok: false, reason: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`, skipped: 0 };
  }
  if (parsed === null) return { exits: [], ok: true, reason: "", skipped: 0 };
  if (!Array.isArray(parsed)) {
    return { exits: [], ok: false, reason: `解析出来不是数组（${typeof parsed}）`, skipped: 0 };
  }

  const exits: ExitRecord[] = [];
  let skipped = 0;
  for (const item of parsed) {
    // 历史上有过纯字符串写法，得容忍 —— 那是真实存在的旧数据，不是错误
    if (typeof item === "string") {
      if (item.length === 0) { skipped++; continue; }
      exits.push({ target: item, desc: item });
      continue;
    }
    if (item && typeof item === "object" && typeof (item as { target?: unknown }).target === "string") {
      const target = (item as { target: string }).target;
      if (target.length === 0) { skipped++; continue; }
      const desc = (item as { desc?: unknown }).desc;
      const sighted = parseSighted((item as { sighted?: unknown }).sighted);
      exits.push({ target, desc: typeof desc === "string" ? desc : target, ...(sighted ? { sighted } : {}) });
      continue;
    }
    skipped++;
  }
  return {
    exits,
    ok: skipped === 0,
    reason: skipped > 0 ? `${skipped} 个条目形状不对，已跳过` : "",
    skipped,
  };
}

/** 合并出口并按 target 去重，先来的优先 */
export function mergeExits(existing: readonly ExitRecord[], added: readonly ExitRecord[]): ExitRecord[] {
  const seen = new Set<string>();
  const out: ExitRecord[] = [];
  for (const e of [...existing, ...added]) {
    if (seen.has(e.target)) continue;
    seen.add(e.target);
    out.push(e);
  }
  return out;
}
