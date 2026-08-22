// 「伤势分级 / 重伤体质检定 / 惩罚骰」到底有没有生效——判据本身。
//
// ── 上一版的三个错 ──
// 1. `lines.filter(l => /惩罚骰/.test(l))` 当成「伤势惩罚生效」的证据。
//    但播报里带「惩罚骰」三个字的至少有三种来源：
//      · 伤势        `[1惩罚骰·伤势]`
//      · 环境/夜色   `[1惩罚骰]`（没有来源后缀）
//      · 战斗疲劳    `[惩罚骰×2]`（`combat.ts` 自己拼的，跟 check() 无关）
//    三种混成一堆，删掉 `recordWound()` 计数照样非零 —— 判据不会变红。
// 2. 只按文本标签分档。HP 归零那一行的后缀被写死成「（昏迷/濒死！）」，
//    把「重伤」「致命伤」标签盖掉了，于是最该被统计的那一档必然漏。
// 3. 没有按角色、按顺序验证。「有 4 次 ≥50%」和「这 4 次各自后面跟了一次体质检定」
//    是两回事，前者成立不代表后者成立。
//
// ── 现在的判据 ──
// 逐角色、按事件顺序跑一个小状态机，验四条不变量：
//   W1  deep/grievous 且**人还没倒**（to > 0）→ 恰好一次「重伤体质检定」
//   W2  那次体质检定 `ignoreWound=true` 且 `woundPenalty=0`（不被自己这处伤罚）
//   W3  伤势记下之后，**读伤势的**检定必须带 woundPenalty > 0
//   W4  伤势被处理（急救/苏醒）之后，woundPenalty 必须回到 0
// 另外把「不读伤势的掷骰路径」单列（`woundAware=false`，即战斗攻击），
// 那是引擎现状不是判据缺陷，但必须**说出来**，不能默默不算。

import type { PlayEvent } from "../play/events";
import type { WoundSeverity } from "../combat/wound-effects";

export type WoundBreach =
  /** deep/grievous 之后没有体质检定 */
  | { kind: "missing-con"; who: string; severity: WoundSeverity; at: number }
  /** deep/grievous 之后体质检定不止一次 */
  | { kind: "duplicate-con"; who: string; count: number; at: number }
  /** 体质检定被它自己结算的那处伤罚了（双重计算） */
  | { kind: "con-self-penalized"; who: string; woundPenalty: number; at: number }
  /** 身上有未处理伤势，读伤势的检定却没带惩罚骰 */
  | { kind: "wound-penalty-missing"; who: string; skill: string; at: number }
  /** 伤势已处理，却还在扣伤势惩罚骰 */
  | { kind: "penalty-after-heal"; who: string; skill: string; at: number }
  /** 人已经昏迷了还在补掷重伤体质检定（口径漂移） */
  | { kind: "con-while-down"; who: string; at: number }
  /**
   * deep/grievous 且人还站着，却没有把伤势记下来。
   * **这条专抓 `recordWound()` 被删** —— 上一版靠数「惩罚骰」字样，
   * 删掉 recordWound 之后环境/疲劳的惩罚骰还在，计数非零，判据毫无反应。
   */
  | { kind: "missing-wound-record"; who: string; severity: WoundSeverity; at: number };

export interface WoundReport {
  /** 按**事件里的 severity** 分档，不看播报标签 */
  severityBuckets: Record<WoundSeverity, number>;
  /** 伤害事件总数 */
  damages: number;
  /** deep/grievous 且当时人还站着的次数 —— W1 的分母 */
  majorWoundsStanding: number;
  /**
   * deep/grievous 但当场就昏迷了。规则是**不该**掷重伤体质检定 ——
   * 那一掷决定的是「会不会昏过去」，人已经躺下就没什么可决定的。
   * 曾经四个调用点两种口径，判据只能单列不下结论；口径统一之后这里可以断言了。
   */
  majorWoundsWhileDown: number;
  /** 重伤体质检定次数 */
  conChecks: number;
  /** 记下的伤势次数（`recordWound` 真写进去才算） */
  woundsRecorded: number;
  /** 伤势被处理次数 */
  woundsHealed: number;
  /** 真正被伤势罚到的检定次数 —— 这是 W3 的正面证据 */
  woundPenalizedChecks: number;
  /** 只带环境/疲劳惩罚、与伤势无关的检定次数。**不许拿它充数** */
  envOnlyPenalizedChecks: number;
  /** 身上有伤、但这条掷骰路径压根不读伤势（战斗攻击）。引擎现状，单列 */
  woundBlindRolls: number;
  breaches: WoundBreach[];
}

interface ActorState {
  /** 未处理的伤势 */
  wound: WoundSeverity | null;
  /** 伤势应带的惩罚骰 */
  woundDice: number;
  /** 正在等一次重伤体质检定 */
  awaitingCon: { severity: WoundSeverity; at: number } | null;
  /** 本次等待期间已经掷了几次体质检定 */
  conSeen: number;
  /** 本次等待期间有没有把伤势记进去 */
  woundSeen: boolean;
  /**
   * 反向窗口：这次重伤把人打昏了，接下来**不该**出现结算检定。
   * 值是那次伤害的事件序号；null 表示窗口关着。
   */
  forbidCon: number | null;
}

function emptyState(): ActorState {
  return { wound: null, woundDice: 0, awaitingCon: null, conSeen: 0, woundSeen: false, forbidCon: null };
}

/** 重伤结算检定的识别：靠 `ignoreWound`，不靠技能名 —— 名字改了判据不该瞎 */
function isSettlementCheck(e: Extract<PlayEvent, { type: "check" }>): boolean {
  return e.ignoreWound;
}

