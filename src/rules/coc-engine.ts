// CoC 7e 技能检定引擎
// d100 roll-under 系统 + SAN 检定 + 疯狂判定
// 与 D&D RuleEngine 共享 dice 工具类，独立判定逻辑



// ============================================================
// Dice 工具（共享）
// ============================================================

export function rollD100(): number {
  return Math.floor(Math.random() * 100) + 1; // 1-100
}

export function rollD10(): number {
  return Math.floor(Math.random() * 10); // 0-9 (tens die)
}

/**
 * 奖励骰：额外投 `count` 个十位骰，连同本来那颗一起取优。
 *
 * CoC 7e：N 个奖励骰 = 掷 N+1 颗十位骰取最好。原先写死投 2 颗，
 * 于是「1 个奖励骰」与「2 个奖励骰」掷出来完全一样——**数量表达不出来**。
 */
export function bonusDie(count: number = 1): number {
  const n = Math.max(1, count);
  let best = rollD10();
  for (let i = 0; i < n; i++) best = Math.min(best, rollD10());
  // CoC 7e: 十位 0-9 + 个位 1-10 → 范围 1-100
  const ones = Math.floor(Math.random() * 10) + 1; // 1-10
  return best * 10 + ones;
}

/** 惩罚骰：额外投 `count` 个十位骰，连同本来那颗一起取劣。见 bonusDie 的说明。 */
export function penaltyDie(count: number = 1): number {
  const n = Math.max(1, count);
  let worst = rollD10();
  for (let i = 0; i < n; i++) worst = Math.max(worst, rollD10());
  const ones = Math.floor(Math.random() * 10) + 1; // 1-10
  return worst * 10 + ones;
}

/** 普通 d100 */
export function regularD100(): number {
  return rollD100();
}

// ============================================================
// 技能检定结果
// ============================================================

export type CoCSuccessLevel = "critical" | "extreme" | "hard" | "regular" | "fail" | "fumble";

/**
 * 成功等级的中文标签 — CLI / 模组 / API 各层共用。
 *
 * 各层此前各写一份（play-module 内部就有两份逐字相同的拷贝），措辞还出现漂移。
 * 标签是语义层，装饰（emoji、缩进、markdown 加粗）留给各自的渲染层。
 */
export const SUCCESS_LEVEL_LABELS: Record<CoCSuccessLevel, string> = {
  critical: "大成功",
  extreme: "极限成功",
  hard: "困难成功",
  regular: "常规成功",
  fail: "失败",
  fumble: "大失败",
};

/**
 * SAN 检定结果标签。
 *
 * 此前 CLI 说「成功」、API 说「通过」，同一件事两种说法。统一取「通过」：
 * SAN 检定是二元的通过/失败，用「成功」会和上面的成功等级（大成功/常规成功）语义撞车。
 */
export function sanOutcomeLabel(passed: boolean): string {
  return passed ? "通过" : "失败";
}

export interface CoCCheckResult {
  roll: number;
  skillValue: number;
  successLevel: CoCSuccessLevel;
  isSuccess: boolean;
  /** 检定类型 */
  checkType: "regular" | "hard" | "extreme";
  /** 是否用了奖励骰/惩罚骰 */
  bonusDieUsed: boolean;
  penaltyDieUsed: boolean;
  /** 人类可读描述 */
  description: string;
  /** 燃运后的实际投骰值（燃运0则等于roll） */
  luckAdjusted: number;
  /** 燃运消耗的点数 */
  luckSpent: number;
  /** 是否为推动检定（失败后重试） */
  pushed: boolean;
}

// ============================================================
// CoC 技能检定引擎
// ============================================================

/** 战斗检定结果（含部位/贯穿） */
export interface CombatCheckResult {
  hit: boolean;
  damage: number;
  result: string;
  roll: number;
  successLevel: CoCSuccessLevel;
  skillValue: number;
  hitLocation?: HitLocation;
  isImpale: boolean;
  isCritical: boolean;
  /** 反击/格挡命中时，反击方造成的伤害 */
  counterDamage?: number;
  /** 反击是否命中 */
  counterHit?: boolean;
}

export class CoCEngine {
  /**
   * 根据骰子表达式（如 "2d6+2", "1d8", "4d6/2d6/1d6"）投掷伤害
   * 霰弹枪分段格式自动取第一段
   */
  static rollDamage(damageDice: string): number {
    // 霰弹枪分段：取第一段
    const dice = damageDice.includes("/") ? damageDice.split("/")[0] : damageDice;
    const diceMatch = dice.match(/(\d+)d(\d+)(?:\+(\d+))?/);
    if (!diceMatch) return 0;
    const [, count, sides, bonus] = diceMatch;
    const sidesNum = parseInt(sides);
    const bonusNum = bonus ? parseInt(bonus) : 0;
    let total = 0;
    for (let i = 0; i < parseInt(count); i++) {
      total += Math.floor(Math.random() * sidesNum) + 1;
    }
    return total + bonusNum;
  }

  /**
   * 技能检定
   * @param skillValue 技能值 (1-99)
   * @param difficulty "regular" | "hard(½)" | "extreme(⅕)"
   * @param bonusDice 奖励骰数量（0-2）
   * @param penaltyDice 惩罚骰数量（0-2）
   * @param luckSpend 燃运点数（减少 d100 投骰值）
   * @param pushed 是否为推动检定
   */
  static skillCheck(
    skillValue: number,
    difficulty: "regular" | "hard" | "extreme" = "regular",
    bonusDice: number = 0,
    penaltyDice: number = 0,
    luckSpend: number = 0,
    pushed: boolean = false,
  ): CoCCheckResult {
    const netDice = bonusDice - penaltyDice; // 奖励骰和惩罚骰互相抵消
    let roll: number;

    if (netDice > 0) {
      // 奖励骰：把净数量传下去，2 个和 1 个不该掷出一样的分布
      roll = bonusDie(netDice);
    } else if (netDice < 0) {
      // 惩罚骰
      roll = penaltyDie(-netDice);
    } else {
      roll = regularD100();
    }

    // 燃运：减少投骰值（不能低于 1）
    // 原骰值不用单独留一份：`luckAdjusted` 与 `luckSpent` 都在返回值里，
    // 要还原原骰加回去就是。留个没人读的 `originalRoll` 只会让人以为它有用途。
    const luckAdjusted = Math.max(1, roll - luckSpend);
    roll = luckAdjusted;

    // ⚠ 这一段原先是错的，而且只有 extreme 那一档错得出来。
    //
    //   原写法把「≤ 半值」那一支写成
    //       successLevel = difficulty === "regular" ? "hard" : "regular";
    //   ——**不看要求的难度**。于是 `skillCheck(25, "extreme")` 掷 6
    //   （极难阈值只有 5）落进这一支，被判成 regular 成功。
    //   也就是说**极难难度形同虚设**：25% 的技能在极难下本该只有 5% 通过，
    //   实际有 12%。hard 没出事纯属**碰巧** —— 它的阈值正好等于半值。
    //
    //   CoC 7e 的模型是：掷一次得到一个**成功等级**（与难度无关，
    //   只看骰值落在技能的哪一段），再拿这个等级去比**要求的难度**。
    //   照这个模型重写，三档就都对了。
    const extremeTarget = Math.floor(skillValue / 5);
    const hardTarget = Math.floor(skillValue / 2);

    let successLevel: CoCSuccessLevel;
    if (roll === 1) successLevel = "critical";
    else if (roll === 100 || (skillValue < 50 && roll >= 96)) successLevel = "fumble";
    else if (roll <= extremeTarget) successLevel = "extreme";
    else if (roll <= hardTarget) successLevel = "hard";
    else if (roll <= skillValue) successLevel = "regular";
    else successLevel = "fail";

    // 成功与否 = 拿到的等级够不够要求的难度。
    // 原先是 `level !== fail && level !== fumble` —— 那等于**任何难度都按常规算**，
    // 与上面那个不看难度的等级链是同一个错的两面。
    const RANK: Record<CoCSuccessLevel, number> = {
      fumble: -1, fail: 0, regular: 1, hard: 2, extreme: 3, critical: 4,
    };
    const NEEDED = difficulty === "extreme" ? 3 : difficulty === "hard" ? 2 : 1;
    const isSuccess = RANK[successLevel] >= NEEDED;

    return {
      roll,
      skillValue,
      successLevel,
      isSuccess,
      checkType: difficulty,
      bonusDieUsed: netDice > 0,
      penaltyDieUsed: netDice < 0,
      description: CoCEngine.describeResult(successLevel, roll, skillValue),
      luckAdjusted,
      luckSpent: luckSpend,
      pushed,
    };
  }

