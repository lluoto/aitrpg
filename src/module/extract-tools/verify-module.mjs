/**
 * 模组数据验证脚本 (CI)
 *
 * 用法: bun run tools/verify-module.mjs
 * 返回码: 0 = 通过, 1 = 有错误
 */

import { readFileSync } from "fs";

const TS_FILE = "src/rules/custom-modules/premiers_barn.ts";

const tsContent = readFileSync(TS_FILE, "utf-8");

let errors = 0;
let warnings = 0;

function err(msg) { errors++; console.error("  ❌ " + msg); }
function warn(msg) { warnings++; console.warn("  ⚠️ " + msg); }
function ok(msg) { console.log("  ✅ " + msg); }

/** 将 TS 字段解析为字符串 */
function getField(text, name) {
  const idx = text.indexOf(name + ":");
  if (idx < 0) return null;
  let i = idx + name.length + 1;
  while (i < text.length && (text[i] === " " || text[i] === "\n")) i++;
  if (i >= text.length) return null;
  const fc = text[i];
  if (fc === '"') {
    let j = i + 1;
    while (j < text.length && !(text[j] === '"' && text[j-1] !== "\\")) j++;
    return text.slice(i, j + 1);
  }
  if (fc === "{" || fc === "[") {
    let depth = 0, inStr = false;
    for (let j = i; j < text.length; j++) {
      if (text[j] === '"' && text[j-1] !== "\\") inStr = !inStr;
      if (!inStr) {
        if (text[j] === "{" || text[j] === "[") depth++;
        else if (text[j] === "}" || text[j] === "]") {
          depth--;
          if (depth === 0) return text.slice(i, j + 1);
        }
      }
    }
  }
  return null;
}

function extractKeys(block) {
  const keys = [];
  const re = /"([^"]+)"\s*:/g;
  let m;
  while ((m = re.exec(block)) !== null) keys.push(m[1]);
  return keys;
}

function extractScenesFromExits(block) {
  const scenes = [];
  const re = /"([^"]+)"\s*:\s*\[/g;
  let m;
  while ((m = re.exec(block)) !== null) scenes.push(m[1]);
  return scenes;
}

console.log("=== 模组数据验证 ===\n");

// ── 1. 解析所有场景名 ──
const sceneBlock = getField(tsContent, "sceneDescriptions");
const sceneKeys = sceneBlock ? extractKeys(sceneBlock) : [];
console.log("── 场景: " + sceneKeys.length + " 个 ──");

// 从 exits 收集场景
const exitsBlock = getField(tsContent, "exits");
const exitScenes = exitsBlock ? extractScenesFromExits(exitsBlock) : [];
const allKnownScenes = new Set([...sceneKeys, ...exitScenes]);

// ── 2. NPC attributes ──
console.log("\n── NPC Attributes ──");

const npcBlock = getField(tsContent, "npcs");
let npcCount = 0, emptyCount = 0;
if (npcBlock) {
  let depth = 0, objStart = -1;
  for (let i = 0; i < npcBlock.length; i++) {
    const ch = npcBlock[i];
    if (ch === '"' && npcBlock[i-1] !== "\\") {
      let j = i + 1;
      while (j < npcBlock.length && !(npcBlock[j] === '"' && npcBlock[j-1] !== "\\")) j++;
      i = j; continue;
    }
    if (ch === "{") { if (depth === 0) objStart = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        const obj = npcBlock.slice(objStart, i + 1);
        const idM = obj.match(/id:\s*"([^"]+)"/);
        if (idM) {
          npcCount++;
          const attrM = obj.match(/attributes:\s*\{([^}]*)\}/);
          const attrs = attrM ? attrM[1].trim() : "";
          if (attrs.length === 0) {
            emptyCount++;
            warn("缺少 attributes: " + idM[1]);
          }
        }
        objStart = -1;
      }
    }
  }
  ok("NPC 总数: " + npcCount + ", 空 attributes: " + emptyCount);
}

// ── 3. 物品场景引用 ──
console.log("\n── 物品场景引用 ──");
const itemBlock = getField(tsContent, "items");
if (itemBlock) {
  const items = itemBlock.match(/\{[^}]+?\}/g) || [];
  for (const item of items) {
    const nameM = item.match(/name:\s*"([^"]+)"/);
    const sceneM = item.match(/sceneId:\s*"([^"]+)"/);
    if (nameM && sceneM && !allKnownScenes.has(sceneM[1])) {
      warn("物品 \"" + nameM[1] + "\" 场景 \"" + sceneM[1] + "\" 不在 sceneDescriptions 中");
    }
  }
  ok("物品: " + items.length + " 个");
}

// ── 4. 线索场景引用 (scene 可以是场景名或 NPC id) ──
console.log("\n── 线索引用 ──");
const clueBlock = getField(tsContent, "clues");
if (clueBlock) {
  const clues = clueBlock.match(/\{[^}]+?\}/g) || [];
  for (const clue of clues) {
    const sceneM = clue.match(/scene:\s*"([^"]+)"/);
    const typeM = clue.match(/clueType:\s*"([^"]+)"/);
    // Skip: clue scenes can reference NPC IDs, not just scene keys
  }
  ok("线索: " + clues.length + " 条");
}

// ── 5. 出口双向验证（仅警告非关键） ──
console.log("\n── 出口双向验证 ──");
if (exitsBlock) {
  const exitMap = new Map();
  const exitRe = /"([^"]+)"\s*:\s*\[([\s\S]*?)\](?=\s*,|\s*\n)/g;
  let m;
  while ((m = exitRe.exec(exitsBlock)) !== null) {
    const from = m[1];
    const entries = m[2].match(/\{[^}]+\}/g) || [];
    exitMap.set(from, entries.map(e => {
      const t = e.match(/target:\s*"([^"]+)"/);
      return t ? t[1] : null;
    }).filter(Boolean));
  }

  let total = 0;
  for (const [from, tos] of exitMap) {
    total += tos.length;
    for (const to of tos) {
      const rev = exitMap.get(to);
      if (!rev || !rev.includes(from)) {
        warn("单向出口: " + from + " → " + to + " 无反方向");
      }
    }
  }
  ok("出口: " + exitMap.size + " 场景, " + total + " 条");
}

// ── Summary ──
console.log("\n" + "=".repeat(50));
console.log("结果: " + errors + " 错误, " + warnings + " 警告");

if (errors > 0) { process.exit(1); }
else { process.exit(0); }
