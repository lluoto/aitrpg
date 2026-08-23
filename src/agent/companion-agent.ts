// CompanionAgent — AI 队友战斗/探索决策引擎
//
// 设计原则：
//   不硬编码动作概率。
//   从角色描述（技能+性格+装备+状态+指令模式）推导权重。
//   推导公式透明可调。
//
// 流程：
//   ┌─ 确定可用动作（装备/技能过滤）
//   ├─ 计算基础权重（技能值 → 自然倾向）
//   ├─ 应用偏置（性格×状态×行为模式）
//   ├─ 归一化 → 随机抽取
//   └─ 返回 ActionIntent

import type { WorldEntity, WorldState, ActionIntent, CompanionConfig, CombatPersonalityTraits } from "../types";

// ============================================================
// 动作定义注册表 — 每类动作独立推导
// ============================================================

interface ActionDef {
  id: string;
  label: string;
  /** 能否执行（装备/技能过滤） */
  prerequisites: (cfg: CompanionConfig, sit: Situation) => boolean;
  /** 基础权重：技能值映射到 0-100 倾向 */
  baseWeight: (cfg: CompanionConfig, sit: Situation) => number;
  /** 偏置修正列表 */
  biases: BiasRule[];
  /** 默认 method */
  method: string;
  /** 是否允许无目标（如 reposition/defend） */
  allowNoTarget?: boolean;
}

interface BiasRule {
  label: string;
  cond: (cfg: CompanionConfig, sit: Situation) => boolean;
  delta: number;
}

/** 决策用环境快照 */
export interface Situation {
  currentPosition: string;
  hpRatio: number;
  enemies: WorldEntity[];
  enemyCount: number;
  allyCount: number;
  allyLowHp: boolean;
  playerLowHp: boolean;
  enemyInMelee: boolean;
  enemyAtRanged: boolean;
  hasMeleeWeapon: boolean;
  hasRangedWeapon: boolean;
  hasMedicalSupplies: boolean;
  inventory: string[];
  isBehavior: (b: string) => boolean;
  behavior: string;
  /** 士气（0-10），影响退缩倾向 */
  morale: number;
}

// ============================================================
// 工具：提取 traits（带默认值）
// ============================================================

function t(cfg: CompanionConfig, key: keyof CombatPersonalityTraits): number {
  return cfg.traits?.[key] ?? 5;
}

// ============================================================
// 动作注册表
// ============================================================