  private static describeResult(level: CoCSuccessLevel, roll: number, skill: number): string {
    switch (level) {
      case "critical": return `大成功！(d100=${roll} vs ${skill})`;
      case "extreme": return `极限成功 (d100=${roll} vs ${skill})`;
      case "hard": return `困难成功 (d100=${roll} vs ${skill})`;
      case "regular": return `常规成功 (d100=${roll} vs ${skill})`;
      case "fail": return `失败 (d100=${roll} > ${skill})`;
      case "fumble": return `大失败！(d100=${roll})`;
    }
  }

  // ==========================================================
  // 战斗相关（CoC 风格——致命且快速）
  // ==========================================================

  /** 近战/射击对抗检定 */
  /**
   * 通用骰子投掷：支持 "1d6", "2d4+3", "1d8-1" 格式
   */
  static rollDice(dice: string): number {
    const m = dice.match(/(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?/);
    if (!m) return 0;
    const count = parseInt(m[1]);
    const sides = parseInt(m[2]);
    let total = 0;
    for (let i = 0; i < count; i++) {
      total += Math.floor(Math.random() * sides) + 1;
    }
    if (m[3] === "+") total += parseInt(m[4]);
    else if (m[3] === "-") total -= parseInt(m[4]);
    return Math.max(0, total);
  }

  static combatCheck(
    attackerSkill: number,
    defenderSkill: number | null,
    damageDice: string,
    bonusDice: number = 0,
    penaltyDice: number = 0,
    aimedMode: boolean = false,
    calledShot?: string,
    isFightBack: boolean = false,
    counterDamageDice?: string,
    /** 攻击方伤害加值 DB 字符串，如 "+1d4"、"-2"，由 rollDamageBonus 解析 */
    attackerDb?: string,
  ): CombatCheckResult {
    const attackRoll = CoCEngine.skillCheck(attackerSkill, "regular", bonusDice, penaltyDice);

    if (attackRoll.successLevel === "fumble") {
      return { hit: false, damage: 0, result: "攻击失误——武器脱手/误伤自己", roll: attackRoll.roll, successLevel: "fumble", skillValue: attackerSkill, hitLocation: undefined, isImpale: false, isCritical: false };
    }

    // 攻击失败则自动未命中（CoC 7e：防御方无需闪避未成功的攻击）
    if (!attackRoll.isSuccess) {
      return { hit: false, damage: 0, result: `攻击未命中 (d100=${attackRoll.roll} > ${attackerSkill})`, roll: attackRoll.roll, successLevel: "fail", skillValue: attackerSkill, hitLocation: undefined, isImpale: false, isCritical: false };
    }

    // 判定是否暴击：大成功 或（瞄准模式下极限成功也算暴击）
    const isCritical = attackRoll.successLevel === "critical"
      || (aimedMode && attackRoll.successLevel === "extreme");

    let counterDamage: number | undefined;
    let counterHit = false;

    if (defenderSkill !== null) {
      const defenseRoll = CoCEngine.skillCheck(defenderSkill, "regular");
      const defenderWins = defenseRoll.isSuccess && defenseRoll.successLevel !== "critical";

      if (defenderWins) {
        if (!isCritical) {
          // 反击命中
          if (isFightBack && counterDamageDice) {
            counterDamage = CoCEngine.rollDamage(counterDamageDice);
            counterHit = true;
          }
          const defenseLabel = isFightBack ? "反击" : "闪避";
          return { hit: false, damage: 0, result: `对方${defenseLabel}成功`, roll: attackRoll.roll, successLevel: attackRoll.successLevel, skillValue: attackerSkill, hitLocation: undefined, isImpale: false, isCritical: false, counterDamage, counterHit };
        }
        // 暴击无视防御
      }
    }

    // 命中——投骰部位
    const hitLocation = rollHitLocation(calledShot);

    // 计算伤害
    const diceMatch = damageDice.match(/(\d+)d(\d+)(?:\+(\d+))?/);
    let damage = 0;
    let isImpale = false;

    if (diceMatch) {
      const [, count, sides, bonus] = diceMatch;
      const sidesNum = parseInt(sides);
      const bonusNum = bonus ? parseInt(bonus) : 0;

      // 贯穿：极限成功 → 最大伤害；暴击 → 最大伤害 + DB 也最大
      if (attackRoll.successLevel === "extreme" || attackRoll.successLevel === "critical") {
        isImpale = true;
        // 每个骰子取最大值
        damage = parseInt(count) * sidesNum + bonusNum;
      } else {
        for (let i = 0; i < parseInt(count); i++) {
          damage += Math.floor(Math.random() * sidesNum) + 1;
        }
        damage += bonusNum;
      }
    }

    // 伤害加值：攻击方 DB（如 "+1d4"）
    if (attackerDb && attackerDb !== "0") {
      if (isImpale || isCritical) {
        damage += maxDamageBonus(attackerDb);
      } else {
        damage += rollDamageBonus(attackerDb);
      }
    }

    // 部位效果描述
    const effect = getHitLocationEffect(hitLocation, damage, isImpale, isCritical);
    const resultStr = isCritical ? `暴击！${effect.description}（${damage} 点伤害）`
      : isImpale ? `贯穿！${effect.description}（${damage} 点伤害）`
      : effect.description + `（${damage} 点伤害）`;

    return {
      hit: true,
      damage,
      result: resultStr,
      roll: attackRoll.roll,
      successLevel: attackRoll.successLevel,
      skillValue: attackerSkill,
      hitLocation,
      isImpale,
      isCritical,
      counterDamage,
      counterHit,
    };
  }
}

// ============================================================
// SAN 系统
// ============================================================

type IndefiniteLevel = "mild" | "moderate" | "severe" | null;

export interface SanityState {
  currentSAN: number;
  maxSAN: number;             // POW (意志)
  temporaryInsanity: boolean;
  indefiniteInsanity: boolean;
  /** 不定疯狂等级: mild=轻(累计20-39%), moderate=中(40-59%), severe=重(60%+) */
  indefiniteLevel: IndefiniteLevel;
  phobias: string[];
  manias: string[];
  /** 本轮已损失 SAN */
  sanLostThisRound: number;
  /** 梦魇计数器（连续噩梦天数） */
  nightmareStreak: number;
  /** 不可逆改变列表 */
  irreversibleChanges: string[];
  /** 心理治疗进度 (0-100，达到100降一级) */
  therapyProgress: number;
  /** 入院天数 (SAN=0时) */
  daysInstitutionalized: number;
  /** 克苏鲁神话技能 (0-99) — 降低 maxSAN 上限 */
  cthulhuMythos: number;
  /** 克苏鲁神话学习记录 */
  mythosLog: CthulhuMythosEntry[];
}

interface SanityCheckResult {
  sanLoss: number;
  roll: number;
  passed: boolean;
  temporaryInsanityTriggered: boolean;
  indefiniteInsanityTriggered: boolean;
  /** 触发的不定疯狂等级 */
  indefiniteLevel: IndefiniteLevel;
  boutOfMadness: string | null;
  newPhobia?: string;
  newMania?: string;
  /** 完整疯狂结构（类型+变体+引导+后遗） */
  boutDetail?: BoutResult;
}

// ============================================================
// 疯狂系统 — CoC 7e 分层结构
// ============================================================

/**
 * 疯狂表现结果
 */
interface BoutResult {
  type: string;                 // 疯狂类型（中文）
  symptom: string;              // 症状描述
  guidance: string;             // RP 指引
  residual: string | null;      // 后遗症（检定后残留）
  outcome: string;              // 简短的结果摘要
}

/**
 * 临时疯狂分层表
 * 每层 1 大类 → 3 条变体 → 各带 RP 指引 + 后遗症 + 残余
 */
const BOUT_MATRIX: Array<{
  id: string;
  label: string;
  variants: string[];
  guidance: string;
  residual: string | null;
  outcomeFn: (v: string) => string;
}> = [
  {
    id: "amnesia", label: "失忆",
    variants: [
      "你无法回忆起过去几分钟发生的事。你不知道自己在哪里、怎么来的。",
      "你对当前场景有片段式的记忆碎片——闪回和幻觉交织，你分不清哪些是真的。",
      "你忘了某个关键人物的身份——即使是你的同伴。你需要重新认识他们。",
    ],
    guidance: "不要使用任何超过「刚才」时间跨度的信息。与其他角色互动时表现出困惑和警惕。",
    residual: "长休后恢复。若不定疯狂中，你可能永远失去这段时间的记忆。",
    outcomeFn: (v: string) => `失忆——${v}`,
  },
  {
    id: "paranoia", label: "偏执",
    variants: [
      "你坚信所有人都在针对你。NPC 的善意将被你解读为阴谋或陷阱。",
      "你怀疑队伍里有叛徒——某个同伴的行为「不对劲」，你暗中监视他们。",
      "你感觉有什么东西在跟踪你。你会频繁回头、检查角落、拒绝孤身一人。",
    ],
    guidance: "不会接受任何帮助或善意。所有说服/交涉对你自动降一级难度。",
    residual: "即使症状消退，你对陌生人的信任永久下降。下次社交技能检定获得 1 个惩罚骰。",
    outcomeFn: (v: string) => `偏执——${v}`,
  },
  {
    id: "violence", label: "暴力",
    variants: [
      "你攻击最近的生物，不分敌我。你的眼中只有威胁。",
      "你开始破坏周围的东西——砸家具、砸墙壁、砸你的装备。",
      "你把武器指向自己，或做出危险的挑衅行为（比如冲向敌人、扔掉武器）。",
    ],
    guidance: "战斗时你无法区分队友和敌人。每次攻击前投 1d2 决定目标（1=最近的敌人，2=最近的队友）。",
    residual: "清醒后你为自己的行为感到羞愧。你对在疯狂中伤害过的对象自动产生+1 度好感/敬畏（守密人决定）。",
    outcomeFn: (v: string) => `暴力倾向——${v}`,
  },
  {
    id: "flight", label: "逃跑",
    variants: [
      "你不顾一切朝任意方向狂奔。忽略所有障碍和危险。",
      "你试图找一个安全的地方躲起来——柜子、床底、阁楼——不管多小。",
      "你命令所有人立刻撤离，即使没有危险。你急切地催促每个人离开。",
    ],
    guidance: "追逐规则自动启动或你进入最近的掩体。除非被强制拦住，你不会主动停止。",
    residual: "你开始随身准备「逃生路线」。每次进入新场景，你下意识寻找出口。",
    outcomeFn: (v: string) => `逃跑——${v}`,
  },
  {
    id: "catatonia", label: "僵直",
    variants: [
      "你全身无法动弹。你眼睁睁看着一切发生，却无法做出任何反应。",
      "你跪下或蜷缩成胎儿姿势。你完全脱离了周围环境。",
      "你只会机械地重复同一个动作或同一句话——「不不不」「完了」「我们都得死」。",
    ],
    guidance: "你无法行动。这状态持续 1d6 回合（或被外力打断——如被攻击或剧烈摇晃）。",
    residual: "你对僵直期间发生的事完全没有记忆。别人告诉你的你也不信。",
    outcomeFn: (v: string) => `僵直——${v}`,
  },
  {
    id: "hysteria", label: "歇斯底里",
    variants: [
      "你无法控制地大笑、哭泣或尖叫。你发出的声音会引来不必要的注意。",
      "你用第三人称谈论自己，或者你相信自己是另一个人物/生物。",
      "你开始唱歌、颂诗或自言自语，内容与当前场景完全无关。",
    ],
    guidance: "潜行和说服自动失败。你无法进行需要沉默或冷静的行动。",
    residual: "同伴可以在 1d3 回合后让你冷静下来（需要 INT×5 检定）。失败则持续到场景结束。",
    outcomeFn: (v: string) => `歇斯底里——${v}`,
  },
  {
    id: "phobia", label: "恐惧症获得",
    variants: [
      "你对当前场景中的某个事物产生极端恐惧。",
      "你对刚刚造成 SAN 损失的对象产生恐惧。",
      "你开始害怕某个抽象概念——死亡、疯狂本身、未知。",
    ],
    guidance: "你会试图远离恐惧来源，拒绝靠近或接触。触及时需要意志检定。",
    residual: "获得对应的恐惧症（见恐惧症表）。",
    outcomeFn: (v: string) => `恐惧症获得——${v}`,
  },
  {
    id: "fantasy", label: "幻觉/妄想",
    variants: [
      "你看到了不存在的东西。墙在呼吸、影子在动、角落里有东西在注视你。",
      "你听到了声音——有人在叫你，在低语，在说你的名字。你知道那不是真的，但无法忽视。",
      "你坚信自己在梦中，这不是真实的。你做出不计后果的行动来「证明」这一点。",
    ],
    guidance: "你可以选择「对抗幻觉」（意志检定）或「屈服于幻觉」（接受并开始 RP）。每次对抗成功时幻觉暂时消退 1 回合。",
    residual: "此后你对「真实」的标准变得模糊。你不再 100% 相信自己的感官。",
    outcomeFn: (v: string) => `幻觉——${v}`,
  },
  {
    id: "obsession", label: "强迫行为",
    variants: [
      "你反复检查、整理或计数。门一定要开关三次，东西必须摆正。",
      "你被某个想法困住了——「我们得回去」「一定有线索」「再试一次」。",
      "你开始收集没用的东西——石块、树叶、骨头——你直觉「这些很重要」。",
    ],
    guidance: "每次试图离开当前场景前，你必须先完成强迫行为（守密人决定耗时）。",
    residual: "你保留轻微的强迫倾向。此后到场景结束，每次新场景你多花 1 回合「检查」。",
    outcomeFn: (v: string) => `强迫行为——${v}`,
  },
  {
    id: "mania", label: "狂躁",
    variants: [
      "你精力过旺，无法静止。你来回踱步、语速快、打断别人说话。",
      "你开始执行一个宏大而不切实际的计划——拆墙、挖洞、追逐某个「灵感」。",
      "你变得极度自信（或轻信），认为什么都能做到。你会贸然做危险的事。",
    ],
    guidance: "你不接受任何否定的意见。所有阻止你的尝试不被你理解。",
    residual: "狂躁消退后你会极度疲惫——下个长休前所有体力行动获得 1 个惩罚骰。",
    outcomeFn: (v: string) => `狂躁——${v}`,
  },
];

/**
 * 从分层表中随机选一条疯狂表现，返回丰富的 BoutResult
 */
function rollBoutOfMadness(): BoutResult {
  const layer = BOUT_MATRIX[Math.floor(Math.random() * BOUT_MATRIX.length)];
  const variant = layer.variants[Math.floor(Math.random() * layer.variants.length)];
  return {
    type: layer.label,
    symptom: variant,
    guidance: layer.guidance,
    residual: layer.residual,
    outcome: layer.outcomeFn(variant),
  };
}

// ============================================================
// 不定疯狂系统（三级 + 梦魇 + 不可逆改变）
// ============================================================

/** 三级不定疯狂定义 */
const INDEFINITE_LEVEL_DEFS: Record<string, {
  label: string;
  recoveryRate: number;
  nightmareChance: number;
  actionPenalty: string;
  socialPenalty: string;
  therapyDC: string;
}> = {
  mild: {
    label: "轻度不定疯狂",
    recoveryRate: 1,
    nightmareChance: 0.3,
    actionPenalty: "压力场景下有 30% 概率出现犹豫或回避行为。推进类行动获得 1 个惩罚骰。",
    socialPenalty: "你有时显得心不在焉。第一次社交检定获得惩罚骰。",
    therapyDC: "常规",
  },
  moderate: {
    label: "中度不定疯狂",
    recoveryRate: 1,
    nightmareChance: 0.5,
    actionPenalty: "所有压力场景下的行动获得 1 个惩罚骰。战斗时每三轮有 30% 概率被恐惧症状干扰。",
    socialPenalty: "你的异常行为明显可见。所有社交检定获得惩罚骰。你偶尔自言自语或做出奇怪手势。",
    therapyDC: "困难",
  },
  severe: {
    label: "重度不定疯狂",
    recoveryRate: 0,
    nightmareChance: 0.7,
    actionPenalty: "所有行动获得 1 个惩罚骰。战斗时有 50% 概率在第一轮无法行动。你无法正常参与复杂的策略讨论。",
    socialPenalty: "你的言行已经严重偏离正常。社交检定自动失败（极难成功除外）。你可能会无意中冒犯或惊吓到 NPC。",
    therapyDC: "极难",
  },
};

/** 梦魇结果表 */
const NIGHTMARE_TABLE: Array<{
  id: string;
  description: string;
  effect: string;
  sanLoss: string;
}> = [
  { id: "replay", description: "你反复梦见 SAN 损失的瞬间——那个神话生物的脸在你的梦中一遍遍放大。", effect: "再次面对恐惧", sanLoss: "0/1" },
  { id: "void", description: "你梦见自己坠入无尽的黑色虚空。没有声音、没有光、没有重量。只有永恒的坠落。", effect: "失眠", sanLoss: "0/1" },
  { id: "pursuit", description: "有什么东西在追你。你在窄巷和密室里狂奔，身后传来湿黏的脚步声。", effect: "惊厥醒来", sanLoss: "1/1d2" },
  { id: "transformation", description: "你看着自己的身体慢慢变成某种非人的形态——鳞片、触手、复眼。你无法叫出声。", effect: "身份恐惧", sanLoss: "0/1d3" },
  { id: "betrayal", description: "你的同伴在梦中变成了怪物。他们对你露出诡异的笑容，手中握着你的内脏。", effect: "信任崩塌", sanLoss: "1/1d3" },
  { id: "monolith", description: "你站在一座巨大的黑色方尖碑前。碑面上刻满不是你认识的文字，但你能读懂——每一行都在描述你的死亡。", effect: "不可名状之惧", sanLoss: "1/1d4" },
  { id: "whispers", description: "无数声音在你脑中低语。你听不清它们说什么，但你能感受到它们的恶意——它们知道你最深处的恐惧。", effect: "精神污染", sanLoss: "1/1d4" },
  { id: "entropy", description: "你的梦境中一切都正在腐烂。墙壁长满霉斑，天花板滴下血水。你自己也在腐烂——你能看见自己的骨头。", effect: "存在危机", sanLoss: "1d2/1d6" },
];

/** 不可逆改变表 */
const IRREVERSIBLE_CHANGE_TABLE: Array<{
  id: string;
  name: string;
  description: string;
  effect: string;
  trigger: string;
}> = [
  { id: "tinnitus", name: "永恒低语", description: "你的耳中永远有微弱的低语声。有时像风，有时像远方的合唱。", effect: "在完全安静的环境中无法专注（侦查/聆听获得惩罚骰）。", trigger: "重度不定疯狂恢复时" },
  { id: "mark", name: "神话标记", description: "你的瞳孔或皮肤出现了无法解释的变化。在普通人的眼中，你看起来「不太对劲」。", effect: "社交检定永久获得惩罚骰。在神话生物眼中你变得「可见」。", trigger: "重度不定疯狂恢复时" },
  { id: "detachment", name: "情感剥离", description: "你不再能感受到强烈的情感。喜悦、悲伤、恐惧——它们都像是隔着一层厚玻璃。", effect: "你不再获得 SAN 恢复的团队/情感奖励。恐惧症对你效果减半。", trigger: "两次重度不定疯狂恢复时" },
  { id: "fragment", name: "记忆碎片化", description: "你的长期记忆开始瓦解。你记不清过去的事情——时间和顺序对你失去了意义。", effect: "所有回忆类的知识检定获得惩罚骰。你无法准确回忆事发经过。", trigger: "累计 SAN 损失 ≥ 80% maxSAN" },
  { id: "connection", name: "灵界连接", description: "你开始能看见不该看见的东西——游魂、未成形的恐惧、时间裂缝中的残影。", effect: "你自动感知附近的神话存在，但看到幻象时需要 SAN 检定（0/1）。", trigger: "三次不定疯狂累积后" },
  { id: "hollow", name: "内心空洞", description: "你的某一部分已经不在了。你照镜子时感觉自己看到的不是自己。", effect: "maxSAN 永久减少 1d10。你不再畏惧死亡——因为你不确定自己是不是还活着。", trigger: "不定疯狂 + SAN 归零经历" },
];

// ============================================================
// 恐惧症/狂躁症表
// ============================================================

const PHOBIA_LIST: string[] = [
  "黑暗恐惧症", "人群恐惧症", "幽闭恐惧症", "高空恐惧症",
  "尸体恐惧症", "血液恐惧症", "昆虫恐惧症", "爬行动物恐惧症",
  "空旷恐惧症", "深海恐惧症", "雷雨恐惧症", "神明恐惧症",
];

const MANIA_LIST: string[] = [
  "洁癖狂", "囤积狂", "偷窃狂", "纵火狂",
  "撒谎狂", "赌博狂", "自残狂", "恋物狂",
];

export class SanityEngine {
  state: SanityState;

