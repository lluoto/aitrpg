// CoC 7e 追逐系统
// 抽象追逐距离 + 障碍物表 + 射程段 + 车载追逐
// 基于 2016 CoC 7e Keeper Rulebook ch.9

import { CoCEngine, type CoCSuccessLevel } from "./coc-engine";

/**
 * 累积惩罚的下界。
 *
 * CoCEngine.skillCheck 只读 netDice 的符号来决定掷奖励骰/惩罚骰/常规骰，
 * 数值大小不影响结果——因此无下界的累积只会产生无意义的账面漂移
 * （实测 20 轮可累积到 -26，等同于 26 颗惩罚骰，而 CoC 7e 惩罚骰上限是 2）。
 * 取 -2 对齐该上限，使该字段第一次具备可解释的量纲。
 */
const MIN_CHASE_PENALTY = -2;

// ============================================================
// 类型定义
// ============================================================

/** 当前追逐距离区间 */
export type ChaseRange = "melee" | "close" | "medium" | "long" | "lost";

/** 追逐环境类型 */
export type ChaseEnvironment =
  | "urban"        // 城镇街道、小巷、屋顶
  | "rural"        // 乡村小路、田野、森林边缘
  | "wilderness"   // 深山、密林、沼泽
  | "indoor"       // 室内、走廊、大厅
  | "underground"  // 地下洞穴、隧道、下水道
  | "water";       // 水上、水下、船坞

/** 载具类型 */
export type VehicleType = "foot" | "bicycle" | "motorcycle" | "car" | "truck" | "boat";

/** 追逐参与者 */
export interface ChaseParticipant {
  name: string;
  role: "pursuer" | "fugitive";
  /** 体质值（查 CON 表） */
  con?: number;
  /** 敏捷值（查 DEX 表） */
  dex?: number;
  /** 相关技能值（运动/驾驶/骑术等） */
  skill: number;
  /** 载具类型 */
  vehicleType: VehicleType;
  /** 累积惩罚（负向调整） */
  currentPenalty: number;
  /** 是否已在追逐中失去行动能力 */
  disabled: boolean;
}

/** 障碍物定义（查表原始数据） */
export interface ChaseObstacleDef {
  name: string;
  environment: ChaseEnvironment;
  /** 默认技能，如 "CON", "DEX", "运动", "驾驶" */
  defaultSkill: string;
  /** 难度 */
  difficulty: "regular" | "hard" | "extreme";
  /** 额外奖励/惩罚骰 */
  diceModifier: number; // 正=奖励骰，负=惩罚骰
  /** 成功时距离变化（正值=远离，负值=接近） */
  successDistance: number;
  /** 失败时距离变化 */
  failureDistance: number;
  /** 成功描述 */
  successDesc: string;
  /** 失败描述 */
  failureDesc: string;
  /** 此障碍是否需要特定技能而非 CON */
  requiresSpecificSkill?: boolean;
}

/** 单轮障碍物实例 */
export interface ChaseObstacleInstance {
  def: ChaseObstacleDef;
  /** 本轮的适用技能名 */
  usedSkill: string;
}

/** 单轮结果 */
export interface ChaseRoundResult {
  round: number;
  obstacle: ChaseObstacleInstance;
  participantResults: Array<{
    name: string;
    role: "pursuer" | "fugitive";
    success: boolean;
    successLevel: CoCSuccessLevel;
    skillUsed: string;
    roll: number;
    penaltyChange: number; // 成功时可能解除部分惩罚
  }>;
  /** 追逐方平均距离变化（本回合） */
  pursuerNetChange: number;
  /** 逃亡方平均距离变化 */
  fugitiveNetChange: number;
  /** 新距离 */
  newDistance: number;
  /** 新射程段 */
  newRange: ChaseRange;
  /** 是否追上 */
  caught: boolean;
  /** 是否逃脱 */
  escaped: boolean;
  /** 叙述文本 */
  narration: string[];
}

/** 追逐状态 */
export interface ChaseState {
  active: boolean;
  distance: number;           // 抽象距离单位（0=接触，50+=脱离）
  environment: ChaseEnvironment;
  vehicleType: VehicleType;
  round: number;
  participants: ChaseParticipant[];
  /** 本追逐已使用的障碍物（避免短时间内重复） */
  usedObstacles: string[];
}

