// 从 play-module.ts 抽出来的一段（脚本搬运，见 tools/_extract-block.ts）。
//
// 抽出来的理由是可寻址性：原先 runModuleInner 一个函数 2615 行、占全文件 74%，
// 里面按注释能切出近 30 个块，但没有一个是能整段读进来的单元 ——
// 每次改动只能靠行号开窗口猜，窄了缺上下文、宽了浪费。
//
// ⚠ 纯搬运，不改行为。判据是全量测试与主循环脚手架全绿。

import { CoCEngine, SanityEngine, SUCCESS_LEVEL_LABELS, sanOutcomeLabel, type CoCCheckResult } from "../rules/coc-engine";
import { calcSeverity, severityLabel, woundPenaltyDice, type WoundSeverity } from "../combat/wound-effects";
import type { CoCGeneratedCharacter } from "../character/coc-character";
import { runCtx, say, sayMech } from "./narration";
// ── 伤势状态 ──
// 记「未处理的最重一处」而不是累加：CoC 里伤是伤，不是叠加的减值。
const SEVERITY_RANK: Record<string, number> = {
  scratch: 0, flesh: 1, deep: 2, grievous: 3, lethal: 4,
};

/**
 * 两处伤取更重的那个。
 *
 * 抽成纯函数是为了能测这条规则：**后来的轻伤不能盖掉先前的重伤**。
 * 写成无脑覆盖的话，重伤之后擦破一下皮，惩罚骰就没了。
 */
export function worseWound(cur: WoundSeverity | undefined, next: WoundSeverity): WoundSeverity {
  if (!cur) return next;
  return (SEVERITY_RANK[next] ?? 0) > (SEVERITY_RANK[cur] ?? 0) ? next : cur;
}

/** 记一处伤；比现有的更重才覆盖 */
export function recordWound(pcName: string, sev: WoundSeverity): void {
  const ctx = runCtx.getStore();
  if (!ctx) return;
  ctx.wounds.set(pcName, worseWound(ctx.wounds.get(pcName), sev));
}

/** 伤势被处理掉（急救成功等） */
export function healWound(pcName: string): void {
  runCtx.getStore()?.wounds.delete(pcName);
}

/**
 * 当前伤势该加几个惩罚骰。
 *
 * 上限 2 —— CoC 7e 的奖励/惩罚骰最多 2 个，而 `woundPenaltyDice` 给致命伤返回 3。
 * 不在那边改是因为它是伤势模型的一部分（3 表示「比重伤重得多」），
 * 截断属于掷骰规则，归这里。
 */
export function woundPenaltyOf(pcName: string): number {
  const sev = runCtx.getStore()?.wounds.get(pcName);
  return sev ? Math.min(2, woundPenaltyDice(sev)) : 0;
}

// ── 检定 ──
// penaltyDice: 额外惩罚骰（环境等）。角色身上的伤势会**自动**再加，不用调用方操心。
//
// ignoreWound: 只给「重伤体质检定」用 —— 那一掷是在结算**这处伤本身**，
// 让它被自己造成的伤势罚一次是双重计算（实跑抓到过：
// 「体质（重伤）51% [1惩罚骰·伤势]」，那个惩罚骰正是同一处伤给的）。
export function check(
  skillVal: number,
  pcName: string,
  skillLabel: string,
  diff: "regular" | "hard" | "extreme" = "regular",
  penaltyDice: number = 0,
  ignoreWound: boolean = false,
): CoCCheckResult {
  const fromWound = ignoreWound ? 0 : woundPenaltyOf(pcName);
  const total = Math.min(2, penaltyDice + fromWound);
  const r = CoCEngine.skillCheck(skillVal, diff, 0, total);
  const why = fromWound > 0 ? (penaltyDice > 0 ? "环境+伤势" : "伤势") : "";
  const penaltyNote = total > 0 ? ` [${total}惩罚骰${why ? "·" + why : ""}]` : "";
  sayMech(`➜ ${pcName} 【${skillLabel}】 ${skillVal}%${penaltyNote} → d100=${r.roll} → ${SUCCESS_LEVEL_LABELS[r.successLevel]}`);
  return r;
}

// ── 根据成功等级生成发现 flavor ──
export function discoveryFlavor(level: string): string {
  const m: Record<string, string[]> = {
    critical: ["仔细查看之下，一个令人震惊的发现——", "拨开遮挡物，露出的东西让所有人都倒吸一口凉气——", "当视线落定，真相让人心头一震——"],
    extreme:  ["凑近仔细观察，目光停在一处——", "翻开杂物，下面的东西引起了注意——", "移开遮挡物，露出了一样东西——"],
    hard:     ["仔细查看之下有了发现——", "目光扫过一处不寻常的地方——", "定睛看去，那里确实有什么——"],
    regular:  ["目光扫过，注意到一个细节——", "手指触到某个不寻常的东西——", "视线在某处停了一下——", "靠近查看，发现了一些东西——"],
  };
  const pool = m[level] || m.regular;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── 失败 flavor ──
export function failFlavor(fumble: boolean): string {
  if (fumble) {
    return ["可惜没能发现什么——反而一个失手把东西碰乱了。", "糟糕，什么也没找到，还弄出了不小的动静。"][Math.floor(Math.random() * 2)];
  }
  return ["可惜没能发现什么有用的东西。", "搜索了一番，一无所获。", "什么也没有。"][Math.floor(Math.random() * 3)];
}

// ── SAN 检定 ──
export function sanCheck(pcName: string, engine: SanityEngine, sanCost: string): void {
  const result = engine.sanityCheck(sanCost);
  const outcome = sanOutcomeLabel(result.passed);
  sayMech(`🧠 ${pcName} 【理智检定】 SAN ${engine.state.currentSAN + result.sanLoss} → d100=${result.roll} → ${outcome}，损失 ${result.sanLoss} SAN (剩余 ${engine.state.currentSAN})`);
  if (result.temporaryInsanityTriggered) {
    say(`\n⚠ ${pcName} 陷入了临时疯狂！${result.boutOfMadness ?? ""}`);
  }
  if (result.indefiniteInsanityTriggered) {
    say(`\n⚠ ${pcName} 陷入了不定疯狂（${result.indefiniteLevel}级）！${result.newPhobia ? `获得恐惧症: ${result.newPhobia}` : ""}`);
  }
}

// ── HP 伤害处理 ──
// 返回伤害等级，供调用方做重伤体质检定。
// 伤害等级按**单次伤害 / maxHp** 计算，不是剩余 HP 比例。
export function applyDamage(pc: CoCGeneratedCharacter, pcName: string, dmg: number): WoundSeverity {
  const severity = calcSeverity(dmg, pc.maxHp);
  pc.hp = Math.max(0, pc.hp - dmg);
  const suffix = pc.hp <= 0
    ? "（昏迷/濒死！）"
    : severity !== "scratch" ? `（${severityLabel(severity)}）` : "";
  sayMech(`❤ ${pcName} HP ${pc.hp + dmg} → ${pc.hp}${suffix}`);

  // 记进本局伤势 —— check() 会自动据此加惩罚骰，直到被急救处理掉
  const penalty = woundPenaltyDice(severity);
  if (penalty > 0 && pc.hp > 0) {
    recordWound(pcName, severity);
    sayMech(`⚠ ${pcName} 因伤势承受 ${woundPenaltyOf(pcName)} 惩罚骰，直到伤口得到处理。`);
  }

  return severity;
}
