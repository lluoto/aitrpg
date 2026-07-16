/**
 * CoC 7e 模组提取器
 * ====================
 *
 * 从 PDF 中提取结构化模块数据，生成 MythosModule TypeScript 代码。
 *
 * 设计原则：
 * 1. 完整 — 保留模组内的叙事文本、描述、背景信息（模组由玩家提供，IP 责任不在我们）。
 * 2. 可复现 — 相同 PDF → 一致的结构化输出。
 * 3. 可编辑 — 生成标准的 MythosModule 代码，GM 可按需修改。
 *
 * 用法：
 *   bun src/tools/extract-module.ts --pdf "模组.pdf" --id module_id --name "模块名"
 *
 * 输出文件：src/rules/custom-modules/{id}.ts（自动生成）
 *
 * 依赖：pdf-parse（已安装）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname, basename } from "path";

// ── 类型定义 ──

export interface ExtractedModule {
  id: string;
  name: string;
  version: string;
  description: string;
  difficulty: "easy" | "medium" | "hard" | "nightmare";
  source?: string;
  activation: { type: "manual" | "location_enter" | "item_found" | "read_tome" | "san_threshold"; condition: string };
  introNarration?: string;
  spells: ExtractedSpell[];
  tomes: ExtractedTome[];
  items: ExtractedItem[];
  npcs: ExtractedNPC[];
  clues: ExtractedClue[];
  hooks: ExtractedHook[];
  scenes: ExtractedScene[];
}

export interface ExtractedSpell {
  name: string;
  sanCost: string;
  mpCost: number;
  description: string;
}

export interface ExtractedTome {
  name: string;
  sceneId: string;
  sanCost: string;
  tomeRating: number;
  spells?: string[];
  description: string;
}

export interface ExtractedItem {
  name: string;
  sceneId: string;
  description: string;
}

export interface ExtractedNPC {
  id: string;
  name: string;
  type: "npc" | "monster";
  hp: number;
  maxHp: number;
  ac: number;
  faction: string;
  sceneId: string;
  mythosCreatureId?: string;
  role?: string;
  personality?: string;
  background?: string;
  goals?: string[];
  speechStyle?: string;
  secrets?: string[];
  attributes?: Record<string, number>;
}

export interface ExtractedClue {
  scene: string;
  clueType: string;
  description: string;
  sanCost?: string;
  skillRequired?: string;
}

export interface ExtractedHook {
  type: "on_enter_scene" | "on_combat_start" | "on_read_tome" | "on_investigate";
  condition: string;
  narration?: string;
  effect?: string;
}

export interface ExtractedScene {
  id: string;
  name: string;
  description: string;
  connectedScenes: string[];
}

// ── 主提取流程 ──

export interface ExtractOptions {
  /** PDF 文件路径 */
  pdf?: string;
  /** 已提取的文本内容（优先于 pdf） */
  text?: string;
  /** 模块 ID */
  id: string;
  /** 模块名 */
  name: string;
  /** 输出目录（默认 src/rules/custom-modules） */
  outputDir?: string;
  /** 是否跳过 LLM 解析（仅提取基础结构） */
  skipLlm?: boolean;
}

/**
 * 主入口：从 PDF 或文本提取模块
 */
async function extractModule(options: ExtractOptions): Promise<ExtractedModule> {
  const { pdf, text: providedText, id, name, skipLlm } = options;

  // 1. 获取原始文本
  let rawText = providedText ?? "";
  if (pdf && !rawText) {
    console.log(`[extract] 读取 PDF: ${pdf}`);
    rawText = await extractPdfText(pdf);
  }

  if (!rawText.trim()) {
    throw new Error("没有可用的文本内容。请提供 PDF 路径或 text 参数。");
  }

  console.log(`[extract] 获取文本 ${rawText.length} 字符`);

  // 2. 基础结构提取（正则/启发式）
  const skeleton = parseSkeleton(rawText, id, name);

  // 3. LLM 辅助语义提取（除非跳过）
  if (!skipLlm) {
    console.log(`[extract] 启动 LLM 语义提取...`);
    const enriched = await enrichWithLlm(rawText, skeleton);
    return enriched;
  }

  return skeleton;
}

// ── PDF 文本提取 ──
// pdf-parse v2 API: import { PDFParse } from "pdf-parse"; new PDFParse({ data: buf })

let PDFParseClass: any = null;

async function getPDFParseClass() {
  if (!PDFParseClass) {
    const mod = await import("pdf-parse");
    PDFParseClass = mod.PDFParse;
  }
  return PDFParseClass;
}

async function extractPdfText(pdfPath: string): Promise<string> {
  const buf = readFileSync(pdfPath);
  const Cls = await getPDFParseClass();
  const pdf = new Cls({ data: buf });
  const result = await pdf.getText();
  return result?.text ?? "";
}

// ── 启发式骨架提取 ──

/** 场景所在的文本行索引（供 detectNPCs 等函数做邻近映射） */
let _sceneLineIndices: number[] = [];

function parseSkeleton(rawText: string, id: string, name: string): ExtractedModule {
  const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
  const fullText = rawText;

  const skeleton: ExtractedModule = {
    id,
    name,
    version: detectVersion(lines) ?? "1.0",
    description: detectDescription(lines) ?? `${name} — 请填写描述`,
    difficulty: detectDifficulty(lines),
    activation: { type: "manual", condition: id },
    spells: [],
    tomes: [],
    items: [],
    npcs: [],
    clues: [],
    hooks: [],
    scenes: [],
  };

  // 检测出处
  const source = detectSource(lines);
  if (source) skeleton.source = source;

  // 检测场景（大写标题行、位置关键词）
  skeleton.scenes = detectScenes(lines);

  // 检测 NPC（HP/STR/CON 等属性行）
  skeleton.npcs = detectNPCs(lines, skeleton.scenes);

  // 检测物品（"物品"或"道具"章节）
  skeleton.items = detectItems(lines, skeleton.scenes);

  // 检测法术/咒文
  skeleton.spells = detectSpells(lines);

  // 检测典籍/书籍
  skeleton.tomes = detectTomes(lines, skeleton.scenes);

  // 检测线索
  skeleton.clues = detectClues(lines, skeleton.scenes);

  // 为每个场景生成入口 hook
  skeleton.hooks = skeleton.scenes.map(s => ({
    type: "on_enter_scene" as const,
    condition: s.id,
    narration: undefined,
    effect: undefined,
  }));

  // 提取简介旁白（通常是前几段叙述性文字）
  skeleton.introNarration = detectIntroNarration(lines);

  return skeleton;
}