  constructor(pow: number = 50) {
    this.state = {
      currentSAN: pow,
      maxSAN: pow,
      temporaryInsanity: false,
      indefiniteInsanity: false,
      indefiniteLevel: null,
      phobias: [],
      manias: [],
      sanLostThisRound: 0,
      nightmareStreak: 0,
      irreversibleChanges: [],
      therapyProgress: 0,
      daysInstitutionalized: 0,
      cthulhuMythos: 0,
      mythosLog: [],
    };
  }

  /**
   * SAN 检定
   * @param sanCost 看到神话生物的标准 SAN 损失，格式 "1/1d6" 或 "0/1d3"
   * @returns SAN 检定结果
   */
  sanityCheck(sanCost: string): SanityCheckResult {
    const [passCost, failCost] = sanCost.split("/");
    const failSanLoss = SanityEngine.parseSanCost(failCost);
    const passSanLoss = SanityEngine.parseSanCost(passCost);

    const roll = regularD100();
    const passed = roll <= this.state.currentSAN;

    let sanLoss: number;
    if (passed) {
      sanLoss = passSanLoss;
    } else {
      sanLoss = failSanLoss;
    }

    // 如果 SAN 降为 0 → 最大损失
    if (sanLoss > this.state.currentSAN) {
      sanLoss = this.state.currentSAN;
    }

    this.state.currentSAN -= sanLoss;
    this.state.sanLostThisRound += sanLoss;

    // 临时疯狂触发条件：单次损失 ≥ 5
    let temporaryInsanityTriggered = false;
    let boutOfMadness: string | null = null;
    let boutResult: BoutResult | null = null;

    if (sanLoss >= 5 && !this.state.temporaryInsanity) {
      temporaryInsanityTriggered = true;
      this.state.temporaryInsanity = true;
      boutResult = rollBoutOfMadness();
      boutOfMadness = boutResult.outcome;

      // 可能获得恐惧症或狂躁症
      if (Math.random() < 0.3) {
        const phobia = PHOBIA_LIST[Math.floor(Math.random() * PHOBIA_LIST.length)];
        this.state.phobias.push(phobia);
      }
      if (Math.random() < 0.1) {
        const mania = MANIA_LIST[Math.floor(Math.random() * MANIA_LIST.length)];
        this.state.manias.push(mania);
      }
    }

    // 永久疯狂：累计损失 ≥ 20% maxSAN → 分三级
    let indefiniteInsanityTriggered = false;
    let indefiniteLevel: IndefiniteLevel = null;
    const totalLoss = this.state.maxSAN - this.state.currentSAN;
    const lossRatio = totalLoss / this.state.maxSAN;
    if (lossRatio >= 0.2 && !this.state.indefiniteInsanity) {
      indefiniteInsanityTriggered = true;
      this.state.indefiniteInsanity = true;

      // 定级
      if (lossRatio >= 0.6) {
        this.state.indefiniteLevel = "severe";
      } else if (lossRatio >= 0.4) {
        this.state.indefiniteLevel = "moderate";
      } else {
        this.state.indefiniteLevel = "mild";
      }
      indefiniteLevel = this.state.indefiniteLevel;

      // 不定疯狂触发时必定获得 1 恐惧症 + 概率狂躁症
      const newPhob = PHOBIA_LIST[Math.floor(Math.random() * PHOBIA_LIST.length)];
      this.state.phobias.push(newPhob);
      if (Math.random() < 0.5) {
        const newMan = MANIA_LIST[Math.floor(Math.random() * MANIA_LIST.length)];
        this.state.manias.push(newMan);
      }
    }

    return {
      sanLoss,
      roll,
      passed,
      temporaryInsanityTriggered,
      indefiniteInsanityTriggered,
      indefiniteLevel,
      boutOfMadness,
      newPhobia: temporaryInsanityTriggered || indefiniteInsanityTriggered
        ? this.state.phobias[this.state.phobias.length - 1]
        : undefined,
      newMania: (temporaryInsanityTriggered || indefiniteInsanityTriggered) && this.state.manias.length > 0
        ? this.state.manias[this.state.manias.length - 1]
        : undefined,
    };
  }

