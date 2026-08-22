// 「昏迷的调查员是不是还在自己掷骰」——判据本身。
//
// ── 范围声明（上一版没有，导致名称、实现、报告三处不一致）──
// 本判据只管**该角色自己发起的技能检定**（走 `check()` 或战斗攻击掷骰的那些）。
// 明确**不**管：
//   · SAN 检定 —— 被动反应不是行动（看着怪物本身就折磨理智），单列计数不判违规
//   · 同伴替他做的事（急救掷骰的 actor 是施救者）
//   · 说话、被拖走、被打 —— 引擎里根本没有对应的掷骰
// 报告用词必须与这条一致：写「昏迷期间掷骰」，不写「昏迷期间行动」。
//
// ── 为什么改用事件而不是正则 ──
// 上一版认 `❤ X HP n → 0（昏迷` 这一行。但昏迷有两条路径：
//   1. 伤害把 HP 打到 0        → 有那行
//   2. 重伤体质检定失败        → **没有那行**（HP 还剩着，人先倒了），
//      只有一句叙述「X因伤势过重昏迷过去！」
// 第 2 条整条漏掉，于是「违规 0 次」既可能是真的没问题，也可能是根本没在看。
// 这不是正则写得不好，是那行文本里没有这个信息。
//
// ── 合法豁免 ──
// 昏迷发生的**那一瞬间**还会结算「体质（重伤）」。它是同一次受伤的一部分，
// 播报顺序排在昏迷之后，不是「倒下之后又行动」。判据靠 `ignoreWound=true`
// 认它（只有重伤结算检定传这个），并且只在**同一场景内**豁免 ——
// 换了场景还在掷「体质（重伤）」就不是结算，是真违规。

import type { PlayEvent, DownedCause } from "../play/events";

export interface DownedViolation {
  actor: string;
  skill: string;
  /** 事件序号，便于回溯 */
  at: number;
  /** 倒下的成因，用来看是哪条路径漏的 */
  cause: DownedCause;
}

export interface DownedReport {
  /** 本局倒下过的人 */
  everDown: string[];
  /** 按成因分：只认 hp-zero 的判据会把 major-wound-con 整类漏掉 */
  byCause: Record<DownedCause, number>;
  /** 急救唤醒成功次数 */
  revives: number;
  /** 违规：处于昏迷态的角色自己发起的技能检定 */
  violations: DownedViolation[];
  /** 合法豁免掉的重伤结算检定次数 —— 报告里要写出来，否则「0 违规」看不出是豁免了还是没在看 */
  settlementExempt: number;
  /** 昏迷期间的 SAN 检定次数。范围外，单列不判违规 */
  sanWhileDowned: number;
  /** 昏迷期间同伴代做的检定次数（急救等）。这类**不该**被算成违规 */
  byPartnerWhileDown: number;
  /** 苏醒之后本人的正常检定次数 —— 上一版把这些也算违规，于是永远报警 */
  checksAfterRevive: number;
  /** 两人同时倒下 */
  allDown: boolean;
  /**
   * 本局的**身份不可分辨** —— 两名调查员的显示名撞了。
   *
   * 判据按名字归属掷骰（播报里只有名字），名字一撞就没法说「是谁在掷」。
   * 这时 `violations` 里的东西**既不能算通过也不能算违规**，只能算不可判定。
   * 实测撞过：seed 95028 两人都叫「亨利」，于是「同伴替他急救」被算成
   * 「他自己在掷急救」。当时差点被当成真违规去改引擎。
   *
   * 识别信号是结构性的：`revived.who === revived.by`。
   * 昏迷的人不可能给自己做急救 —— 出现这条就说明两个名字指向了同一个键。
   */
  ambiguousIdentity: boolean;
  ambiguityReason: string;
}