// ── 启发式检测函数 ──

function detectVersion(lines: string[]): string | undefined {
  // 匹配 "ver X.Y" / "vX.Y" / "版本 X.Y"
  for (const line of lines.slice(0, 30)) {
    const m = line.match(/ver(sion)?[.\s]*(\d+[.]\d+)/i) ?? line.match(/v(\d+[.]\d+)/i);
    if (m) return m[1] ?? m[0];
  }
  return undefined;
}

function detectDescription(lines: string[]): string | undefined {
  // Chinese CoC module: best description is a line describing module structure
  // Look for specific patterns in the first 15 non-meta lines
  const filtered = lines.filter(l => !l.match(/^(ver|--)/) && !l.startsWith("《"));
  
  for (const line of filtered.slice(0, 15)) {
    const cleaned = line.replace(/\s+/g, " ").trim();
    // Match "模组为线性半City类模组。长度中短..." type summary sentences
    if (cleaned.includes("线性") || (cleaned.includes("模组为") && cleaned.length > 15)) {
      // Gather 2-3 surrounding summary lines
      const idx = filtered.indexOf(line);
      const descLines = [cleaned];
      // Add next line if it continues the description
      const next = filtered[idx + 1];
      if (next && !next.includes("导入") && !next.match(/^模组/) && next.length > 10) {
        descLines.push(next.replace(/\s+/g, " ").trim());
      }
      return descLines.join(" ");
    }
  }
  
  // Fallback: look for "模组" sentences
  for (const line of filtered.slice(0, 20)) {
    if (line.includes("模组") && line.length > 20 && !line.includes("COC") && !line.includes("KP") && !line.includes("安眠药")) {
      return line.replace(/\s+/g, " ").trim();
    }
  }

  return undefined;
}

function detectDifficulty(lines: string[]): "easy" | "medium" | "hard" | "nightmare" {
  const text = lines.slice(0, 50).join(" ");
  if (/新人|入门|简单|easy/i.test(text)) return "easy";
  if (/中等|普通|medium/i.test(text)) return "medium";
  if (/困难|噩梦|hard|nightmare/i.test(text)) return "hard";
  return "medium"; // 默认
}

function detectSource(lines: string[]): string | undefined {
  // Check beginning for "出自/来源" patterns
  const text = lines.slice(0, 50).join(" ");
  const m = text.match(/出自[：:]\s*(.+?)(?:[。，]|$)/) ?? text.match(/来源[：:]\s*(.+?)(?:[。，]|$)/);
  if (m) return m[1].trim();
  
  // Check end of text for author info: name, email, or "MikuFan" pattern
  for (let i = lines.length - 10; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("MikuFan") || line.includes("mikufan")) return "MikuFan";
    const email = line.match(/^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (email && i > 0) return lines[i-1].trim();
  }
  
  return undefined;
}

function detectScenes(lines: string[]): ExtractedScene[] {
  const scenes: ExtractedScene[] = [];
  // Track sections we want to skip as scenes (meta headers, appendix, etc)
  const skipSections = new Set(["前言", "导入/车卡规则", "事件真相（想跑的人请不要继续往下看了。）", "写在最后", "附录", "主要 NPC", "主要势力", "可能的敌人类", "敌对神话生物", "特殊能力"]);
  const branchSignals = ["如果", "若玩家", "若调查员", "假如", "分支", "可选"];

  // Line index → scene index mapping for later lookups (module level)
  _sceneLineIndices = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    // Match section headers: "XXX：" or "【XXX】" or "XXX:" 
    const colonMatch = line.match(/^(.{2,25})[：:]$/);
    const bracketMatch = line.match(/^【(.+?)】/);
    const numMatch = line.match(/^[一二三四五六七八九十]+[.、．]\s*(.{2,30})$/);

    const rawName = (colonMatch?.[1] ?? bracketMatch?.[1] ?? numMatch?.[1] ?? "").trim();
    if (!rawName || rawName.length < 2) continue;

    // Skip meta headers
    if (skipSections.has(rawName)) continue;
    if (rawName.includes("ver") || rawName.includes("--")) continue;

    const name = rawName.replace(/\s+/g, " ").trim();
    const id = name
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase()
      .slice(0, 30) || `scene_${scenes.length}`;

    // Extract full description until next scene header
    let description = "";
    for (let di = li + 1; di < Math.min(li + 200, lines.length); di++) {
      const next = lines[di].trim();
      if (!next) continue;
      // Stop at next scene header or section marker
      if (/^.{2,25}[：:]$/.test(next) || /^【.+?】/.test(next) || next.startsWith("主要") || next.startsWith("附录")) break;
      description += (description ? " " : "") + next;
    }

    scenes.push({ id, name, description: description.trim(), connectedScenes: [] });
    _sceneLineIndices.push(li);
  }

  // Build connected scenes — sequential default + branching detection
  for (let i = 0; i < scenes.length; i++) {
    if (i > 0) scenes[i].connectedScenes.push(scenes[i-1].id);
    if (i < scenes.length - 1) {
      // Check if the gap between scene i and i+1 contains branch signals
      const startLine = _sceneLineIndices[i];
      const endLine = _sceneLineIndices[i + 1];
      const gapText = lines.slice(startLine, endLine).join(" ");
      const hasBranch = branchSignals.some(s => gapText.includes(s));
      if (!hasBranch) {
        scenes[i].connectedScenes.push(scenes[i+1].id);
      }
    }
  }

  return scenes;
}

