// 从 play-module.ts 抽出来的一段（脚本搬运，见 tools/_extract-block.ts）。
//
// 抽出来的理由是可寻址性：原先 runModuleInner 一个函数 2615 行、占全文件 74%，
// 里面按注释能切出近 30 个块，但没有一个是能整段读进来的单元 ——
// 每次改动只能靠行号开窗口猜，窄了缺上下文、宽了浪费。
//
// ⚠ 纯搬运，不改行为。判据是全量测试与主循环脚手架全绿。

import type { ModuleData, Scene, ModuleSupport } from "../module/types";
import type { WorldState } from "../world/state";
import { CoCEngine, SUCCESS_LEVEL_LABELS } from "../rules/coc-engine";
import { say, sayMech } from "./narration";
import { sanCheck } from "./checks";
import type { Cast } from "./run-state";

/**
 * Boss 遭遇战（本模组是 Mi-Go）。条件不满足就直接返回，不产生任何播报。
 *
 * ⚠ 已知缺口：**这场战斗不扣玩家 HP**。调查员轮流攻击、敌人只会掉血或逃走，
 * 玩家这边只有疲劳惩罚骰，没有受伤路径 —— `applyDamage` 的调用点全在陷阱段。
 * 后果是伤势/惩罚骰那套机制在战斗里完全用不上。这是搬运时发现的，不在本次改动范围。
 */
