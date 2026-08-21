// 从 play-module.ts 抽出来的一段（脚本搬运，见 tools/_extract-block.ts）。
//
// 抽出来的理由是可寻址性：原先 runModuleInner 一个函数 2615 行、占全文件 74%，
// 里面按注释能切出近 30 个块，但没有一个是能整段读进来的单元 ——
// 每次改动只能靠行号开窗口猜，窄了缺上下文、宽了浪费。
//
// ⚠ 纯搬运，不改行为。判据是全量测试与主循环脚手架全绿。

import type { ModuleData, Scene } from "../module/types";
import type { WorldState } from "../world/state";
import { resolveCheckValue } from "../character/coc-character";
import type { Cast, Cursor } from "./run-state";
import { say, sayMech } from "./narration";
import { check, sanCheck, applyDamage, healWound } from "./checks";
import { rollDice, trapsInScene, attributeValue } from "./trap-util";
import type { WoundSeverity } from "../combat/wound-effects";

/**
 * 一次进场的陷阱结算。
 *
 * 与 npc-dialogue 不同，这一段是**真耦合**运行状态的：要两名调查员、world、
 * 当前场景，还有「哪些陷阱响过」与「这次轮到谁踩」。
 *
 * 参数按概念分组（`cast` / `cursor`）而不是平铺 —— 平铺过一版是 11 个散参数，
 * 每个都要读一遍才知道这函数碰什么。现在拿到 `cast` 就知道它动角色，
 * 拿到 `cursor` 就知道它参与循环推进。
 *
 * 内部仍用解构把名字还原成原闭包里的那些，于是循环体一个字都没改 ——
 * 搬运的正确性只取决于「参数是不是同一批东西」。
 */
