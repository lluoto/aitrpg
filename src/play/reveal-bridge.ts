// 从 play-module.ts 抽出来的一段（脚本搬运，见 tools/_extract-block.ts）。
//
// 抽出来的理由是可寻址性：原先 runModuleInner 一个函数 2615 行、占全文件 74%，
// 里面按注释能切出近 30 个块，但没有一个是能整段读进来的单元 ——
// 每次改动只能靠行号开窗口猜，窄了缺上下文、宽了浪费。
//
// ⚠ 纯搬运，不改行为。判据是全量测试与主循环脚手架全绿。

import type { ModuleNPC } from "../module/types";
import { analyseNpcData } from "./npc-text";
import type { Dedup } from "./run-state";

// 原先这里有个本地 pick<T>()，没人用 —— 本文件的随机挑选走的是别处的实现。

/**
 * 取一条 NPC 引导桥并记住它，供下一次躲开。
 *
 * 原先它嵌在 runModuleInner 里、靠闭包捕获 `lastRevealBridge`，
 * 于是 npc-dialogue 抽出去时够不到它，只能反过来把整个函数当回调注入 ——
 * 那处别扭正是「状态没分类」的症状。现在去重状态收成 Dedup 显式传进来，
 * 回调参数就不需要了。
 */
export function nextRevealBridge(
  dedup: Dedup,
  npc: ModuleNPC,
  s: ReturnType<typeof analyseNpcData> | null,
  isFirst: boolean,
): string {
  const b = buildRevealBridge(npc, s, isFirst, dedup.lastRevealBridge);
  dedup.lastRevealBridge = b;
  return b;
}
export function buildRevealBridge(
  npc: ModuleNPC,
  s: ReturnType<typeof analyseNpcData> | null,
  isFirst: boolean,
  avoid?: string,
): string {
  const speechText = npc.personality.speech || "";
  const isMumbling = /喃喃|昏迷|含糊|意识不清/.test(speechText);
  if (isMumbling) return isFirst ? "昏迷中喃喃道：" : "含混不清地继续说：";
  const pick = <T,>(arr: T[]): T => {
    const pool = arr.length > 1 ? arr.filter((x) => x !== avoid) : arr;
    return pool[Math.floor(Math.random() * pool.length)];
  };
  if (isFirst) {
    // isFirst=true：紧跟开场白后的首次信息吐露。用叙述化承接引导（情绪/神态类，无"说"字、
    // 无重复"急切"、无依赖屋内道具的肢体动作——对话可能在门口/任意阶段发生，避免叙述穿越）
    return s?.isChild ? pick(["歪着头想了想，说：", "眨巴着眼睛说：", "抱着皮球晃了晃，说："]) :
      s?.isAnxious ? pick(["抿了抿嘴唇，声音有些发颤：", "垂下眼帘，声音低沉下来：", "深吸一口气，声音发紧："]) :
      s?.isTalkative ? pick(["压低声音说：", "凑近了些，兴致勃勃地说：", "眉飞色舞地说："]) :
      s?.isCautious ? pick(["压低声音说：", "环顾了一下四周，低声说：", "皱着眉头说："]) :
      s?.isGentle ? pick(["温和地说：", "语气柔和地继续说：", "不紧不慢地开口："]) :
      s?.isOfficial ? pick(["用公事公办的口吻说：", "面无表情地说：", "语气平淡地告知：", "目光扫过你们："]) :
      s?.isRough ? pick(["粗声粗气地说：", "叼着烟含糊地说：", "不耐烦地咂了咂嘴，说："]) :
      pick([
        "接着说：", "想了想，开口道：", "告诉你们：",
        "停顿了一下，开口：", "换了口气说：", "像是斟酌了一下用词：",
        "声音里听不出情绪：", "缓缓道：",
      ]);
  }
  return s?.isChild ? pick(["又小声补充道：", "压低声音，神秘兮兮地说：", "朝你们招招手，悄声说："]) :
    s?.isAnxious ? pick(["声音颤抖着补充说：", "吸了吸鼻子，又说：", "用袖口擦了擦眼角，接着说：", "声音越来越小："]) :
    s?.isTalkative ? pick(["又说：", "话锋一转，继续道：", "跟连珠炮似的接着说："]) :
    s?.isCautious ? pick(["顿了顿，又说：", "略微犹豫了一下，补充道：", "压着嗓子又说："]) :
    s?.isGentle ? pick(["想了想，又说：", "语气依然温和地补充：", "耐心地继续说道："]) :
    s?.isOfficial ? pick(["又翻了一页，说：", "补充道：", "面无表情地继续说："]) :
    s?.isRough ? pick(["又补了一句：", "哼了一声，继续说：", "叼着烟含混地说："]) :
    pick([
      "又说：", "想了想，补充道：", "继续说道：",
      "顿了顿：", "补了一句：", "话没停：", "隔了一会儿才说：",
    ]);
}