export async function runCombatEncounter(
  cast: Cast,
  world: WorldState,
  module: ModuleData,
  scene: Scene,
  support: ModuleSupport,
): Promise<void> {
  const { p0, p1, c1, c2, san1, san2 } = cast;

// Mi-Go Combat Encounter — 多回合战斗系统
const migoEncounter = support.encounters.find(e =>
  e.sceneId === scene.id &&
  world.isClueFound(e.requiredClue) &&
  !world.isClueFound(e.excludedClue)
);
if (migoEncounter) {
  const enemyName = migoEncounter.enemyName ?? "敌人";
  const fmt = (t: string) => t.replaceAll("{enemy}", enemyName);
  say(`\n${"═".repeat(48)}`);
  say(`  ⚔ ${enemyName}战斗轮 ⚔`);
  say(`${"═".repeat(48)}`);
  for (const line of migoEncounter.encounterLines) say(fmt(line), "verbatim");
  say("");

  // Read Mi-Go HP from module NPC data: "HP11 MP15 DB无" → 11
  const migoNpc = module.npcs.find(n => support.bossNpcIdPattern.test(n.id));
  const hpMatch = migoNpc?.description?.match(/\bHP\s*(\d+)/i);
  const migoMaxHp = hpMatch ? parseInt(hpMatch[1], 10) : 11;
  let migoHp = migoMaxHp;
  const pcCombatants = [
    { pc: c1, name: p0.shortName, fightingKey: "fighting", firearmsKey: "firearms_pistol" },
    { pc: c2, name: p1.shortName, fightingKey: "fighting", firearmsKey: "firearms_pistol" },
  ];

  // ── 战斗行动 & 伤害叙事 ──
  // 值是扁平的 string[]（每个键一组候选台词），此前误写成 string[][]，
  // 导致 pick() 的返回类型被推成 string[]，下游 fmt() 才会报参数类型不符。
  const actionVariants: Record<string, string[]> = {
    [`${p0.shortName}_格斗`]: [
      "抄起身边的家伙迎了上去！", "握紧拳头沉身逼近！", "抓起一张椅子猛砸过去！",
      "顺手抄起一根铁管挥去！", "低喝一声侧身冲上前！",
    ],
    [`${p0.shortName}_射击`]: [
      "拔出左轮手枪冷静瞄准！", "举枪对准{enemy}扣动扳机！", "侧身闪避的同时抬手就是一枪！",
      "双手握枪，目光如炬地瞄准！",
    ],
    [`${p1.shortName}_格斗`]: [
      "抓起一把手术刀冲向{enemy}！", "握紧拳头摆出军体拳架势！",
      "抡起一张折叠椅砸了过去！", "抄起金属器械猛掷过去！",
    ],
    [`${p1.shortName}_射击`]: [
      "掏出左轮手枪瞄准{enemy}！", "举枪冷静射击！",
      "双手握枪对准{enemy}的翼膜扣动扳机！",
    ],
  };
  const dmgFlavors: Record<string, string[]> = {
    graze: ["只是擦破了甲壳表层，几乎没有实质伤害。", "子弹在甲壳上弹开，留下一道浅痕。"],
    light: ["命中了！在甲壳上留下了一道裂痕。", "打击奏效，{enemy}的甲壳出现了细纹。"],
    medium: ["有力的打击！甲壳出现明显裂纹，荧光绿的血液渗了出来！", "重击！{enemy}的身体猛地一震，体液渗出！"],
    heavy: ["一记重击！{enemy}发出一声痛苦的嘶叫，墨绿色的体液喷溅而出！", "猛烈的攻击！{enemy}的甲壳碎裂，体液横流！"],
  };
  const missTexts: Record<string, string[]> = {
    normal: ["的攻击被{enemy}灵巧地躲开了。", "的攻击落空了——{enemy}以不符合体型的速度闪避了。", "的攻击划过空气，没能碰到{enemy}。"],
    fumble: ["的攻击落空，反而一个踉跄差点摔倒！", "用力过猛失去平衡，差点扑倒在地！"],
  };
  function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

  // ── 疲劳系统 ──
  const FATIGUE_THRESHOLDS = [
    { min: 0, label: "", skillPenalty: 0, penaltyDice: 0 },
    { min: 2, label: "  ⚠ 手臂开始发酸，动作不如之前灵活了。", skillPenalty: 0, penaltyDice: 0 },
    { min: 3, label: "  ⚠ 呼吸变得急促，准头开始下降。", skillPenalty: 10, penaltyDice: 0 },
    { min: 4, label: "  ⚠ 汗水模糊了视线，持枪的手微微发抖。", skillPenalty: 0, penaltyDice: 1 },
    { min: 5, label: "  ⚠ 体力严重透支，肌肉不受控制地颤抖！", skillPenalty: 0, penaltyDice: 2 },
  ];
  const fatigue: Record<string, number> = { [p0.shortName]: 0, [p1.shortName]: 0 };

  // 单名调查员攻击一次
  function pcAttack(combatant: typeof pcCombatants[0]): number {
    const { name, pc, fightingKey, firearmsKey } = combatant;
    const fightVal = (pc.skillValues as Record<string, number>)[fightingKey] ?? 25;
    const gunVal = (pc.skillValues as Record<string, number>)[firearmsKey] ?? 20;
    const usingGun = gunVal > fightVal && Math.random() > 0.3;
    const skillLabel = usingGun ? "射击(手枪)" : "格斗(肉搏)";
    const actionKey = `${name}_${usingGun ? "射击" : "格斗"}`;
    const actionText = pick(actionVariants[actionKey] ?? [usingGun ? "开枪射击！" : "冲了上去！"]);

    // 疲劳修正
    fatigue[name] = (fatigue[name] ?? 0) + 1;
    const f = FATIGUE_THRESHOLDS.slice().reverse().find(t => fatigue[name] >= t.min)!;
    const effectiveSkill = Math.max(5, (usingGun ? gunVal : fightVal) - f.skillPenalty);

    say(`${name}${fmt(actionText)}`);
    const r = CoCEngine.skillCheck(effectiveSkill, "hard", 0, f.penaltyDice);
    sayMech(`➜ ${name} 【${skillLabel}】 ${effectiveSkill}%${f.skillPenalty > 0 ? `(-${f.skillPenalty}疲劳)` : ""}${f.penaltyDice > 0 ? ` [惩罚骰×${f.penaltyDice}]` : ""} → d100=${r.roll} → ${SUCCESS_LEVEL_LABELS[r.successLevel]}`);

    if (r.isSuccess) {
      // 伤害：格斗 1d6，射击 1d8 + 暴击加成
      const dieMax = usingGun ? 8 : 6;
      let dmg = 1 + Math.floor(Math.random() * dieMax);
      if (r.successLevel === "critical") dmg += dieMax;
      else if (r.successLevel === "extreme") dmg += Math.floor(dieMax / 2);
      const dmgTier = dmg >= 7 ? "heavy" : dmg >= 4 ? "medium" : dmg >= 2 ? "light" : "graze";
      say(`  ${fmt(pick(dmgFlavors[dmgTier]))}（${dmg}点伤害）`);
      return dmg;
    } else {
      const missPool = r.successLevel === "fumble" ? missTexts.fumble : missTexts.normal;
      say(`  ${name}${fmt(pick(missPool))}`);
      return 0;
    }
  }

  let round = 0;
  const MAX_ROUNDS = 4;
  let miGoFled = false;

  while (migoHp > 0 && round < MAX_ROUNDS && !miGoFled) {
    round++;
    if (round > 1) say(`\n── 第 ${round} 回合 ──`);

    // 调查员攻击
    for (const combatant of pcCombatants) {
      if (migoHp <= 0) break;
      migoHp -= pcAttack(combatant);
    }
    if (migoHp <= 0) break;

    // 显示调查员疲劳状态（从第2回合起）
    if (round >= 2) {
      const shown = new Set<string>();
      for (const { name } of pcCombatants) {
        const f = FATIGUE_THRESHOLDS.slice().reverse().find(t => fatigue[name] >= t.min)!;
        if (f.label && !shown.has(f.label)) {
          shown.add(f.label);
          say(`  ${name}：${f.label.trim()}`);
        }
      }
    }

    // 米戈反击：SAN 检定
    say("");
    sanCheck(p0.shortName, san1, "0/1d3");
    sanCheck(p1.shortName, san2, "0/1d3");

    // 显示米戈状态
    const hpPct = migoHp / migoMaxHp;
    const statusText = hpPct > 0.6 ? "甲壳完好，行动自如" : hpPct > 0.3 ? "甲壳多处碎裂，动作开始迟缓" : "浑身伤痕累累，踉跄后退";
    say(`\n[${enemyName} HP: ${migoHp}/${migoMaxHp} — ${fmt(statusText)}]`);

    // 米戈受伤过半时尝试逃跑
    if (hpPct <= 0.6 && round >= 2) {
      const fleeChance = 0.3 + (1 - hpPct) * 0.5;
      if (Math.random() < fleeChance) {
        miGoFled = true;
        break;
      }
    }
  }

  // ── 结局判定 ──
  say("");
  if (migoHp <= 0) {
    // 击败：Mi-Go 重伤逃走，没带走大脑
    if (migoEncounter.victoryClueId) world.discoverClue(migoEncounter.victoryClueId);
    for (const line of migoEncounter.victoryLines) say(line, "verbatim");
  } else if (miGoFled && migoHp < migoMaxHp * 0.4) {
    // 打跑但没杀死：Mi-Go 自己逃走，没来得及带走大脑
    if (migoEncounter.victoryClueId) world.discoverClue(migoEncounter.victoryClueId);
    if (migoEncounter.fledLines) {
      for (const line of migoEncounter.fledLines) say(line, "verbatim");
    } else {
      say("敌人发出一声不甘的嘶叫，撞破通风管道独自逃走了。", "verbatim");
    }
  } else {
    // 完全失败：Mi-Go 带着大脑逃走
    for (const line of migoEncounter.defeatLines) say(line, "verbatim");
  }
  say(`${"═".repeat(48)}`);
}
}