  /** 解析 SAN 损失字符串：1d6 → 1-6, 1d3 → 1-3, 1d20 → 1-20 */
  static parseSanCost(cost: string): number {
    const match = cost.trim().match(/(\d+)d(\d+)/);
    if (!match) return parseInt(cost) || 0;

    let total = 0;
    const count = parseInt(match[1]);
    const sides = parseInt(match[2]);
    for (let i = 0; i < count; i++) {
      total += Math.floor(Math.random() * sides) + 1;
    }
    return total;
  }

  /** SAN 恢复（击败神话生物、完成场景、心理治疗） */
  recoverSan(amount: number) {
    this.state.currentSAN = Math.min(this.state.maxSAN, this.state.currentSAN + amount);
  }

  /** 每日重置 SAN 累计 */
  resetDaily() {
    this.state.sanLostThisRound = 0;
    // 临时疯狂取消（一天后）
    this.state.temporaryInsanity = false;
  }

  /**
   * 长休处理 — 每场景/每天结束时调用
   * 返回 { nightmare, sanRecovered, therapyProgressed, message }
   */
  handleLongRest(): { nightmare: boolean; sanRecovered: number; message: string } {
    const result = { nightmare: false, sanRecovered: 0, message: "" };
    const msgs: string[] = [];

    // 1. 梦魇检查
    const nightmareOut = this.rollNightmare();
    if (nightmareOut) {
      result.nightmare = true;
      msgs.push(nightmareOut.description + ` [SAN -${nightmareOut.sanLoss}]`);
    }

    // 2. 不定疯狂自然恢复
    if (this.state.indefiniteInsanity && this.state.indefiniteLevel) {
      const def = INDEFINITE_LEVEL_DEFS[this.state.indefiniteLevel];
      if (def && def.recoveryRate > 0 && this.state.currentSAN < this.state.maxSAN) {
        const recovery = def.recoveryRate;
        this.state.currentSAN = Math.min(this.state.maxSAN, this.state.currentSAN + recovery);
        result.sanRecovered = recovery;
        msgs.push(`自然恢复 ${recovery} SAN`);
      }
    }

    // 3. 治疗进度衰减（没做心理治疗时每周退步）
    if (this.state.therapyProgress > 0 && Math.random() < 0.2) {
      this.state.therapyProgress = Math.max(0, this.state.therapyProgress - 5);
      msgs.push("心理治疗进度因缺乏持续治疗而退步（-5%）");
    }

    result.message = msgs.join("；");
    return result;
  }