function detectNPCs(lines: string[], scenes: ExtractedScene[]): ExtractedNPC[] {
  const npcs: ExtractedNPC[] = [];

  // Faction detection map (Chinese mythos factions)
  const factionKeywords: Array<[RegExp, string]> = [
    [/米戈|Mi-Go|mi.go/i, "米戈"],
    [/深潜者|深潜/i, "深潜者"],
    [/食尸鬼/i, "食尸鬼"],
    [/修格斯|shoggoth/i, "修格斯"],
    [/星之精/i, "星之精"],
    [/克苏鲁|クトゥルフ/i, "克苏鲁教团"],
    [/黄衣之王|黄印/i, "黄衣之王"],
    [/蛇人|蛇之道/i, "蛇人"],
    [/黑山羊|莎布/i, "黑山羊幼仔"],
    [/无名之雾|犹格/i, "犹格·索托斯"],
    [/蠕动的混沌|奈亚/i, "奈亚拉托提普"],
    [/人类|村民|镇民|居民|警|调查员|教授|医生|学生/i, "人类"],
  ];

  // Detect faction from role string
  function detectFaction(role: string): string {
    for (const [re, faction] of factionKeywords) {
      if (re.test(role)) return faction;
    }
    return "未知";
  }

  // Find scene ID from line proximity: which scene section is this NPC closest to?
  function nearestScene(lineIndex: number): string {
    let bestSceneId = scenes[0]?.id ?? "unknown";
    let bestDist = Infinity;
    for (let si = 0; si < _sceneLineIndices.length && si < scenes.length; si++) {
      const dist = Math.abs(lineIndex - _sceneLineIndices[si]);
      if (dist < bestDist) {
        bestDist = dist;
        bestSceneId = scenes[si].id;
      }
    }
    return bestSceneId;
  }

  // Find the NPC appendix section
  let npcStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^主要\s*NPC[：:]/.test(lines[i]) || lines[i].includes("主要") && lines[i].includes("NPC")) {
      npcStart = i;
      break;
    }
  }
  if (npcStart < 0) return npcs;

  // Parse NPC entries from the appendix
  // Format: "艾德里安·埃斯特鲁姆 	34 	岁 	生物学教授 	耐久 	14"
  // Then following lines have stats: "Str50 	Dex65 	Pow80 	Con70 ..."
  let currentNpc: Partial<ExtractedNPC> | null = null;
  let parsedCount = 0;

  for (let i = npcStart + 1; i < Math.min(lines.length, npcStart + 60); i++) {
    const line = lines[i];

    // Check for NPC name pattern with "耐久": "中文名 年龄 岁 职业 耐久 HP [大脑耐久 N]"
    const nameMatch = line.match(/^([\u4e00-\u9fff·]{2,12})\s+(\d+)\s*岁\s+(.{1,40}?)\s+耐久\s+(\d+)(?:\s+大脑耐久\s+(\d+))?$/);
    if (nameMatch) {
      if (currentNpc?.name && parsedCount < 20) finalizeNPC(currentNpc, npcs, scenes);
      parsedCount++;
      const role = nameMatch[3].trim();
      currentNpc = {
        id: "",
        name: nameMatch[1].trim(),
        type: /米戈|Mi-Go|食尸鬼|深潜者|修格斯|星之精|克苏鲁|神话生物/i.test(role) ? "monster" as const : "npc" as const,
        hp: parseInt(nameMatch[4]) || 10,
        maxHp: parseInt(nameMatch[4]) || 10,
        ac: 10,
        faction: detectFaction(role),
        sceneId: nearestScene(i),
        role,
        attributes: {},
      };
      currentNpc.id = currentNpc.name.replace(/\s+/g, "_").toLowerCase().slice(0, 20);
      continue;
    }

    // Check for single-line NPC entry: "菲碧·特里坎 	42 	岁 	银行职员 	Siz50 	App55"
    const shortMatch = line.match(/^([\u4e00-\u9fff·]{2,12})\s+(\d+)\s*岁\s+(.{1,40}?)\s+(?:Siz|App|HP|Str|Con|Dex|Int|Pow)\d+/);
    if (shortMatch) {
      if (currentNpc?.name && parsedCount < 20) finalizeNPC(currentNpc, npcs, scenes);
      parsedCount++;
      const role = shortMatch[3].trim();
      currentNpc = {
        id: "",
        name: shortMatch[1].trim(),
        type: "npc",
        hp: 8,
        maxHp: 8,
        ac: 10,
        faction: detectFaction(role),
        sceneId: nearestScene(i),
        role,
        attributes: {},
      };
      currentNpc.id = currentNpc.name.replace(/\s+/g, "_").toLowerCase().slice(0, 20);
      finalizeNPC(currentNpc, npcs, scenes);
      currentNpc = null;
      continue;
    }

    // Generic enemy entries: "流浪汉 	HP12 	Dex50" or "酒吧保镖 	HP14 	Dex55"
    const enemyMatch = line.match(/^([\u4e00-\u9fff·]{2,10})\s+HP(\d+)/);
    if (enemyMatch && parsedCount > 3) {
      if (currentNpc?.name) finalizeNPC(currentNpc, npcs, scenes);
      currentNpc = {
        id: enemyMatch[1].trim().toLowerCase().replace(/\s+/g, "_").slice(0, 20),
        name: enemyMatch[1].trim(),
        type: "npc",
        hp: parseInt(enemyMatch[2]) || 10,
        maxHp: parseInt(enemyMatch[2]) || 10,
        ac: 10,
        faction: detectFaction(enemyMatch[1].trim()),
        sceneId: nearestScene(i),
      };
      finalizeNPC(currentNpc, npcs, scenes);
      currentNpc = null;
      continue;
    }

    // Monster entry: name on previous line, then StrXX DexXX...
    if (/^Str\d+/.test(line) || /^Str\s/.test(line)) {
      // Parse stats from "Str50 	Dex65 	Pow80 	Con70 	App55 	Edu75 	Siz70 	Int80 	San0"
      const stats: Record<string, number> = {};
      const statPairs = line.match(/([A-Za-z]+)(\d+)/g);
      if (statPairs) {
        for (const pair of statPairs) {
          const mk = pair.match(/([A-Za-z]+)(\d+)/);
          if (mk) {
            const key = mk[1].toLowerCase();
            const val = parseInt(mk[2]);
            if (key === "hp") { currentNpc!.hp = val; currentNpc!.maxHp = val; }
            else if (key === "str") stats.strength = val;
            else if (key === "con") stats.constitution = val;
            else if (key === "siz") stats.size = val;
            else if (key === "dex") stats.dexterity = val;
            else if (key === "int") stats.intelligence = val;
            else if (key === "pow") stats.power = val;
            else if (key === "app") stats.appearance = val;
            else if (key === "edu") stats.education = val;
          }
        }
      }
      if (currentNpc) {
        currentNpc.attributes = { ...currentNpc.attributes, ...stats };
        // Try to get HP from another source if not set
        if (!currentNpc.hp || currentNpc.hp <= 0) {
          const hpLine = lines[i+1];
          const hpM = hpLine?.match(/HP(\d+)/);
          if (hpM) { currentNpc.hp = parseInt(hpM[1]); currentNpc.maxHp = parseInt(hpM[1]); }
        }
      }
      continue;
    }

    // Direct HP from next line
    if (currentNpc && /^HP\d+/.test(line)) {
      const m = line.match(/HP(\d+)/);
      if (m) { currentNpc.hp = parseInt(m[1]); currentNpc.maxHp = parseInt(m[1]); }
      continue;
    }

    // Skip the module name line (matches "《XXX》verX.X" patterns)
    if (line.match(/^《.+》/)) continue;

    // Monster header line: "食尸鬼", "Mi-Go，来自尤格斯的真菌"
    const monsterHeader = line.match(/^([\u4e00-\u9fff·a-zA-Z-]{2,20})(?:[，,].*)?$/);
    if (monsterHeader && (line.includes("食尸鬼") || line.includes("Mi-Go") || line.includes("米戈"))) {
      if (currentNpc?.name && parsedCount < 20) finalizeNPC(currentNpc, npcs, scenes);
      const name = monsterHeader[1].trim();
      currentNpc = {
        id: name.replace(/\s+/g, "_").toLowerCase().slice(0, 20),
        name,
        type: "monster",
        hp: 10,
        maxHp: 10,
        ac: 10,
        faction: "敌对神话生物",
        sceneId: nearestScene(i),
        mythosCreatureId: line.includes("Mi-Go") || line.includes("米戈") ? "mi_go" : undefined,
        attributes: {},
      };
      parsedCount++;
      continue;
    }
  }

  if (currentNpc?.name && parsedCount < 5) finalizeNPC(currentNpc, npcs, scenes);
  return npcs;
}