const ACTIONS: ActionDef[] = [
  // ── 近战攻击 ──
  {
    id: "melee", label: "近战攻击",
    method: "melee",
    prerequisites: (cfg) => (cfg.skills.fight ?? cfg.skills["格斗"] ?? 0) > 0,
    baseWeight: (cfg) => (cfg.skills.fight ?? cfg.skills["格斗"] ?? 30),
    biases: [
      { label: "勇气低→畏战", cond: (cfg) => t(cfg, "courage") < 4, delta: -30 },
      { label: "攻击性高→更好斗", cond: (cfg) => t(cfg, "aggression") > 7, delta: +25 },
      { label: "残血→退缩", cond: (_, sit) => sit.hpRatio < 0.3, delta: -50 },
      { label: "士气低→无心战斗", cond: (_, sit) => sit.morale <= 3, delta: -40 },
      { label: "防御模式→少主动攻击", cond: (_, sit) => sit.isBehavior("defensive"), delta: -25 },
      { label: "支援模式→少主动攻击", cond: (_, sit) => sit.isBehavior("support"), delta: -35 },
    ],
  },
  // ── 全力攻击（+伤害 -命中） ──
  {
    id: "power_attack", label: "全力攻击",
    method: "melee",
    prerequisites: (cfg) => (cfg.skills.fight ?? 0) > 40 && t(cfg, "aggression") > 5,
    baseWeight: (cfg) => t(cfg, "aggression") * 8 + t(cfg, "cruelty") * 5,
    biases: [
      { label: "谨慎高→不冒险", cond: (cfg) => t(cfg, "caution") > 6, delta: -30 },
      { label: "残血→不全力", cond: (_, sit) => sit.hpRatio < 0.5, delta: -40 },
      { label: "士气低→不敢冒险", cond: (_, sit) => sit.morale <= 3, delta: -50 },
      { label: "防御模式→不全力", cond: (_, sit) => sit.isBehavior("defensive"), delta: -50 },
      { label: "残忍高→更倾向全力", cond: (cfg) => t(cfg, "cruelty") > 7, delta: +20 },
    ],
  },
  // ── 射击 ──
  {
    id: "ranged", label: "射击",
    method: "ranged",
    prerequisites: (cfg, sit) => sit.hasRangedWeapon && (cfg.skills.firearms ?? 0) > 0,
    baseWeight: (cfg) => (cfg.skills.firearms ?? 20),
    biases: [
      { label: "敌人在远处→优先射", cond: (_, sit) => sit.enemyAtRanged && !sit.enemyInMelee, delta: +30 },
      { label: "敌人在近战→不射", cond: (_, sit) => sit.enemyInMelee, delta: -25 },
      { label: "谨慎高→保持距离射", cond: (cfg) => t(cfg, "caution") > 6, delta: +15 },
    ],
  },
  // ── 闪避/防御 ──
  {
    id: "defend", label: "防御闪避",
    method: "melee",
    prerequisites: (cfg) => (cfg.skills.dodge ?? 0) > 0,
    baseWeight: (cfg) => (cfg.skills.dodge ?? 20),
    biases: [
      { label: "谨慎高→更倾向防御", cond: (cfg) => t(cfg, "caution") > 6, delta: +20 },
      { label: "忠诚高→保护队友时防御", cond: (cfg, sit) => t(cfg, "loyalty") > 7 && sit.allyLowHp, delta: +25 },
      { label: "残血→优先保命", cond: (_, sit) => sit.hpRatio < 0.3, delta: +35 },
      { label: "士气低→更想保命", cond: (_, sit) => sit.morale <= 3, delta: +30 },
      { label: "勇气低→优先保命", cond: (cfg) => t(cfg, "courage") < 4, delta: +20 },
      { label: "防御模式加成", cond: (_, sit) => sit.isBehavior("defensive"), delta: +30 },
    ],
    allowNoTarget: true,
  },
  // ── 急救 ──
  {
    id: "heal", label: "急救",
    method: "melee",
    prerequisites: (cfg, sit) => sit.allyLowHp && (cfg.skills.heal ?? cfg.skills["医疗"] ?? 0) > 20,
    baseWeight: (cfg) => (cfg.skills.heal ?? cfg.skills["医疗"] ?? 20) * 0.8,
    biases: [
      { label: "友善/忠诚高→更愿治疗", cond: (cfg) => t(cfg, "loyalty") > 6, delta: +25 },
      { label: "支援模式→优先治疗", cond: (_, sit) => sit.isBehavior("support"), delta: +40 },
      { label: "自己也残血→优先自救", cond: (_, sit) => sit.hpRatio < 0.3, delta: -30 },
      { label: "残忍高→不在意队友", cond: (cfg, sit) => t(cfg, "cruelty") > 7 && !sit.allyLowHp, delta: -20 },
    ],
  },
  // ── 逃跑 ──
  {
    id: "flee", label: "逃跑",
    method: "melee",
    prerequisites: () => true, // 永远可逃
    baseWeight: (cfg) => (10 - t(cfg, "courage")) * 5,
    biases: [
      { label: "残血→想逃", cond: (_, sit) => sit.hpRatio < 0.25, delta: +40 },
      { label: "士气低→萌生退意", cond: (_, sit) => sit.morale <= 3, delta: +35 },
      { label: "士气崩溃→只想逃", cond: (_, sit) => sit.morale <= 1, delta: +60 },
      { label: "敌众我寡→想逃", cond: (_, sit) => sit.enemyCount > sit.allyCount + 1 && sit.enemyCount >= 3, delta: +20 },
      { label: "勇气高→不逃", cond: (cfg) => t(cfg, "courage") > 7, delta: -30 },
      { label: "忠诚高→不扔队友", cond: (cfg, sit) => t(cfg, "loyalty") > 7 && sit.allyLowHp, delta: -25 },
      { label: "攻击模式→不逃", cond: (_, sit) => sit.isBehavior("aggressive"), delta: -30 },
    ],
  },
  // ── 走位换距 ──
  {
    id: "reposition", label: "走位换距",
    method: "melee",
    prerequisites: (cfg, sit) => {
      // 只有不在理想位置时才考虑换位
      const idealPos = sit.hasRangedWeapon ? "ranged" : "melee_range";
      return sit.currentPosition !== idealPos;
    },
    baseWeight: (cfg, sit) => {
      // 偏差越大越想换
      const idealPos = sit.hasRangedWeapon ? "ranged" : "melee_range";
      const distanceFromIdeal = sit.currentPosition === idealPos ? 0 : 30;
      return 15 + distanceFromIdeal;
    },
    biases: [
      { label: "谨慎高→常换位", cond: (cfg) => t(cfg, "caution") > 6, delta: +15 },
      { label: "有远程武器且敌近→拉开", cond: (_, sit) => sit.hasRangedWeapon && sit.enemyInMelee, delta: +30 },
      { label: "近战但敌远→冲锋", cond: (cfg, sit) => !sit.hasRangedWeapon && sit.enemyAtRanged, delta: +25 },
      { label: "防御模式→挡位", cond: (_, sit) => sit.isBehavior("defensive"), delta: +10 },
      { label: "残血→后撤", cond: (_, sit) => sit.hpRatio < 0.3, delta: +20 },
      { label: "攻击模式→压上", cond: (_, sit) => sit.isBehavior("aggressive"), delta: +10 },
    ],
    allowNoTarget: true,
  },
];