  /**
   * 学习克苏鲁神话 — 读典籍/遭遇事件时调用
   * @param tomeRating 典籍的 CM 等级 (1-20)
   * @param sourceName 来源描述
   * @returns 学习结果
   */
  learnCthulhuMythos(tomeRating: number, sourceName: string): { cmGain: number; maxSanLoss: number; newMaxSan: number } {
    const { cmGain, maxSanLoss } = calcMythosGain(tomeRating);
    this.state.cthulhuMythos = Math.min(99, this.state.cthulhuMythos + cmGain);
    this.state.maxSAN = Math.max(10, this.state.maxSAN - maxSanLoss);
    this.state.currentSAN = Math.min(this.state.currentSAN, this.state.maxSAN);
    this.state.mythosLog.push({ source: sourceName, gain: cmGain, maxSanLoss });
    return { cmGain, maxSanLoss, newMaxSan: this.state.maxSAN };
  }

  /**
   * 梦魇投骰 — 不定疯狂角色在长休时有概率做噩梦
   */
  rollNightmare(): { description: string; sanLoss: number } | null {
    if (!this.state.indefiniteInsanity) {
      this.state.nightmareStreak = 0;
      return null;
    }
    const level = this.state.indefiniteLevel || "mild";
    const def = INDEFINITE_LEVEL_DEFS[level];
    if (!def || Math.random() >= def.nightmareChance) {
      this.state.nightmareStreak = Math.max(0, this.state.nightmareStreak - 1);
      return null;
    }

    const pick = NIGHTMARE_TABLE[Math.floor(Math.random() * NIGHTMARE_TABLE.length)];
    const sanLoss = SanityEngine.parseSanCost(pick.sanLoss.split("/").pop() || "1");
    this.state.currentSAN = Math.max(0, this.state.currentSAN - sanLoss);
    this.state.nightmareStreak++;

    // 连续 7 天噩梦 → 触发不可逆改变
    if (this.state.nightmareStreak >= 7) {
      this.triggerIrreversibleChange("连续七日噩梦侵蚀");
    }

    return { description: pick.description, sanLoss };
  }

  /**
   * 心理治疗检定 — 心理学 / 精神医学成功时可以恢复 SAN 并推进治疗进度
   * @param rollValue 心理学检定的投骰值
   * @param skillValue 心理学技能值
   * @returns 治疗结果
   */
  therapyCheck(rollValue: number, skillValue: number): {
    success: boolean;
    sanRecovered: number;
    progressGained: number;
    levelReduced: boolean;
    message: string;
  } {
    const result = {
      success: false,
      sanRecovered: 0,
      progressGained: 0,
      levelReduced: false,
      message: "",
    };

    const passed = rollValue <= skillValue;
    if (!passed) {
      result.message = "心理治疗未产生效果。";
      return result;
    }

    result.success = true;
    // 这里原先取了 indefiniteLevel 和它对应的 DEF 表项，两个都没被读过。
    // 治疗效果目前不区分疯狂等级 —— 要区分得真的把它用起来。

    // 基础 SAN 恢复
    const sanRecovery = 1 + Math.floor(Math.random() * 3); // 1d3
    this.recoverSan(sanRecovery);
    result.sanRecovered = sanRecovery;

    // 治疗进度推进
    const progress = 15 + Math.floor(Math.random() * 16); // 15-30
    this.state.therapyProgress = Math.min(100, this.state.therapyProgress + progress);
    result.progressGained = progress;

    // 进度达到 100 → 降级
    if (this.state.therapyProgress >= 100) {
      this.state.therapyProgress = 0;
      if (this.state.indefiniteLevel === "severe") {
        this.state.indefiniteLevel = "moderate";
        result.levelReduced = true;
        result.message = `治疗取得重大突破！不定疯狂从重度降至中度。`;
      } else if (this.state.indefiniteLevel === "moderate") {
        this.state.indefiniteLevel = "mild";
        result.levelReduced = true;
        result.message = `治疗取得进展！不定疯狂从中度降至轻度。`;
      } else if (this.state.indefiniteLevel === "mild") {
        this.state.indefiniteInsanity = false;
        this.state.indefiniteLevel = null;
        result.levelReduced = true;
        result.message = `恭喜！你从不定疯狂中康复了。`;
      }
    } else {
      result.message = `心理治疗有效。SAN +${sanRecovery}，治疗进度 +${progress}%。`;
    }

    return result;
  }

  /**
   * 入院处理 — SAN 归零时触发
   * @returns 入院消息
   */
  institutionalize(): string {
    this.state.currentSAN = 0;
    this.state.daysInstitutionalized += 1;
    this.state.indefiniteInsanity = true;
    if (!this.state.indefiniteLevel) {
      this.state.indefiniteLevel = "severe";
    }
    this.state.therapyProgress = 0;

    // 入院期间每天恢复 1 SAN，但 maxSAN 永久减少
    const permanentLoss = Math.floor(Math.random() * 6) + 1; // 1d6
    this.state.maxSAN = Math.max(10, this.state.maxSAN - permanentLoss);

    const msgs = [
      "你的精神彻底崩溃了。你被送入了精神病院。",
      `maxSAN 永久减少 ${permanentLoss} 点（剩余 ${this.state.maxSAN}）。`,
      "住院期间你每天恢复 1 SAN，但无法参与冒险。",
      "你至少需要住院 1d4+1 天才能基本恢复意识。",
      `\n【不可逆改变触发】${this.triggerIrreversibleChange("SAN归零入院")}`,
    ];
    return msgs.join("\n");
  }