function finalizeNPC(npc: Partial<ExtractedNPC>, npcs: ExtractedNPC[], scenes: ExtractedScene[]) {
  npcs.push({
    id: npc.id ?? `npc_${npcs.length}`,
    name: npc.name ?? "未知",
    type: npc.type ?? "npc",
    hp: npc.hp ?? 10,
    maxHp: npc.maxHp ?? 10,
    ac: npc.ac ?? 10,
    faction: npc.faction ?? "未知",
    sceneId: npc.sceneId ?? scenes[0]?.id ?? "unknown",
    mythosCreatureId: npc.mythosCreatureId,
    role: npc.role,
    personality: npc.personality,
    background: npc.background,
    attributes: npc.attributes,
  });
}

function detectItems(lines: string[], scenes: ExtractedScene[]): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const knownItemParents = new Set<string>();

  // Verb-based lines and location/furniture descriptions to skip
  const skipItemPrefixes = ["侦查", "搜查", "检查", "宣言", "使用", "询问", "向", "如果", "进一步的", "关于"];
  const skipItemSuffix = ["边上", "柜", "柜子", "抽屉", "桌子", "椅子", "床", "窗", "门", "堆", "尸体", "床位", "房间", "桌", "脑", "入口", "出口", "通道", "走廊", "角落"];
  const skipItemNames = ["一旁的", "朝向外面的", "其他", "中控台的", "下水道", "母女的"];

  // Match item lines in ▶ bullet sections: "▶物品名：描述" or "▶物品名"
  // Also match "可以找到XX" / "可以获得XX"
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match "▶物品名(：描述)" or "▶物品名(：描述)"
    const bulletItem = line.match(/^[▶>]\s*(.{2,20}?)[：:]\s*(.+)/);
    if (bulletItem) {
      const name = bulletItem[1].trim();
      const desc = bulletItem[2].trim();
      // Skip verbs, search actions, and conditional phrases
      const isAction = skipItemPrefixes.some(p => name.startsWith(p));
      // Skip location descriptions and furniture
      const isLocation = skipItemSuffix.some(s => name.endsWith(s));
      const isLocationStart = skipItemNames.some(s => name.startsWith(s));
      // Allow 的 in short concrete names (防盗门的钥匙) but skip long sentence fragments
      const hasManyDe = (name.match(/的/g) || []).length >= 2;
      if (name.length >= 3 && name.length <= 12 && !hasManyDe && !isAction && !isLocation && !isLocationStart && !items.some(it => it.name === name)) {
        const sceneId = findNearestScene(lines, i, scenes);
        items.push({ name, sceneId, description: desc });
        knownItemParents.add(name);
        continue;
      }
    }

    // Match "可以获得/找到 XX" patterns for concrete items
    // Capture only the first noun phrase that looks like a real item
    const found = line.match(/可以[找获][到得]\s*([\u4e00-\u9fff·\d-]{2,14})/);
    if (found) {
      const phrase = found[1].trim();
      // Skip sentence fragments (time words, measure words, prepositions)
      const skipStarts = ["的", "一些", "这", "那", "一个", "什么", "怎么", "他", "她", "它", "在", "把", "被", "了", "着", "过", "位于", "当时", "一间", "一张", "一把", "一本", "一只", "一个", "一份"];
      const startsWithSkip = skipStarts.some(w => phrase.startsWith(w));
      if (phrase.length >= 2 && !startsWithSkip && !items.some(it => it.name === phrase || it.name.includes(phrase) || phrase.includes(it.name))) {
        const sceneId = findNearestScene(lines, i, scenes);
        items.push({ name: phrase, sceneId, description: line });
      }
    }

    // Match key items from 证物室 section: a list after "身上的物品。包括..."
    // Also catches continuations like "当然，还有他所使用的XX与YY"
    const itemList = line.match(/包括(.{3,60})/);
    if (itemList) {
      // Split by comma/和/与, then clean each potential item
      const raw = itemList[1];
      // Collect from this line and the continuation line
      let fullText = raw;
      const nextLine = lines[i + 1];
      if (nextLine && !nextLine.match(/^[▶>]/) && nextLine.length > 5) {
        fullText += nextLine.replace(/\s+/g, "").trim();
      }
      const parts = fullText.split(/[，,、与和]/).map(s => s.trim()).filter(s => {
        const cleaned = s.replace(/^[一二三\d]+\s*(?:把|张|个|只|本|份)?/, "").trim();
        // Allow 的 in short names (防盗门的钥匙), skip verbs/prepositions/sentence fragments
        const hasSentenceBoundary = /[。！？\?]/.test(cleaned);
        const tooShort = cleaned.replace(/[的之]/g, "").length < 2;
        return !hasSentenceBoundary && !tooShort && cleaned.length <= 12 && !cleaned.startsWith("他") && !cleaned.startsWith("还有") && !cleaned.startsWith("当然") && !/\d/.test(cleaned[0]) && !cleaned.startsWith("所使用");
      });
      const sceneId = findNearestScene(lines, i, scenes);
      // Collect all raw parts (even filtered ones) for secondary extraction
      const allParts = fullText.split(/[，,、与和]/).map(s => s.trim());
      
      for (const part of parts) {
        const cleaned = part.replace(/^[一二三\d]+\s*(?:把|张|个|只|本|份)?/, "").trim();
        const tooShort = cleaned.replace(/[的之]/g, "").length < 2;
        if (!tooShort && cleaned.length <= 12 && !items.some(it => it.name === cleaned) && !skipItemPrefixes.some(p => cleaned.startsWith(p))) {
          items.push({ name: cleaned, sceneId, description: "证物室物品" });
        }
      }
      
      // Secondary: from possessive phrases like "他本人的钱包", extract the actual item name "钱包"
      for (const part of allParts) {
        const cleaned = part.replace(/^[一二三\d]+\s*(?:把|张|个|只|本|份)?/, "").trim();
        if (cleaned.startsWith("他") || cleaned.startsWith("还有")) {
          // Look for the last 2-3 char word after 的
          const afterDe = cleaned.match(/的([\u4e00-\u9fff]{2,4})(?:$|[\s与和])/);
          if (afterDe && !items.some(it => it.name === afterDe[1])) {
            items.push({ name: afterDe[1], sceneId, description: "证物室物品" });
          }
        }
      }
    }
  }

  return items.slice(0, 20);
}