export function reduceWounds(events: readonly PlayEvent[]): WoundReport {
  const states = new Map<string, ActorState>();
  const st = (who: string) => {
    let s = states.get(who);
    if (!s) { s = emptyState(); states.set(who, s); }
    return s;
  };

  const r: WoundReport = {
    severityBuckets: { scratch: 0, flesh: 0, deep: 0, grievous: 0, lethal: 0 },
    damages: 0,
    majorWoundsStanding: 0,
    majorWoundsWhileDown: 0,
    conChecks: 0,
    woundsRecorded: 0,
    woundsHealed: 0,
    woundPenalizedChecks: 0,
    envOnlyPenalizedChecks: 0,
    woundBlindRolls: 0,
    breaches: [],
  };

  /** 结掉上一处还在等体质检定的重伤 */
  const closeAwait = (who: string, at: number) => {
    const s = st(who);
    if (!s.awaitingCon) return;
    if (s.conSeen === 0) {
      r.breaches.push({ kind: "missing-con", who, severity: s.awaitingCon.severity, at: s.awaitingCon.at });
    } else if (s.conSeen > 1) {
      r.breaches.push({ kind: "duplicate-con", who, count: s.conSeen, at: s.awaitingCon.at });
    }
    if (!s.woundSeen) {
      r.breaches.push({ kind: "missing-wound-record", who, severity: s.awaitingCon.severity, at: s.awaitingCon.at });
    }
    s.awaitingCon = null;
    s.conSeen = 0;
    s.woundSeen = false;
  };

  events.forEach((e, i) => {
    switch (e.type) {
      case "damage": {
        const s = st(e.who);
        closeAwait(e.who, i); // 上一处伤的等待窗口在下一次受伤时结束
        s.forbidCon = null;
        r.damages++;
        // ⚠ 用事件里的 severity，不看播报标签：HP 归零时标签是「昏迷/濒死」，
        // 据文本分档必然把最重的那一档漏掉。
        r.severityBuckets[e.severity]++;
        const major = e.severity === "deep" || e.severity === "grievous";
        if (major) {
          if (e.to > 0) {
            r.majorWoundsStanding++;
            s.awaitingCon = { severity: e.severity, at: i };
            s.conSeen = 0;
            s.woundSeen = false;
          } else {
            // 已经被打昏了 → **不该**再掷重伤体质检定。
            // 开一个反向窗口：接下来到下一次伤害/换场景之间，
            // 这个人身上出现结算检定就是口径漂移。
            r.majorWoundsWhileDown++;
            s.forbidCon = i;
          }
        }
        break;
      }
      case "wound": {
        const s = st(e.who);
        s.wound = e.severity;
        s.woundDice = e.penaltyDice;
        s.woundSeen = true;
        r.woundsRecorded++;
        break;
      }
      case "wound-healed": {
        const s = st(e.who);
        s.wound = null;
        s.woundDice = 0;
        r.woundsHealed++;
        break;
      }
      case "check": {
        if (e.actorKind !== "pc") break;
        const s = st(e.actor);
        if (isSettlementCheck(e)) {
          r.conChecks++;
          if (s.awaitingCon) s.conSeen++;
          else if (s.forbidCon !== null) {
            r.breaches.push({ kind: "con-while-down", who: e.actor, at: i });
            s.forbidCon = null;
          }
          // W2：结算这处伤的那一掷不能被这处伤罚
          if (e.woundPenalty > 0) {
            r.breaches.push({ kind: "con-self-penalized", who: e.actor, woundPenalty: e.woundPenalty, at: i });
          }
          break;
        }
        if (!e.woundAware) {
          // 战斗攻击掷骰：这条路径不读伤势。有伤时记一笔，报告里明说。
          if (s.wound) r.woundBlindRolls++;
          if (e.envPenalty > 0) r.envOnlyPenalizedChecks++;
          break;
        }
        if (s.wound) {
          // W3：有未处理伤势 → 必须带伤势惩罚骰
          if (e.woundPenalty > 0) r.woundPenalizedChecks++;
          else r.breaches.push({ kind: "wound-penalty-missing", who: e.actor, skill: e.skill, at: i });
        } else {
          // W4：没伤了还在扣伤势惩罚 = 治疗没生效
          if (e.woundPenalty > 0) {
            r.breaches.push({ kind: "penalty-after-heal", who: e.actor, skill: e.skill, at: i });
          } else if (e.envPenalty > 0) {
            // 环境惩罚骰。**不能拿它当伤势惩罚生效的证据**
            r.envOnlyPenalizedChecks++;
          }
        }
        break;
      }
      case "scene-enter": {
        // 换场景就别再等这次的体质检定了，反向窗口同样关掉
        for (const who of states.keys()) {
          closeAwait(who, i);
          st(who).forbidCon = null;
        }
        break;
      }
      default:
        break;
    }
  });

  for (const who of states.keys()) closeAwait(who, events.length);
  return r;
}

export function mergeWounds(reports: readonly WoundReport[]): WoundReport {
  const out = reduceWounds([]);
  for (const r of reports) {
    for (const k of Object.keys(out.severityBuckets) as WoundSeverity[]) {
      out.severityBuckets[k] += r.severityBuckets[k];
    }
    out.damages += r.damages;
    out.majorWoundsStanding += r.majorWoundsStanding;
    out.majorWoundsWhileDown += r.majorWoundsWhileDown;
    out.conChecks += r.conChecks;
    out.woundsRecorded += r.woundsRecorded;
    out.woundsHealed += r.woundsHealed;
    out.woundPenalizedChecks += r.woundPenalizedChecks;
    out.envOnlyPenalizedChecks += r.envOnlyPenalizedChecks;
    out.woundBlindRolls += r.woundBlindRolls;
    out.breaches.push(...r.breaches);
  }
  return out;
}