  /**
   * 触发不可逆改变
   * @param reason 触发原因
   * @returns 改变描述
   */
  triggerIrreversibleChange(reason: string): string {
    const existingIds = new Set(this.state.irreversibleChanges.map(c => {
      const match = c.match(/^【(.+?)】/);
      return match ? match[1] : "";
    }));

    const available = IRREVERSIBLE_CHANGE_TABLE.filter(c => !existingIds.has(c.name));
    if (available.length === 0) return "你已经经历了所有可能的不可逆改变。";

    const pick = available[Math.floor(Math.random() * available.length)];
    const entry = `【${pick.name}】${pick.description}（${pick.effect} 触发：${reason}）`;
    this.state.irreversibleChanges.push(entry);
    return entry;
  }

  /** 获取当前 SAN 状态摘要 */
  getSummary(): string {
    const levelLabel = this.state.indefiniteLevel ? INDEFINITE_LEVEL_DEFS[this.state.indefiniteLevel]?.label ?? "" : "";
    return [
      `SAN: ${this.state.currentSAN}/${this.state.maxSAN}`,
      this.state.cthulhuMythos > 0 ? ` CM:${this.state.cthulhuMythos}%` : "",
      this.state.temporaryInsanity ? " [临时疯狂]" : "",
      this.state.indefiniteInsanity && levelLabel ? ` [${levelLabel}]` : "",
      this.state.phobias.length > 0 ? ` 恐惧症: ${this.state.phobias.join(", ")}` : "",
      this.state.manias.length > 0 ? ` 狂躁症: ${this.state.manias.join(", ")}` : "",
    ].filter(Boolean).join("");
  }

  /** 获取临时疯狂的 RP 指引 */
  getTemporaryGuidance(boutText: string | null): string {
    if (!boutText) return "";
    for (const [symptom, guidance] of Object.entries(INSANITY_GUIDANCE)) {
      if (boutText.includes(symptom) || symptom.includes(boutText.slice(0, 4))) {
        return guidance;
      }
    }
    return "你处于临时疯狂状态。KP 将决定你的行为。";
  }

  /** 获取不定疯狂的 RP 指引（等级感知版） */
  getIndefiniteGuidance(): string {
    if (!this.state.indefiniteInsanity) return "";
    const level = this.state.indefiniteLevel || "mild";
    const def = INDEFINITE_LEVEL_DEFS[level];
    if (!def) return "你的精神遭受了不可逆的创伤。";
    const lines: string[] = [
      `【${def.label}】`,
      `累计损失 ${this.state.maxSAN - this.state.currentSAN}/${this.state.maxSAN} SAN`,
      ``,
      `行动惩罚：${def.actionPenalty}`,
      `社交惩罚：${def.socialPenalty}`,
    ];
    if (this.state.nightmareStreak > 0) {
      lines.push(`\n连续噩梦：第 ${this.state.nightmareStreak} 天`);
    }
    if (this.state.therapyProgress > 0) {
      lines.push(`心理治疗进度：${this.state.therapyProgress}/100`);
    }
    return lines.join("\n");
  }

  /** 不定疯狂等级对应的行动惩罚摘要（供 game-session 使用） */
  getIndefiniteActionPenalty(): string {
    if (!this.state.indefiniteLevel) return "";
    const def = INDEFINITE_LEVEL_DEFS[this.state.indefiniteLevel];
    return def ? `${def.label}: ${def.actionPenalty}` : "";
  }

  /** 获取恐惧症对行动的限制 */
  getPhobiaGuidance(): string {
    if (this.state.phobias.length === 0) return "";
    return this.state.phobias.map(p => {
      const guide = PHOBIA_GUIDANCE[p];
      return `【${p}】${guide || "面对此事物时，你需要进行意志检定才能行动。"}`;
    }).join("\n");
  }

  /** 获取指定狂躁症的 RP 指引 */
  getManiaGuidance(mania: string): string {
    return MANIA_GUIDANCE[mania] || "";
  }

  /** 获取完整的疯狂指引文本 */
  getFullGuidance(): string {
    const lines: string[] = [];
    if (this.state.temporaryInsanity) {
      lines.push("【临时疯狂】你的行为由疯狂症状支配。输入「状态」查看当前症状。");
    }
    if (this.state.indefiniteInsanity) {
      lines.push(this.getIndefiniteGuidance());
    }
    if (this.state.phobias.length > 0) {
      lines.push("【恐惧症】" + this.getPhobiaGuidance());
    }
    if (this.state.manias.length > 0) {
      const maniaLines = this.state.manias.map(m => {
        const mg = this.getManiaGuidance(m);
        return `【${m}】${mg || "守密人将为你设定具体的 RP 约束。"}`;
      });
      lines.push("【狂躁症】\n" + maniaLines.join("\n"));
    }
    if (this.state.cthulhuMythos > 0) {
      lines.push(`【克苏鲁神话技能】${this.state.cthulhuMythos}% — 你已窥见宇宙真相的一角。maxSAN 已永久减少相当于 CM 值的 ${this.state.cthulhuMythos}%。`);
    }
    if (this.state.irreversibleChanges.length > 0) {
      lines.push("【不可逆改变】\n" + this.state.irreversibleChanges.join("\n"));
    }
    if (this.state.daysInstitutionalized > 0) {
      lines.push(`【入院】已住院 ${this.state.daysInstitutionalized} 天。`);
    }
    if (lines.length === 0) {
      lines.push("你的神智目前清醒。");
    }
    return lines.join("\n\n");
  }