function findNearestScene(lines: string[], lineIdx: number, scenes: ExtractedScene[]): string {
  // Walk backwards to find which scene header is closest
  for (let i = lineIdx - 1; i >= Math.max(0, lineIdx - 50); i--) {
    for (const scene of scenes) {
      if (lines[i].includes(scene.name) && lines[i].endsWith("：")) {
        return scene.id;
      }
    }
  }
  return scenes[0]?.id ?? "unknown";
}

function detectSpells(lines: string[]): ExtractedSpell[] {
  const spells: ExtractedSpell[] = [];
  const knownSpells = new Set<string>();

  for (const line of lines) {
    // Match spell names from "法术：XXX/YYY/ZZZ" format
    const spellListM = line.match(/法术[：:]\s*(.{5,60})$/);
    if (spellListM) {
      const names = spellListM[1].split(/[\/、，,]/).map(s => s.trim()).filter(Boolean);
      for (const name of names) {
        if (name.length >= 2 && !knownSpells.has(name)) {
          knownSpells.add(name);
          spells.push({
            name,
            sanCost: "1d3/1d6",
            mpCost: 8,
            description: "详见模组原文",
          });
        }
      }
      continue;
    }

    // Match individual spell entries with cost
    const spellM = line.match(/^(.{2,20}?)\s*消耗[：:]\s*(\d+)\s*点魔法值/);
    if (spellM && !knownSpells.has(spellM[1].trim())) {
      const name = spellM[1].trim();
      knownSpells.add(name);
      spells.push({
        name,
        sanCost: "不计",
        mpCost: parseInt(spellM[2]) || 8,
        description: line,
      });
    }
  }

  return spells;
}

