// Complete character sheet display
// Shows all attributes, derived values, ALL skills with values
import {
  type CoCGeneratedCharacter,
  COC_ATTRIBUTES,
  COC_SKILLS,
  SKILL_NAME_MAP,
  getBaseSkillValue,
} from "../character/coc-character";

const ATTR_LABELS: Record<string, string> = {
  strength: "STR\u529b\u91cf",
  constitution: "CON\u4f53\u8d28",
  size: "SIZ\u4f53\u578b",
  dexterity: "DEX\u654f\u6377",
  appearance: "APP\u5916\u8c8c",
  intelligence: "INT\u667a\u529b",
  power: "POW\u610f\u5fd7",
  education: "EDU\u6559\u80b2",
};

function half(v: number) { return Math.floor(v / 2); }
function fifth(v: number) { return Math.floor(v / 5); }

/** Reverse mapping: English skill key -> Chinese name */
function buildReverseMap(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const [cn, en] of Object.entries(SKILL_NAME_MAP)) {
    m[en] = cn;
  }
  return m;
}
const EN2CN = buildReverseMap();

/** Format a line for the character sheet */
function fmtSkillLine(cnName: string, engKey: string, currentVal: number, baseVal: number, isOccup: boolean): string {
  const indicator = isOccup ? "\u25c6" : (currentVal > baseVal ? "\u25cb" : "·");
  const valStr = String(currentVal).padStart(3);
  const baseStr = String(baseVal).padStart(2);
  if (currentVal > baseVal) {
    return `  ${indicator} ${cnName.padEnd(16)} ${valStr}% (${baseStr}%)`;
  }
  return `  · ${cnName.padEnd(16)} ${valStr}%`;
}

export function displayCharacterSheet(char: CoCGeneratedCharacter): string {
  const lines: string[] = [];
  const L = (s: string) => lines.push(s);
  const attr = char.attributes;

  // Header
  L("\u2501".repeat(60));
  L(`  ${char.name}`);
  L(`  ${char.archetypeId}`);
  L("\u2501".repeat(60));

  // Core attributes
  L("\n\u3010\u6838\u5fc3\u5c5e\u6027\u3011");
  for (const key of COC_ATTRIBUTES) {
    const val = attr[key] ?? 0;
    L(`  ${(ATTR_LABELS[key] || key).padEnd(16)} ${String(val).padStart(3)}  [${half(val)}/${fifth(val)}]`);
  }

  // Luck
  L(`\n\u3010\u5e78\u8fd0\u3011`);
  L(`  ${char.luck}`);

  // Derived values
  L(`\n\u3010\u884d\u751f\u503c\u3011`);
  L(`  HP: ${char.hp}/${char.maxHp}`);
  L(`  DB: ${char.damageBonus}  Build: ${char.build}  Move: ${char.move}`);
  L(`  \u4fe1\u7528\u8bc4\u7ea7: ${char.creditRating}%`);

  // Skill points
  L(`\n\u3010\u6280\u80fd\u70b9\u6570\u3011`);
  L(`  \u804c\u4e1a: ${char.occupationSkillPoints}  \u4e2a\u4eba\u5174\u8da3: ${char.interestSkillPoints}`);

  // Build occupation skill list (show Chinese names with values)
  L(`\n\u3010\u804c\u4e1a\u6280\u80fd\u3011`);
  const occSkills = char.occupationSkills || [];
  const occKeys = char.occupationSkillKeys || [];
  if (occSkills.length > 0) {
    for (let i = 0; i < occSkills.length; i++) {
      const cn = occSkills[i];
      const engKey = occKeys[i] || SKILL_NAME_MAP[cn] || cn;
      const val = char.skillValues[engKey] ?? 0;
      L(`  ${cn.padEnd(16)} ${String(val).padStart(3)}%`);
    }
  } else {
    L(`  (\u65e0\u804c\u4e1a\u6280\u80fd\u6570\u636e)`);
  }

  // All skills list
  L(`\n\u3010\u5168\u90e8\u6280\u80fd\u3011`);
  let skillCount = 0;
  for (const cn of COC_SKILLS) {
    const engKey = SKILL_NAME_MAP[cn];
    if (!engKey) continue;
    const currentVal = char.skillValues[engKey] ?? 0;
    if (currentVal <= 0) continue;
    const baseVal = getBaseSkillValue(engKey, attr.dexterity ?? 50, attr.education ?? 50) ?? 0;
    const isOccup = occSkills.includes(cn) || occKeys.includes(engKey);
    L(fmtSkillLine(cn, engKey, currentVal, baseVal, isOccup));
    skillCount++;
  }
  L(`  (\u5171 ${skillCount} \u9879\u6280\u80fd)`);

  // Other info
  L(`\n\u3010\u5176\u4ed6\u3011`);
  L(`  \u5e74\u9f84: ${char.age}  CM: ${char.cthulhuMythos}%`);
  L(`  ${char.valid ? "\u2714 \u89d2\u8272\u6709\u6548" : "\u2718 \u89d2\u8272\u6709\u95ee\u9898"}`);
  if (char.warnings.length > 0) {
    L(`  \u8b66\u544a: ${char.warnings.join("; ").slice(0, 120)}`);
  }
  L("\u2501".repeat(60));

  return lines.join("\n");
}

/** Summary for KP context */
export function characterSummary(char: CoCGeneratedCharacter): string {
  const attr = char.attributes;
  return `${char.name}: STR${attr.strength} CON${attr.constitution} SIZ${attr.size} DEX${attr.dexterity} HP:${char.hp} DB:${char.damageBonus}`;
}

/** Top skills for prompt injection */
export function getHighlightedSkills(char: CoCGeneratedCharacter): string[] {
  const importantKeys = ["spot_hidden","listen","library_use","persuade","fast_talk","intimidate",
    "fighting","firearms_pistol","first_aid","medicine","psychology","occult","stealth","dodge"];
  return importantKeys
    .map(k => ({ key: k, cn: EN2CN[k] || k, val: char.skillValues[k] ?? 0 }))
    .filter(s => s.val > 10)
    .sort((a, b) => b.val - a.val)
    .map(s => `${s.cn}(${s.val}%)`);
}
