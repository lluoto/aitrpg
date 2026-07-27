// 为"普瑞米尔的谷仓"创建 2 个调查员
import { createCoCCharacter, getCoCArchetypes, getSkillValue, getBaseSkillValue, type CoCGeneratedCharacter } from "./character/coc-character";

async function main() {
  const archs = getCoCArchetypes();

  // 找合适的职业
  const investigator = archs.find(a => a.id === "investigator");
  const doctor = archs.find(a => a.id === "doctor");
  const journalist = archs.find(a => a.id === "journalist");
  const detective = archs.find(a => a.id === "detective");
  const doctor_medicine = archs.find(a => a.id === "doctor_medicine");

  // PC1: 私家侦探 — 侦查+社交+手枪
  const pc1Arch = detective || investigator!;
  const pc1 = await createCoCCharacter(
    { name: "亨利·摩根", archetypeId: pc1Arch.id, method: "point_buy" as const, points: 480 },
    pc1Arch
  );
  
  // PC2: 医生 — 医学+科学+社交
  const pc2Arch = doctor_medicine || journalist!;
  const pc2 = await createCoCCharacter(
    { name: "詹姆斯·卡特", archetypeId: pc2Arch.id, method: "point_buy" as const, points: 480 },
    pc2Arch
  );

  // 输出 JSON
  const fs = await import("fs");
  fs.writeFileSync("pcs/pc1_henry.json", JSON.stringify(pc1, null, 2), "utf-8");
  fs.writeFileSync("pcs/pc2_james.json", JSON.stringify(pc2, null, 2), "utf-8");
  
  console.log("=== PC1: 亨利·摩根 ===");
  console.log(`职业: ${pc1.archetypeId} | HP:${pc1.hp}/${pc1.maxHp} | DB:${pc1.damageBonus} | 幸运:${pc1.luck}`);
  console.log(`属性: STR=${pc1.attributes.strength} DEX=${pc1.attributes.dexterity} CON=${pc1.attributes.constitution}`);
  console.log(`      INT=${pc1.attributes.intelligence} POW=${pc1.attributes.power} EDU=${pc1.attributes.education}`);
  console.log(`      SIZ=${pc1.attributes.size} APP=${pc1.attributes.appearance}`);
  console.log("关键技能:");
  for (const k of ["fighting", "firearms_pistol", "spot_hidden", "listen", "stealth", "library_use", "occult", "psychology", "persuade", "fast_talk", "intimidate", "dodge"]) {
    const v = getSkillValue(pc1.occupationSkills, pc1.skillValues, k) || getBaseSkillValue(k, pc1.attributes.dexterity, pc1.attributes.education);
    if (v > 0) console.log(`  ${k}: ${v}%`);
  }
  console.log(`物品: ${pc1.startingItems.join(", ")}`);

  console.log("\n=== PC2: 詹姆斯·卡特 ===");
  console.log(`职业: ${pc2.archetypeId} | HP:${pc2.hp}/${pc2.maxHp} | DB:${pc2.damageBonus} | 幸运:${pc2.luck}`);
  console.log(`属性: STR=${pc2.attributes.strength} DEX=${pc2.attributes.dexterity} CON=${pc2.attributes.constitution}`);
  console.log(`      INT=${pc2.attributes.intelligence} POW=${pc2.attributes.power} EDU=${pc2.attributes.education}`);
  console.log(`      SIZ=${pc2.attributes.size} APP=${pc2.attributes.appearance}`);
  console.log("关键技能:");
  for (const k of ["medicine", "science_chemistry", "fighting", "spot_hidden", "listen", "library_use", "psychology", "persuade", "dodge", "first_aid"]) {
    const v = getSkillValue(pc2.occupationSkills, pc2.skillValues, k) || getBaseSkillValue(k, pc2.attributes.dexterity, pc2.attributes.education);
    if (v > 0) console.log(`  ${k}: ${v}%`);
  }
  console.log(`物品: ${pc2.startingItems.join(", ")}`);
}

main().catch(console.error);
