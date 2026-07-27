// 普瑞米尔的谷仓 — 模拟跑团运行器
// 用法: bun run src/simulate-mod.ts

import { createInterface } from "readline";
import * as fs from "fs";

import { CoCEngine, SanityEngine } from "./rules/coc-engine";
import { createCoCCharacter, getCoCArchetypes, getSkillValue, getBaseSkillValue, type CoCGeneratedCharacter } from "./character/coc-character";
import { InvestigationEngine } from "./investigation/investigation-engine";
import { WorldStateManager } from "./state/world-state-manager";

// ============================================================
// 模组场景状态
// ============================================================
const MODULE = {
  title: "普瑞米尔的谷仓",
  version: "ver1.03",
  year: 1921,
  location: "普瑞米尔小镇",
  startingScene: "特里坎家",
};

// 场景树
const SCENES: Record<string, string> = {
  "特里坎家": `1921年，普瑞米尔小镇。
一栋普通的美式小别墅前，你们按响了门铃。
一位穿着得体的中年女性打开了门——菲碧·特里坎，她显得焦虑而疲惫。
"请进，先生们。感谢你们愿意来。我的儿子加比已经失踪半个月了..."
屋内，一个5岁的小女孩在走廊探头看了看你们，又跑开了。

菲碧提供了加比的照片——一个打扮另类、身材高大但有些憔悴的17岁青年。
她说加比住在屋外的拖车里，或许那里能找到线索。`,
  
  "加比的拖车": `这间拖车房里面都是一些青年的物品。时下流行的音乐碟，乐队海报，
餐厅区域有不少空的啤酒罐与披萨盒，床上的被褥没有好好叠好，
床上还放着类似于乞丐裤之类的青年服饰。拖车内部还有一个小的卫生间。`,
  
  "维森酒吧": `维森酒吧是小镇唯二的酒吧之一，属于平民阶层与混混常来的场所。
虽然禁酒令施行，但这乡下地区显然执行不到位。
酒吧有自己的保安，在角落能看到他们的身影。`,
  
  "报亭": `小镇的报亭，可以购买到最近的报纸。
老板是个看起来不太耐烦的中年男人。`,
  
  "霍姆斯医院": `一间看上去有些年头的建筑，墙面油漆有些脱落。
医院附近人不多，大厅里一位分诊员正在柜台前昏昏欲睡。
照明有些昏暗。医院有3层。`,

  "警察局": `普瑞米尔警局，外墙是新刷的油漆。
星条旗在旗杆上飘扬。警局内人不多，
整洁得有些让人不适应。`,

  "艾德里安的住宅": `一栋独门独户的小别墅，靠近贫民窟。
似乎已经荒废了一段时间，门前的草坪很久没有修整过，
一侧的玻璃窗有被打破的痕迹。`,

  "农场外围": `这间农场周围围着简单的木质栅栏，油漆被雨水腐蚀。
入口处能看到一些田地，完全没打理的样子。
远处可以看到一间红色谷仓和一栋农场主别墅。`,

  "谷仓建筑": `谷仓内部已被简单改造过。
显眼的是放置在周围的床铺，上面躺着人，
他们的上半身被奇怪的仪器罩着。
凌乱的线路朝着内部延伸。
门口还有一具尸体，眼睛睁着盯着大门。`,

  "中控室": `一台占据了大片区域的机器，有3个显示器。
下面是控制台，有许多按钮和旋钮。
线路随意地落在外面，机器持续发出风扇轰鸣。
一旁有冰箱和储物柜。`,

  "下水道": `废弃的下水道，强行挖通过来。
已经干涸，墙壁上长着青苔，
充斥着腐烂与陈朽的味道，几乎没有光线。`,

  "维修间": `昏暗的房间，弥漫着机油与医用酒精的味道。
有两个支撑梁，右手边有一张桌子，
一旁有类似展柜的金属架。`,
};

// ============================================================
// 游戏状态
// ============================================================
let round = 0;
let currentScene = "特里坎家";
let discoveredClues: string[] = [];
let phase: "intro" | "investigation" | "farm" | "sewer" | "finale" = "intro";

const journal: string[] = [];

function log(msg: string) {
  const line = `[第${round}回合] ${msg}`;
  console.log(`  📝 ${line}`);
  journal.push(line);
}

// ============================================================
// 角色系统
// ============================================================
let pc1: CoCGeneratedCharacter | null = null;
let pc2: CoCGeneratedCharacter | null = null;
const sanity = new SanityEngine(55);

