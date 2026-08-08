/**
 * 校正循环脚本
 * 对比 raw.txt 原始章节 vs premiers_barn.ts 结构化数据
 * 输出差异报告，指出需要修正的地方
 * 
 * 用法: bun run tools/calibrate.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = resolve(__dirname, "..");
const RAW_FILE = BASE + "/src/rules/custom-modules/premiers_barn_raw.txt";
const TS_FILE = BASE + "/src/rules/custom-modules/premiers_barn.ts";
const OUT = BASE + "/tools/modules";

const rawContent = readFileSync(RAW_FILE, "utf-8");
const tsContent = readFileSync(TS_FILE, "utf-8");

// ── 工具函数 ──

function extractField(text, fieldName) {
  const regex = new RegExp("(\\n\\s{2}" + fieldName + "\\s*:\\s*)");
  const m = text.match(regex);
  if (!m) return null;
  const start = m.index + m[1].length;
  const firstChar = text[start];
  if (firstChar === '"') {
    let result = '"';
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === '"' && text[i-1] !== '\\') { result += '"'; return result; }
      result += text[i];
    }
  } else if (firstChar === '[' || firstChar === '{') {
    let depth = 0, inStr = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) { if (ch === '"' && text[i-1] !== '\\') inStr = false; }
      else {
        if (ch === '"') inStr = true;
        else if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') { depth--; if (depth <= 0) return text.slice(start, i + 1); }
      }
    }
  }
  return null;
}

function extractStrArray(text, fieldName) {
  const block = extractField(text, fieldName);
  if (!block) return [];
  // Parse array of objects or strings
  const items = [];
  const objRegex = /\{[^}]+\}/g;
  let match;
  while ((match = objRegex.exec(block)) !== null) {
    items.push(match[0]);
  }
  return items;
}

function extractMapKeys(text, fieldName) {
  const block = extractField(text, fieldName);
  if (!block) return [];
  const keys = [];
  const keyRegex = /"([^"]+)"\s*:/g;
  let match;
  while ((match = keyRegex.exec(block)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}

function extractSceneIdsFromItems(text) {
  const block = extractField(text, "items");
  if (!block) return [];
  const ids = [];
  const idRegex = /sceneId:\s*"([^"]+)"/g;
  let match;
  while ((match = idRegex.exec(block)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

// ── 对比报告 ──

const report = [];
let errors = 0;
let warnings = 0;

function err(msg) { errors++; report.push("  ❌ " + msg); }
function warn(msg) { warnings++; report.push("  ⚠️ " + msg); }
function ok(msg) { report.push("  ✅ " + msg); }

// ── 1. 对比 metadata ──
report.push("\n## 1. 元数据对比");

const metaFields = {
  name: "普瑞米尔的谷仓",
  version: "ver1.03",
  difficulty: "easy",
  source: "MikuFan",
};
for (const [k, v] of Object.entries(metaFields)) {
  const extracted = extractField(tsContent, k);
  if (!extracted) { err(k + " 未提取"); continue; }
  const clean = extracted.replace(/^"/, "").replace(/"$/, "");
  if (clean.includes(v) || v.includes(clean)) ok(k + ": " + clean);
  else warn(k + " 值不匹配: TS=\"" + clean + "\", 预期包含\"" + v + "\"");
}

// introNarration
const intro = extractField(tsContent, "introNarration");
if (intro) {
  const introClean = intro.replace(/^"/, "").replace(/"$/, "");
  if (introClean.includes("菲碧·特里坎")) ok("introNarration 包含菲碧·特里坎");
  else warn("introNarration 可能不完整");
}

// ── 2. 对比场景描述 ──
report.push("\n## 2. 场景描述对比");

const sceneKeys = extractMapKeys(tsContent, "sceneDescriptions");
const rawHasScenes = ["特里坎家", "加比的拖车房", "普瑞米尔", "维森酒吧", "霍姆斯医院",
  "警察局", "旅店", "交火现场", "艾德里安在镇子内的住宅", "艾德里安的农场",
  "农场主别墅", "谷仓形建筑", "建筑内", "中控室", "艾德里安的卧室",
  "下水道", "维修间", "比较大的奇怪管道", "艾米丽与爱莉的棺材",
  "证物室", "与艾德里安的会面"];

for (const s of rawHasScenes) {
  if (sceneKeys.includes(s)) ok("场景描述存在: " + s);
  else warn("场景描述缺失: " + s);
}

// Check for extra scenes in TS that aren't in raw
const extraInTs = sceneKeys.filter(k => !rawHasScenes.includes(k) && k !== "奇怪的卡片");
for (const s of extraInTs) warn("TS 有多余场景描述: " + s);

// 奇怪的卡片 is from raw section_03 but not a physical scene — expected
if (sceneKeys.includes("奇怪的卡片")) ok("奇怪的卡片 场景描述存在 (非物理场景)");

// ── 3. 对比物品 ──
report.push("\n## 3. 物品对比");

const rawItemMentions = [];
// Scan raw for item-like mentions
const rawItems = rawContent.match(/▶[^▶]+?(?:钥匙|照片|钱包|驾驶证|陷阱|文件|笔记|卡片|手枪|步枪|霰弹枪|电棒|氧气瓶|流食)/g);
if (rawItems) {
  for (const r of rawItems) {
    const name = r.replace(/^▶/, "").trim();
    rawItemMentions.push(name.substring(0, 30));
  }
}

// From TS items
const tsItemsBlock = extractField(tsContent, "items");
const tsItemNames = [];
if (tsItemsBlock) {
  const nameRegex = /name:\s*"([^"]+)"/g;
  let match;
  while ((match = nameRegex.exec(tsItemsBlock)) !== null) tsItemNames.push(match[1]);
}
ok("TS 定义物品: " + tsItemNames.join(", "));
// Check each against raw
const itemsToCheck = [
  "防盗门的钥匙", "农场的照片", "钱包", "驾驶证", "住宅钥匙",
  "捕兽夹", "锯短霰弹枪拌锁陷阱", "音响陷阱", "硫酸陷阱", "老旧文件"
];
for (const item of itemsToCheck) {
  if (tsItemNames.includes(item)) ok("物品存在: " + item);
  else err("物品缺失: " + item);
}

// ── 4. 对比 NPC ──
report.push("\n## 4. NPC 对比");

const npcBlock = extractField(tsContent, "npcs");
const npcNames = [];
const npcWithAttrs = [];
const npcEmptyAttrs = [];

if (npcBlock) {
  const npcRegex = /id:\s*"([^"]+)"[^}]*attributes:\s*\{([^}]*)\}/gs;
  // Alternative: extract NPCs manually
  const npcObjs = npcBlock.split(/\},\s*\{/);
  for (const obj of npcObjs) {
    const idMatch = obj.match(/id:\s*"([^"]+)"/);
    if (idMatch) {
      npcNames.push(idMatch[1]);
      if (obj.includes("attributes: {  }") || obj.includes("attributes: {}") || obj.includes("attributes:{\n")) {
        npcEmptyAttrs.push(idMatch[1]);
      } else {
        npcWithAttrs.push(idMatch[1]);
      }
    }
  }
}
ok("NPC 总数: " + npcNames.length);
for (const n of npcWithAttrs) ok("  " + n + " — 有 attributes");
for (const n of npcEmptyAttrs) warn("  " + n + " — attributes 为空");

// ── 5. 对比线索 ──
report.push("\n## 5. 线索对比");

const cluesBlock = extractField(tsContent, "clues");
const clueMatches = cluesBlock ? cluesBlock.match(/clueType:\s*"([^"]+)"/g) : [];
ok("TS 线索数: " + (clueMatches ? clueMatches.length : 0));

// ── 6. 对比法术 ──
report.push("\n## 6. 法术对比");

const rawSpells = rawContent.match(/僵尸创造术|纳克-提特障壁创建术|帕祖祖之息|Mi-Go\s+修改版/g);
const tsSpellsBlock = extractField(tsContent, "spells");
const tsSpellNames = [];
if (tsSpellsBlock) {
  const nameRegex = /name:\s*"([^"]+)"/g;
  let match;
  while ((match = nameRegex.exec(tsSpellsBlock)) !== null) tsSpellNames.push(match[1]);
}
if (rawSpells) {
  for (const s of rawSpells) {
    const cleanName = s.replace(/\s+/g, " ").trim();
    const found = tsSpellNames.some(t => t.replace(/\s+/g, " ").trim().includes(cleanName) || cleanName.includes(t.replace(/\s+/g, " ").trim()));
    if (found) ok("法术存在: " + cleanName);
    else err("法术缺失: " + cleanName);
  }
}

// ── 7. 对比导出 ──
report.push("\n## 7. 出口连接对比");

const exitsBlock = extractField(tsContent, "exits");
const exitKeys = extractMapKeys(tsContent, "exits");
ok("有出口的场景数: " + exitKeys.length);

// ── 8. RAW 附录 NPC 技能数据 vs TS NPC ──
report.push("\n## 8. NPC 技能数据对比 (附录 section_15)");

const rawSkillsMatch = rawContent.match(/艾德里安[^]*?Str\d+/);
if (rawSkillsMatch) {
  const skillsSection = rawContent.match(/主要\s+NPC[\s\S]*?(?=可能的敌对人类)/);
  if (skillsSection) {
    ok("找到了 raw 附录 NPC 技能数据段 (" + skillsSection[0].length + " 字符)");
    
    // Check which NPCs have skills data in raw but missing from TS
    const rawNpcNames = [];
    const npcNameRegex = /^([^\d]+?)\s+\d+/gm;
    let nMatch;
    while ((nMatch = npcNameRegex.exec(skillsSection[0])) !== null) {
      rawNpcNames.push(nMatch[1].trim());
    }
    for (const rn of rawNpcNames) {
      if (rn.includes("艾德里安")) {
        if (npcWithAttrs.some(n => n.includes("艾德里安"))) ok("艾德里安有 attributes (含技能)");
      } else if (rn.includes("艾米丽")) {
        if (rn.includes("作为")) continue; // "艾米丽作为 20th..." 是注释，非 NPC
        if (npcEmptyAttrs.some(n => n.includes("艾米丽"))) warn("艾米丽 attributes 为空, raw 有技能数据: " + rn);
      } else if (rn.includes("爱莉")) {
        // baby, no skills needed
      } else if (rn.includes("菲碧") || rn.includes("加比") || rn.includes("米尔")) {
        // Check if TS now has attributes for this NPC
        const hasTsAttrs = npcWithAttrs.some(n => n.includes(rn.trim()));
        if (!hasTsAttrs) warn(rn.trim() + " attributes 为空, raw 有基础属性数据");
      }
    }
  }
}

// Check enemy NPCs
const enemySection = rawContent.match(/可能的敌对人类[\s\S]*?(?=敌对神话生物)/);
if (enemySection) {
  ok("找到了敌对 NPC 数据段");
  const enemyNames = ["流浪汉", "警员", "酒吧保镖"];
  for (const en of enemyNames) {
    if (npcNames.some(n => n.includes(en))) ok("敌对 NPC 存在: " + en);
    else err("敌对 NPC 缺失: " + en);
  }
}

// ── 9. 怪物数据对比 ──
report.push("\n## 9. 神话生物数据对比");

const monsterSection = rawContent.match(/敌对神话生物[\s\S]*?(?=-- 18 of 18 --)/);
if (monsterSection) {
  ok("找到了神话生物数据段");
  const monsterNames = ["食尸鬼", "Mi-Go"];
  for (const mn of monsterNames) {
    if (npcNames.some(n => n.toLowerCase().includes(mn.toLowerCase()) || n.toLowerCase() === mn.toLowerCase())) ok("怪物存在: " + mn);
    else err("怪物缺失: " + mn);
  }
}

// ── 10. Hooks 完整性 ──
report.push("\n## 10. 钩子完整性");

const hooksBlock = extractField(tsContent, "hooks");
if (hooksBlock) {
  const hookConditions = [];
  const condRegex = /condition:\s*"([^"]+)"/g;
  let match;
  while ((match = condRegex.exec(hooksBlock)) !== null) hookConditions.push(match[1]);
  ok("钩子数: " + hookConditions.length);
}

// ── Summary ──
report.push("\n" + "=".repeat(50));
report.push("校正报告: " + errors + " 个错误, " + warnings + " 个警告");
report.push("=".repeat(50));

const reportStr = report.join("\n");
writeFileSync(OUT + "/CALIBRATION_REPORT.md", reportStr, "utf-8");
console.log(reportStr);
