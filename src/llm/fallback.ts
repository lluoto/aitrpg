// ============================================================
// LLM 降级模板 — LLM 不可用时生成兜底叙事
// ============================================================

// ── 工具 ──────────────────────────────────────────────

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── 场景描述 ──────────────────────────────────────────

const OPENINGS = [
  "夜幕低垂，街灯在雾气中晕开昏黄的光。远处传来几声犬吠，随即被寂静吞没。",
  "清晨的薄雾尚未散去，石板路上还残留着夜里的露水。你紧了紧衣领，踏入了这个看似平凡的日子。",
  "雨水顺着屋檐滴落，在泥地上砸出细密的小坑。空气中弥漫着泥土和朽木的气息。",
  "午后的阳光透过落满灰尘的窗户，在木地板上投下斜长的光斑。房间里很安静，安静得能听到自己的心跳。",
  "黄昏时分，天空被染成不祥的暗红色。几只乌鸦从头顶掠过，径直飞向远处的钟楼。",
  "寒风呼啸着穿过狭窄的巷子，吹起地上的落叶和废纸。你下意识地将手伸进口袋，指尖触到了冰冷的——",
];

const TRANSITIONS = [
  "你在昏暗的灯光下驻足，眼前的景象让你不由得屏住了呼吸。",
  "你深吸一口气，推开了那扇吱呀作响的门。",
  "沿着石板路向前，两旁的建筑渐渐变得破败，仿佛在诉说着被遗忘的故事。",
  "拐过街角，你看到了——一个你希望自己从未见过的东西。",
  "脚步声在空旷的走廊里回荡。前方是一扇门，门缝里透出微弱的光。",
];

// ── 战斗叙事 ──────────────────────────────────────────

function describeHit(): string {
  return pick([
    "你的攻击精准地命中了目标，传来一声沉闷的撞击。",
    "你奋力一击，正中要害！对手踉跄了几步。",
    "你的攻势凌厉，目标显然吃了不小的亏。",
    "一击得手——你看到对手的脸色变了。",
  ]);
}

function describeMiss(): string {
  return pick([
    "你的攻击落空了，只砍中了空气。",
    "你挥出的力道太大，失去了平衡——没能命中。",
    "目标敏捷地闪避了你的攻击。",
    "你的攻击擦着对手的发梢掠过，只差一点。",
  ]);
}

function describeKill(): string {
  return pick([
    "最后一击落下，对手轰然倒地，再无声息。",
    "你给了它致命的一击。一切都结束了——至少暂时如此。",
    "随着一声垂死的哀嚎，它终于不动了。",
  ]);
}

function describeCrit(): string {
  return pick([
    "极致的精准！这一击的效果远超预期。",
    "千载难逢的机会！你的攻击造成了毁灭性的效果。",
    "完美的一击！连你自己都有些不敢相信。",
  ]);
}

function describeFumble(): string {
  return pick([
    "糟糕！你的武器脱手而出，飞到了几米开外。",
    "你绊了一下，差点摔倒在地——幸好没有敌人趁机攻击。",
    "你用力过猛，伤到了自己。不是什么严重的问题，但很疼。",
  ]);
}

// ── SAN 损失 ──────────────────────────────────────────

function describeSanLoss(amount: number): string {
  if (amount <= 0) return "";
  if (amount <= 2) return "你感到一阵寒意从脊背升起，有什么东西在你的理智边缘窥探。";
  if (amount <= 5) return "你眼前的景象开始扭曲。你咬紧牙关，努力将那些不该存在的画面从脑海中驱赶出去。";
  return "你的大脑在尖叫——那些不可名状的知识像毒液一样渗透进你的意识。你感到自己的某一部分永远地改变了。";
}

// ── 调查线索 ──────────────────────────────────────────

function describeClue(): string {
  return pick([
    "你注意到了一些不寻常的细节——有人来过这里，而且时间不长。",
    "你的指尖触碰到了什么，那触感让你心头一紧。",
    "翻开落满灰尘的书页，一行用红笔标注的文字跳入了你的视线。",
    "墙角的暗格之后，藏着一个你本不该发现的秘密。",
    "血迹——虽然被仔细擦拭过，但在这个角落里，清洗的人显然不够仔细。",
  ]);
}

