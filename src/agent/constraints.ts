/**
 * NPC 输出约束层
 * ===============
 *
 * 在 LLM 生成 NPC 回复后，代码层拦截/改写，保证：
 *   1. 秘密保护 — NPC 不会主动透露 secrets 中的内容
 *   2. 知识边界 — NPC 不会说出 knowledge 未包含的信息
 *   3. 态度一致性 — NPC 回复基调符合当前态度/关系
 *
 * 设计原则：约束是安全网，不是创作枷锁。
 *   - LLM 尽力扮演 → 约束层兜底拦截明显越界
 *   - 拦截时优先改写（保持流畅），其次拒绝（生硬但安全）
 */

import type { NPCPersonality, NPCMood } from "./types";

// ============================================================
// 秘密保护
// ============================================================

const SECRET_LEAK_PATTERNS: Array<RegExp> = [
  /其实.*(?:我是|我就是|我才是)/,           // "其实我是XX" 式自曝
  /告诉你一个秘密/,                           // 主动预告秘密
  /这.*(?:一般人|别人).*(?:不知道|不知)/,    // 暗示知道秘密
  /不瞒你说/,                                 // 坦白前缀
];

/**
 * 检查输出是否泄露秘密
 * @returns 泄露的秘密列表（空=无泄露）
 */
export function checkSecretLeak(
  output: string,
  secrets: string[]
): string[] {
  if (secrets.length === 0) return [];

  const leaked: string[] = [];

  // 1. 直接关键词匹配
  for (const secret of secrets) {
    // 提取秘密中的关键名词短语（2-4字词）
    const keywords = extractKeywords(secret, 2, 4);
    const matchCount = keywords.filter(kw => output.includes(kw)).length;
    // 如果输出中包含秘密中 60% 以上的关键词 → 疑似泄露
    if (keywords.length > 0 && matchCount / keywords.length >= 0.6) {
      leaked.push(secret);
    }
  }

  // 2. 自曝句式检测
  for (const pattern of SECRET_LEAK_PATTERNS) {
    if (pattern.test(output)) {
      // 标记为泄露（但不知道具体哪个秘密）
      if (leaked.length === 0) leaked.push("__pattern_suspicious__");
    }
  }

  return leaked;
}

/**
 * 改写输出，移除秘密相关内容
 */
export function sanitizeSecretLeak(output: string, leakedSecrets: string[]): string {
  let sanitized = output;
  for (const secret of leakedSecrets) {
    if (secret === "__pattern_suspicious__") {
      // 对可疑句式不做自动改写（避免破坏正常表达），仅添加警告
      continue;
    }
    // 替换秘密关键词为占位符
    const keywords = extractKeywords(secret, 2, 4);
    for (const kw of keywords) {
      sanitized = sanitized.replaceAll(kw, "……");
    }
  }
  return sanitized;
}

// ============================================================
// 知识边界
// ============================================================

/**
 * 检查输出是否超出 NPC 知识范围
 * @returns 检测到的越界声明列表
 */
export function checkKnowledgeBoundary(
  output: string,
  knowledge: string[],
  _npcName: string
): string[] {
  // 越界信号词 — NPC 从自身知识出发不应使用的表述
  const BOUNDARY_SIGNALS = [
    /据我所知/,
    /根据.*(?:记载|文献|研究)/,
    /历史上/,
    /科学.*(?:证明|表明|发现)/,
    /全世界/,
    /所有.*(?:人|生物|存在)/,
  ];

  const violations: string[] = [];
  for (const signal of BOUNDARY_SIGNALS) {
    if (signal.test(output)) {
      violations.push(`NPC 使用了超出角色的表述: ${signal.source}`);
    }
  }

  // 如果 NPC 知识为空，任何事实性声称都可能越界
  if (knowledge.length === 0) {
    const CLAIM_PATTERNS = [
      /(?:是|有|在).*(?:的|了)。$/,   // 陈述句结尾
    ];
    for (const cp of CLAIM_PATTERNS) {
      if (cp.test(output.trim())) {
        violations.push(`NPC 知识为空但做出了事实性陈述`);
        break;
      }
    }
  }

  return violations;
}

// ============================================================
// 态度一致性
// ============================================================

/**
 * 检查回复基调是否与当前态度一致
 */
export function checkAttitudeConsistency(
  output: string,
  mood: NPCMood,
  relationship: number
): string[] {
  const inconsistencies: string[] = [];

  // 愤怒情绪下出现友好用语
  if (mood === "angry") {
    const friendlySignals = [/谢谢|感谢|麻烦你了|辛苦了|帮大忙了/];
    for (const s of friendlySignals) {
      if (s.test(output)) {
        inconsistencies.push(`愤怒情绪下使用了友好用语: ${s.source}`);
      }
    }
  }

  // 低关系值时过于亲密
  if (relationship <= -2) {
    const intimateSignals = [/朋友|兄弟|哥们|姐妹|亲爱的|老.?乡/];
    for (const s of intimateSignals) {
      if (s.test(output)) {
        inconsistencies.push(`关系值${relationship}下使用了亲密称呼`);
      }
    }
  }

  return inconsistencies;
}

// ============================================================
// 综合约束检查
// ============================================================

export interface ConstraintResult {
  passed: boolean;
  sanitized: string;
  warnings: string[];
}

/**
 * 对 NPC 回复运行全部约束检查
 * @param output LLM 原始输出
 * @param npc NPC 人格卡
 * @param mood 当前情绪
 * @param relationship 当前关系值
 * @returns 约束结果（可能已改写）
 */
export function applyConstraints(
  output: string,
  npc: NPCPersonality,
  mood: NPCMood,
  relationship: number
): ConstraintResult {
  const warnings: string[] = [];

  // 1. 秘密保护
  const leaked = checkSecretLeak(output, npc.secrets ?? []);
  if (leaked.length > 0) {
    warnings.push(`秘密泄露拦截: ${leaked.join(", ")}`);
  }
  let sanitized = sanitizeSecretLeak(output, leaked);

  // 2. 知识边界
  const violations = checkKnowledgeBoundary(sanitized, npc.knowledge ?? [], npc.name);
  warnings.push(...violations);

  // 3. 态度一致性
  const inconsistencies = checkAttitudeConsistency(sanitized, mood, relationship);
  warnings.push(...inconsistencies);

  return {
    passed: warnings.length === 0,
    sanitized,
    warnings,
  };
}

// ============================================================
// 工具函数
// ============================================================

/** 从文本中提取 2-4 字的关键词 */
function extractKeywords(text: string, minLen = 2, maxLen = 4): string[] {
  // 过滤掉常见虚词、标点
  const STOP_WORDS = new Set([
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "这个", "那个", "什么", "怎么", "我们", "他们", "你们", "自己",
    "可以", "没有", "因为", "所以", "但是", "如果", "虽然", "可能", "已经",
    "把", "被", "让", "给", "为", "从", "对", "与", "以", "到", "上", "下",
    "里", "中", "大", "小", "多", "少", "很", "太", "更", "最", "也", "还",
    "又", "再", "才", "就", "都", "只", "要", "会", "能", "应该", "必须",
  ]);

  const result: string[] = [];
  let current = "";
  for (const ch of text) {
    if (/[\u4e00-\u9fff]/.test(ch)) {
      current += ch;
      if (current.length >= minLen) {
        const word = current.slice(-maxLen);
        if (word.length >= minLen && !STOP_WORDS.has(word)) {
          result.push(word);
        }
      }
    } else {
      current = "";
    }
  }
  return [...new Set(result)];
}