// ============================================================
// 射程段计算
// ============================================================

const RANGE_BRACKETS: Array<{ range: ChaseRange; maxDistance: number }> = [
  { range: "melee",  maxDistance: 2 },
  { range: "close",  maxDistance: 10 },
  { range: "medium", maxDistance: 25 },
  { range: "long",   maxDistance: 50 },
];

export function rangeFromDistance(distance: number): ChaseRange {
  for (const b of RANGE_BRACKETS) {
    if (distance <= b.maxDistance) return b.range;
  }
  return "lost";
}

/** 射程段对射击难度的影响（惩罚骰数量） */
export function shootingPenaltyForRange(range: ChaseRange): number {
  switch (range) {
    case "melee":  return 0;  // 近战也可以直接攻击
    case "close":  return 0;  // 近距离射击无惩罚
    case "medium": return 1;  // 中距离 1 惩罚骰
    case "long":   return 2;  // 远距离 2 惩罚骰
    case "lost":   return 99; // 超出射程无法射击
  }
}

// ============================================================
// 障碍物表（CoC 7e 规则书参考）
// ============================================================

// 加权障碍物表，每个环境的障碍物数组
// 权重越高越容易被抽到
const OBSTACLE_TABLE: Record<ChaseEnvironment, Array<{ def: ChaseObstacleDef; weight: number }>> = {

  // ── 城镇 Urban ──
  urban: [
    {
      weight: 3,
      def: {
        name: "翻越摊位", environment: "urban", defaultSkill: "DEX",
        difficulty: "regular", diceModifier: 0,
        successDistance: -2, failureDistance: 3,
        successDesc: "你手脚并用地翻过市场摊位，成功缩短了距离",
        failureDesc: "你被摊位上的货物绊倒，距离被拉开",
      },
    },
    {
      weight: 2,
      def: {
        name: "穿过人群", environment: "urban", defaultSkill: "CON",
        difficulty: "regular", diceModifier: 0,
        successDistance: -1, failureDistance: 2,
        successDesc: "你在拥挤的人潮中灵巧穿行",
        failureDesc: "你被拥挤的人群阻挡了去路",
      },
    },
    {
      weight: 2,
      def: {
        name: "跳过栅栏", environment: "urban", defaultSkill: "DEX",
        difficulty: "regular", diceModifier: 0,
        successDistance: -2, failureDistance: 3,
        successDesc: "你双手一撑轻松翻过铁栅栏",
        failureDesc: "栅栏顶端的尖刺钩住了你的衣服",
      },
    },
    {
      weight: 2,
      def: {
        name: "冲下楼梯", environment: "urban", defaultSkill: "DEX",
        difficulty: "hard", diceModifier: -1,
        successDistance: -3, failureDistance: 4,
        successDesc: "你三步并作两步冲下台阶，距离大幅缩小",
        failureDesc: "你一脚踩空差点摔倒，被迫放慢速度",
      },
    },
    {
      weight: 1,
      def: {
        name: "穿过建筑", environment: "urban", defaultSkill: "智力",
        difficulty: "hard", diceModifier: -1,
        successDistance: -4, failureDistance: 5,
        successDesc: "你抄近道穿过一栋建筑，奇迹般地出现在目标前方",
        failureDesc: "建筑是个死胡同，你不得不原路返回",
        requiresSpecificSkill: true,
      },
    },
    {
      weight: 2,
      def: {
        name: "垃圾桶障碍", environment: "urban", defaultSkill: "DEX",
        difficulty: "regular", diceModifier: 0,
        successDistance: -1, failureDistance: 2,
        successDesc: "你敏捷地绕过散落的垃圾桶",
        failureDesc: "垃圾桶被撞翻，废料洒了一地",
      },
    },
  ],

  // ── 乡村 Rural ──
  rural: [
    {
      weight: 3,
      def: {
        name: "泥泞田地", environment: "rural", defaultSkill: "CON",
        difficulty: "regular", diceModifier: -1,
        successDistance: -1, failureDistance: 2,
        successDesc: "你深一脚浅一脚地穿过泥泞田地",
        failureDesc: "你陷进泥里，费了好大劲才拔出来",
      },
    },
    {
      weight: 3,
      def: {
        name: "翻越篱笆", environment: "rural", defaultSkill: "DEX",
        difficulty: "regular", diceModifier: 0,
        successDistance: -2, failureDistance: 3,
        successDesc: "你敏捷地翻过木篱笆",
        failureDesc: "篱笆在你脚下断裂，你摔了个踉跄",
      },
    },
    {
      weight: 2,
      def: {
        name: "穿过灌木", environment: "rural", defaultSkill: "CON",
        difficulty: "regular", diceModifier: -1,
        successDistance: -1, failureDistance: 2,
        successDesc: "你忍痛拨开荆棘灌木穿行",
        failureDesc: "荆棘在你身上划出道道血痕",
      },
    },
    {
      weight: 2,
      def: {
        name: "涉水小溪", environment: "rural", defaultSkill: "CON",
        difficulty: "regular", diceModifier: 0,
        successDistance: -1, failureDistance: 2,
        successDesc: "你蹚过齐膝深的小溪",
        failureDesc: "溪底的苔藓让你滑了一跤",
      },
    },
  ],

  // ── 荒野 Wilderness ──
  wilderness: [
    {
      weight: 2,
      def: {
        name: "密林穿行", environment: "wilderness", defaultSkill: "DEX",
        difficulty: "hard", diceModifier: -1,
        successDistance: -1, failureDistance: 3,
        successDesc: "你在交错的树枝间闪转腾挪",
        failureDesc: "密集的树枝挡住了你的去路",
      },
    },
    {
      weight: 2,
      def: {
        name: "陡坡攀爬", environment: "wilderness", defaultSkill: "DEX",
        difficulty: "hard", diceModifier: -1,
        successDistance: -2, failureDistance: 4,
        successDesc: "你手脚并用地爬上陡峭的土坡",
        failureDesc: "坡面松软，你滑回了原处",
      },
    },
    {
      weight: 1,
      def: {
        name: "沼泽地带", environment: "wilderness", defaultSkill: "CON",
        difficulty: "extreme", diceModifier: -2,
        successDistance: -1, failureDistance: 5,
        successDesc: "你在泥沼中找到了相对坚实的路径",
        failureDesc: "你陷入了齐腰深的沼泽",
      },
    },
    {
      weight: 2,
      def: {
        name: "越过树根", environment: "wilderness", defaultSkill: "DEX",
        difficulty: "regular", diceModifier: 0,
        successDistance: -2, failureDistance: 2,
        successDesc: "你在盘根错节的树根上保持平衡",
        failureDesc: "你被树根绊倒",
      },
    },
    {
      weight: 2,
      def: {
        name: "跨过倒木", environment: "wilderness", defaultSkill: "DEX",
        difficulty: "regular", diceModifier: 0,
        successDistance: -1, failureDistance: 2,
        successDesc: "你跨过横在路上的倒下树干",
        failureDesc: "倒木上的苔藓让你脚下一滑",
      },
    },
  ],

  // ── 室内 Indoor ──
  indoor: [
    {
      weight: 3,
      def: {
        name: "绕过家具", environment: "indoor", defaultSkill: "DEX",
        difficulty: "regular", diceModifier: 0,
        successDistance: -1, failureDistance: 2,
        successDesc: "你在桌椅之间灵活穿梭",
        failureDesc: "你撞上了一把椅子",
      },
    },
    {
      weight: 2,
      def: {
        name: "推开房门", environment: "indoor", defaultSkill: "力量",
        difficulty: "regular", diceModifier: 0,
        successDistance: -1, failureDistance: 2,
        successDesc: "你猛地推开门冲了过去",
        failureDesc: "门被卡住了，你不得不绕道",
        requiresSpecificSkill: true,
      },
    },
    {
      weight: 2,
      def: {
        name: "穿过走廊", environment: "indoor", defaultSkill: "CON",
        difficulty: "regular", diceModifier: 0,
        successDistance: -2, failureDistance: 2,
        successDesc: "你在长长的走廊里疾奔",
        failureDesc: "光滑的地板让你差点滑倒",
      },
    },
    {
      weight: 1,
      def: {
        name: "攀爬楼梯井", environment: "indoor", defaultSkill: "DEX",
        difficulty: "hard", diceModifier: -1,
        successDistance: -4, failureDistance: 5,
        successDesc: "你抓住扶手纵身跃下楼梯井，大幅缩短距离",
        failureDesc: "你差点失足坠落，好不容易才抓住扶手",
      },
    },
  ],

  // ── 地下 Underground ──
  underground: [
    {
      weight: 3,
      def: {
        name: "狭窄通道", environment: "underground", defaultSkill: "DEX",
        difficulty: "hard", diceModifier: -1,
        successDistance: -1, failureDistance: 3,
        successDesc: "你侧身挤过狭窄的岩缝",
        failureDesc: "通道太窄，你被卡住了片刻",
      },
    },
    {
      weight: 2,
      def: {
        name: "湿滑地面", environment: "underground", defaultSkill: "DEX",
        difficulty: "regular", diceModifier: -1,
        successDistance: -1, failureDistance: 2,
        successDesc: "你在潮湿的石地上小心保持平衡",
        failureDesc: "你脚下一滑，摔在湿漉漉的地面上",
      },
    },
    {
      weight: 2,
      def: {
        name: "低矮洞顶", environment: "underground", defaultSkill: "DEX",
        difficulty: "regular", diceModifier: 0,
        successDistance: -1, failureDistance: 2,
        successDesc: "你弯腰低头在低矮的洞穴中穿行",
        failureDesc: "你一头撞上了低垂的钟乳石",
      },
    },
    {
      weight: 1,
      def: {
        name: "地下河", environment: "underground", defaultSkill: "CON",
        difficulty: "extreme", diceModifier: -2,
        successDistance: -3, failureDistance: 6,
        successDesc: "你沿着地下河岸疾行，路线出人意料地顺利",
        failureDesc: "河岸塌陷，你掉入冰冷的地下河中",
      },
    },
  ],

  // ── 水域 Water ──
  water: [
    {
      weight: 3,
      def: {
        name: "逆流游泳", environment: "water", defaultSkill: "CON",
        difficulty: "hard", diceModifier: -1,
        successDistance: -1, failureDistance: 3,
        successDesc: "你奋力逆流游进",
        failureDesc: "水流强劲，你被冲退了好一段距离",
      },
    },
    {
      weight: 2,
      def: {
        name: "水下障碍", environment: "water", defaultSkill: "CON",
        difficulty: "hard", diceModifier: -1,
        successDistance: -1, failureDistance: 3,
        successDesc: "你潜入水下避开漂浮的残骸",
        failureDesc: "你被水下的暗流卷住",
      },
    },
    {
      weight: 2,
      def: {
        name: "码头跳跃", environment: "water", defaultSkill: "DEX",
        difficulty: "regular", diceModifier: 0,
        successDistance: -2, failureDistance: 3,
        successDesc: "你在码头木桩之间灵活跳跃",
        failureDesc: "你踩空落入水中",
      },
    },
  ],
};