  /** 检查一个行动是否与当前恐惧症冲突 */
  checkPhobiaConflict(action: string): { conflicts: boolean; penalty: string } {
    for (const phobia of this.state.phobias) {
      const keyword = phobia.replace("恐惧症", "");
      if (keyword.length > 0 && action.includes(keyword)) {
        return { conflicts: true, penalty: "意志检定(极难)" };
      }
      // 特化边缘匹配
      if (phobia === "黑暗恐惧症" && (action.includes("暗") || action.includes("熄灯") || action.includes("无光"))) return { conflicts: true, penalty: "意志检定(极难)" };
      if (phobia === "高空恐惧症" && (action.includes("爬") || action.includes("崖") || action.includes("顶"))) return { conflicts: true, penalty: "意志检定(极难)" };
      if (phobia === "幽闭恐惧症" && (action.includes("钻") || action.includes("洞") || action.includes("箱") || action.includes("井") || action.includes("缝"))) return { conflicts: true, penalty: "意志检定(极难)" };
      if (phobia === "尸体恐惧症" && (action.includes("翻尸") || action.includes("检查尸体") || action.includes("走近死人") || action.includes("挖坟") || action.includes("开棺"))) return { conflicts: true, penalty: "敏捷检定(惩罚)" };
      if (phobia === "血液恐惧症" && (action.includes("血") || action.includes("医疗") || action.includes("伤口") || action.includes("绷带"))) return { conflicts: true, penalty: "意志检定(惩罚)" };
      if (phobia === "昆虫恐惧症" && (action.includes("虫") || action.includes("蚁") || action.includes("蜘蛛") || action.includes("巢"))) return { conflicts: true, penalty: "意志检定(惩罚)" };
    }
    return { conflicts: false, penalty: "" };
  }
}

// ============================================================
// 疯狂 RP 指引表
// ============================================================

const INSANITY_GUIDANCE: Record<string, string> = {
  "失忆": "你无法回忆起过去几分钟发生的事。你不知道自己在哪里、怎么来的。不要使用任何超过「刚才」时间跨度的信息。",
  "被偷窃": "你坚信有东西被偷了。反复检查随身物品，对接近你的任何人产生怀疑。任何触碰都被视为偷窃企图。",
  "肢体疼痛": "你感到剧烈的幻肢痛或身体某处剧痛。你会蜷缩、呻吟、无法专注于需要精细操作的事情。所有涉及 DEX 的行动获得一个惩罚骰。",
  "暴力倾向": "你攻击最近的目标，不分敌我。战斗时你无法区分队友和敌人。你的眼中只有威胁。",
  "极度偏执": "你坚信所有人都在针对你。NPC 的善意会被解读为阴谋。你不会接受任何帮助，认为那是陷阱。",
  "昏厥": "你当场晕倒。在接下来 1d10 回合内你失去知觉，无法行动。醒来后你对此段时间毫无记忆。",
  "逃跑": "你不顾一切朝任意方向狂奔。你会远离当前场景，忽略所有障碍和危险。追逐规则自动启动。",
  "歇斯底里": "你无法控制地大笑、哭泣或尖叫。你发出的声音会引来不必要的注意。潜行和说服自动失败。",
  "恐惧症": "你对眼前的事物产生极端恐惧。你会试图远离它，拒绝靠近或接触。任何要求你接近这个事物的行动都需要通过意志检定。",
  "僵直": "你全身无法动弹。你眼睁睁看着眼前的一切发生，却无法做出任何反应。这状态持续 1d6 回合。",
};

const PHOBIA_GUIDANCE: Record<string, string> = {
  "黑暗恐惧症": "在黑暗或昏暗环境中需要意志检定才能行动，施法 / 远程 / 精密操作行为获得 1 个惩罚骰。",
  "人群恐惧症": "身处 3 人以上聚集时感到窒息和眩晕，社交与敏捷相关行动获得惩罚骰。",
  "幽闭恐惧症": "进入狭窄、封闭的空间（洞穴、密道、棺材、小型房室）前需要进行意志检定，否则无法进入或进入后恐慌 1 回合。",
  "高空恐惧症": "处于 3 米以上的高度时头晕，灵活行动获得惩罚骰。强迫登高需要意志检定。",
  "尸体恐惧症": "看到尸体时恶心反胃。接近或触碰尸体需要进行意志检定，否则恐慌。",
  "血液恐惧症": "看到流出的血液时眩晕。医学、急救、战斗行动在见到鲜血时获得惩罚骰。",
  "昆虫恐惧症": "遭遇昆虫时尖叫后退，昆虫存在区域中侦查和潜行获得一个惩罚骰。",
  "爬行动物恐惧症": "遇到爬行动物（蛇、蜥蜴、龟等）时僵住一秒，对抗该类生物时获得战斗惩罚骰。",
  "空旷恐惧症": "进入大型开阔空间（球场、广场、海面）时产生失去庇护的焦虑，集中力下降。在视野超过 100 米的开阔场景中，感知类检定获得一个惩罚骰。",
  "深海恐惧症": "看到不可穿透的水面或海洋时感到本能恐惧。面对大片水域、进入水下、搭乘船只时需要进行意志检定，每次检定失败积累不定疯狂进度 5%。",
  "雷雨恐惧症": "听到雷声或看到闪电时惊恐，户外时攻击检定获得惩罚骰，还会下意识寻找封闭的地方躲避。雷雨期间无法正常休息或专注。",
  "神明恐惧症": "面对明显的神话物品、仪式、活祭、神祇名讳或任何超物理威压时都有 30% 的几率僵住一轮。在与神话神祇相关的地城或事件中，你的 SAN 损失 +1。",
};

const MANIA_GUIDANCE: Record<string, string> = {
  "洁癖狂": "你无法忍受污渍、灰尘、无序排列。每进入一个新场景，你必须花至少 1 回合进行清理/整理。在污秽场景中受到 1 个感知惩罚骰。",
  "囤积狂": "你无法丢弃任何物品，总认为会有用得上的机会。你的负重上限减半。拒绝放弃任何物品，即使是空的容器或无用的残片。",
  "偷窃狂": "看到心仪的东西就想据为己有。每次进入有物品的场景，你需要意志检定，失败则偷取一件小物件。",
  "纵火狂": "你对火有无法抗拒的着迷。看到火源或引火物时无法移开视线，在适合放火的环境中需要意志检定。升级：你开始携带点火工具。",
  "撒谎狂": "你说真话会感到不适。与 NPC 交涉时你倾向添加不必要的谎言。你的话中有一半是假的，守密人在你发出信息时可能会插入部分错误内容。",
  "赌博狂": "你无法拒绝赌博/几率游戏。遇到概率事件时你总想押一把。在商店或酒馆等场所中三次之内有一次会试图打赌。",
  "自残狂": "疼痛让你觉得更真实。压力大或困惑时你会下意识抓挠或抠伤自己。在经历恐慌或愤怒后(如被恐吓或目睹朋友受伤)你会进行一次自残(1 点伤害)。",
  "恋物狂": "你会对特定不寻常的物品或身体状况产生强烈的迷恋。角色会开始收集这种物品或对特定的生理状态产生浓厚的兴趣（依守密人设定物而定），并可能为此做出不合理的行为。",
};

// ============================================================
// CoC 7e 伤害加深 (DB) / Build
// ============================================================

/** STR+SIZ 合并值区间 → 伤害加深 */
const DB_TABLE: Array<{ min: number; max: number; db: string; build: number }> = [
  // CoC 7e 标准 DB/Build 表（基于百分值 STR+SIZ）
  { min: 2,   max: 64,  db: "-2",   build: -2 },
  { min: 65,  max: 84,  db: "-1",   build: -1 },
  { min: 85,  max: 124, db: "0",    build: 0  },
  { min: 125, max: 164, db: "+1d4", build: 0  },
  { min: 165, max: 204, db: "+1d6", build: 1  },
  // 超常延伸（神话生物/ Pulp）
  { min: 205, max: 224, db: "+1d4+1d6", build: 1 },
  { min: 225, max: 244, db: "+2d6",      build: 2 },
  { min: 245, max: 264, db: "+1d4+2d6",  build: 2 },
  { min: 265, max: 284, db: "+3d6",      build: 3 },
  { min: 285, max: 304, db: "+1d4+3d6",  build: 3 },
  { min: 305, max: 324, db: "+4d6",      build: 4 },
  { min: 325, max: 344, db: "+1d4+4d6",  build: 4 },
  { min: 345, max: 364, db: "+5d6",      build: 5 },
  { min: 365, max: 384, db: "+1d4+5d6",  build: 5 },
  { min: 385, max: 404, db: "+6d6",      build: 6 },
  { min: 405, max: 424, db: "+1d4+6d6",  build: 6 },
  { min: 425, max: 444, db: "+7d6",      build: 7 },
  { min: 445, max: 464, db: "+1d4+7d6",  build: 7 },
  { min: 465, max: 484, db: "+8d6",      build: 8 },
];

export function calcDamageBonus(str: number, siz: number): { db: string; build: number } {
  const total = str + siz;
  for (const row of DB_TABLE) {
    if (total >= row.min && total <= row.max) return { db: row.db, build: row.build };
  }
  if (total < 2)  return { db: "-1d6", build: -2 };
  return { db: "+8d6", build: 8 };
}

function rollDamageBonus(db: string): number {
  // 骰子格式: +1d4, -1d6
  const diceMatch = db.match(/^([+-])(\d+)d(\d+)$/);
  if (diceMatch) {
    const sign = diceMatch[1] === "+" ? 1 : -1;
    const count = parseInt(diceMatch[2]);
    const sides = parseInt(diceMatch[3]);
    let total = 0;
    for (let i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
    return sign * total;
  }
  // 固定值: -1, 0, +2
  const flatMatch = db.match(/^([+-])?(\d+)$/);
  if (flatMatch) {
    const sign = flatMatch[1] === "-" ? -1 : 1;
    return sign * parseInt(flatMatch[2]);
  }
  return 0;
}

/**
 * 伤害加值最大可能值（用于贯穿/暴击时取满伤）
 * 支持格式："+1d4"→4, "-1d6"→-6, "-2"→-2, "0"→0
 * 复合格式如 "+1d4+1d6"→10
 */
function maxDamageBonus(db: string): number {
  // 复合格式：用全局匹配分段
  const parts = db.match(/[+-]?\d+d\d+|[+-]?\d+/g);
  if (!parts) return 0;
  let total = 0;
  for (const part of parts) {
    const dice = part.match(/^([+-]?)(\d*)d(\d+)$/);
    if (dice) {
      const sign = dice[1] === "-" ? -1 : 1;
      const count = parseInt(dice[2] || "1");
      const sides = parseInt(dice[3]);
      total += sign * count * sides;
    } else {
      total += parseInt(part);
    }
  }
  return total;
}

// ============================================================
// CoC 7e 重伤 (Major Wound)
// ============================================================

interface MajorWoundResult {
  isMajorWound: boolean;
  location: string;
  unconscious: boolean;
  bleeding: boolean;
  broken: boolean;
  description: string;
}

const HIT_LOCATIONS = ["头部", "左臂", "右臂", "躯干", "左腿", "右腿"];

export function checkMajorWound(
  damage: number,
  maxHp: number,
  currentHp: number,
  /**
   * 规则集钩子（`coc-ruleset-mod.ts`）。不给就是标准 CoC 7e。
   *
   * ⚠ 只收类型、由调用方注入：`coc-ruleset-mod` 自己 import 了本文件，
   *   反向再 import 值就成环。注册表只在组合层出现。
   */
  hooks?: { majorWoundThreshold?: (maxHP: number) => number; enableMajorWound?: boolean },
): MajorWoundResult {
  if (hooks?.enableMajorWound === false) {
    return { isMajorWound: false, location: "", unconscious: false, bleeding: false, broken: false, description: "" };
  }
  const threshold = hooks?.majorWoundThreshold?.(maxHp) ?? Math.ceil(maxHp / 2);
  const isMajor = damage >= threshold && currentHp > 0;
  if (!isMajor) return { isMajorWound: false, location: "", unconscious: false, bleeding: false, broken: false, description: "" };

  const location = HIT_LOCATIONS[Math.floor(Math.random() * HIT_LOCATIONS.length)];
  const broken = Math.random() < 0.3;
  const unconscious = Math.random() < 0.4;
  // ⚠ 原先是 `const bleeding = true` —— **重伤必定流血**。这比 CoC 7e 苛刻：
  //   RAW 里重伤（单次伤害 ≥ 最大 HP 一半）只要求掷一次 CON，失败则昏迷；
  //   **持续掉血属于「濒死」**（HP ≤ 0），每轮 1 点直到急救成功。
  //   重伤本身不带持续伤害。
  //
  //   照原样的话，12 点体力的调查员挨一次重伤（≥6）已经掉到 6 以下，
  //   还要再被流血扣三轮 —— 一次重伤等于半条命再打个对折。
  //
  //   所以只在**这一击把人打昏**时才算流血：那已经接近 RAW 的「倒下之后还在失血」。
  //   站着的人挨了重伤，掷 CON 就是全部代价。
  const bleeding = unconscious;
  const desc = `重伤——${location}受到致命打击${broken ? "，骨折" : ""}${unconscious ? "，昏迷" : ""}。${bleeding ? "正在流血，每回合失去 1 HP 直到止血。" : ""}`;
  return { isMajorWound: true, location, unconscious, bleeding, broken, description: desc };
}

// ============================================================
// CoC 7e 克苏鲁神话技能
// ============================================================

interface CthulhuMythosEntry {
  /** 来自哪本典籍/事件 */
  source: string;
  /** 增加的 CM 技能点数 */
  gain: number;
  /** 导致的 maxSAN 减少 */
  maxSanLoss: number;
}

export function calcMythosGain(tomeRating: number): { cmGain: number; maxSanLoss: number } {
  return {
    cmGain: Math.floor(Math.random() * tomeRating) + 1,
    maxSanLoss: Math.floor(Math.random() * Math.ceil(tomeRating / 2)) + 1,
  };
}

// ============================================================
// Hit Location — 命中部位 + 瞄准 + 贯穿
// ============================================================

/** CoC 7e 命中部位 */
export type HitLocation = "右腿" | "左腿" | "腹部" | "胸部" | "右臂" | "左臂" | "头部";

/** 1d20 随机命中部位 */
export function rollHitLocation(calledShot?: string): HitLocation {
  if (calledShot) {
    const valid: HitLocation[] = ["右腿", "左腿", "腹部", "胸部", "右臂", "左臂", "头部"];
    if (valid.includes(calledShot as HitLocation)) return calledShot as HitLocation;
    // 模糊匹配：武器 → 右臂，颈部 → 头部
    if (calledShot.includes("武器") || calledShot.includes("手")) return "右臂";
    if (calledShot.includes("颈") || calledShot.includes("脖")) return "头部";
    if (calledShot.includes("眼") || calledShot.includes("面")) return "头部";
  }
  const roll = Math.floor(Math.random() * 20) + 1;
  if (roll <= 3) return "右腿";
  if (roll <= 6) return "左腿";
  if (roll <= 10) return "腹部";
  if (roll <= 15) return "胸部";
  if (roll <= 17) return "右臂";
  if (roll <= 19) return "左臂";
  return "头部";
}

/** 瞄准特定部位的副手骰惩罚 */
export function getCalledShotPenalty(target: string): number {
  const t = target.includes("眼") ? "eye" :
    target.includes("头") || target.includes("颈") || target.includes("脖") ? "head" :
    target.includes("武器") ? "weapon" :
    target.includes("臂") || target.includes("肩") ? "arm" :
    target.includes("手") ? "hand" :
    target.includes("腿") || target.includes("脚") ? "leg" :
    target.includes("腹") || target.includes("腰") ? "torso" :
    "other";
  switch (t) {
    case "eye": return 3;
    case "head": return 2;
    case "hand": return 2;
    case "weapon": return 1;
    case "arm": return 1;
    case "leg": return 1;
    case "torso": return 0;
    default: return 0;
  }
}

/** 命中部位效果 */
interface HitLocationEffect {
  location: HitLocation;
  damage: number;
  isImpale: boolean;
  isCritical: boolean;
  description: string;
  secondaryEffect?: string;
}

/** 根据部位/伤害/贯穿等级生成战场效果描述 */
export function getHitLocationEffect(
  location: HitLocation,
  damage: number,
  isImpale: boolean,
  isCritical: boolean,
): HitLocationEffect {
  const base: HitLocationEffect = {
    location, damage, isImpale, isCritical,
    description: `命中${location}`,
  };

  // 贯穿/暴击的额外效果
  if (isCritical) {
    // 暴击：最大伤害 + 严重效果
    switch (location) {
      case "头部":
        base.description = `贯穿头部！目标立即昏迷（CON检定，失败即死亡）`;
        base.secondaryEffect = "即死检定";
        break;
      case "胸部":
        base.description = `贯穿胸部！目标倒地并开始大出血，每轮额外失去 1d3 HP`;
        base.secondaryEffect = "持续失血";
        break;
      case "腹部":
        base.description = `贯穿腹部！目标弯腰倒地，无法行动一轮`;
        base.secondaryEffect = "眩晕一轮";
        break;
      case "右臂":
      case "左臂":
        base.description = `贯穿手臂！目标武器脱手，手臂无法使用直到接受医疗`;
        base.secondaryEffect = "缴械 + 失能";
        break;
      case "右腿":
      case "左腿":
        base.description = `贯穿腿部！目标倒地，移动力降至 1`;
        base.secondaryEffect = "倒地 + 减速";
        break;
    }
  } else if (isImpale) {
    // 贯穿：极限成功
    switch (location) {
      case "头部":
        base.description = `贯穿头部！目标眼前一黑，暂时致盲一轮（INT检定以恢复正常）`;
        base.secondaryEffect = "致盲一轮";
        break;
      case "胸部":
        base.description = `贯穿胸部！目标遭受重创，CON检定或失去下一轮行动`;
        base.secondaryEffect = "可能失能一轮";
        break;
      case "腹部":
        base.description = `贯穿腹部！目标剧痛，所有行动 -20% 减值持续 1d3 轮`;
        base.secondaryEffect = "全行动-20%";
        break;
      case "右臂":
      case "左臂":
        base.description = `贯穿手臂！目标武器脱手`;
        base.secondaryEffect = "缴械";
        break;
      case "右腿":
      case "左腿":
        base.description = `贯穿腿部！目标倒地`;
        base.secondaryEffect = "倒地";
        break;
    }
  } else {
    // 普通命中
    switch (location) {
      case "头部":
        if (damage >= 5) {
          base.description = `命中头部！目标头晕目眩，下轮行动 -20%`;
          base.secondaryEffect = "下轮-20%";
        }
        break;
      case "胸部":
        if (damage >= 6) {
          base.description = `命中胸部！目标被击退 1 米`;
          base.secondaryEffect = "击退";
        }
        break;
      case "右臂":
      case "左臂":
        if (damage >= 4) {
          base.description = `命中手臂！目标武器险些脱手（STR 检定保持握持）`;
          base.secondaryEffect = "可能脱手";
        }
        break;
      case "右腿":
      case "左腿":
        if (damage >= 4) {
          base.description = `命中腿部！目标一瘸一拐，移动 -2 米`;
          base.secondaryEffect = "减速";
        }
        break;
    }
  }

  return base;
}