async function createPCs() {
  const archs = getCoCArchetypes();
  const archDetective = archs.find((a: any) => a.id === "detective")!;
  const archDoctor = archs.find((a: any) => a.id === "doctor_medicine")!;

  pc1 = await createCoCCharacter(
    { name: "亨利·摩根", archetypeId: "detective", method: "point_buy" as const, points: 480 },
    archDetective
  );
  pc2 = await createCoCCharacter(
    { name: "詹姆斯·卡特", archetypeId: "doctor_medicine", method: "point_buy" as const, points: 480 },
    archDoctor
  );

  sanity.state.currentSAN = pc1.attributes.power ?? 50;
  sanity.state.maxSAN = Math.max(pc1.attributes.power ?? 50, pc2.attributes.power ?? 50);
  
  console.log("\n  📜 调查员已就位");
  console.log(`  🔹 亨利·摩根 — 私家侦探 | HP:${pc1.hp}/11 | 幸运:${pc1.luck} | DB:${pc1.damageBonus}`);
  console.log(`  🔹 詹姆斯·卡特 — 医生 | HP:${pc2.hp}/10 | 幸运:${pc2.luck} | DB:${pc2.damageBonus}`);
}

function getSkill(character: CoCGeneratedCharacter, key: string): number {
  return getSkillValue(character.occupationSkills, character.skillValues, key)
    || getBaseSkillValue(key, character.attributes.dexterity, character.attributes.education)
    || 0;
}

function showSheet(which: 1 | 2) {
  const c = which === 1 ? pc1 : pc2;
  if (!c) return;
  console.log(`\n  📜 ${c.name} [${c.archetypeId}]`);
  console.log(`  HP:${c.hp}/${c.maxHp} DB:${c.damageBonus} 幸运:${c.luck}`);
  console.log(`  STR=${c.attributes.strength} CON=${c.attributes.constitution} SIZ=${c.attributes.size}`);
  console.log(`  DEX=${c.attributes.dexterity} INT=${c.attributes.intelligence} POW=${c.attributes.power} EDU=${c.attributes.education}`);
  const skills = ["spot_hidden", "listen", "library_use", "psychology", "persuade", "fighting", "firearms_pistol", "dodge", "stealth", "medicine", "first_aid", "occult"];
  const lines = skills.filter(k => getSkill(c, k) > 0).map(k => `${k}=${getSkill(c, k)}%`).join(" ");
  console.log(`  技能: ${lines}`);
}

// ============================================================
// 检定辅助
// ============================================================
function skillCheck(character: CoCGeneratedCharacter, skillName: string, difficulty: "regular" | "hard" | "extreme" = "regular", bonusDice = 0, penaltyDice = 0): string {
  const skillValue = getSkill(character, skillName);
  if (skillValue <= 0) return `${skillName}: 无此技能`;
  const result = CoCEngine.skillCheck(skillValue, difficulty, bonusDice, penaltyDice);
  const slLabel: Record<string, string> = { critical: "大成功", extreme: "极限成功", hard: "困难成功", regular: "常规成功", fail: "失败", fumble: "大失败" };
  return `${character.name} — ${skillName}(${skillValue}%): d100=${result.roll} → ${slLabel[result.successLevel]}`;
}