// ============================================================
// 载具速度修正
// ============================================================

interface VehicleSpeedMod {
  /** 基础速度（每轮自动距离变化） */
  baseSpeed: number;
  /** 驾驶相关技能名 */
  pilotSkill: string;
  /** 加速度（每成功减少的距离） */
  acceleration: number;
}

const VEHICLE_STATS: Record<VehicleType, VehicleSpeedMod> = {
  foot:        { baseSpeed: 0, pilotSkill: "CON",     acceleration: 2 },
  bicycle:     { baseSpeed: 1, pilotSkill: "骑术",    acceleration: 3 },
  motorcycle:  { baseSpeed: 2, pilotSkill: "驾驶",    acceleration: 4 },
  car:         { baseSpeed: 2, pilotSkill: "驾驶",    acceleration: 3 },
  truck:       { baseSpeed: 1, pilotSkill: "驾驶",    acceleration: 2 },
  boat:        { baseSpeed: 1, pilotSkill: "驾驶",    acceleration: 2 },
};

// ============================================================
// 核心引擎
// ============================================================

export class ChaseEngine {
  /**
   * 初始化追逐状态
   */
  static init(
    pursuers: Omit<ChaseParticipant, "role" | "currentPenalty" | "disabled">[],
    fugitives: Omit<ChaseParticipant, "role" | "currentPenalty" | "disabled">[],
    environment: ChaseEnvironment,
    startDistance: number = 15,
    vehicleType: VehicleType = "foot",
  ): ChaseState {
    return {
      active: true,
      distance: startDistance,
      environment,
      vehicleType,
      round: 0,
      participants: [
        ...pursuers.map(p => ({ ...p, role: "pursuer" as const, currentPenalty: 0, disabled: false })),
        ...fugitives.map(f => ({ ...f, role: "fugitive" as const, currentPenalty: 0, disabled: false })),
      ],
      usedObstacles: [],
    };
  }