// ============================================================
// CompanionAgent
// ============================================================

export class CompanionAgent {
  readonly id: string;
  readonly config: CompanionConfig;
  readonly entityId: string;

  constructor(config: CompanionConfig, entityId: string) {
    this.id = config.id;
    this.config = config;
    this.entityId = entityId;
  }

  // ==========================================================
  // 构建 Situation 快照
  // ==========================================================

  /** 从背包 + 配置中解析有效武器 */
  private resolveWeapon(inventory: string[]): string {
    const priority = ["猎枪", "霰弹枪", "步枪", "手枪", "消防斧", "猎刀", "长剑", "短剑", "匕首", "木棍", "拳套"];
    for (const w of priority) {
      if (inventory.some(i => i.includes(w) || w.includes(i))) return w;
    }
    return this.config.weapon ?? "shortsword";
  }

  private buildSituation(entity: WorldEntity, state: WorldState, behavior: string, inventory: string[] = [], morale: number = 10): Situation {
    const enemies = Object.values(state.entities).filter(
      (e) => e.hp > 0 && !e.status.includes("dead") && e.id !== entity.id && e.id !== "player" && e.faction !== "player_ally"
    );
    const allies = Object.values(state.entities).filter(
      (e) => e.hp > 0 && (e.id === "player" || e.faction === "player_ally") && e.id !== entity.id
    );

    const hasRangedWeapon = !!(this.config.skills.firearms && this.config.weapon)
      || inventory.some(i => i.includes("枪") || i.includes("rifle") || i.includes("gun") || i.includes("弩"));
    const hasMedicalItem = (this.config.skills.heal ?? this.config.skills["医疗"] ?? 0) > 0
      || inventory.some(i => i.includes("急救包") || i.includes("医疗") || i.includes("绷带") || i.includes("医药"));

    return {
      currentPosition: entity.position ?? "melee_range",
      hpRatio: entity.hp / entity.maxHp,
      enemies,
      enemyCount: enemies.length,
      allyCount: allies.length,
      allyLowHp: allies.some((a) => a.hp < a.maxHp * 0.5),
      playerLowHp: allies.some((a) => a.id === "player" && a.hp < a.maxHp * 0.5),
      enemyInMelee: enemies.some((e) => e.position === entity.position || e.position === "melee_range"),
      enemyAtRanged: enemies.some((e) => e.position === "ranged" || e.position === "far"),
      hasMeleeWeapon: true,
      hasRangedWeapon,
      hasMedicalSupplies: hasMedicalItem,
      inventory,
      isBehavior: (b) => behavior === b,
      behavior,
      morale,
    };
  }

  // ==========================================================
  // 主决策入口
  // ==========================================================