export async function runSceneTraps(
  cast: Cast,
  world: WorldState,
  cursor: Cursor,
  module: ModuleData,
  scene: Scene,
): Promise<void> {
  const { p0, p1, c1, c2, san1, san2 } = cast;
  const { triggeredTraps, stepCounter } = cursor;

for (const trapItem of trapsInScene(module.items, scene.id)) {
  if (triggeredTraps.has(trapItem.id) || stepCounter <= 0) continue;

  const mech = trapItem.trap!;
  // 事先发现就绕开了 —— 这是原先 support.trapClueId 的语义，现在按陷阱各自声明
  if (mech.detectedByClue && world.isClueFound(mech.detectedByClue)) continue;
  triggeredTraps.add(trapItem.id);
  const vName = stepCounter % 2 === 0 ? p0.shortName : p1.shortName;
  const pc = stepCounter % 2 === 0 ? c1 : c2;

  // 体型免疫：模组给结论不给理由，理由写在数据的 immuneNarration 里并记入 inferred
  if (mech.sizImmunityBelow !== undefined && (pc.attributes.size ?? 50) < mech.sizImmunityBelow) {
    say(`\n${vName}${mech.immuneNarration ?? `踩上了${trapItem.name}，却什么也没发生。`}`);
    continue;
  }

  // 事先发现检定：侦查/灵感检定，成功则发现陷阱并绕开
  if (mech.detect) {
    // 检查是否有特定背景可以用替代技能（如军事背景用灵感）
    const bgKeywords = ["军", "soldier", "military", "veteran", "army", "navy", "marine"];
    const hasMilitaryBg = bgKeywords.some(kw =>
      (pc.archetypeId?.toLowerCase() ?? "").includes(kw)
    );
    const useAlt = hasMilitaryBg && mech.detect.alternativeSkill;
    const skillName = useAlt ? mech.detect.alternativeSkill! : mech.detect.skill;
    const skillVal = resolveCheckValue(pc, skillName);

    if (skillVal > 0) {
      // 惩罚骰（夜晚等）：每个惩罚骰多掷一颗十位骰取最差
      // 惩罚骰不写进 label —— check() 自己会标，写这儿会打印两遍
      const penalty = mech.detect.penaltyDice ?? 0;
      const label = `${skillName}（发现${trapItem.name}）`;
      const r = check(skillVal, vName, label, mech.detect.difficulty, penalty);
      if (r.isSuccess) {
        say(`\n${vName}${useAlt ? "凭着直觉感到危险" : "仔细观察后"}发现了前方的陷阱，小心绕开了。`);
        if (mech.detectedByClue) {
          world.discoverClue(mech.detectedByClue);
        }
        continue;
      }
    }
  }

  // 躲避：来得及闪开就完全无事，与"已经中招后挣脱"是两回事
  if (mech.avoid) {
    const label = `${mech.avoid.skill}（躲避${trapItem.name}）`;
    const a = check(attributeValue(pc.attributes, mech.avoid.skill), vName, label, mech.avoid.difficulty);
    if (a.isSuccess) {
      say(`\n${vName}察觉到不对，堪堪闪开了。`);
      continue;
    }
  }

  say(`\n${vName}${mech.triggerNarration ?? `触发了${trapItem.name}！`}`);

  let total = 0;
  let severity: WoundSeverity = "scratch";
  if (mech.damage) {
    total = rollDice(mech.damage);
    severity = applyDamage(pc, vName, total);
  }

  // ── 重伤体质检定（CoC 7e Major Wound）──
  // deep（50-74%）或 grievous（≥75%）需要 CON 检定，失败则昏迷
  if (severity === "deep" || severity === "grievous") {
    // ignoreWound：这一掷结算的就是这处伤，不能被它自己罚
    const conCheck = check(pc.attributes.constitution, vName, "体质（重伤）", "regular", 0, true);
    if (!conCheck.isSuccess) {
      say(`${vName}因伤势过重昏迷过去！`);
      pc.hp = 0; // 昏迷状态
    }
  }

  // ── 挣脱检定（捕兽夹等）──
  let escaped = false;
  if (mech.escape) {
    const label = `${mech.escape.skill}（挣脱${trapItem.name}）`;
    const r = check(attributeValue(pc.attributes, mech.escape.skill), vName, label, mech.escape.difficulty);
    if (r.isSuccess) {
      say(`${vName}挣脱了出来。`);
      escaped = true;
    } else if (r.successLevel === "fumble" && mech.escape.fumbleDamage) {
      const extra = rollDice(mech.escape.fumbleDamage);
      say(`${vName}越挣扎，情况越糟。`);
      const extraSev = applyDamage(pc, vName, extra);
      total += extra;
      // 额外伤害也可能触发重伤
      if ((extraSev === "deep" || extraSev === "grievous") && pc.hp > 0) {
        const conCheck2 = check(pc.attributes.constitution, vName, "体质（重伤）", "regular", 0, true);
        if (!conCheck2.isSuccess) {
          say(`${vName}因伤势过重昏迷过去！`);
          pc.hp = 0;
        }
      }
    } else {
      say(`${vName}一时挣不开，只能等同伴过来搭手。`);
    }
  }

  // ── 持续伤害（硫酸等）──
  // 没有 escape 或者 escape 失败都会触发 ongoing
  if (mech.ongoing && !escaped && pc.hp > 0) {
    const tick = rollDice(mech.ongoing.damage);
    const tickSev = applyDamage(pc, vName, tick);
    total += tick;
    sayMech(`${trapItem.name}持续造成伤害，直到${mech.ongoing.until}。`);

    // 急救知识检定：化学/医学/科学才知道怎么救
    // 不是每个人都知道硫酸要用水冲
    if (mech.firstAid) {
      const partner = pc === c1 ? c2 : c1;
      const partnerName = pc === c1 ? p1.shortName : p0.shortName;
      // 优先检定化学，其次医学
      const chemVal = resolveCheckValue(partner, "化学");
      const medVal = resolveCheckValue(partner, "医学");
      const useSkill = chemVal >= medVal ? "化学" : "医学";
      const useVal = Math.max(chemVal, medVal);
      if (useVal > 0) {
        const knowCheck = check(useVal, partnerName, `${useSkill}（判断急救方式）`, "regular");
        if (knowCheck.isSuccess) {
          sayMech(`${partnerName}知道应该${mech.firstAid}！`);
          // 急救检定
          const faVal = resolveCheckValue(partner, "急救");
          if (faVal > 0) {
            const faCheck = check(faVal, partnerName, "急救", "regular");
            if (faCheck.isSuccess) {
              say(`${partnerName}迅速${mech.firstAid}，阻止了持续伤害。`);
              // 伤口处理掉了 → 撤掉伤势惩罚骰
              healWound(vName);
              sayMech(`${vName} 伤势得到处理，惩罚骰解除。`);
            } else {
              say(`${partnerName}尝试急救但没能完全控制住情况。`);
              // 失败也扣一次持续伤害
              if (pc.hp > 0) {
                const tick2 = rollDice(mech.ongoing.damage);
                applyDamage(pc, vName, tick2);
                total += tick2;
              }
            }
          }
        } else {
          say(`${partnerName}不知道该怎么处理这种伤势……`);
        }
      }
    }

    // 持续伤害也可能触发重伤
    if ((tickSev === "deep" || tickSev === "grievous") && pc.hp > 0) {
      const conCheck3 = check(pc.attributes.constitution, vName, "体质（重伤）", "regular", 0, true);
      if (!conCheck3.isSuccess) {
        say(`${vName}因伤势过重昏迷过去！`);
        pc.hp = 0;
      }
    }
  }

  if (total > 0 && mech.maimAtHpRatio !== undefined && total > Math.floor(pc.maxHp * mech.maimAtHpRatio)) {
    const ratioLabel = mech.maimAtHpRatio === 0.5 ? "半值" : `${mech.maimAtHpRatio} 倍`;
    sayMech(`${vName} 单次伤害 ${total} 点，超过耐久${ratioLabel} —— 有截肢风险。`);
  }

  // 一次进场最多真正踩中一个陷阱。
  //
  // 常理约束：铁齿咬住小腿之后，人不会在同一瞬间又走进下一根拌锁绳——
  // 会停下、会喊人、会开始一寸寸看脚下。放开这条，实跑里出现过
  // 「HP 10 → 6 → 0」两个陷阱连响把调查员直接打昏的序列。
  // 没踩中的陷阱不记入 triggeredTraps，下次再进这个场景仍然在等着。
  break;
}
}