  /**
   * 从环境中随机选择一个障碍物
   */
  static pickObstacle(state: ChaseState): ChaseObstacleInstance {
    const table = OBSTACLE_TABLE[state.environment];
    if (!table || table.length === 0) {
      // 回退：基础平地追逐
      return {
        def: {
          name: "直线冲刺",
          environment: state.environment,
          defaultSkill: "CON",
          difficulty: "regular",
          diceModifier: 0,
          successDistance: -2,
          failureDistance: 2,
          successDesc: "你在平坦的地面上全力冲刺",
          failureDesc: "你体力不支，速度慢了下来",
        },
        usedSkill: "CON",
      };
    }

    // 权重随机选择
    const totalWeight = table.reduce((sum, e) => sum + e.weight, 0);
    let roll = Math.floor(Math.random() * totalWeight);
    for (const entry of table) {
      roll -= entry.weight;
      if (roll < 0) {
        return {
          def: entry.def,
          usedSkill: entry.def.defaultSkill,
        };
      }
    }

    // 兜底
    return {
      def: table[0].def,
      usedSkill: table[0].def.defaultSkill,
    };
  }

  /**
   * 获取参与者用于本轮检定的技能值
   */
  static getSkillForRound(participant: ChaseParticipant, obstacle: ChaseObstacleInstance): number {
    const skillName = obstacle.usedSkill;
    if (skillName === "CON") return participant.con ?? participant.skill;
    if (skillName === "DEX") return participant.dex ?? participant.skill;
    return participant.skill;
  }