  async decide(
    entity: WorldEntity,
    state: WorldState,
    behavior: CompanionConfig["behavior"],
    ruleset: string,
    inventory: string[] = [],
    morale: number = 10,
  ): Promise<ActionIntent | null> {
    if (entity.hp <= 0 || entity.status.includes("dead") || entity.status.includes("unconscious")) {
      return null;
    }

    const sit = this.buildSituation(entity, state, behavior, inventory, morale);

    // 先抽动作（reposition/flee 不需要敌人目标）
    const chosen = this.rollAction(sit);
    if (!chosen) return null;

    // ── 逃跑 ──
    if (chosen.id === "flee") {
      return null; // 由外部处理
    }

    // ── 走位换距 ──
    if (chosen.id === "reposition") {
      const idealPos = sit.hasRangedWeapon ? "ranged" : "melee_range";
      return {
        action: "move",
        target: idealPos,
        weapon: this.resolveWeapon(inventory),
        method: idealPos,
        skill: String(this.config.skills.fight ?? this.config.skills["格斗"] ?? 40),
      };
    }

    // 以下动作需要敌人
    if (sit.enemies.length === 0) return null;

    // 选目标
    const target = this.selectTargetImpl(entity, state, sit);
    if (!target) return null;

    // 构建攻击/治疗/防御 intent
    const intent: ActionIntent = {
      action: chosen.id === "heal" ? "first_aid" : "attack",
      target: chosen.allowNoTarget ? undefined : target.id,
      weapon: this.resolveWeapon(inventory),
      method: chosen.method,
      skill: String(this.config.skills.fight ?? this.config.skills["格斗"] ?? 40),
    };

    return intent;
  }

  // ==========================================================
  // 目标选择（公开，可被 CompanionManager 代理调用）
  // ==========================================================

  /** 公开目标选择：给定当前状态返回最佳目标 */
  selectTarget(
    entity: WorldEntity,
    state: WorldState,
    behavior: CompanionConfig["behavior"],
    inventory: string[] = [],
  ): WorldEntity | null {
    const sit = this.buildSituation(entity, state, behavior, inventory);
    return this.selectTargetImpl(entity, state, sit);
  }

  private selectTargetImpl(
    entity: WorldEntity,
    state: WorldState,
    sit: Situation,
  ): WorldEntity | null {
    const enemies = sit.enemies.filter((e) => e.position === entity.position);
    if (enemies.length === 0) return sit.enemies[0] ?? null;

    // 性格影响目标选择
    if (t(this.config, "cruelty") > 6) {
      // 残忍→追杀伤血
      return enemies.reduce((a, b) => (a.hp < b.hp ? a : b));
    }
    if (t(this.config, "caution") > 6) {
      // 谨慎→打最近
      return enemies[0];
    }
    // 默认→打最近
    return enemies[0];
  }

  // ==========================================================
  // 权重推导 + 随机抽取
  // ==========================================================

  private rollAction(sit: Situation): ActionDef | null {
    const pool: Array<{ action: ActionDef; weight: number }> = [];

    for (const action of ACTIONS) {
      if (!action.prerequisites(this.config, sit)) continue;

      let weight = action.baseWeight(this.config, sit);
      for (const bias of action.biases) {
        if (bias.cond(this.config, sit)) {
          weight += bias.delta;
        }
      }

      if (weight > 0) {
        pool.push({ action, weight });
      }
    }

    if (pool.length === 0) return null;

    const totalWeight = pool.reduce((s, p) => s + p.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const entry of pool) {
      if (roll < entry.weight) return entry.action;
      roll -= entry.weight;
    }

    return pool[pool.length - 1].action;
  }

  // ==========================================================
  // 探索感知
  // ==========================================================