function detectTomes(lines: string[], scenes: ExtractedScene[]): ExtractedTome[] {
  const tomes: ExtractedTome[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Match "▶笔记/日记名：内容" pattern (name must start with Chars)
    const bullet = line.match(/^[▶>]\s*([\u4e00-\u9fff·]{2,15}(?:笔记|日记|手稿))[：:]\s*(.+)/);
    if (bullet) {
      const name = bullet[1].trim();
      tomes.push({
        name,
        sceneId: findNearestScene(lines, i, scenes),
        sanCost: "1/1d4",
        tomeRating: 4,
        description: bullet[2].trim(),
      });
      continue;
    }

    // Match "XX的笔记/日记" where XX is short (2-4 chars) and preceded by delimiter
    // e.g. "：疯子的笔记" → "疯子的笔记", but NOT "留下的疯子的笔记" (preceded by 的)
    const namedNote = line.match(/(?:^|[：:\s▶>])([\u4e00-\u9fff·]{2,4}的(?:笔记|日记|手稿|书稿))/);
    if (namedNote) {
      const fullName = namedNote[1];
      const isFragmented = /\u7684/.test(namedNote[0].slice(0, -fullName.length));
      if (!isFragmented && !tomes.some(t => t.name === fullName)) {
        tomes.push({
          name: fullName,
          sceneId: findNearestScene(lines, i, scenes),
          sanCost: "1/1d4",
          tomeRating: 4,
          description: line.replace(/^[▶>]?\s*/, ""),
        });
        continue;
      }
    }

    // Match standalone "笔记本" or "日记本" mentions in short lines
    const standalone = line.match(/^[\u4e00-\u9fff·]{2,12}(笔记本|记录本|日记本)$/);
    if (standalone && !tomes.some(t => t.name === standalone[0])) {
      tomes.push({
        name: standalone[0],
        sceneId: findNearestScene(lines, i, scenes),
        sanCost: "1/1d4",
        tomeRating: 4,
        description: "模组记载",
      });
    }
  }

  return tomes.slice(0, 5);
}

function detectClues(lines: string[], scenes: ExtractedScene[]): ExtractedClue[] {
  const clues: ExtractedClue[] = [];
  const clueKeywords = ["线索", "发现", "找到", "调查", "得知", "知道", "情报"];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Lines starting with ▶ or ? often indicate clue/detail sections
    if (/^[▶?>?]/.test(line) && line.length > 15 && clues.length < 10) {
      const sceneId = findNearestScene(lines, i, scenes);
      clues.push({
        scene: sceneId,
        clueType: `clue_${clues.length}`,
        description: line.replace(/^[▶?>?]\s*/, ""),
      });
    }
  }

  return clues;
}

function detectIntroNarration(lines: string[]): string | undefined {
  const narrLines: string[] = [];
  
  // Strategy 1: Find "导入" section and collect its content
  let inDaoru = false;
  for (const line of lines) {
    if (/^导入[：:]\s*$/.test(line)) { inDaoru = true; continue; }
    if (inDaoru) {
      // Stop at next section header
      if (/^.{2,25}[：:]$/.test(line) || /^【.+?】/.test(line)) break;
      if (line.includes("ver") || line.includes("--") || line.length < 8) continue;
      narrLines.push(line);
      if (narrLines.length >= 6) break;
    }
  }
  if (narrLines.length >= 2) {
    return narrLines.join(" ").replace(/\s+/g, " ").trim();
  }
  
  // Strategy 2: Look for date/time narrative openings
  // "在XXXX年某月某日..." or "19XX年夏..." etc.
  narrLines.length = 0;
  let foundNarrative = false;
  for (const line of lines) {
    if (line.includes("ver") || line.includes("前言")) continue;
    
    if (line.match(/^在\s*\d/) || line.match(/^\d{4}\s*年/) || line.match(/^在.*年.*[日时]/)) {
      foundNarrative = true;
      narrLines.push(line);
      continue;
    }
    
    if (foundNarrative) {
      if (line.includes("导入") || line.includes("车卡") || line.includes("事件真相")) break;
      if (line.includes("COC") || line.includes("KP") || line.length < 10) continue;
      narrLines.push(line);
      if (narrLines.length >= 5) break;
    }
  }
  
  if (narrLines.length >= 2) {
    return narrLines.join(" ").replace(/\s+/g, " ").trim();
  }
  
  return undefined;
}

// ── LLM 语义补充 ──

async function enrichWithLlm(rawText: string, skeleton: ExtractedModule): Promise<ExtractedModule> {
  // 使用 multimodal-looker agent 进行语义提取
  // 将骨架 JSON + 原始文本发送给 agent，让它补充缺失字段

  const prompt = buildEnrichPrompt(rawText, skeleton);
  console.log(`[extract] LLM 提取 prompt 长度: ${prompt.length}`);

  // 通过 task 调用子 agent
  try {
    const result = await task({
      subagent_type: "general",
      load_skills: [],
      run_in_background: false,
      description: "Extract module structure from text",
      prompt,
    });

    // 尝试解析返回的 JSON
    const resultText = typeof result === "string" ? result : JSON.stringify(result);
    const jsonMatch = resultText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      return mergeSkeleton(skeleton, parsed);
    }

    // 尝试直接从返回文本中找 JSON 对象
    const jsonStart = resultText.indexOf("{");
    const jsonEnd = resultText.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(resultText.slice(jsonStart, jsonEnd + 1));
      return mergeSkeleton(skeleton, parsed);
    }
  } catch (e) {
    console.warn(`[extract] LLM 解析失败: ${e}`);
    console.log(`[extract] 使用骨架数据作为最终输出`);
  }

  return skeleton;
}

