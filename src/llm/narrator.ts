// 叙事生成器 — 克苏鲁风格战斗叙事
// LLM 驱动（有 API Key） + 模板 fallback（无 API Key）
// 根据伤害/总HP比例决定伤势描述等级
//
// 严重度分级（与 wound-effects.ts 同步）：
//   scratch  ≤10%  擦伤
//   flesh    10-25% 轻伤
//   deep     25-50% 重伤
//   grievous 50-75% 致命伤
//   lethal   >75%   斩杀

import type { CombatResult } from "../types";
import type { LLMClient } from "./client";
import { calcSeverity } from "../combat/wound-effects";
import { checkDialogueText } from "../world/world-constraint";

// ============================================================
// 克苏鲁风格叙事模板
//
// 基调：冷静、细节化、旁观者视角
// 避免"剑光闪过"等武侠/奇幻式表达
// 专注：伤口形态、血液、骨骼、声音、目标的反应
// ============================================================

/** 擦伤 — 几乎无影响，但带出恐惧氛围 */
const SCRATCH_TEMPLATES = [
  "{weapon}擦过{defender}的体表，留下一道浅浅的血痕。暗红色的液体沿着伤口边缘缓缓渗出。",
  "{defender}被{weapon}蹭破了皮——伤口不深，但血珠已经沿着皮肤滚落。",
  "一声钝响后，{defender}的手臂上多了一道细长的划口。皮肉翻开处露出粉红色的嫩肉。",
  "{weapon}掠过{defender}的侧肋，带起一串细小的血珠。",
];

/** 轻伤 — 流血，痛楚 */
const FLESH_TEMPLATES = [
  "{weapon}切入{defender}的手臂，皮肉翻开，鲜血立刻涌出。{defender}闷哼一声，咬紧了牙关。",
  "猩红的液体从{defender}的肋部淌下——{weapon}在那里留下了一道不浅的伤口。",
  "{weapon}击中了{defender}的身体。温热的血浸透了衣物，在布料上洇开一片深色。",
  "{defender}的肩头被{weapon}撕开一道口子。可以看见筋膜在伤口深处泛着苍白的光。",
];

/** 重伤 — 明显影响行动能力 */
const DEEP_TEMPLATES = [
  "{weapon}深深嵌入{defender}的身体，抽出时带出一股温热黏腻的液体。{defender}踉跄后退，呼吸变得粗重。",
  "骨肉被撕裂的闷响。{weapon}在{defender}的躯干上留下了一道狰狞的创口——鲜血正从那里汩汩涌出。",
  "这一击几乎贯穿了{defender}的防御。伤口深可见骨，暗红的血液正沿着{defender}的身体流到地面上。",
  "{weapon}重重击中了{defender}——可以听到骨头发出不妙的声响。{defender}的脸色瞬间变得煞白。",
];

/** 致命伤 — 濒死，意识模糊 */
const GRIEVOUS_TEMPLATES = [
  "{weapon}穿透了{defender}的身体。露出的刃尖上挂着温热的血液，一滴滴落在地上。{defender}发出一声不似人声的哀嚎。",
  "毁灭性的一击。{defender}的身体被{weapon}撕开巨大的创口——透过翻卷的皮肉，可以看到内部的骨骼与脏器。",
  "{defender}遭受了致命创伤。鲜血以可怕的速率喷涌而出，{defender}的双腿开始发软，视线涣散。",
  "空气中弥漫着铁锈般的血腥味。{defender}低头看了一眼自己胸前的伤口——那一眼中充满了不可置信。",
];

/** 斩杀 — HP归零 */
const LETHAL_TEMPLATES = [
  "{weapon}精准地没入{defender}的要害部位。{defender}甚至没能发出声音——只是无声地瘫软下去，像一具被剪断提线的木偶。",
  "致命一击。{defender}发出一声短促的气音，然后向后倒去。鲜血迅速在身下汇聚成一滩深色的水洼。",
  "{weapon}斩断了{defender}的生命线。身体倒地的声音沉闷而沉重，仿佛某种容器被打翻。",
  "战斗结束了。{defender}以一种不自然的角度瘫倒在地上，{weapon}造成的创口仍在缓缓渗出暗红色的液体。",
];

/** 未命中 */
const MISS_TEMPLATES = [
  "{weapon}划破空气，在{defender}身侧掠过——只差不到一寸。",
  "{defender}侧身闪避，{weapon}几乎擦着皮肤飞过。",
  "攻击落空。{weapon}击中了一旁的墙壁/地面，溅起碎片与尘土。{defender}已经移动到了另一个位置。",
  "{attacker}的突击被{defender}一个后撤步化解。{weapon}在空气中挥了个空。",
];

const CRIT_PREFIX = ["致命的暴击！", "精准命中！", ""];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 取 UnifiedCombatResult 的 critical 字段（兼容 crit/critical 命名） */
function isCritical(result: any): boolean {
  return !!(result.critical ?? result.crit ?? false);
}

// ============================================================
// 模板叙事
// ============================================================