export function reduceDowned(events: readonly PlayEvent[]): DownedReport {
  /** name → 当前是否昏迷 */
  const down = new Map<string, boolean>();
  /** name → 倒下成因（用于违规归类） */
  const cause = new Map<string, DownedCause>();
  /** name → 结算豁免窗口是否还开着（进新场景/苏醒就关） */
  const settling = new Set<string>();
  /** name → 是否曾被救醒过（用来数「苏醒后的正常行动」） */
  const revivedOnce = new Set<string>();

  const r: DownedReport = {
    everDown: [],
    byCause: { "hp-zero": 0, "major-wound-con": 0 },
    revives: 0,
    violations: [],
    settlementExempt: 0,
    sanWhileDowned: 0,
    byPartnerWhileDown: 0,
    checksAfterRevive: 0,
    allDown: false,
    ambiguousIdentity: false,
    ambiguityReason: "",
  };

  // 先扫一遍身份可不可分辨。放前面是因为它决定后面那些计数**能不能当结论用**，
  // 而不是「先算完再补个免责声明」。
  const selfRevive = events.find((e) => e.type === "revived" && e.who === e.by);
  if (selfRevive && selfRevive.type === "revived") {
    r.ambiguousIdentity = true;
    r.ambiguityReason = `「${selfRevive.who}」给自己做了急救 —— 两名调查员显示名相同，按名字归属掷骰在本局不成立`;
  }

  events.forEach((e, i) => {
    switch (e.type) {
      case "downed": {
        if (!r.everDown.includes(e.who)) r.everDown.push(e.who);
        down.set(e.who, true);
        cause.set(e.who, e.cause);
        r.byCause[e.cause]++;
        settling.add(e.who);
        r.allDown = [...down.values()].filter(Boolean).length >= 2;
        break;
      }
      case "revived": {
        down.set(e.who, false);
        settling.delete(e.who);
        revivedOnce.add(e.who);
        r.revives++;
        break;
      }
      case "scene-enter": {
        // 换场景 = 结算窗口关闭。之后再掷「体质（重伤）」就不是这次受伤的结算了。
        settling.clear();
        break;
      }
      case "san-check": {
        if (down.get(e.actor)) r.sanWhileDowned++;
        break;
      }
      case "check": {
        if (e.actorKind !== "pc") break; // 敌人不在本判据范围内
        const isDown = down.get(e.actor) === true;
        if (!isDown) {
          // 同伴在替倒下的人做事（急救），或者本人已经醒了 —— 都不是违规。
          // 这两条要分别数出来，因为上一版正是把它们算成了违规。
          if ([...down.values()].some(Boolean)) r.byPartnerWhileDown++;
          if (revivedOnce.has(e.actor)) r.checksAfterRevive++;
          break;
        }
        if (e.ignoreWound && settling.has(e.actor)) {
          // 同一次受伤的结算掷骰，合法
          r.settlementExempt++;
          break;
        }
        r.violations.push({
          actor: e.actor,
          skill: e.skill,
          at: i,
          cause: cause.get(e.actor) ?? "hp-zero",
        });
        break;
      }
      default:
        break;
    }
  });

  return r;
}

/** 汇总多局 */
export function mergeDowned(reports: readonly DownedReport[]): DownedReport {
  const out: DownedReport = {
    everDown: [],
    byCause: { "hp-zero": 0, "major-wound-con": 0 },
    revives: 0,
    violations: [],
    settlementExempt: 0,
    sanWhileDowned: 0,
    byPartnerWhileDown: 0,
    checksAfterRevive: 0,
    allDown: false,
    ambiguousIdentity: false,
    ambiguityReason: "",
  };
  for (const r of reports) {
    if (r.ambiguousIdentity) {
      out.ambiguousIdentity = true;
      out.ambiguityReason = out.ambiguityReason || r.ambiguityReason;
    }
    for (const n of r.everDown) if (!out.everDown.includes(n)) out.everDown.push(n);
    out.byCause["hp-zero"] += r.byCause["hp-zero"];
    out.byCause["major-wound-con"] += r.byCause["major-wound-con"];
    out.revives += r.revives;
    out.violations.push(...r.violations);
    out.settlementExempt += r.settlementExempt;
    out.sanWhileDowned += r.sanWhileDowned;
    out.byPartnerWhileDown += r.byPartnerWhileDown;
    out.checksAfterRevive += r.checksAfterRevive;
    out.allDown = out.allDown || r.allDown;
  }
  return out;
}
