/**
 * 模块拆分脚本 v2
 * 1. 将 raw.txt 按 18 个章节拆分为独立 txt 文件（含前言 section_00）
 * 2. 将 premiers_barn.ts 的各数据模块拆分为独立 txt 文件
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = resolve(__dirname, "..");
const RAW = BASE + "/src/rules/custom-modules/premiers_barn_raw.txt";
const TS = BASE + "/src/rules/custom-modules/premiers_barn.ts";
const OUT = BASE + "/tools/modules";

mkdirSync(OUT + "/raw", { recursive: true });
mkdirSync(OUT + "/structured", { recursive: true });

// ── 1. 拆分 raw.txt ──
const rawContent = readFileSync(RAW, "utf-8");
const lines = rawContent.split("\n");
let currentSectionLines = [];
let currentNum = 0;
const sections = [];
let capturedFirst = false;

for (const line of lines) {
  const m = line.match(/^-- (\d+) of 18 --$/);
  if (m) {
    // Save previous section
    if (currentSectionLines.length > 0) {
      const content = currentSectionLines.join("\n").trim();
      if (content) {
        sections.push({ num: currentNum, content: content });
      }
    }
    currentSectionLines = [];
    currentNum = parseInt(m[1]);
    capturedFirst = true;
  } else {
    if (!capturedFirst) {
      // Content before first marker → section 00 (header)
      currentSectionLines.push(line);
      currentNum = 0;
    } else if (currentNum > 0) {
      currentSectionLines.push(line);
    }
  }
}
// Last section
if (currentSectionLines.length > 0) {
  const content = currentSectionLines.join("\n").trim();
  if (content) {
    sections.push({ num: currentNum, content: content });
  }
}

console.log("raw.txt 共 " + sections.length + " 个章节 (含 header)");
for (const s of sections) {
  const label = s.num === 0 ? "00_header" : "section_" + String(s.num).padStart(2, "0");
  const path = OUT + "/raw/" + label + ".txt";
  writeFileSync(path, s.content, "utf-8");
  console.log("  写入 " + label + ".txt (" + s.content.length + " 字符, " + s.content.split("\n").length + " 行)");
}

// ── 2. 拆分 premiers_barn.ts ──
const tsContent = readFileSync(TS, "utf-8");

function extractBlock(text, fieldName) {
  const fieldRegex = new RegExp("(\\n\\s{2}" + fieldName + "\\s*:\\s*)");
  const m = text.match(fieldRegex);
  if (!m) return null;
  
  const start = m.index + m[1].length;
  const firstChar = text[start];
  
  if (firstChar === '"') {
    let result = '"';
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === '"' && text[i-1] !== '\\') {
        result += '"';
        return result;
      }
      result += text[i];
    }
  } else if (firstChar === '[' || firstChar === '{') {
    let depth = 0;
    let inStr = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (ch === '"' && text[i-1] !== '\\') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') {
          depth--;
          if (depth <= 0) return text.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

// Ordered by appearance in TS file — stop when we hit a field at indent 2
function extractAllFields(text) {
  const fields = [];
  // Match lines like "  fieldName:"
  const regex = /^\s{2}([a-zA-Z]\w+)\s*:/gm;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const fieldName = match[1];
    const content = extractBlock(text, fieldName);
    fields.push({ name: fieldName, content: content });
  }
  return fields;
}

const allFields = extractAllFields(tsContent);
console.log("\npremiers_barn.ts 模块 (" + allFields.length + " 个顶层字段):");
for (const f of allFields) {
  if (f.content) {
    const fpath = OUT + "/structured/" + f.name + ".txt";
    writeFileSync(fpath, f.content, "utf-8");
    console.log("  ✅ " + f.name + ".txt (" + f.content.length + " 字符)");
  } else {
    console.log("  ⚠️ " + f.name + ": 提取失败");
  }
}

// ── 3. Summary ──
let summary = "# 模块拆分报告\n\n## raw.txt → " + sections.length + " 个章节\n";
for (const s of sections) {
  const label = s.num === 0 ? "00_header" : "section_" + String(s.num).padStart(2, "0");
  const title = s.content.split("\n")[0].trim().substring(0, 80);
  summary += "- " + label + ".txt: " + title + "\n";
}

summary += "\n## premiers_barn.ts → " + allFields.length + " 个顶层字段\n";
for (const f of allFields) {
  summary += "- " + f.name + ".txt " + (f.content ? "✅" : "❌") + "\n";
}

writeFileSync(OUT + "/SUMMARY.md", summary, "utf-8");
console.log("\n✅ 拆分完成! 输出目录: " + OUT);
console.log("   查看: " + OUT + "/SUMMARY.md");