function buildEnrichPrompt(rawText: string, skeleton: ExtractedModule): string {
  return `你是一个 CoC 7e 模组解析器。分析以下模组原始文本，输出结构化的 JSON 数据。

当前已通过启发式提取的骨架数据（部分字段可能为空或不准确，需要你补充）：
${JSON.stringify(skeleton, null, 2)}

原始文本：
${rawText.slice(0, 15000)}

请输出 JSON（**仅 JSON，不要 markdown 包裹**），格式如下：
{
  "description": "模组简介（50-100字）",
  "difficulty": "easy|medium|hard|nightmare",
  "source": "模组出处/作者信息",
  "introNarration": "开场KP旁白（80-200字，叙述性，不包含规则说明）",
  "scenes": [
    { "id": "scene_id", "name": "场景名", "description": "场景简短描述", "connectedScenes": ["相连场景ID"] }
  ],
  "npcs": [
    { "id": "npc_id", "name": "NPC名", "type": "npc|monster", "hp": 10, "ac": 10,
      "faction": "所属阵营", "sceneId": "所在场景ID",
      "role": "角色定位", "personality": "性格描述",
      "background": "背景故事",
      "goals": ["目标1", "目标2"],
      "secrets": ["秘密1"],
      "mythosCreatureId": "如果是神话生物且存在于 mi_go/deep_one/shoggoth/star_vampire/cthulhu 中则填写"
    }
  ],
  "items": [
    { "name": "物品名", "sceneId": "所在场景", "description": "描述" }
  ],
  "clues": [
    { "scene": "场景ID", "clueType": "clue_xxx", "description": "线索描述", "sanCost": "可选 SAN 损失" }
  ],
  "spells": [
    { "name": "法术名", "sanCost": "1d3/1d6", "mpCost": 8, "description": "描述" }
  ]
}

注意事项：
- ID 使用英文小写+下划线
- 完整保留模组的叙事文本和描述（场景、NPC背景、线索详情等）
- NPC 属性值（HP/AC等）从原始文本中提取
- faction 填写"友好/中立/敌对/神话生物"等
- NPC 的 background、goals、secrets 请从原始文本中抽取
- 怪物（type: monster）同样填写 background 描述它在模组中的角色`;
}

function mergeSkeleton(skeleton: ExtractedModule, llmData: any): ExtractedModule {
  // 安全合并：保留骨架中非空的字段，LLM 补充缺失字段
  return {
    ...skeleton,
    description: llmData.description || skeleton.description,
    difficulty: llmData.difficulty || skeleton.difficulty,
    source: llmData.source || skeleton.source,
    introNarration: llmData.introNarration || skeleton.introNarration,
    scenes: llmData.scenes?.length ? llmData.scenes.map((s: any) => ({
      ...s,
      description: s.description ?? "",
      connectedScenes: s.connectedScenes ?? [],
    })) : skeleton.scenes,
    npcs: llmData.npcs?.length ? llmData.npcs.map((n: any) => ({
      id: n.id ?? n.name?.replace(/\s+/g, "_").toLowerCase() ?? `npc_${Math.random().toString(36).slice(2, 6)}`,
      name: n.name ?? "未知",
      type: n.type ?? "npc",
      hp: n.hp ?? 10,
      maxHp: n.maxHp ?? n.hp ?? 10,
      ac: n.ac ?? 10,
      faction: n.faction ?? "未知",
      sceneId: n.sceneId ?? skeleton.scenes[0]?.id ?? "unknown",
      mythosCreatureId: n.mythosCreatureId,
      role: n.role,
      personality: n.personality,
      background: n.background,
      goals: n.goals,
      secrets: n.secrets,
      attributes: n.attributes,
    })) : skeleton.npcs,
    items: llmData.items?.length ? llmData.items : skeleton.items,
    clues: llmData.clues?.length ? llmData.clues : skeleton.clues,
    spells: llmData.spells?.length ? llmData.spells : skeleton.spells,
  };
}

// ── 章节提取辅助 ──

// ── TypeScript 代码生成 ──