  /**
   * 解析一轮追逐
   */
  static resolveRound(state: ChaseState): ChaseRoundResult {
    const round = state.round + 1;
    const obstacle = this.pickObstacle(state);
    const results: ChaseRoundResult["participantResults"] = [];

    // 过滤出非 disabled 参与者
    const activeParticipants = state.participants.filter(p => !p.disabled);
    if (activeParticipants.length === 0) {
      return {
        round,
        obstacle,
        participantResults: [],
        pursuerNetChange: 0,
        fugitiveNetChange: 0,
        newDistance: state.distance,
        newRange: rangeFromDistance(state.distance),
        caught: false,
        escaped: false,
        narration: ["追逐中无人能够行动——一切陷入了停顿。"],
      };
    }

    // 每个参与者独立检定
    const vehicle = VEHICLE_STATS[state.vehicleType];
    for (const p of activeParticipants) {
      const skillValue = this.getSkillForRound(p, obstacle);
      const difficulty = obstacle.def.difficulty;
      const netDice = obstacle.def.diceModifier + p.currentPenalty;

      const check = CoCEngine.skillCheck(
        skillValue,
        difficulty,
        netDice > 0 ? netDice : 0,   // bonus dice
        netDice < 0 ? -netDice : 0,  // penalty dice
      );

      let penaltyChange = 0;
      // 极难或大失败：累积惩罚
      if (check.successLevel === "fumble") {
        penaltyChange = -2;
      } else if (!check.isSuccess && check.successLevel === "fail") {
        penaltyChange = -1;
      } else if (check.successLevel === "critical") {
        // 大成功：解除一点惩罚
        penaltyChange = Math.min(1, -p.currentPenalty);
      } else if (check.isSuccess) {
        penaltyChange = 0;
      }

      results.push({
        name: p.name,
        role: p.role,
        success: check.isSuccess,
        successLevel: check.successLevel,
        skillUsed: obstacle.usedSkill,
        roll: check.roll,
        penaltyChange,
      });
    }

    // 聚合距离变化：追逐方成功→距离减少，失败→距离增加
    // 逃亡方成功→距离增加，失败→距离减少
    const pursuerResults = results.filter(r => r.role === "pursuer");
    const fugitiveResults = results.filter(r => r.role === "fugitive");

    // 距离变化在统一坐标系中计算：负值=距离缩小（对追方有利），正值=距离增大（对逃方有利）
    // 对追逐方：成功→距离缩小（用successDistance，通常为负），失败→距离增大（用failureDistance，通常为正）
    // 对逃亡方：成功→距离增大（反向使用successDistance），失败→距离缩小（反向使用failureDistance）
    const calcNetChange = (participantResults: typeof results): number => {
      if (participantResults.length === 0) return 0;

      let total = 0;
      for (const r of participantResults) {
        const raw = r.success ? obstacle.def.successDistance : obstacle.def.failureDistance;
        // 逃亡方方向取反
        const baseChange = r.role === "fugitive" ? -raw : raw;
        // 成功等级效果：负方向=距离缩小（好）
        let levelMod = 0;
        if (r.successLevel === "critical") levelMod = -1;   // 大成功距离额外缩小
        else if (r.successLevel === "fumble") levelMod = 1; // 大失败距离额外增大
        // 逃亡方的大成功也应增大距离，方向取反
        if (r.role === "fugitive") levelMod = -levelMod;
        total += baseChange + levelMod;
      }
      return total / participantResults.length;
    };

    const pursuerNetChange = calcNetChange(pursuerResults);
    const fugitiveNetChange = calcNetChange(fugitiveResults);

    // 双方净变化叠加
    let netDistanceChange = pursuerNetChange + fugitiveNetChange;

    // 载具基础速度
    netDistanceChange += vehicle.baseSpeed;

    const newDistance = Math.max(0, Math.min(100, state.distance + netDistanceChange));
    const newRange = rangeFromDistance(newDistance);

    // 更新参与者 penalty
    for (const r of results) {
      const p = state.participants.find(pp => pp.name === r.name);
      if (p) p.currentPenalty = Math.max(MIN_CHASE_PENALTY, Math.min(0, p.currentPenalty + r.penaltyChange));
    }

    // 记录使用的障碍物
    state.usedObstacles.push(obstacle.def.name);
    state.distance = newDistance;
    state.round = round;

    // 生成叙述
    const narration = this.generateNarration(obstacle, results, netDistanceChange);

    return {
      round,
      obstacle,
      participantResults: results,
      pursuerNetChange,
      fugitiveNetChange,
      newDistance,
      newRange,
      caught: newDistance <= 0,
      escaped: newDistance >= 50,
      narration,
    };
  }