function templateNarrative(
  attackerName: string,
  defenderName: string,
  weaponName: string,
  damage: number,
  maxHp: number,
  hit: boolean,
  isKill: boolean,
  isCrit: boolean,
): string {
  const weapon =
    weaponName === "shortsword" ? "短刀"
    : weaponName === "longsword" ? "长刀"
    : weaponName === "greatsword" ? "巨剑"
    : weaponName === "dagger" ? "匕首"
    : weaponName === "longbow" ? "长弓"
    : weaponName === "shortbow" ? "短弓"
    : weaponName === "club" ? "棍棒"
    : weaponName === "spear" ? "长矛"
    : weaponName === "fist" ? "拳头"
    : weaponName;

  let template: string;
  if (!hit) {
    template = pick(MISS_TEMPLATES);
  } else if (isKill) {
    template = pick(LETHAL_TEMPLATES);
  } else {
    const severity = calcSeverity(damage, maxHp);
    switch (severity) {
      case "scratch":   template = pick(SCRATCH_TEMPLATES); break;
      case "flesh":     template = pick(FLESH_TEMPLATES); break;
      case "deep":      template = pick(DEEP_TEMPLATES); break;
      case "grievous":  template = pick(GRIEVOUS_TEMPLATES); break;
      default:          template = pick(FLESH_TEMPLATES); break;
    }
  }

  let narrative = template
    .replace(/\{attacker\}/g, attackerName)
    .replace(/\{defender\}/g, defenderName)
    .replace(/\{weapon\}/g, weapon);

  if (isCrit && hit) {
    narrative = pick(CRIT_PREFIX) + narrative;
  }

  return narrative;
}

// ============================================================
// LLM 驱动叙事生成
// ============================================================

const NARRATIVE_SYSTEM_PROMPT = `你是洛夫克拉夫特风格的 TRPG 战斗叙事生成器。生成一段简洁、阴郁、写实的战斗描述。

要求：
- 1-3 句话，不超过 100 字
- 语调冷静、细节化，像调查员的观察笔记
- 命中时具体描写：武器造成的伤口形态、出血量、有无骨/脏器暴露
- 暴击时描写瞬间的冲击与目标的生理反应
- 未命中时描写子弹/武器掠过空气的声音
- 击杀时描写死亡的过程——从受伤到失去生命体征
- 不要使用"剑光闪过"、"暴喝一声"等武侠/奇幻表达
- 不要写"掷出了XX点"、"命中/未命中判定"等元信息
- 注意伤害严重度（擦伤/轻伤/重伤/致命/斩杀），伤势越重描写越详细
- 伤害占总血量比例决定伤势轻重，据此调整描述的惨烈程度`;

async function generateNarrativeLLM(
  attackerName: string,
  defenderName: string,
  weaponName: string,
  result: CombatResult,
  maxHp: number,
  llm: LLMClient
): Promise<string> {
  const weapon =
    weaponName === "shortsword" ? "短刀"
    : weaponName === "longsword" ? "长刀"
    : weaponName === "dagger" ? "匕首"
    : weaponName === "longbow" ? "长弓"
    : weaponName;

  const severity = result.hit ? calcSeverity(result.damage, maxHp) : null;

  const userPrompt = [
    `攻击者: ${attackerName}`,
    `目标: ${defenderName}`,
    `武器: ${weapon}`,
    `命中: ${result.hit ? "是" : "否"}`,
    `暴击: ${result.crit ? "是" : "否"}`,
    `伤害: ${result.damage} 点 (${result.damage_type})`,
    `目标最大HP: ${maxHp}`,
    `伤势严重度: ${severity ?? "无"}`,
    `结果: ${result.result === "kill" ? "击杀" : result.result === "wound" ? "受伤" : "未命中"}`,
  ].join("\n");

  const raw = await llm.chat(
    [
      { role: "system", content: NARRATIVE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.8, maxTokens: 200, timeout: 120000 }
  );

  // 世界模型约束：时代科技黑名单 / meta 词汇。命中则重生成一次（新上下文），再命中则交回降级路径
  let text = raw.trim();
  if (checkDialogueText(text)) {
    text = (await llm.chat(
      [
        { role: "system", content: NARRATIVE_SYSTEM_PROMPT + "\n禁止使用任何 1920 年代不存在的现代科技词汇（手机、电视、电脑、互联网等）。" },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.6, maxTokens: 200, timeout: 120000 }
    )).trim();
  }
  if (checkDialogueText(text)) {
    throw new Error("LLM 叙事违反世界模型约束，降级模板");
  }

  return text;
}

// ============================================================
// 统一入口
// ============================================================

let _narratorLLM: LLMClient | null = null;

export function setNarratorLLM(client: LLMClient | null) {
  _narratorLLM = client;
}

/**
 * 生成战斗叙事文本
 * @param maxHp 目标最大生命值（用于计算伤势严重度）
 */
export async function generateNarrative(
  attackerName: string,
  defenderName: string,
  weaponName: string,
  result: CombatResult,
  maxHp: number = 10,
): Promise<string> {
  if (_narratorLLM) {
    try {
      return await generateNarrativeLLM(
        attackerName, defenderName, weaponName, result, maxHp, _narratorLLM
      );
    } catch (err) {
      // console.warn(`  ⚠ LLM 叙事失败，退化到模板: ${(err as Error).message.slice(0, 80)}`);
    }
  }
  return templateNarrative(
    attackerName, defenderName, weaponName,
    result.damage, maxHp,
    result.hit, result.result === "kill", isCritical(result),
  );
}