  perceive(
    entity: WorldEntity,
    state: WorldState,
    behavior: CompanionConfig["behavior"],
  ): string[] {
    const findings: string[] = [];
    const skillValue = this.config.skills.spot ?? this.config.skills["侦查"] ?? 30;
    const roll = Math.floor(Math.random() * 100) + 1;
    if (roll > skillValue) return findings;

    const entities = Object.values(state.entities).filter(
      (e) => e.id !== entity.id && e.id !== "player" && !e.status.includes("dead")
    );

    // 谨慎高→看得更细→更多发现。
    //
    // 原本读的是 curiosity，但特质表里没有这个键：t() 对未知键返回默认值 5，
    // 于是 rollCount 恒为 2，这个旋钮从来没接上过。caution 是真实存在的特质，
    // 语义也对得上注释里"看得更细"的那一半，默认值同样是 5，默认行为不变。
    // 原先这里还有个 `detailBonus = caution > 6 ? 1.3 : 1`，算了从不使用。
    // 「谨慎高→看得更细」这半已经由下面的 rollCount 实现了，
    // 两个旋钮拧同一件事，其中一个还是空转的。
    const rollCount = Math.ceil(t(this.config, "caution") / 3);

    for (let i = 0; i < rollCount && i < entities.length; i++) {
      const target = entities[i];
      if (target.hp < target.maxHp * 0.3 && target.hp > 0) {
        findings.push(`${target.name} 看起来受伤严重。`);
      }
    }

    return findings;
  }

  // ==========================================================
  // 性格台词系统
  // 根据性格特质 + 场景选择合适语气
  // ==========================================================

  /** 战斗台词：攻击/命中/击杀/被击 */
  getCombatBanter(actionType: "attack" | "kill" | "hit" | "see_enemy"): string | null {
    if (Math.random() > 0.35) return null; // 65% 沉默，避免刷屏

    const courage = t(this.config, "courage");
    const aggression = t(this.config, "aggression");
    const cruelty = t(this.config, "cruelty");
    const caution = t(this.config, "caution");

    const pool = this.getBanterPool(actionType, { courage, aggression, cruelty, caution });
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private getBanterPool(actionType: string, t: Record<string, number>): string[] {
    const pool: string[] = [];

    // 勇气分档
    const brave = t.courage > 6;
    const cowardly = t.courage < 4;

    // 攻击性分档
    const aggro = t.aggression > 6;
    const passive = t.aggression < 4;

    // 残忍
    const cruel = t.cruelty > 6;

    // 谨慎
    const wary = t.caution > 6;

    switch (actionType) {
      // ⚠ `passive`（攻击性 < 4）原先算了却**没有任何分支** ——
      //   六个性格档里只有它没声音，低攻击性的同伴一律落到通用 else。
      //   是 tsc 的 noUnusedLocals 报出来的。补上它该有的那一档。
      case "see_enemy":
        if (brave && aggro) pool.push("又有猎物了。", "不堪一击的东西。", "让我来。");
        else if (cowardly) pool.push("有东西……小心。", "我们非打不可吗？");
        else if (wary) pool.push("等等，有动静。", "看清楚再动手。");
        else if (passive) pool.push("非动手不可吗？", "先别急着上。", "能绕开就绕开吧。");
        else pool.push("有敌人！", "准备好战斗！", "来了。");
        break;

      case "attack":
        if (cruel) pool.push("去死吧！", "一个都不留。", "尝尝这个！");
        else if (aggro) pool.push("看招！", "别想跑！", "哈！");
        else if (brave) pool.push("为了大家！", "我不会后退的！");
        else if (passive) pool.push("抱歉了。", "我只是不想有人受伤。", "别逼我。");
        else pool.push("呃！", "上吧！", "喝！");
        break;

      case "kill":
        if (cruel) pool.push("解决了。下一个。", "不过如此。", "哼。");
        else if (brave) pool.push("少了一个！", "干掉了！", "呼……");
        else pool.push("我干掉它了……", "它还活着吗？死了就好。");
        break;

      case "hit":
        if (brave) pool.push("小伤而已。", "不碍事。", "就这？");
        else if (cowardly) pool.push("好痛！", "我不行了……", "救命！");
        else if (wary) pool.push("得小心了……", "退后两步。", "它的攻击有规律……");
        else pool.push("呃啊！", "该死的！", "还挺疼……");
        break;
    }

    return pool;
  }

  /** 探索台词：发现线索/物品时的反馈 */
  getExplorationBanter(finding: string): string | null {
    if (Math.random() > 0.4) return null;
    const caution = t(this.config, "caution");
    const courage = t(this.config, "courage");

    if (finding.includes("受伤")) {
      return courage > 6 ? "它伤得不轻。追。" : "它受伤了……也许我们别追太紧。";
    }
    if (caution > 6) return "有东西不太对劲……";
    if (courage < 4) return "我不喜欢这里……";
    return null;
  }
}
