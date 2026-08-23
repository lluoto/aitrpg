// 「Boss 到底还不还手、玩家掉不掉血」——判据本身。
//
// ── 上一版的错 ──
// `inCombat.filter(l => /【格斗】/.test(l)).length` 当成敌人挥击次数。
// 三个洞：
//   1. **不验攻击者**。玩家若有一个正好叫「格斗」的技能，这条直接把玩家的
//      掷骰算成敌人还手 —— 「敌人会还手了」于是永远通过。
//   2. **认死技能名**。敌人技能改叫「触手」或「格斗(钳肢)」就一次都不认，
//      静默掉到 0，然后报「敌人一次都没还手」——真报警和漏报长得一模一样。
//   3. **跨局求和**。`swings === 0 ? 报警 : 通过`：只要 10 局里有 1 局打了 1 下，
//      另外 9 局的敌人全程发呆也算「会还手了」。判据必须按**发生战斗的那一局**看。
// 战斗段的行范围也是猜的：`findIndex(/战斗轮/)` 到下一条 `═{10,}` ——
// 而 `═` 分隔线在战斗开始处就有三条。
//
// ── 现在的判据 ──
// 按 combat-start / combat-round 事件划分战斗与轮次，敌人还手直接读
// `enemy-attack` 事件（自带攻击者与目标），与技能名无关。

import type { PlayEvent } from "../play/events";

interface CombatRound {
  round: number;
  /** 本轮敌人挥击（按目标分） */
  enemyAttacks: { target: string; outcome: "miss" | "dodged" | "hit"; damage: number }[];
  /** 本轮调查员攻击掷骰（按攻击者分） */
  pcAttacks: { actor: string; skill: string; success: boolean }[];
}

interface CombatEncounter {
  enemy: string;
  rounds: CombatRound[];
  /** 战斗中玩家被打掉的 HP 总量 */
  pcHpLost: number;
  /** 战斗中被打昏的人（含两条成因） */
  knockouts: { who: string; cause: "hp-zero" | "major-wound-con" }[];
  result: "defeated" | "fled" | "lost" | "(未结束)";
}

export interface CombatReport {
  encounters: CombatEncounter[];
  /** 疑似把玩家掷骰当成敌人攻击的行数 —— 判据自检用，应恒为 0 */
  misattributed: number;
}

export function reduceCombat(events: readonly PlayEvent[]): CombatReport {
  const report: CombatReport = { encounters: [], misattributed: 0 };
  let cur: CombatEncounter | null = null;
  let round: CombatRound | null = null;
  /** 战斗中的角色名，用来把「战斗内的伤害」和「陷阱伤害」分开 */
  let inCombat = false;

  const ensureRound = () => {
    if (!cur) return null;
    if (!round) {
      round = { round: cur.rounds.length + 1, enemyAttacks: [], pcAttacks: [] };
      cur.rounds.push(round);
    }
    return round;
  };

  for (const e of events) {
    switch (e.type) {
      case "combat-start":
        cur = { enemy: e.enemy, rounds: [], pcHpLost: 0, knockouts: [], result: "(未结束)" };
        round = null;
        inCombat = true;
        report.encounters.push(cur);
        break;
      case "combat-round":
        if (!cur) break;
        round = { round: e.round, enemyAttacks: [], pcAttacks: [] };
        cur.rounds.push(round);
        break;
      case "enemy-attack": {
        const rd = ensureRound();
        if (!rd || !cur) break;
        // 攻击者身份来自事件，不从技能名反推 —— 敌人技能叫什么都不影响
        if (e.enemy !== cur.enemy) report.misattributed++;
        rd.enemyAttacks.push({ target: e.target, outcome: e.outcome, damage: e.damage });
        break;
      }
      case "pc-attack": {
        if (!inCombat || !cur) break;
        // 「这是不是一次攻击」由专门的事件说，不从技能名或实现细节反推。
        // 曾经靠 `woundAware === false` 认它（那时 pcAttack 绕过 `check()`），
        // 后来伤势惩罚接上去，那个标记立刻失效 —— 判据不该寄生在实现细节上。
        const rd = ensureRound();
        rd?.pcAttacks.push({ actor: e.actor, skill: e.skill, success: e.success });
        break;
      }
      case "damage":
        if (inCombat && cur) cur.pcHpLost += e.amount;
        break;
      case "downed":
        if (inCombat && cur) cur.knockouts.push({ who: e.who, cause: e.cause });
        break;
      case "combat-end":
        if (cur) cur.result = e.result;
        cur = null;
        round = null;
        inCombat = false;
        break;
      default:
        break;
    }
  }
  return report;
}

interface CombatVerdict {
  /** 发生过战斗的局数（分母） */
  fights: number;
  /** 敌人一次都没挥击的战斗数 —— **这才是「不还手」的判据** */
  silentFights: number;
  enemySwings: number;
  enemyHits: number;
  dodged: number;
  missed: number;
  pcAttacks: number;
  pcHpLost: number;
  knockouts: { who: string; cause: "hp-zero" | "major-wound-con" }[];
  results: Record<string, number>;
  misattributed: number;
}

/** 把多局的战斗汇总成可判定的结论。注意 silentFights 是按**局**算的 */
export function judgeCombat(reports: readonly CombatReport[]): CombatVerdict {
  const v: CombatVerdict = {
    fights: 0, silentFights: 0, enemySwings: 0, enemyHits: 0, dodged: 0, missed: 0,
    pcAttacks: 0, pcHpLost: 0, knockouts: [], results: {}, misattributed: 0,
  };
  for (const r of reports) {
    v.misattributed += r.misattributed;
    for (const enc of r.encounters) {
      v.fights++;
      const swings = enc.rounds.reduce((a, rd) => a + rd.enemyAttacks.length, 0);
      if (swings === 0) v.silentFights++;
      v.enemySwings += swings;
      for (const rd of enc.rounds) {
        for (const a of rd.enemyAttacks) {
          if (a.outcome === "hit") v.enemyHits++;
          else if (a.outcome === "dodged") v.dodged++;
          else v.missed++;
        }
        v.pcAttacks += rd.pcAttacks.length;
      }
      v.pcHpLost += enc.pcHpLost;
      v.knockouts.push(...enc.knockouts);
      v.results[enc.result] = (v.results[enc.result] ?? 0) + 1;
    }
  }
  return v;
}