function generateModuleCode(module: ExtractedModule): string {
  const indent = (level: number, content: string) => "  ".repeat(level) + content;

  const lines: string[] = [];
  lines.push(`import { type MythosModule } from "../mythos-module";`);
  lines.push("");
  lines.push(`/**`);
  lines.push(` * ${module.name} — 自动提取模组`);
  lines.push(` * 源：${module.source ?? "未指定"}`);
  lines.push(` * 生成时间：${new Date().toISOString()}`);
  lines.push(` */`);
  lines.push(`export const MODULE_${module.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}: MythosModule = {`);

  lines.push(indent(1, `id: "${module.id}",`));
  lines.push(indent(1, `name: "${module.name}",`));
  lines.push(indent(1, `version: "${module.version}",`));
  lines.push(indent(1, `description: "${module.description}",`));
  lines.push(indent(1, `difficulty: "${module.difficulty}",`));
  if (module.source) lines.push(indent(1, `source: "${module.source}",`));

  lines.push(indent(1, `activation: {`));
  lines.push(indent(2, `type: "${module.activation.type}",`));
  lines.push(indent(2, `condition: "${module.activation.condition}",`));
  lines.push(indent(1, `},`));

  if (module.introNarration) {
    lines.push(indent(1, `introNarration:`));
    lines.push(indent(2, `"${escapeString(module.introNarration)}",`));
  }

  // Spells
  if (module.spells.length > 0) {
    lines.push(indent(1, `spells: [`));
    for (const s of module.spells) {
      lines.push(indent(2, `{`));
      lines.push(indent(3, `name: "${s.name}",`));
      lines.push(indent(3, `sanCost: "${s.sanCost}",`));
      lines.push(indent(3, `mpCost: ${s.mpCost},`));
      lines.push(indent(3, `description: "${escapeString(s.description)}",`));
      lines.push(indent(3, `effectType: "other",`));
      lines.push(indent(2, `},`));
    }
    lines.push(indent(1, `],`));
  }

  // Tomes
  if (module.tomes.length > 0) {
    lines.push(indent(1, `tomes: [`));
    for (const t of module.tomes) {
      lines.push(indent(2, `{`));
      lines.push(indent(3, `name: "${t.name}",`));
      lines.push(indent(3, `sceneId: "${t.sceneId}",`));
      lines.push(indent(3, `sanCost: "${t.sanCost}",`));
      lines.push(indent(3, `tomeRating: ${t.tomeRating},`));
      if (t.spells?.length) {
        lines.push(indent(3, `spells: [${t.spells.map(s => `"${s}"`).join(", ")}],`));
      }
      lines.push(indent(3, `openDescription: "${escapeString(t.description)}",`));
      lines.push(indent(2, `},`));
    }
    lines.push(indent(1, `],`));
  }

  // Items
  if (module.items.length > 0) {
    lines.push(indent(1, `items: [`));
    for (const it of module.items) {
      lines.push(indent(2, `{ name: "${it.name}", sceneId: "${it.sceneId}", description: "${escapeString(it.description)}" },`));
    }
    lines.push(indent(1, `],`));
  }

  // Clues
  if (module.clues.length > 0) {
    lines.push(indent(1, `clues: [`));
    for (const c of module.clues) {
      const san = c.sanCost ? `, sanCost: "${c.sanCost}"` : "";
      lines.push(indent(2, `{ scene: "${c.scene}", clueType: "${c.clueType}", description: "${escapeString(c.description)}"${san} },`));
    }
    lines.push(indent(1, `],`));
  }

  // Hooks
  if (module.hooks.length > 0) {
    lines.push(indent(1, `hooks: [`));
    for (const h of module.hooks) {
      const eff = h.effect ? `, effect: "${h.effect}"` : "";
      const narr = h.narration ? `, narration: "${escapeString(h.narration)}"` : "";
      lines.push(indent(2, `{ type: "${h.type}", condition: "${h.condition}"${narr}${eff} },`));
    }
    lines.push(indent(1, `],`));
  }

  // NPCs
  if (module.npcs.length > 0) {
    lines.push(indent(1, `npcs: [`));
    for (const n of module.npcs) {
      lines.push(indent(2, `{`));
      lines.push(indent(3, `id: "${n.id}",`));
      lines.push(indent(3, `name: "${n.name}",`));
      lines.push(indent(3, `type: "${n.type}",`));
      lines.push(indent(3, `hp: ${n.hp},`));
      lines.push(indent(3, `maxHp: ${n.maxHp},`));
      lines.push(indent(3, `ac: ${n.ac},`));
      lines.push(indent(3, `faction: "${n.faction}",`));
      lines.push(indent(3, `sceneId: "${n.sceneId}",`));
      if (n.mythosCreatureId) lines.push(indent(3, `mythosCreatureId: "${n.mythosCreatureId}",`));
      if (n.attributes) {
        lines.push(indent(3, `attributes: { ${Object.entries(n.attributes).map(([k, v]) => `${k}: ${v}`).join(", ")} },`));
      }
      if (n.role || n.personality || n.background || n.goals || n.secrets) {
        lines.push(indent(3, `personality: {`));
        if (n.role) lines.push(indent(4, `role: "${n.role}",`));
        if (n.personality) lines.push(indent(4, `personality: "${n.personality}",`));
        if (n.background) lines.push(indent(4, `background: "${escapeString(n.background)}",`));
        if (n.goals?.length) lines.push(indent(4, `goals: [${n.goals.map(g => `"${g}"`).join(", ")}],`));
        if (n.secrets?.length) lines.push(indent(4, `secrets: [${n.secrets.map(s => `"${s}"`).join(", ")}],`));
        if (n.speechStyle) lines.push(indent(4, `speech_style: "${n.speechStyle}",`));
        lines.push(indent(4, `traits: { courage: 7, friendliness: 6, suspicion: 6, curiosity: 6, stability: 6 },`));
        lines.push(indent(3, `},`));
      }
      lines.push(indent(2, `},`));
    }
    lines.push(indent(1, `],`));
  }

  lines.push("};");
  lines.push("");
  lines.push(`/**`);
  lines.push(` * 模组注册信息`);
  lines.push(` */`);
  lines.push(`export const MODULE_REGISTRY: Array<{ id: string; name: string; module: MythosModule }> = [`);
  lines.push(`  { id: "${module.id}", name: "${module.name}", module: MODULE_${module.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")} },`);
  lines.push(`];`);

  return lines.join("\n");
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ");
}

// ── 输出 ──

function writeModuleFile(module: ExtractedModule, outputDir: string): string {
  const dir = resolve(outputDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const code = generateModuleCode(module);
  const filePath = resolve(dir, `${module.id}.ts`);
  writeFileSync(filePath, code, "utf-8");
  console.log(`[extract] 写入: ${filePath}`);
  return filePath;
}

// ── CLI ──

// Direct execution
(async () => {
  const args = process.argv.slice(2);

  function getArg(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  }

  const pdfPath = getArg("--pdf");
  const moduleId = getArg("--id");
  const moduleName = getArg("--name");
  const outputDir = getArg("--output") ?? resolve(import.meta.dirname ?? ".", "../rules/custom-modules");
  const skipLlm = args.includes("--skip-llm");

  if (!moduleId || !moduleName) {
    console.error(`
用法: bun src/tools/extract-module.ts [选项]

必要参数:
  --id <id>        模块唯一标识（如 premiers_barn）
  --name <name>    模块中文名（如 普瑞米尔的谷仓）

可选参数:
  --pdf <path>      PDF 文件路径
  --text <path>     已提取的文本文件路径（替代 --pdf）
  --output <dir>    输出目录（默认 src/rules/custom-modules）
  --skip-llm        跳过 LLM 语义补充，仅使用启发式提取
`);
    process.exit(1);
  }

  let text: string | undefined;
  const textPath = getArg("--text");

  if (textPath) {
    text = readFileSync(resolve(textPath), "utf-8");
  }

  extractModule({ pdf: pdfPath, text, id: moduleId, name: moduleName, outputDir, skipLlm })
    .then(module => {
      const filePath = writeModuleFile(module, outputDir!);
      console.log(`\n✅ 模组提取完成`);
      console.log(`   模块: ${module.name} (${module.id})`);
      console.log(`   场景: ${module.scenes.length}`);
      console.log(`   NPC:  ${module.npcs.length}`);
      console.log(`   物品: ${module.items.length}`);
      console.log(`   线索: ${module.clues.length}`);
      console.log(`   输出: ${filePath}`);
      console.log(`\n   在 game-session.ts 中导入：`);
      console.log(`   import { MODULE_${module.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")} } from "../rules/custom-modules/${module.id}";`);
      console.log(`   然后加入 registeredModules 数组即可激活。`);
    })
    .catch(e => {
      console.error(`\n❌ 提取失败:`, e.message);
      process.exit(1);
    });
})();
