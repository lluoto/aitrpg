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
type SpeechRoute = "prebaked" | "realtime" | "silent";

interface SpeechPlan {
  route: SpeechRoute;
  /** 由谁来念：NPC 名 / "KP" / "守秘人" */
  speaker: string;
  /** 送进合成器的文本。对白已剔除舞台指示，念出来的就是台词本身 */
  text: string;
  /** 音色情绪。消息没带就按中性处理 */
  mood: NPCMood;
  /**
   * 音频缓存键。只由文本内容决定：同文本必然同键，文本改一个字就失效。
   * 预制层靠它判断哪些已经合成过、哪些要重新合成。
   *
   * 取的是 text（真正送去合成的那一版），不是原始 content —— 键必须标识
   * 实际合成出来的音频，否则剔除舞台指示前后会共用同一份 wav。
   */
  key: string;
  /**
   * 台词里被摘出来的括号舞台指示，按出现顺序。
   *
   * 摘出来是为了不念，但不丢弃：`（声音低沉）` 对应降低音高、放慢语速，
   * 比单一的 mood 标签更精细（voice-readiness.md 第五节）。实时层接上音高/语速
   * 控制后由它驱动；在那之前它只是躺在这里，不影响任何现有行为。
   */
  directions: string[];
}

/**
 * 把一句台词拆成"念出来的部分"和"括号里的舞台指示"。
 *
 * 提示词第 7 条主动要求 NPC 台词带括号神态，且允许穿插句中；这些内容送进 TTS
 * 会被照着念出来（「抬眼打量他们」）。但它们不该被删 —— 见 voice-readiness.md
 * 第五节：这是现有最好的韵律提示。所以是切分，不是剥离。
 *
 * 只认全角括号：文档第五节记着格式是一致的中文全角，收窄判据可以避免误伤
 * 英文缩写里的半角括号。
 *
 * 纯函数，不依赖引擎，也不认识消息类型 —— 该不该对某条消息调用它，由调用方决定。
 */
export function splitStageDirections(text: string): { spoken: string; directions: string[] } {
  const directions: string[] = [];
  const spoken = text
    .replace(/（([^）]*)）/g, (_m, inner: string) => {
      const d = inner.trim();
      if (d) directions.push(d);
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { spoken, directions };
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
/**
 * 送去合成的文本 —— 只有对白剔除舞台指示。
 *
 * 旁白里的括号是解释性夹注（「拖车车房（可搭载拖车移动的房屋，在美国还算常见）」），
 * 那是正文的一部分，切掉等于删内容。消息类型本来就把对白和旁白分开了，
 * 用它判定即可，不必靠正则去猜括号里装的是神态还是注解。
 */
function spokenTextOf(
  msg: Pick<AgentMessage, "type" | "content">
): { spoken: string; directions: string[] } {
  return msg.type === "dialogue"
    ? splitStageDirections(msg.content)
    : { spoken: msg.content, directions: [] };
}

export function voiceKeyFor(
  msg: Pick<AgentMessage, "type" | "content" | "verbatim">
): string | undefined {
  if (speechRouteFor(msg) !== "prebaked") return undefined;
  const { spoken } = spokenTextOf(msg);
  return spoken ? voiceKey(spoken) : undefined;
}

export function planSpeech(msg: AgentMessage): SpeechPlan {
  const { spoken, directions } = spokenTextOf(msg);
  return {
    // 整句都是舞台指示时没什么可念的，不必为一段空文本去合成
    route: spoken ? speechRouteFor(msg) : "silent",
    speaker: msg.speaker,
    text: spoken,
    mood: msg.mood ?? "neutral",
    key: voiceKey(spoken),
    directions,
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