  /**
   * 生成追逐轮次的叙述文本
   */
  private static generateNarration(
    obstacle: ChaseObstacleInstance,
    results: ChaseRoundResult["participantResults"],
    netChange: number,
  ): string[] {
    const lines: string[] = [];
    lines.push(`障碍物：${obstacle.def.name}（${obstacle.usedSkill}，${obstacle.def.difficulty}难度）`);

    for (const r of results) {
      const pos = r.role === "pursuer" ? "追击方" : "逃亡方";
      const outcome = r.success ? "成功" : "失败";
      const desc = r.success ? obstacle.def.successDesc : obstacle.def.failureDesc;
      lines.push(`${pos}【${r.name}】${outcome}（${r.roll} vs ${obstacle.def.difficulty}）：${desc}`);
    }

    if (netChange < -2) lines.push(`距离急剧缩小！`);
    else if (netChange > 2) lines.push(`距离被拉开！`);
    else lines.push(`距离变化不大。`);

    return lines;
  }
}

// ============================================================
// 便利函数
// ============================================================

/**
 * 检查射程段是否允许射击/近战
 */
export function canAttackInChase(range: ChaseRange): boolean {
  return range !== "lost";
}

/**
 * 获取射击难度
 */
export function getShootingDifficulty(range: ChaseRange): "regular" | "hard" | "extreme" {
  switch (range) {
    case "melee": return "regular";
    case "close": return "regular";
    case "medium": return "hard";
    case "long": return "extreme";
    case "lost": return "extreme"; // 理论上不可射，兜底
  }
}
