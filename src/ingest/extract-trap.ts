// 摄取管线 · 陷阱机制抽取（确定性，不经 LLM）
//
// 这一段是整条线的起点。陷阱数值原本只活在散文里，引擎读不到，
// 于是被人工抄进 play-module.ts —— 抄成了 `1 + rand(3)`，连模组自己写的
// 最小值 2 都够不到，而且没有任何测试会发现。
//
// 能用规则抽的就别交给 LLM：骰子表达式、难度词、体型阈值都是死板的文本形态，
// 规则抽取可复现、可解释、不要 API key。留给 LLM 的应该是真正需要理解的部分。

import type { TrapMechanics, Provenance } from "../module/types";

export interface TrapExtraction {
  mech: TrapMechanics;
  provenance: Provenance[];
}

/**
 * 骰子表达式。
 *
 * 后面不强求边界：原文写的是「造成 1d6的伤害」，骰子直接贴着中文，
 * 加 \b 之类的边界断言反而匹配不上。
 */
const DICE = /\d*[dD]\d+(?:\s*[+-]\s*\d+)?/;

/** 难度词 → CoC 难度等级。原文用「困难成功」「极难成功」这样的说法 */
function difficultyNear(text: string): "regular" | "hard" | "extreme" {
  if (/极难|极限/.test(text)) return "extreme";
  if (/困难/.test(text)) return "hard";
  return "regular";
}

/** CoC 属性与常见技能名，用于认出检定用的是哪一项 */
const SKILL_WORDS = ["力量", "敏捷", "体质", "体型", "智力", "意志", "教育", "外貌", "闪避", "锁匠", "侦查", "聆听", "攀爬", "游泳", "幸运"];

function skillIn(text: string): string | null {
  for (const w of SKILL_WORDS) if (text.includes(w)) return w;
  return null;
}

/** 取一句话：从命中位置往两边扩到句读为止，用来做留痕的原文片段 */
function sentenceAround(text: string, idx: number): string {
  const start = Math.max(0, text.lastIndexOf("。", idx) + 1);
  const endRaw = text.indexOf("。", idx);
  const end = endRaw < 0 ? text.length : endRaw + 1;
  return text.slice(start, end).trim();
}

/**
 * 从条目正文抽出陷阱机制。
 *
 * 一条机制信号都找不到就返回 null —— 不硬凑一个空壳。
 * 「一旁的杂物堆」这种纯叙述条目也走这个函数，它们本就不该产出机制。
 */
export function extractTrapMechanics(
  name: string,
  text: string,
  sourceRef?: string,
): TrapExtraction | null {
  if (!text.trim()) return null;

  const mech: TrapMechanics = {};
  const prov: Provenance[] = [];
  const record = (path: string, source: string, result: unknown, reason: string) => {
    prov.push({ path, source, sourceRef, result: String(result), reason, by: "rule" });
  };

  // ── 体型免疫：「体形小于 35 的角色会免疫」──
  const siz = text.match(/体[形型]小于\s*(\d+)/);
  if (siz) {
    mech.sizImmunityBelow = parseInt(siz[1] as string, 10);
    record("trap.sizImmunityBelow", sentenceAround(text, siz.index ?? 0), mech.sizImmunityBelow, "原文写明体型低于该值免疫");
  }

  // ── SAN 消耗：「sc0/1d3」「SC1d3+1/1d6+1」──
  const san = text.match(/[sS][cC]\s*(\d+(?:[dD]\d+)?(?:\s*\+\s*\d+)?)\s*\/\s*(\d*[dD]\d+(?:\s*\+\s*\d+)?)/);
  if (san) {
    mech.sanCost = `${(san[1] as string).replace(/\s/g, "")}/${(san[2] as string).replace(/\s/g, "")}`;
    record("trap.sanCost", sentenceAround(text, san.index ?? 0), mech.sanCost, "原文以 sc 记法给出理智损失");
  }

  // ── 伤害：跟在「造成」附近的第一个骰子 ──
  // 不直接取全文第一个骰子：挣脱的额外伤害、持续伤害都是骰子，
  // 位置靠「造成…的伤害」这个说法锁定。
  const dmg = text.match(new RegExp(`造成[^。]{0,12}?(${DICE.source})`));
  // sc 记法要排掉。音响陷阱原文是「造成 sc0/1d3 的惩罚」——
  // 那是理智损失，不是物理伤害，照单全收会给一个不掉血的陷阱安上 1d3 伤害。
  if (dmg && !/[sS][cC]/.test(dmg[0])) {
    mech.damage = (dmg[1] as string).replace(/\s/g, "");
    record("trap.damage", sentenceAround(text, dmg.index ?? 0), mech.damage, "原文「造成…伤害」处的骰子");
  }

  // ── 躲避：踩中的瞬间还来得及闪开 ──
  const avoidM = text.match(/[^。]*(?:躲过|躲避|闪开)[^。]*/);
  if (avoidM) {
    const seg = avoidM[0];
    const skill = skillIn(seg);
    if (skill) {
      mech.avoid = { skill, difficulty: difficultyNear(seg) };
      record("trap.avoid", seg.trim(), `${skill}/${mech.avoid.difficulty}`, "原文描述为在触发瞬间躲开");
    }
  }

  // ── 挣脱：已经中招，要挣开 ──
  const escM = text.match(/[^。]*挣脱[^。]*/);
  if (escM) {
    const seg = escM[0];
    const skill = skillIn(seg);
    if (skill) {
      mech.escape = { skill, difficulty: difficultyNear(seg) };
      // 大失败的额外伤害通常写在挣脱之后的下一句
      const fum = text.slice(escM.index ?? 0).match(new RegExp(`大失败[^。]*?(${DICE.source})`));
      if (fum) mech.escape.fumbleDamage = (fum[1] as string).replace(/\s/g, "");
      record("trap.escape", seg.trim(), `${skill}/${mech.escape.difficulty}`, "原文描述为中招之后挣开");
    }
  }

  // ── 持续伤害：「会一直伤害这名调查员 1D3」──
  const ong = text.match(new RegExp(`(?:一直|持续|每回合)[^。]{0,16}?(${DICE.source})`));
  if (ong) {
    const d = (ong[1] as string).replace(/\s/g, "");
    if (d !== mech.damage) {
      mech.ongoing = { damage: d, until: "摆脱" };
      record("trap.ongoing", sentenceAround(text, ong.index ?? 0), d, "原文写明未摆脱则持续伤害");
    }
  }

  return prov.length === 0 ? null : { mech, provenance: prov };
}
