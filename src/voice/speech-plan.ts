/**
 * 语音路由 — 决定每条消息该不该念、谁念、走预制还是实时。
 *
 * 只做判定，不做合成：这里没有任何引擎依赖，可以单测，也不绑定具体 TTS 厂商。
 * 判据来自 docs/voice-readiness.md 第二节的四个问题。
 */

import { createHash } from "node:crypto";
import type { AgentMessage, NPCMood } from "../agent/types";
import type { MythosModule } from "../rules/mythos-module";

/**
 * 合成路径。
 *
 * prebaked 与 realtime 的分界不是"内容像不像固定文本"，而是**消息有没有经过 LLM**。
 * 来源是可判定的，模型行为要靠实测 —— 见 voice-readiness.md 第七节记的那次翻车。
 */
export type SpeechRoute = "prebaked" | "realtime" | "silent";

export interface SpeechPlan {
  route: SpeechRoute;
  /** 由谁来念：NPC 名 / "KP" / "守秘人" */
  speaker: string;
  /** 送进合成器的文本 */
  text: string;
  /** 音色情绪。消息没带就按中性处理 */
  mood: NPCMood;
  /**
   * 音频缓存键。只由文本内容决定：同文本必然同键，文本改一个字就失效。
   * 预制层靠它判断哪些已经合成过、哪些要重新合成。
   */
  key: string;
}

/** 骰点、状态变更、系统提示、模组元信息都不念 */
const SILENT_TYPES: ReadonlySet<AgentMessage["type"]> = new Set(["system", "action"]);

/**
 * 文本内容的稳定键。
 *
 * 用内容哈希而不是模组 ID + 序号：模组文案改了但编号没变时，编号方案会继续
 * 命中旧音频，而内容哈希会自然失效。
 */
export function voiceKey(text: string): string {
  return createHash("sha1").update(text.trim(), "utf8").digest("hex").slice(0, 16);
}

export function speechRouteFor(msg: Pick<AgentMessage, "type" | "verbatim">): SpeechRoute {
  if (SILENT_TYPES.has(msg.type)) return "silent";
  return msg.verbatim ? "prebaked" : "realtime";
}

/**
 * 可预制的消息给出音频键，其余给 undefined。
 *
 * 键在服务端算而不是让前端自己哈希：口径只有一处，前端也不必为此引入
 * 异步的 SubtleCrypto。返回 undefined 表示这条消息没有预制音频可放。
 */
export function voiceKeyFor(
  msg: Pick<AgentMessage, "type" | "content" | "verbatim">
): string | undefined {
  return speechRouteFor(msg) === "prebaked" ? voiceKey(msg.content) : undefined;
}

export function planSpeech(msg: AgentMessage): SpeechPlan {
  return {
    route: speechRouteFor(msg),
    speaker: msg.speaker,
    text: msg.content,
    mood: msg.mood ?? "neutral",
    key: voiceKey(msg.content),
  };
}

// ============================================================
// 预制清单
// ============================================================

export interface PrebakeEntry {
  /** 音频文件名用它，不带扩展名 */
  key: string;
  /** 来源模组 ID，仅用于人读与排错 */
  moduleId: string;
  /** 这段文本在模组里的角色：模组开场白 / 剧本里不经 LLM 的播报行 */
  kind: "intro" | "scripted";
  speaker: string;
  text: string;
}

/**
 * 收集 MythosModule 的开场白 —— 它走不经 LLM 的直出路径，加载时内容就已确定。
 *
 * 剧本（ModuleData）那条线的可预制文本不在这里收：它的文本是引擎在 say() 出文
 * 那一刻才成形的（补换行、补句号、替换 {enemy}），静态复刻这些格式等于把同一套
 * 规则写两遍，改一处就会悄悄对不上键。那条线由 scripts/gen-speech.ts 实跑收割。
 *
 * 模组从参数传入而不是在这里 import，既便于单测，也让调用方决定要烘哪些。
 */
export function collectPrebakeEntries(modules: readonly MythosModule[]): PrebakeEntry[] {
  const entries: PrebakeEntry[] = [];
  const seen = new Set<string>();

  for (const mod of modules) {
    const text = mod.introNarration?.trim();
    if (!text) continue;

    const key = voiceKey(text);
    // 不同模组共用同一段文本时只烘一次 —— 键由内容决定，音频本来就是同一份
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({ key, moduleId: mod.id, kind: "intro", speaker: "守秘人", text });
  }

  return entries;
}