// ============================================================
// 主循环 — 接收玩家输入并处理
// ============================================================
async function processTurn(p1Action: string, p2Action: string) {
  round++;
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  第 ${round} 回合 | 场景: ${currentScene}`);
  console.log(`${"═".repeat(60)}`);

  console.log(`\n  🔹 亨利: "${p1Action}"`);
  console.log(`  🔹 詹姆斯: "${p2Action}"`);

  // 解析命令
  const p1Lower = p1Action.toLowerCase();
  const p2Lower = p2Action.toLowerCase();

  // /sheet 命令
  if (p1Action.startsWith("/sheet")) showSheet(1);
  if (p2Action.startsWith("/sheet")) showSheet(2);
  
  // /check 命令 — CoC技能检定
  const checkMatch = (s: string) => s.match(/^\/cc?\s+(.+)/);
  const m1 = checkMatch(p1Lower);
  const m2 = checkMatch(p2Lower);
  if (m1 && pc1) console.log(`  🎲 ${skillCheck(pc1, m1[1])}`);
  if (m2 && pc2) console.log(`  🎲 ${skillCheck(pc2, m2[1])}`);

  // /luck 燃运
  const luckMatch = (s: string) => s.match(/^\/luck\s+(\d+)\s+(.+)/);
  const l1 = luckMatch(p1Lower);
  const l2 = luckMatch(p2Lower);
  if (l1 && pc1) {
    const n = parseInt(l1[1]);
    if (n <= pc1.luck) {
      const r = CoCEngine.skillCheck(getSkill(pc1, l1[2]), "regular", 0, 0, n);
      pc1.luck -= n;
      console.log(`  🍀 ${pc1.name} 燃运${n}: ${r.description} (剩余幸运:${pc1.luck})`);
    } else console.log(`  ❌ ${pc1.name} 幸运不足 (${pc1.luck})`);
  }
  if (l2 && pc2) {
    const n = parseInt(l2[1]);
    if (n <= pc2.luck) {
      const r = CoCEngine.skillCheck(getSkill(pc2, l2[2]), "regular", 0, 0, n);
      pc2.luck -= n;
      console.log(`  🍀 ${pc2.name} 燃运${n}: ${r.description} (剩余幸运:${pc2.luck})`);
    } else console.log(`  ❌ ${pc2.name} 幸运不足 (${pc2.luck})`);
  }

  // 场景切换
  if (p1Action.startsWith("去") || p2Action.startsWith("去") ||
      p1Action.startsWith("前往") || p2Action.startsWith("前往")) {
    for (const [sceneKey, sceneDesc] of Object.entries(SCENES)) {
      if (p1Action.includes(sceneKey) || p2Action.includes(sceneKey)) {
        if (sceneKey !== currentScene) {
          currentScene = sceneKey;
          console.log(`\n  🚶 前往: ${sceneKey}`);
          console.log(`  ${sceneDesc}`);
        }
        break;
      }
    }
  }

  // 调查动作
  if (p1Action.includes("调查") || p1Action.includes("搜索") || p1Action.includes("检查") ||
      p2Action.includes("调查") || p2Action.includes("搜索") || p2Action.includes("检查")) {
    if (pc1 && (p1Action.includes("调查") || p1Action.includes("搜索"))) {
      const r = CoCEngine.skillCheck(getSkill(pc1, "spot_hidden"), "regular");
      console.log(`  🔍 ${pc1.name} 侦查: d100=${r.roll} → ${r.isSuccess ? "成功" : "失败"}`);
      if (r.isSuccess) { discoveredClues.push(`在${currentScene}发现线索`); console.log(`  📌 发现新线索！`); }
    }
    if (pc2 && (p2Action.includes("调查") || p2Action.includes("搜索"))) {
      const r = CoCEngine.skillCheck(getSkill(pc2, "spot_hidden"), "regular");
      console.log(`  🔍 ${pc2.name} 侦查: d100=${r.roll} → ${r.isSuccess ? "成功" : "失败"}`);
      if (r.isSuccess) { discoveredClues.push(`在${currentScene}发现线索`); console.log(`  📌 发现新线索！`); }
    }
  }

  // 与NPC对话
  if (p1Action.includes("对话") || p1Action.includes("询问") || p1Action.includes("说话") ||
      p2Action.includes("对话") || p2Action.includes("询问") || p2Action.includes("说话")) {
    if (pc1) {
      const r = CoCEngine.skillCheck(getSkill(pc1, "persuade"), "regular");
      console.log(`  💬 ${pc1.name} 说服: d100=${r.roll} → ${r.isSuccess ? "成功" : "失败"}`);
    }
  }

  log(`${pc1?.name}: ${p1Action} | ${pc2?.name}: ${p2Action}`);
}

// ============================================================
// 模组流程控制
// ============================================================
function showSceneIntro() {
  console.clear();
  console.log("═".repeat(60));
  console.log(`  《${MODULE.title}》${MODULE.version}`);
  console.log(`  ${MODULE.year}年，${MODULE.location}`);
  console.log("═".repeat(60));
  console.log(`\n${SCENES["特里坎家"]}`);
  console.log(`\n  🎯 任务: 寻找失踪青年 加比·特里坎（17岁）`);
  console.log(`  💡 建议从加比的拖车开始调查（输入"去加比的拖车"）`);
}

// ============================================================
// 导出的函数，供外部调用
// ============================================================
export async function initModule() {
  await createPCs();
  showSceneIntro();
}

export async function runTurn(p1: string, p2: string) {
  return processTurn(p1, p2);
}

export function getState() {
  return { round, currentScene, phase, discoveredClues: [...discoveredClues], journal: [...journal] };
}

export function getPC(n: 1 | 2) { return n === 1 ? pc1 : pc2; }

// ============================================================
// 直接运行模式
// ============================================================
async function main() {
  await initModule();

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  async function askTurn() {
    console.log(`\n  当前场景: ${currentScene} | 线索: ${discoveredClues.length}条`);
    rl.question(`\n🔹 亨利的行动: `, async (a1) => {
      if (a1 === "exit" || a1 === "quit") { console.log("\n  模组结束。"); rl.close(); return; }
      if (a1 === "/pc1") { showSheet(1); askTurn(); return; }
      if (a1 === "/pc2") { showSheet(2); askTurn(); return; }
      if (a1 === "/state") { console.log(getState()); askTurn(); return; }
      
      rl.question(`🔹 詹姆斯的行动: `, async (a2) => {
        if (a2 === "exit" || a2 === "quit") { console.log("\n  模组结束。"); rl.close(); return; }
        await processTurn(a1, a2);
        askTurn();
      });
    });
  }

  askTurn();
}

if (require.main === module) {
  main().catch(console.error);
}
