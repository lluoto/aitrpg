import { readFileSync, writeFileSync } from "fs";

const raw = readFileSync("src/rules/custom-modules/premiers_barn_raw.txt", "utf-8");
const ts = readFileSync("src/rules/custom-modules/premiers_barn.ts", "utf-8");

// Extract scene descriptions
const sceneBlock = ts.match(/sceneDescriptions:\s*\{([\s\S]*?)\}\s*,\n/);
const sceneDescs = {};
if (sceneBlock) {
  const pairs = sceneBlock[1].match(/"([^"]+)":\s*"([^"]+)"/g) || [];
  for (const p of pairs) {
    const m = p.match(/"([^"]+)":\s*"([^"]+)"/);
    if (m) sceneDescs[m[1]] = m[2];
  }
}

// Hook conditions (in order)
const conditions = [
  "特里坎家","菲碧_特里坎","加比的拖车房","奇怪的卡片",
  "普瑞米尔","在小镇内询问路人","维森酒吧","报亭","绑架犯的报道","霍姆斯医院",
  "与艾德里安的会面","关于艾米丽难产的事件","警察局","证物室","旅店","交火现场",
  "艾德里安在镇子内的住宅","抽屉里的关于_号农场的转购协议","与背景","可选",
  "艾德里安的农场","农场外围","艾德里安会在外围布置_3_种陷阱","农场主别墅",
  "谷仓形建筑","建筑内","中控室","艾德里安的卧室","下水道","维修间",
  "比较大的奇怪管道","艾米丽与爱莉的棺材","与米戈的战斗","关于缸中脑最后的去向",
  "结局","主要_npc","可能的敌人类","以下的法术则视情况让_mi_go_使用"
];

// Scene-only conditions (use scene desc as narration)
const sceneOnly = new Set([
  "特里坎家","加比的拖车房","奇怪的卡片","普瑞米尔","维森酒吧",
  "霍姆斯医院","与艾德里安的会面","警察局","证物室","旅店","交火现场",
  "艾德里安在镇子内的住宅","艾德里安的农场","农场外围","农场主别墅",
  "谷仓形建筑","建筑内","中控室","艾德里安的卧室","下水道","维修间",
  "比较大的奇怪管道","艾米丽与爱莉的棺材"
]);

function extractFromRaw(term) {
  // Normalize search
  const searches = [
    term, 
    term.replace(/_/g, " ").replace(/_(\d)/g, " $1"),
    term.replace(/_/g, ""),
    term.replace(/_/g, " "),
    term.split("_").join(" "),
  ];
  
  for (const s of [...new Set(searches)]) {
    const idx = raw.indexOf(s);
    if (idx >= 0) {
      let content = raw.slice(idx + s.length, idx + 300)
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/[▶]/g, "")
        .trim();
      // Find first sentence end
      const sentEnd = content.search(/[。！？]/);
      if (sentEnd > 5 && sentEnd < 250) {
        content = content.slice(0, sentEnd + 1);
      } else {
        content = content.slice(0, 150);
      }
      return content.trim();
    }
  }
  return "";
}

function escapeJson(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

const result = [];
for (const cond of conditions) {
  let narration, effect;
  if (sceneOnly.has(cond)) {
    narration = sceneDescs[cond] || extractFromRaw(cond) || "";
    effect = `进入场景「${cond}」`;
  } else if (cond === "菲碧_特里坎" || cond === "米尔_特里坎") {
    // These are NPC names used as clue sections - extract from raw
    const name = cond.replace("_", "·");
    const rawSnippet = extractFromRaw(name);
    narration = rawSnippet || `关于${cond.replace("_", "")}的线索`;
    effect = `触发NPC线索条件「${cond}」`;
  } else {
    narration = extractFromRaw(cond);
    effect = `触发条件「${cond}」`;
    if (!narration) {
      narration = "(原始文本中无对应段落)";
    }
  }
  result.push({ cond, narration, effect });
}

// Generate hooks array
let output = "  hooks: [\n";
for (const r of result) {
  output += `    { type: "on_enter_scene", condition: "${r.cond}", narration: "${escapeJson(r.narration)}", effect: "${escapeJson(r.effect)}" },\n`;
}
output += "  ],";

// Save to temp file for review
writeFileSync("tools/generated-hooks.txt", output);
console.log("Generated hooks written to tools/generated-hooks.txt");
console.log("Total hooks:", result.length);

// Show non-empty stats
let withNarration = 0;
let withoutNarration = 0;
for (const r of result) {
  if (r.narration && r.narration !== "(原始文本中无对应段落)") withNarration++;
  else withoutNarration++;
}
console.log("With narration:", withNarration);
console.log("Without narration:", withoutNarration);