function describeSearchFail(): string {
  return pick([
    "你仔细搜索了一遍，但什么也没有找到。也许你需要换个角度思考。",
    "这里确实有些线索，但不够清晰——你无法确定它们意味着什么。",
    "你翻遍了每一个角落，只有灰尘和蛛网作为回报。",
  ]);
}

// ── NPC 对话 ──────────────────────────────────────────

function describeNpcReaction(action: "greeting" | "threat" | "bribe"): string {
  switch (action) {
    case "greeting":
      return pick([
        "那人上下打量了你一番，最终点了点头。「什么事？」",
        "「又一个生面孔。最近城里来的陌生人可真不少。」",
      ]);
    case "threat":
      return pick([
        "那人后退了一步，手按在了腰间。「你最好离我远点。」",
        "空气中弥漫着紧张的气息。对方显然不是能被轻易吓住的人。",
      ]);
    case "bribe":
      return pick([
        "对方看了看你手中的钱，又看了看你。「……你想要什么？」",
        "他犹豫了一下，最终还是接过了钱。「下不为例。」",
      ]);
  }
}

// ── 滚动叙事 ──────────────────────────────────────────

/** 根据检定结果生成兜底叙事 */
export function fallbackNarrative(
  context: string,
  partialContent?: string,
): string {
  // 如果有部分 LLM 返回内容，用过渡句拼接
  if (partialContent) {
    return partialContent + "\n\n" + pick(TRANSITIONS);
  }

  const ctx_lower = context.toLowerCase();

  if (ctx_lower.includes("命中") || ctx_lower.includes("hit")) return describeHit();
  if (ctx_lower.includes("未命中") || ctx_lower.includes("miss") || ctx_lower.includes("闪避")) return describeMiss();
  if (ctx_lower.includes("击杀") || ctx_lower.includes("kill") || ctx_lower.includes("死亡")) return describeKill();
  if (ctx_lower.includes("暴击") || ctx_lower.includes("crit")) return describeCrit();
  if (ctx_lower.includes("大失败") || ctx_lower.includes("fumble")) return describeFumble();
  if (ctx_lower.includes("san") || ctx_lower.includes("理智")) return describeSanLoss(3);
  if (ctx_lower.includes("搜索") || ctx_lower.includes("调查") || ctx_lower.includes("线索")) return describeClue();
  if (ctx_lower.includes("失败") || ctx_lower.includes("找不到")) return describeSearchFail();
  if (ctx_lower.includes("对话") || ctx_lower.includes("交谈") || ctx_lower.includes("npc")) {
    if (ctx_lower.includes("威胁")) return describeNpcReaction("threat");
    if (ctx_lower.includes("贿赂")) return describeNpcReaction("bribe");
    return describeNpcReaction("greeting");
  }

  return pick(OPENINGS);
}

/** 场景切换兜底描述 */
export function fallbackSceneDescription(sceneId?: string): string {
  if (sceneId?.includes("tavern") || sceneId?.includes("酒馆")) {
    return "酒馆里烟雾缭绕，空气中混杂着麦酒、汗水和廉价蜡烛的气味。角落里的壁炉噼啪作响，几个喝得微醺的常客正低声交谈着。吧台后面，老板用一块油腻的抹布擦着杯子，抬眼打量了你一下。";
  }
  if (sceneId?.includes("library") || sceneId?.includes("图书")) {
    return "巨大的书架上塞满了落满灰尘的书籍，空气中弥漫着旧纸张和墨水的气息。高耸的窗户透进苍白的日光，在地板上投下斑驳的光影。这里安静得像是另一个世界。";
  }
  if (sceneId?.includes("farm") || sceneId?.includes("乡")) {
    return "开阔的田野在微风中起伏，远处的地平线上，几棵歪斜的老树勾勒出孤寂的剪影。一条土路蜿蜒向前，通向若隐若现的村庄。空气中带着泥土和青草的气息。";
  }
  return pick(OPENINGS);
}

/** 超时等待时发送的状态消息 */
export const DEGRADATION_NOTICE = "守秘人陷入了短暂的沉思……你仿佛听到远处传来翻书的声音。";
export const DEGRADED_NARRATION_PREFIX = "[降级] ";
