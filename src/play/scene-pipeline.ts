// 从 play-module.ts 抽出来的一段（脚本搬运，见 tools/_extract-block.ts）。
//
// 抽出来的理由是可寻址性：原先 runModuleInner 一个函数 2615 行、占全文件 74%，
// 里面按注释能切出近 30 个块，但没有一个是能整段读进来的单元 ——
// 每次改动只能靠行号开窗口猜，窄了缺上下文、宽了浪费。
//
// ⚠ 纯搬运，不改行为。判据是全量测试与主循环脚手架全绿。

import type {
  ModuleNPC, ModuleData, ModuleSupport, SceneConnection, } from "../module/types";
import type { WorldState } from "../world/state";
import type { PlayerAgent } from "../agent/player-agent";
import type { LLMClient } from "../llm/client";

import { resolveCheckValue } from "../character/coc-character";
import {
  generateNpcReply, generatePcQuestion,
  generateNpcTransition, generateOpeningTransition,
} from "../llm/npc-dialogue-prompts";
import type { SceneContext } from "../llm/npc-dialogue-prompts";

import { say, runCtx, emit } from "./narration";
// 运行时那道「旁白不许提前叫出没见过的人的名字」的闸门。
// 判据（diagnostics/narration.ts）用的是同一个函数，不另写一份。
import { namesPerson } from "./names";
import { buildWorldContext } from "./llm-context";
import { runSceneTraps } from "./traps";
import { runCombatEncounter } from "./combat";
import {
  buildPcImpression, handleNonSpeakingNpc, brainwaveFlavor, buildToneBridge, revealNpcKnowledge,
  generateNpcDialogue, stripDoorOpenPrefix, stripDialogueLead,
  mentalVoiceBridge, classifySpeechStyle,
} from "./npc-dialogue";
import { nextRevealBridge } from "./reveal-bridge";
import {
  analyseNpcData, splitLeadingStageDirection, stripOuterQuotes, quoteDialogue,
  noteEntityMentions, speechLead, askerScore,
} from "./npc-text";
import {
  runClueCheck, narrateClueDiscovery, checkClueSanLoss, investigableClues,
  isPassiveClue, MAX_SCENE_ACTIONS, tryReviveDowned, type ClueCtx,
} from "./clue-check";
// 从 move-util 取而不是从 play-module —— 后者会成环
import { chooseConnection, isRedundantMoveLine, noticesEntity, parseMoveHint } from "./move-util";
import { isDowned, standing } from "./run-state";
import type { Cast, Cursor, Dedup, WorldModelCtx } from "./run-state";

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }

/**
 * 一次进场的完整流水线所需的处境。
 *
 * `processScene` 是 493 行的「进场 → NPC 遭遇 → 对话 → 线索 → 选下一步」，
 * 它同时碰世界、模组、两名调查员、两个 agent、LLM、游标。
 * 参数多是实情 —— 收成一个 ctx 让调用点读起来是「按这套处境跑一个场景」。
 *
 * ⚠ 当前场景由 `world.currentScene` 取，不放进 ctx —— 主循环每轮换场景，
 * 放进来就得每轮重建 ctx，而 ctx 里其余东西整局不变。
 */
export interface SceneCtx {
  module: ModuleData;
  support: ModuleSupport;
  world: WorldState;
  cast: Cast;
  cursor: Cursor;
  dedup: Dedup;
  wm: WorldModelCtx;
  agents: [PlayerAgent, PlayerAgent];
  llmClient: LLMClient | null;
}
export function maybeRecognitionBeat(ctx: SceneCtx, w: WorldState): boolean {
  // 原先这里连着解构了 module/support/world/cast/cursor/dedup/wm/llmClient/agents
  // 九个名字，真正用到的只有 pl1、pl2 —— 与 `fallbackQuestion` 同一个毛病，
  // 而且同样带着 `agents: [pl1, pl2]` 这条会对 undefined 抛异常的数组解构。
  // 多出来的名字不是无害的装饰：读代码的人会以为这个函数依赖那八样东西。
  const { agents: [pl1, pl2] } = ctx;
  const ent = w.getPendingRecognition();
  if (!ent) return false;
  const candidates = [pl1, pl2].filter((p) => noticesEntity(p.pc.occupation, ent));
  if (candidates.length === 0) return false;
  const who = pick(candidates);
  // 先落状态再输出：即便下游抛错也不会在下一轮重演同一段
  w.markEntityRecognized(ent.id);
  say(`\n${ent.recognition.replaceAll("{name}", who.name)}`);
  return true;
}

/**
 * 这一轮谁开口。
 *
 * 提问者原先写死 pl1，第二名调查员整局一句话都没说过；改成硬轮流之后
 * 又变成了两人排队发言。真实的队伍里谁接话取决于这个人是谁、这话题跟他有没有关系，
 * 所以交给 askerScore 打分，同分时才随机。
 */
/**
 * 这一轮谁开口。昏迷的人不开口 —— 两人都昏迷则返回 null，调用方跳过这段对话。
 *
 * agent 与角色卡是两个对象，得按顺序对上才判得了昏迷：
 * `agents[0]` 对 `cast.c1`，`agents[1]` 对 `cast.c2`。
 */
export function pickAsker(ctx: SceneCtx, topic: string): PlayerAgent | null {
  const { cast, dedup, agents: [pl1, pl2] } = ctx;
  const alive = [
    { agent: pl1, pc: cast.c1 },
    { agent: pl2, pc: cast.c2 },
  ].filter(x => !isDowned(x.pc));
  if (alive.length === 0) return null;

  // 开口计数按**本局**算（`dedup.askCounts`）。原先挂在模块级 Map 上，
  // 第二局会继承第一局的计数 —— 见 run-state.ts 里那段说明。
  const askCounts = dedup.askCounts;
  const scored = alive.map(({ agent }) => ({
    p: agent,
    // 微小抖动：分数持平时不至于每次都选同一个
    score: askerScore(agent.pc, topic, askCounts.get(agent.name) ?? 0) + Math.random() * 0.2,
  }));
  scored.sort((a, b) => b.score - a.score);
  const chosen = scored[0]!.p;
  askCounts.set(chosen.name, (askCounts.get(chosen.name) ?? 0) + 1);
  return chosen;
}

export async function conductNpcConversation(ctx: SceneCtx, npc: ModuleNPC, w: WorldState): Promise<void> {
  // 同上：原先解构九个，support/world/cast/cursor/agents 五个从没被读过。
  const { module, dedup, wm, llmClient, agents: [pl1, pl2] } = ctx;
  const displayName = npc.name.replace(/[（(].*[）)]$/, "").trim();

  // 识别先于提问：这一轮归它，不再叠一个提问上去（顶替本轮 Q&A）
  if (maybeRecognitionBeat(ctx, w)) return;

  // Build scene context for NPC
  const curScene = w.currentScene;
  const sceneCtx: SceneContext = {
    sceneName: curScene?.name ?? "未知",
    sceneDescription: curScene?.description ?? "",
    presentNpcs: [displayName],
    knownClues: curScene?.clues.filter(cl => w.isClueFound(cl.id)).map(cl => cl.name) ?? [],
    recentEvents: [],
    playerOccupations: [pl1.pc.occupation, pl2.pc.occupation],
  };

  // ── 全局调查上下文（跨场景串联）：供所有 LLM 叙事生成点注入 ──
  const worldCtx = buildWorldContext(module, [pl1, pl2], wm, w);

  // 未说出的知识：knowledgeReveals 中尚未作为线索展开的条目（保留下标 → 与 knowledge 一一对应）
  const unrevealedReveals = (npc.llmExpanded?.knowledgeReveals ?? [])
    .map((text, ki) => ({ text, ki }))
    .filter(({ ki }) => !w.isClueFound(`clue_kn_${npc.id}_${ki}`));
  // knowledge 原文中尚未问过的话题（作为后备方向）
  const unrevealedKnowledge = (npc.knowledge ?? [])
    .map((k, ki) => ({ text: extractTopic(k), ki }))
    .filter(t => t.text.length > 2)
    .filter(t => !w.isClueFound(`conv_kn_${npc.id}_${t.ki}`))
    .map(t => t.text);

  // 标记本轮问过的话题（避免下次重复）
  if (unrevealedKnowledge.length > 0) {
    for (const k of (npc.knowledge ?? [])) {
      const ki = npc.knowledge.indexOf(k);
      w.discoverClue(`conv_kn_${npc.id}_${ki}`);
    }
  }

  // 全部信息都已说出 → 无需追问
  if (unrevealedReveals.length === 0 && unrevealedKnowledge.length === 0) return;

  // 调查重点：玩家当前目标 + 已发现的线索
  const focus = [
    pl1.pc.currentGoal ? `调查员1目标: ${pl1.pc.currentGoal}` : "",
    pl2.pc.currentGoal ? `调查员2目标: ${pl2.pc.currentGoal}` : "",
    sceneCtx.knownClues.length > 0 ? `已发现线索: ${sceneCtx.knownClues.join("、")}` : "",
  ].filter(Boolean).join("\n") || "继续调查当前案件";

  // 对话历史：本场景内已经发生的 NPC 发言（firstEncounter + 已说出的 reveal）。
  // 注意：必须是"已说出的"，不能包含未说出的 reveal——否则 LLM 会把没说过的话当历史引用/重复
  const revealedReveals = (npc.llmExpanded?.knowledgeReveals ?? [])
    .map((text, ki) => ({ text, ki }))
    .filter(({ ki }) => w.isClueFound(`clue_kn_${npc.id}_${ki}`));
  const dialogueHistory = [npc.llmExpanded?.firstEncounter, ...revealedReveals.map(r => r.text)]
    .filter(Boolean)
    .slice(0, 3)
    .map(t => `${displayName}：${t}`)
    .join("\n");

  // ── 问答对齐：先定本轮揭示目标（第一条未说出的 reveal），问话围绕它生成 ──
  const target = unrevealedReveals[0];
  const targetTopic = target
    ? extractTopic(npc.knowledge?.[target.ki] ?? target.text)
    : "";

  // 谁开口要等 targetTopic 定下来才能判：话题跟谁的经历沾边，谁才更可能接这一句
  const asker = pickAsker(ctx, targetTopic);
  // 两人都昏迷 → 没人问得出话，这段对话整个跳过
  if (!asker) return;

  // ── PC question: 交给 LLM 结合场景/历史/重点生成自然提问（无 LLM 时降级为锚点引导话术） ──
  let question: string;
  if (llmClient) {
    try {
      question = await generatePcQuestion(
        { name: asker.name, occupation: asker.pc.occupation, personality: asker.pc.personality },
        npc,
        sceneCtx,
        {
          dialogueHistory,
          investigationFocus: focus,
        },
        llmClient,
        worldCtx,
      );
    } catch (e) {
      // 静默降级会伪装成"模型写得很平庸"：fallbackQuestion 的池子只有四条万能追问，
      // 一局问下来全是"能跟我们细说说当时的情形吗？"，看日志的人只会以为提示词不行，
      // 根本想不到 LLM 这一路每次都抛了异常。原因必须打出来。
      console.warn(`[pc-question] ${asker.name} 提问降级为模板：${e instanceof Error ? e.message : String(e)}`);
      question = fallbackQuestion(ctx, targetTopic);
    }
    if (!question.trim()) {
      console.warn(`[pc-question] ${asker.name} 提问降级为模板：LLM 返回空串`);
      question = fallbackQuestion(ctx, targetTopic);
    }
  } else {
    question = fallbackQuestion(ctx, targetTopic);
  }
  // PC 提问用自然引导（"开口问道：'……'"），避免机械"名字：内容"直出。
  // 池子原先只有 4 条且纯随机，一局里"沉吟片刻，问道："出现了三次、
  // "向前一步，问道："两次。扩池 + 躲开上一条，比继续加大随机池有效。
  const askBridges = [
    "开口问道：", "追问道：", "沉吟片刻，问道：", "向前一步，问道：",
    "皱了皱眉，问：", "点点头，接着问：", "换了个语气问：", "顿了顿，问：",
    "看了对方一眼，问：", "压低声音问：", "不太确定地问：", "直截了当地问：",
  ];
  const pool = askBridges.filter((b) => b !== dedup.lastAskBridge);
  const askBridge = pick(pool);
  dedup.lastAskBridge = askBridge;
  say(`\n${asker.name}${askBridge}"${stripOuterQuotes(question)}"`);

  // NPC 回复：LLM 可用时走 LLM；无 LLM 时 generateNpcReply 内 templateReply 按 preferredIndex
  // 精确返回目标 reveal（问答对齐：问话锚定 knowledge[target.ki]，回复即 reveals[target.ki]）
  const usedRevealIndices = new Set(
    (npc.llmExpanded?.knowledgeReveals ?? [])
      .map((_, i) => i)
      .filter(i => w.isClueFound(`clue_kn_${npc.id}_${i}`))
  );
  const reply = await generateNpcReply(
    npc, question, sceneCtx,
    llmClient ?? undefined,
    usedRevealIndices,
    target?.ki,
    worldCtx,
  );
  if (reply) {
    // 回复用数据驱动引导桥（"顿了顿，又说："类），避免机械"名字：内容"直出
    const s = analyseNpcData(npc);
    // 台词自带开头神态时，把它转成叙述句当引导桥，不要再叠一层 —— 否则同一个
    // 动作会被说两遍。转成叙述句而不是保留括号，是因为"（面带忧虑）我儿子失踪了"
    // 读起来是剧本提示，"面带忧虑，说：「我儿子失踪了」"才像人话。
    const { action, speech } = splitLeadingStageDirection(stripOuterQuotes(reply), displayName);
    const lead = action ? speechLead(action) : nextRevealBridge(dedup, npc, s, false);
    say(`\n${displayName}${lead}"${speech}"`);
    noteEntityMentions(speech, w);
    // 标记本轮实际说出的 reveal（避免下次重复）。
    // LLM 路径：按回答内容与 reveal 的重叠匹配标记——回答"按需叙述"后可能偏离 target，
    //   未说出的信息不标记、留待玩家再问（符合"信息在提及时才叙述"）；
    // 模板路径：按 preferredIndex 锚定 target（问答对齐）。
    const reveals = npc.llmExpanded?.knowledgeReveals ?? [];
    const norm = (x: string) => x.replace(/（[^）]*）/g, "").replace(/[\s，。！？、：；…"“”‘’]/g, "");
    if (llmClient) {
      const core = norm(reply);
      for (let i = 0; i < reveals.length; i++) {
        if (w.isClueFound(`clue_kn_${npc.id}_${i}`)) continue;
        const rc = norm(reveals[i]);
        if (rc.length > 4 && (core.includes(rc) || rc.includes(core))) {
          w.discoverClue(`clue_kn_${npc.id}_${i}`);
        }
      }
    } else {
      const replyKi = target?.ki ?? reveals.findIndex(r => r === reply);
      if (replyKi >= 0) w.discoverClue(`clue_kn_${npc.id}_${replyKi}`);
    }
  }
}

/** 无 LLM 时的追问降级 — 抽象化提问（不把 knowledge 信息内容塞进问句，避免"提问即剧透、回答即复述"的逐条打印感）。
 *  回复由 generateNpcReply 按 preferredIndex 锚定对应 reveal，问句抽象不影响答对内容。 */
export function fallbackQuestion(ctx: SceneCtx, topic?: string): string {
  // ⚠ 这里原先解构了 module/support/world/cast/cursor/dedup/wm/llmClient/agents
  //   九个变量，**一个都没用**。而且 `agents: [pl1, pl2]` 会对 undefined 做数组解构，
  //   于是一个「从池子里挑句话」的纯函数能抛 TypeError —— 诊断脚本传个空 ctx 就崩了。
  //   要用什么现取什么，并且防着 ctx 不完整。
  const anchor = topic ? topicAnchor(topic, ctx?.module) : "";
  const last = ctx?.dedup?.lastAskBridge ?? "";
  const pickOne = (xs: string[]): string => {
    const pool = xs.filter((x) => x !== last);
    return (pool.length ? pool : xs)[Math.floor(Math.random() * (pool.length || xs.length))]!;
  };

  // 抓到了专名 → 问到人头上。专名不是剧透：PC 本来就知道有这么个人、这么个地方。
  if (anchor) {
    return pickOne([
      `关于${anchor}，您还记得什么吗？`,
      `${anchor}的事，您还知道些什么？`,
      `能跟我们说说${anchor}吗？`,
      `${anchor}那边，当时是什么情况？`,
      // 句式要经得起长全名 —— 「再问一句艾德里安·埃斯特鲁姆——」读着卡
      `${anchor}呢？您还想得起别的吗？`,
    ]);
  }
  // 没抓到专名 → 只能抽象地问。
  //
  // 这里**不能**把 topic 原样塞进问句：extractTopic 返回的是 knowledge 的分句
  // 而不是名词，「关于**加比比较叛逆**，您还记得什么吗？」既不通顺，
  // 又把答案在问句里提前说了 —— 提问即剧透、回答即复述。
  if (topic && topic.length > 1) {
    return pickOne([
      "这件事的具体情况，您还知道些什么吗？",
      "能跟我们细说说当时的情形吗？",
      "关于这一点，您还记得什么吗？",
      "那之后呢，还发生了什么？",
      "您当时是怎么想的？",
      "还有别人知道这件事吗？",
    ]);
  }
  return pickOne([
    "关于这个案子，你们还知道些什么吗？",
    "能再说说你们知道的情况吗？",
    "有什么是我们该知道、但还没问到的吗？",
    "这阵子镇上还有什么不对劲的地方？",
  ]);
}

/**
 * 从话题分句里取出**已知专名**，取不到就返回空。
 *
 * 判据的关键在「已知」两个字：只认模组里登记过的人名和地名。
 * 不做通用中文名词抽取 —— 在开放文本上按字面切词不可靠，
 * 切错了就会把 knowledge 正文当专名塞进问句，那正是要避免的剧透。
 *
 * 取最长匹配：「米尔·特里坎」优先于「米尔」，否则问句会退化成叫小名。
 */
export function topicAnchor(topic: string, module?: { npcs?: { name: string }[]; scenes?: { name: string }[] }): string {
  if (!topic) return "";
  const names = [
    ...(module?.npcs ?? []).map((n) => n.name),
    ...(module?.scenes ?? []).map((s) => s.name),
  ]
    .map((n) => n.replace(/[（(].*?[）)]/g, "").trim())
    .filter((n) => n.length >= 2);
  // 全名之外也认「姓」和「名」两段，玩家口语里常只说一段
  const variants = names.flatMap((n) => (n.includes("·") ? [n, ...n.split("·")] : [n]))
    .filter((n) => n.length >= 2);
  const hit = variants
    .filter((n) => topic.includes(n))
    .sort((a, b) => b.length - a.length)[0];
  return hit ?? "";
}

/**
 * 首次见面时，调查员怎么表明身份与来意。
 *
 * 原先是写死的一句，一局原样重复 6 次（`probe-narration-mix` 量到的）。
 * 改成由**这两个人是谁**决定：
 *   · 谁开口 —— 靠说话吃饭的职业（记者/警察/律师/医生…）更可能先开口
 *   · 怎么说 —— 说辞跟着那个职业走，而不是所有人共用一句
 *
 * 仍然是模板（不打 LLM）—— 这一句紧接在敲门之后、NPC 回应之前，
 * 是个**节拍**而不是内容，为它多打一次网络不划算。
 * 但素材取自角色，同一局两个人不会说同一句，不同局也不会。
 */
const SPEAKER_TRADES = /记者|警|侦探|律师|教授|医生|护士|神职|传教|推销|演员|作家/;

export function introduceParty(
  cast: { p0: { shortName: string }; p1: { shortName: string } },
  agents: readonly [PlayerAgent, PlayerAgent],
): string {
  const people = [
    { name: cast.p0.shortName, occ: agents[0].pc.occupation ?? "" },
    { name: cast.p1.shortName, occ: agents[1].pc.occupation ?? "" },
  ];
  // 靠说话吃饭的先开口；都不是就按谁在前
  const speaker = people.find((p) => SPEAKER_TRADES.test(p.occ)) ?? people[0]!;
  const other = people.find((p) => p !== speaker)!;

  // 池子要够大。一局有 6 次首见 —— 两三句的池子必然连着撞
  //（实测改成 2 句一档之后，仍出现同一句连出 4 次）。
  // 这仍是模板，不打 LLM：这一句是敲门与回应之间的节拍，为它多打一次网络不划算；
  // 真要彻底不重复，得让 LLM 写，那是另一笔账。
  const byTrade: [RegExp, string[]][] = [
    [/记者|作家/, [
      `${speaker.name}报上名字，说自己在为一桩失踪案奔走，${other.name}在旁补了一句来意。`,
      `${speaker.name}先递上名片，简短说明了来意；${other.name}站在半步之后没有插话。`,
      `${speaker.name}把来意说得像在起一个头，留了不少余地；${other.name}没有补充。`,
      `${speaker.name}自报家门，顺口问了句方不方便说话；${other.name}站在门边。`,
      `${speaker.name}三言两语交代了身份和来由，笔记本还夹在腋下；${other.name}跟着点头。`,
    ]],
    [/警|侦探|律师/, [
      `${speaker.name}亮明身份，把来意说得很短；${other.name}在一旁点了点头。`,
      `${speaker.name}开口便直奔正题，报了姓名与所为何来，${other.name}没有多话。`,
      `${speaker.name}报上名字，末了补一句「例行了解情况」；${other.name}站在后面。`,
      `${speaker.name}说明身份时语速不快，把来意一句一句放下；${other.name}没有插话。`,
      `${speaker.name}先说清自己是谁，再说明为什么来；${other.name}只在旁边应了一声。`,
    ]],
    [/医生|护士/, [
      `${speaker.name}放缓语气自报家门，说明来意时特意避开了刺耳的字眼；${other.name}在旁边等着。`,
      `${speaker.name}先问了句「方便说话吗」，才报上姓名与来意，${other.name}跟着点头。`,
      `${speaker.name}把来意说得很轻，像是怕碰着什么；${other.name}在半步之后。`,
      `${speaker.name}自报家门，先关心了一句对方的气色，才转到正题；${other.name}没作声。`,
      `${speaker.name}说明身份时手一直没从提包上挪开，来意讲得简短；${other.name}在旁。`,
    ]],
    [/教授|学者|科学/, [
      `${speaker.name}略显生硬地介绍了自己和${other.name}，把来意讲得像在陈述一件事实。`,
      `${speaker.name}报上姓名与职衔，接着才想起补上一句此行的缘由；${other.name}替他把话收了尾。`,
      `${speaker.name}先说了自己在哪里任职，绕了一圈才讲到来意；${other.name}把话接了过去。`,
      `${speaker.name}的自我介绍比来意还长；${other.name}适时插了一句，把话头拉回正题。`,
      `${speaker.name}把来意讲得条理分明，像在念一份提纲；${other.name}在旁边点头。`,
    ]],
  ];
  const pool = byTrade.find(([re]) => re.test(speaker.occ))?.[1] ?? [
    `${speaker.name}说明了两人的身份和此行的来意，${other.name}在旁边补了两句。`,
    `${speaker.name}先开口报上姓名，${other.name}接着说清了他们为什么来。`,
    `两人自报家门，${speaker.name}把来意讲了一遍。`,
    `${speaker.name}把话头起了，${other.name}把来意补完整。`,
    `${speaker.name}报上两人的名字，简短交代了为什么找上门来。`,
    `${speaker.name}说明来意的时候没绕弯子；${other.name}在一旁听着。`,
    `寒暄了两句，${speaker.name}才把身份和来意一并说了。`,
  ];
  return pick(pool);
}

/**
 * 子串匹配放弃之后，问一次 LLM「他到底要去哪」。
 *
 * 三条纪律，缺一条这步就变成净损失：
 *   1. **只在放弃时问**。正常路径一次网络都不打，离线跑法完全不受影响。
 *   2. **短超时**。移动决策卡在网络上比认错地方更糟；超时就当没问过。
 *   3. **答不出就照旧**。`parseMoveHint` 只接受候选集合里真实存在的 id，
 *      `unknown`/幻觉/报错一律回 null，调用方回落到替选并**明说没听清**。
 *
 * 任何一步出问题的代价都是「退回今天的行为」，不会更差 —— 这是敢接的前提。
 */
async function askMoveTarget(
  llm: LLMClient,
  said: string,
  sceneName: string,
  unlocked: SceneConnection[],
  module: ModuleData,
): Promise<string | null> {
  const exits = unlocked.map(c => ({
    id: c.targetSceneId,
    name: module.scenes.find(s => s.id === c.targetSceneId)?.name ?? c.targetSceneId,
  }));
  try {
    const raw = await llm.chat(
      [
        {
          role: "system",
          content: [
            "你在帮一个跑团引擎判断：玩家这句话指的是下面哪个出口。",
            '只输出 JSON，形如 {"target":"<出口 id>"} 或 {"target":"unknown"}。',
            "**只有当这句话唯一确定了一个出口时才给 id。**",
            "话里没指定去哪、或者同时说得通好几个出口，一律回 unknown ——",
            "猜错比承认不知道更糟，引擎会明确告诉玩家「没听清」。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `当前所在：${sceneName}`,
            "可选出口：",
            ...exits.map(e => `  ${e.id} = ${e.name}`),
            "",
            `玩家说：「${said}」`,
          ].join("\n"),
        },
      ],
      { maxTokens: 64, temperature: 0, jsonMode: true, timeout: 8_000 },
    );
    return parseMoveHint(raw, exits.map(e => e.id));
  } catch {
    return null; // 网络/超时/限流 —— 当没问过，回落到替选
  }
}

// ── Scene processor: entry → exploration → analysis → advance ──
export async function processScene(ctx: SceneCtx): Promise<SceneConnection | null> {
  const {
    module, support, world, cast, cursor, dedup, wm, llmClient,
    agents, agents: [pl1, pl2],
  } = ctx;
  const scene = world.currentScene!;
  world.advanceRound();

  // 进场先看有没有人倒着 —— CoC 7e：HP 归零即失去意识，得靠同伴急救唤醒。
  // 放在场景开头而不是每回合：每回合都试会变成必然成功的仪式，掷骰就没意义了。
  tryReviveDowned({
    module, support, world, scene, cast, cursor, dedup, wm,
    agents, llmClient, attemptedClueIds: new Set(),
  });

  // 两人都还倒着 → 这个场景什么也做不了，交回主循环收尾
  if (standing([cast.c1, cast.c2]).length === 0) {
    say(`\n两名调查员都失去了意识，倒在${scene.name}。`);
    return null;
  }

  // Use global visit tracking — moveToScene increments before processScene runs,
  // so count > 1 means this is a revisit
  const prevVisits = cursor.visitCount.get(scene.id) ?? 0;
  const isRevisit = prevVisits > 0;
  say(`\n${isRevisit ? "\u2501 \u518d\u6b21\u6765\u5230" : "\u2501"} ${scene.name}`);
  emit({ type: "scene-enter", sceneId: scene.id, sceneName: scene.name, revisit: isRevisit });

  // ── Phase 1: Scene entry - KP roleplay narration ──
  // On revisit, skip full description for immersion; use a short restatement
  if (isRevisit) {
    const revisitPhrases = ["这里和刚才来时一样。", "一切如旧。", "和之前离开时没什么变化。", "场景依旧。"];
    say(`\n${revisitPhrases[Math.floor(Math.random() * revisitPhrases.length)]}`);
  } else {
    say(`\n${scene.description}`, "verbatim");
    // 首次到访：开场氛围描写（场景级，先于 NPC 出场——如"孩子玩球跑回屋内"这类场景开场动作）
    if (scene.openingAtmosphere) {
      say(`\n${scene.openingAtmosphere}`, "verbatim");
    }
  }

  // ── NPC encounters woven into scene ──
  for (let nIdx = 0; nIdx < scene.npcIds.length; nIdx++) {
    const npcId = scene.npcIds[nIdx];
    const npc = module.npcs.find(n => n.id === npcId) as ModuleNPC;
    if (!npc) continue;
    const npcState = world.getNpcState(npc.id);
    if (!npcState || !npcState.isAlive) continue;

    // 场景内多个 NPC 之间插入过渡衔接（LLM 生成，模板 fallback）
    let introShown = false;
    // 记录刚展示的过渡文本（用于剥离 firstEncounter 中与过渡重复的开门动作，避免"门被拉开"后又说"猛地拉开门"）
    let lastTransitionText = "";
    if (nIdx > 0) {
      const prevId = scene.npcIds[nIdx - 1];
      const prevNpc = module.npcs.find(n => n.id === prevId) as ModuleNPC | undefined;
      if (prevNpc) {
        try {
          // prevNpc 已经说过的话（供过渡句承接，防止脑补未发生的内容，如编造"她对警察的抱怨"）
          const prevLines = [
            prevNpc.llmExpanded?.firstEncounter,
            ...(prevNpc.llmExpanded?.knowledgeReveals ?? [])
              .map((text, ki) => ({ text, ki }))
              .filter(({ ki }) => world.isClueFound(`clue_kn_${prevNpc.id}_${ki}`))
              .map(r => r.text),
          ].filter(Boolean).join(" / ");
          const transition = await generateNpcTransition(prevNpc, npc, scene, llmClient, buildWorldContext(module, [pl1, pl2], wm, world), prevLines);
          // 过渡句印在 npc 被介绍**之前**。它要是叫出了还没见过的人的名字，
          // 旁白就替调查员作弊了。宁可不印这句 —— 过渡是润色，名字穿帮是硬伤。
          const leak = npcState.knownByPlayers ? "" : namesPerson(transition, npc.name, everyKnownName(ctx));
          if (leak) {
            emit({ type: "name-leak", where: "npc-transition", npc: npc.id, hit: leak, text: transition });
          } else {
            say(`\n${transition}`);
            lastTransitionText = transition;
            introShown = true;
          }
        } catch { /* 过渡失败则直接进入下一位 NPC */ }
      }
    } else if (scene.openingAtmosphere) {
      // 场景有开场氛围（如"孩子跑回屋内"）时，首位 NPC 出场前生成承接过渡，
      // 只做"承接动作"衔接（孩子进屋→大人开门），外貌由后续 impression 单独给出，
      // 不设 introShown，避免首 NPC 的外貌信息缺失。
      try {
        const transition = await generateOpeningTransition(npc, scene, scene.openingAtmosphere, llmClient, buildWorldContext(module, [pl1, pl2], wm, world));
        // 同上：首位 NPC 的承接句同样印在介绍之前。
        // 模组里静态的 openingAtmosphere 有测试守着，这条生成出来的以前没人查。
        const leak = npcState.knownByPlayers ? "" : namesPerson(transition, npc.name, everyKnownName(ctx));
        if (leak) {
          emit({ type: "name-leak", where: "opening-transition", npc: npc.id, hit: leak, text: transition });
        } else {
          say(`\n${transition}`);
          lastTransitionText = transition;
        }
      } catch { /* 承接失败则不打印，直接进入首 NPC */ }
    }

    const firstMeeting = !npcState.knownByPlayers;
    if (firstMeeting) world.meetNpc(npc.id);
    const speechProfile = classifySpeechStyle(npc.personality.speech);

    if (npc.llmExpanded) {
      // ── LLM预生成对话分支：统一处理，跳过模板链 ──
      const displayName = npc.name.replace(/[（(].*[）)]$/, "").trim();
      const pcImpression = buildPcImpression(npc);
      const approachBehavior = npc.behaviors?.find(b => b.trigger === "player_approach");
      const behaviorText = approachBehavior
        ? approachBehavior.action.replace(npc.name, "").trim().replace(/^，+/, "")
        : "";
      const toneBridge = buildToneBridge(npc, speechProfile);

      if (firstMeeting) {
        // 开头的括号神态在这里就切掉，下面三个分支拿到的都是干净台词。
        // 切出来的动作留给普通分支当引导桥用（见下），mental_voice / coma_rapid
        // 自带固定引导句，多一段神态只会打架，直接丢。
        const rawFirst = stripDoorOpenPrefix(npc.llmExpanded.firstEncounter, lastTransitionText);
        const { action: leadAction, speech: dialogueText } = splitLeadingStageDirection(rawFirst, displayName);
        noteEntityMentions(dialogueText, world);
        if (speechProfile.type === "mental_voice") {
          if (!introShown) say(`\n${pcImpression}`, "verbatim");
          say(`\n${mentalVoiceBridge(speechProfile, displayName, "——")}`);
          say(quoteDialogue(dialogueText));
        } else if (speechProfile.type === "coma_rapid") {
          if (!introShown) say(`\n${pcImpression}`, "verbatim");
          say(`\n${displayName}昏迷中似乎在说着什么。`, "verbatim");
          say(quoteDialogue(dialogueText));
        } else {
          if (!introShown) {
            say(`\n${pcImpression}。`, "verbatim");
            // 首次见面自报家门：调查员先表明身份与来意（承接敲门/进屋），NPC 才承接回应进入正题。
            //
            // ⚠ 原先是写死的一句「你们上前，向对方表明了自己的身份与来意。」
            // `probe-narration-mix` 量到它**一局里原样出现 6 次** ——
            // 全局唯一一句被反复复用的引擎叙述，正是「读起来没有灵性」的来源。
            // 现在按**这两个调查员是谁**来说：谁开口取决于职业（记者/警察这类
            // 本来就靠说话吃饭），说辞也跟着职业走。素材来自角色，不是固定句。
            say(`\n${introduceParty(cast, agents)}`, "verbatim");
            // 私宅场景：插入"进屋坐下"过渡，建立叙事节奏（先落座 → 再求助 → 再谈案情），
            // 避免 NPC 站在门口就把所有话倒完
            if (world.currentScene?.isHome) {
              say(`\n${displayName}侧身把你们让进屋里，示意你们在桌边坐下。`, "verbatim");
            }
          }
          if (behaviorText) say(behaviorText);
          // firstEncounter 若自带"XX说："引导（LLM 生成的神态更贴合），直接用它的引导，
          // 避免与 toneBridge 叠加成两个"说"；否则统一用 displayName + toneBridge
          const { lead, rest } = stripDialogueLead(dialogueText);
          if (lead) {
            // LLM 引导常以"他/她/它"开头（如"他像堵墙一样挡住去路……"），前置名字避免指代不明
            const leadWithName = /^[他她它]/.test(lead) ? `${displayName}${lead.slice(1)}` : lead;
            say(`\n${leadWithName.trim()}`);
            say(quoteDialogue(rest));
          } else {
            // 台词自带开头神态时拿它当引导桥（转成叙述句）。原先是"有括号就不加桥"，
            // 可括号仍留在台词里，读起来还是剧本提示而不是人话。
            say(`\n${displayName}${leadAction ? speechLead(leadAction) : toneBridge}`);
            say(quoteDialogue(dialogueText));
          }
        }
        // ── 玩家背景提及反应 ──
        // 模组数据定义 mentionReactions，引擎做匹配：PL的occupation命中trigger时触发
        const reactions = npc.llmExpanded?.mentionReactions;
        if (reactions && reactions.length > 0) {
          for (const pl of [pl1, pl2]) {
            const matched = reactions.find(r =>
              pl.pc.occupation.toLowerCase().includes(r.trigger.toLowerCase())
            );
            if (matched) {
              say(`\n${matched.reaction.replace(/\{name\}/g, pl.name)}`);
              break;
            }
          }
        }
      } else {
        // 同 firstMeeting：开头括号在源头切掉，三个分支拿到的都是干净台词
        const rawRevisit = stripDoorOpenPrefix(npc.llmExpanded.revisitEncounter ?? npc.llmExpanded.firstEncounter, lastTransitionText);
        const { action: leadAction, speech: dialogueText } = splitLeadingStageDirection(rawRevisit, displayName);
        noteEntityMentions(dialogueText, world);
        if (speechProfile.type === "mental_voice") {
          say(`\n${mentalVoiceBridge(speechProfile, displayName, "——", true)}`);
          say(quoteDialogue(dialogueText));
        } else if (speechProfile.type === "coma_rapid") {
          if (!introShown) say(`\n${pcImpression}——依然昏迷，但嘴唇仍在翕动。`, "verbatim");
          say(quoteDialogue(dialogueText));
        } else {
          const { lead, rest } = stripDialogueLead(dialogueText);
          if (lead) {
            // LLM 引导常以"他/她/它"开头（如"他像堵墙一样挡住去路……"），前置名字避免指代不明
            const leadWithName = /^[他她它]/.test(lead) ? `${displayName}${lead.slice(1)}` : lead;
            say(`\n${leadWithName.trim()}`);
            say(quoteDialogue(rest));
          } else {
            say(`\n${displayName}${leadAction ? speechLead(leadAction) : toneBridge}`);
            say(quoteDialogue(dialogueText));
          }
        }
      }
      revealNpcKnowledge(npc, world, dedup, speechProfile);
      world.adjustRelationship(npc.id, 1);
      // 自由对话：PL 可以追问 NPC 1-2 轮
      if (firstMeeting && speechProfile.type !== "coma_rapid" && speechProfile.type !== "none") {
        await conductNpcConversation(ctx, npc, world);
      }
    } else if (firstMeeting) {
      // Set mood from attitude
      const moodMap: Record<string, string> = { "友好": "friendly", "热心": "friendly", "合作": "cooperative", "冷漠": "neutral", "警惕": "wary", "敌意": "hostile", "畏惧": "fearful" };
      for (const [kw, m] of Object.entries(moodMap)) {
        if (npc.personality.attitude.includes(kw)) { world.setNpcMood(npc.id, m); break; }
      }

      // Clean name for narration (strip parenthetical role suffixes like "（缸中脑）")
      const displayName = npc.name.replace(/[（(].*[）)]$/, "").trim();
        // Generate player-facing impression from NPC name + role instead of raw data dump
        const pcImpression = buildPcImpression(npc);

      if (speechProfile.type === "none" || speechProfile.type === "coma_rapid") {
        // 出场过渡已显示（entrance）则不重复打印印象
        if (!introShown) say(`\n就在你们面前，${pcImpression}——似乎无法与你们正常交流。`, "verbatim");
      } else if (speechProfile.type === "brainwave") {
        // 出场过渡已显示（entrance）则不重复打印印象
        if (!introShown) say(`\n${pcImpression}`, "verbatim");
        say(brainwaveFlavor(npc, displayName));
      } else if (speechProfile.type === "mental_voice") {
        // Telepathic encounter: full description, then direct mental communication
        if (!introShown) say(`\n${pcImpression}`, "verbatim");
        const dialogueText = generateNpcDialogue(npc, npcState, speechProfile, world);
        say(`\n${mentalVoiceBridge(speechProfile, displayName, "：")}`);
        say(`"${dialogueText}"`);
        revealNpcKnowledge(npc, world, dedup, speechProfile);
        world.adjustRelationship(npc.id, 1);
      } else {
        const approachBehavior = npc.behaviors?.find(b => b.trigger === "player_approach");
        const behaviorText = approachBehavior
          ? approachBehavior.action.replace(npc.name, "").trim().replace(/^，+/, "")
          : "";

        const dialogueText = generateNpcDialogue(npc, npcState, speechProfile, world);
        if (!introShown) say(`\n${pcImpression}。`, "verbatim");
        if (dialogueText) {
          const toneBridge = buildToneBridge(npc, speechProfile);
          const behaviorBridge = behaviorText ? `${behaviorText}，${toneBridge}` : `${displayName}${toneBridge}`;
          say(behaviorBridge);
          say(`"${dialogueText}"`);
        }
        revealNpcKnowledge(npc, world, dedup, speechProfile);
        world.adjustRelationship(npc.id, 1);
        // 自由对话：PL 可以追问 NPC 1-2 轮。
        // 此处无需再判 firstMeeting 或排除 coma_rapid/none：外层已是 else if (firstMeeting)，
        // 且上面的 if/else if 链已把这两种 type 分流走，条件恒为真。
        await conductNpcConversation(ctx, npc, world);
      }
    } else {
      // Returning encounter
      const displayName = npc.name.replace(/[（(].*[）)]$/, "").trim();
      if (speechProfile.type === "none" || speechProfile.type === "brainwave") {
        handleNonSpeakingNpc(npc, speechProfile, introShown);
      } else if (speechProfile.type === "coma_rapid") {
        // Unconscious NPC: show impression, then reveal mumbling knowledge
        const pcImpression = buildPcImpression(npc);
        if (!introShown) say(`\n${pcImpression}——依然处于昏迷状态，无法交流。`, "verbatim");
        revealNpcKnowledge(npc, world, dedup, speechProfile);
      } else if (speechProfile.type === "mental_voice") {
        const dialogueText = generateNpcDialogue(npc, npcState, speechProfile, world, true);
        say(`\n${mentalVoiceBridge(speechProfile, displayName, "：", true)}`);
        say(`"${dialogueText}"`);
        revealNpcKnowledge(npc, world, dedup, speechProfile);
        world.adjustRelationship(npc.id, 1);
      } else {
        const dialogueText = generateNpcDialogue(npc, npcState, speechProfile, world, true);
        if (dialogueText) {
          const toneBridge = buildToneBridge(npc, speechProfile);
          say(`\n${displayName}${toneBridge}`);
          say(`"${dialogueText}"`);
        }
        revealNpcKnowledge(npc, world, dedup, speechProfile);
        world.adjustRelationship(npc.id, 1);
      }
    }

    // npc_dialogue clues
    for (const clue of scene.clues) {
      if (world.isClueFound(clue.id)) continue;
      for (const method of clue.findMethods) {
        if (method.type === "npc_dialogue") { world.discoverClue(clue.id); }
      }
    }
  }

  // NPC 对话生成已抽到 src/play/npc-dialogue.ts（纯搬运，见该文件头部说明）
  // ── Phase 4-5: PL decision loop — investigate clues OR move ──
  // After scene entry + NPC encounters + auto events, the PL decides
  // what to do. Loop until they choose to move (or run out of options).

  /** Gather available scene-level connections, filtered by state */
  function getUnlockedConnections(): SceneConnection[] {
    return scene.connections.filter(c => {
      if (c.requiredClueId && !world.isClueFound(c.requiredClueId)) return false;
      const tgt = module.scenes.find(s => s.id === c.targetSceneId);
      if (tgt && world.isSceneVisited(c.targetSceneId)) {
        const remainingCore = tgt.clues.filter(cl => !world.isClueFound(cl.id) && cl.importance === "core");
        // Don't filter out if this scene is a passage to unexplored areas
        if (remainingCore.length === 0) {
          const leadsToUnexplored = tgt.connections.some(conn =>
            !world.isSceneVisited(conn.targetSceneId)
          );
          if (!leadsToUnexplored) return false;
        }
      }
      return true;
    }) as SceneConnection[];
  }

  // 陷阱结算已抽到 src/play/traps.ts
  await runSceneTraps(cast, world, cursor, module, scene);

  // Boss 遭遇战已抽到 src/play/combat.ts
  await runCombatEncounter(cast, world, module, scene, support);

  /**
   * 这一次进场里已经试过的线索 —— 试过就从选项里拿掉。
   *
   * 每次进场重建：换个场景、或者过一阵再回来，都该能重新试。
   */
  const attemptedClueIds = new Set<string>();

  // 线索检定这一块要的处境，按进场组一次（scene 与 attemptedClueIds 都是每次进场的）
  const clueCtx: ClueCtx = {
    module, support, world, scene, cast, cursor, dedup, wm,
    agents: [pl1, pl2], llmClient, attemptedClueIds,
  };

  // ── 进场自动揭示：只处理"不动手也会注意到"的 ──
  for (const clue of scene.clues) {
    if (world.isClueFound(clue.id)) continue;
    if (clue.importance !== "color" && !isPassiveClue(clue)) continue; // 留给玩家
    if (clue.importance === "color") {
      // Color clues: skill 类线索走 runClueCheck（有检定输出）；
      // 纯 automatic/observation 自动揭示但用 flavor+revelation 叙述（不再裸输出"发现了X。"）
      const hasSkillMethod = clue.findMethods.some(m => m.type === "skill");
      if (hasSkillMethod) {
        await runClueCheck(clueCtx, clue);
        continue;
      }
      for (const method of clue.findMethods) {
        if (method.type === "automatic" || method.type === "observation") {
          say(await narrateClueDiscovery(clueCtx, clue, "regular", ""));
          world.discoverClue(clue.id);
          checkClueSanLoss(clueCtx, clue);
        }
      }
      continue;
    }
    await runClueCheck(clueCtx, clue);
  }

  // ── 场景内行动：玩家自己决定查什么 ──
  //
  // 这是"循环反转"。原先进场就把线索全解光，走到岔口时玩家已经无事可做，
  // 只剩"去哪"可选 —— 他对"查什么"零决定权。
  //
  // 没有可查线索时整段跳过，不产生任何额外的 LLM 调用。
  for (let act = 0; act < MAX_SCENE_ACTIONS; act++) {
    const clueOpts = investigableClues(clueCtx);
    if (clueOpts.length === 0) break;

    const labels = clueOpts.map(cl => `调查${cl.name}`);
    const leaveLabel = "离开这里";
    const ctx = [
      `【场景】${scene.name}`,
      scene.description,
      clueOpts.length > 0 ? `你注意到这里还有些地方值得细看。` : "",
      `\n你要做什么？（也可以选择离开）`,
    ].filter(Boolean).join("\n");

    const decider = runCtx.getStore()?.decide;
    const options = [...labels, leaveLabel];
    const decision = decider
      ? await decider(ctx, options)
      : await pl1.decideViaLLM(ctx, labels, [leaveLabel]);
    emit({ type: "decision", options: options.length, chosen: decision.action });

    // 先看他有没有点名某条线索。名字是专有名词，出现即命中。
    // 放在 intent 前面是有意的：**不能只信 intent**。
    // 不设 intent 的决策器（PlayerDecision.intent 是可选的）会让"永远不调查"
    // 成为默认行为，而那正是这次要修的毛病。点了名就照做。
    const hit = clueOpts.find(cl =>
      decision.action.includes(cl.name) ||
      (decision.targetName ? cl.name.includes(decision.targetName) : false));

    // 没点名 —— 说要走就走，说不清要查什么也当作不查了，别替他挑一个
    if (!hit) break;

    // 记进 attemptedClueIds：检定失败的线索不能一直挂在选项里，
    // 否则玩家会在同一个抽屉上反复失败直到用完行动次数。
    attemptedClueIds.add(hit.id);
    await runClueCheck(clueCtx, hit);
  }

  // ── Gather movement options ──
  const unlocked = getUnlockedConnections().filter(c => {
    const tgt = module.scenes.find(s => s.id === c.targetSceneId);
    if (!tgt) return true;
    // If all remaining undiscovered clues in this scene are unfindable skill-checks (no PC has the skill),
    // filter it out so the PL can't waste cycles bouncing to a dead end
    const undiscovered = tgt.clues.filter(cl => !world.isClueFound(cl.id) && cl.importance !== "color");
    const allUnfindable = undiscovered.length > 0 && undiscovered.every(cl => {
      return cl.findMethods.every(m => {
        if (m.type !== "skill") return false;
        if (!m.skillName) return false;
        return resolveCheckValue(cast.c1, m.skillName) <= 0 && resolveCheckValue(cast.c2, m.skillName) <= 0;
      });
    });
    if (allUnfindable) return false; // skip this dead-end scene
    return true;
  });

  if (unlocked.length === 0) return null;

  // Single move option — just take it without LLM call
  if (unlocked.length === 1) {
    const only = unlocked[0] as SceneConnection;
    // 同下面那条分支：只报地名的示意会被紧跟的场景标题重复一遍
    const dest = module.scenes.find(s => s.id === only.targetSceneId);
    if (!isRedundantMoveLine(only.condition, dest?.name ?? "")) {
      say(`\n${only.condition}。`, "verbatim");
    }
    return only;
  }

  // Multiple move options — let LLM decide
  const foundClues = scene.clues.filter(cl => world.isClueFound(cl.id)).map(cl => cl.name);
  const knownCluesFormatted = foundClues.length > 0 ? `已发现线索: ${foundClues.join("、")}` : "已发现线索: 暂无";

  // Global investigation progress (all scenes)
  const allScenes = module.scenes;
  const visitedCount = allScenes.filter(s => world.isSceneVisited(s.id)).length;
  let allFoundCount = 0;
  const unexploredCoreScenes: string[] = [];
  for (const s of allScenes) {
    for (const cl of s.clues) {
      if (world.isClueFound(cl.id)) allFoundCount++;
    }
    const hasUndiscoveredCore = s.clues.some(cl => cl.importance === "core" && !world.isClueFound(cl.id));
    if (hasUndiscoveredCore && !world.isSceneVisited(s.id)) {
      unexploredCoreScenes.push(s.name);
    }
  }
  const progressLine = `调查进度: 已访问 ${visitedCount}/${allScenes.length} 场景, 共发现 ${allFoundCount} 条线索`;
  const remainingLine = unexploredCoreScenes.length > 0
    ? `\n还有关键线索未探索的场景: ${unexploredCoreScenes.join("、")}`
    : "";

  const npcPresent = scene.npcIds
    .map(id => module.npcs.find(n => n.id === id)?.name ?? id)
    .filter(Boolean);
  const npcLine = npcPresent.length > 0 ? `在场的人: ${npcPresent.join("、")}` : "";
  const isFirstVisit = (cursor.visitCount.get(scene.id) ?? 0) === 0;

  // ── 移动排序：保证关键场景（医院等）不被线性捷径跳过 ──
  // 规则（分数越低越优先）：
  //   0  目标场景有未发现 core 线索 且 从镇上不可达（如医院病房）→ 必须现在去，否则绕不回来
  //   10 当前场景不是镇上 且 全局仍有未发现 core 线索 → 回镇上枢纽重新分派
  //  20  目标场景未访问 且有未发现 core 线索 且 从镇上可达（回镇上后按连接序选，医院排镇内住宅前）
  //  25  目标场景已访问 但有未发现 core 线索（检定失败未拿到——已试过，别死循环，先探索新场景）
  //  30  未访问过
  //  40+ 已访问（次数越多越靠后，"已充分探索"最后）
  const HUB_SCENE_ID = support.hubSceneId;
  const hubTargets = new Set(
    module.scenes.find(s => s.id === HUB_SCENE_ID)?.connections.map(c => c.targetSceneId) ?? []
  );
  const anyCoreUndiscovered = allScenes.some(s =>
    s.clues.some(cl => cl.importance === "core" && !world.isClueFound(cl.id))
  );
  const sortedUnlocked = [...unlocked as SceneConnection[]].sort((a, b) => {
    const score = (c: SceneConnection): number => {
      const tgt = module.scenes.find(s => s.id === c.targetSceneId);
      const tgtHasCore = tgt
        ? tgt.clues.some(cl => cl.importance === "core" && !world.isClueFound(cl.id))
        : false;
      const tgtViaHub = hubTargets.has(c.targetSceneId);
      const visits = cursor.visitCount.get(c.targetSceneId) ?? 0;
      if (tgtHasCore && !tgtViaHub) return 0;                      // 仅当前场景可达的 core 场景
      if (c.targetSceneId === HUB_SCENE_ID && scene.id !== HUB_SCENE_ID && anyCoreUndiscovered) return 10; // 回枢纽
      if (tgtHasCore && visits === 0) return 20;                   // 未访问的 core 场景
      if (tgtHasCore) return 25;                                   // 已访问的 core 场景（避免死循环）
      if (visits === 0) return 30;                                 // 未访问
      return 40 + visits;                                          // 已访问（充分探索最后）
    };
    return score(a) - score(b);
  });

  const moveLabels = sortedUnlocked.map((c) => {
    const vc = cursor.visitCount.get(c.targetSceneId) ?? 0;
    const suffix = vc >= 3 ? " (已充分探索)" : vc >= 1 ? ` (已访问${vc}次)` : "";
    return `${c.condition.trim()}${suffix}`;
  });

  const plContext = [
    `【场景】${scene.name}${isFirstVisit ? "" : "（再次来到）"}`,
    scene.description,
    npcLine,
    knownCluesFormatted,
    progressLine + remainingLine,
    `\n接下来去哪？`,
  ].filter(Boolean).join("\n");

  // 这个场景还剩什么没查 —— 上面的调查循环可能是因为玩家选了「离开」才退出的，
  // 那时线索还在。
  //
  // 原先这里传的是空数组，有两个后果：
  //   1. prompt 里不会列出「你可以调查的线索」，玩家不知道还有东西没看
  //   2. `scoreAction` 会因为 `availableClues.length === 0` 给调查类意图**扣 0.3 分**
  //      —— 不只是没提示，是在主动压制「留下来再查查」这个选择
  // 对「有线索后玩家自行决定行动」这个设计来说，正好是反的。
  const stillInvestigable = investigableClues(clueCtx).map(cl => `调查${cl.name}`);

  // 走上下文里的决策器；没给就是内置 AI 玩家，与原有跑法完全一致
  const decider = runCtx.getStore()?.decide;
  const decision = decider
    ? await decider(plContext, moveLabels)
    : await pl1.decideViaLLM(plContext, stillInvestigable, moveLabels);
  emit({ type: "decision", options: moveLabels.length, chosen: decision.action });

  // 匹配逻辑见 chooseConnection（本文件顶部）—— 挪出闭包是为了能单测
  const picked = chooseConnection(decision, unlocked as SceneConnection[], {
    isSceneVisited: (id) => world.isSceneVisited(id),
    visitCount: (id) => cursor.visitCount.get(id) ?? 0,
    sceneExists: (id) => module.scenes.some(s => s.id === id),
    sceneName: (id) => module.scenes.find(s => s.id === id)?.name ?? "",
  });
  let chosenConn = picked.conn;
  if (!chosenConn) return null;
  // 记下"接下来这一步是玩家自己选的还是引擎替他挑的"。
  // 主循环的「访问≥6次强制改道」要看它 —— 玩家明确要去的地方不能把人弹走。
  cursor.arrivedByPlayerChoice = !picked.forced;

  // 没对上玩家说的话 → **明说**，别静默替他挑。
  //
  // `chooseConnection` 本来就诚实标了 `forced`，但这个标记原先只喂给
  // 「访问≥6次强制改道」，玩家那边一个字都看不到 ——
  // 他说「去那边」，引擎按分数把他送到别处，日志上只有目的地的名字。
  // 记录里那句「比菜单更糟：菜单至少还承认玩家做了选择」说的就是这个。
  //
  // 实测（scripts/diag/diag-phrasing.ts，1178 组 = 每个多出口场景 × 每个出口 ×
  // 18 种说法 × 原序/逆序两遍）：
  //   正例命中 800/800、反例（否定与「已经去过了」）144/144、
  //   歧义输入老实承认替选 234/234，且**原序与逆序结果完全一致**。
  // 这个数是判据先能区分对错之后才有意义的 —— 上一版也跑出 100%，
  // 但那只是因为 12 条用例里 8 条都含完整地名。
  //
  // 剩下认不出的是同义改写、代词、描述目的地特征 —— 这几类要语义理解，
  // 子串匹配到头了。**这不是「没有 API」**（`scripts/diag/probe-llm.ts` 实测可用），
  // 是 `chooseConnection` 从不问 LLM：它是纯函数，得可复现、可单测、能离线跑。
  //
  // 所以问 LLM 这一步放在这里，而不是塞进匹配器：
  //   · 只在匹配器已经放弃（forced）时才发一次请求，正常路径零开销
  //   · 拿到的 id 必须在候选集合里，编出来的一律当没答（见 parseMoveHint）
  //   · 答 unknown / 超时 / 报错 → 原样回落到替选，并照旧**明说**
  // 实测（`scripts/diag/probe-llm-move.ts`）：有唯一解时挑对 3/3，
  // 本无唯一解时老实回 unknown 3/3，硬猜 0/3 —— 它肯说「说不准」，这才敢接。
  let forced = picked.forced;
  if (forced && llmClient) {
    const ids = (unlocked as SceneConnection[]).map(c => c.targetSceneId);
    const hint = await askMoveTarget(llmClient, decision.action, scene.name, unlocked as SceneConnection[], module);
    const picked2 = hint ? (unlocked as SceneConnection[]).find(c => c.targetSceneId === hint) : undefined;
    if (picked2 && ids.includes(picked2.targetSceneId)) {
      chosenConn = picked2;
      forced = false;
      cursor.arrivedByPlayerChoice = true;
    }
  }

  const finalDest = module.scenes.find(s => s.id === chosenConn.targetSceneId);
  if (forced) {
    say(`\n（没听清要去哪，两人商量了一下，决定先去${finalDest?.name ?? "别处"}。）`, "verbatim");
  }

  // 只报地名的那种就别说了 —— 下一行的场景标题会把同一件事再讲一遍
  if (!isRedundantMoveLine(chosenConn.condition, finalDest?.name ?? "")) {
    say(`\n${chosenConn.condition}。`, "verbatim");
  }
  return chosenConn;
}

/**
 * 本局所有已知的人名 —— 全场 NPC 加两位调查员。
 *
 * `namesPerson` 判「这段话点没点到某人」时要靠它排除被更长名字盖住的误认：
 * 少了调查员的名字，「米尔德丽德」就会被当成「米尔」。
 * 这条规则是被打脸四次打出来的，见 `play/names.ts` 开头。
 */
export function everyKnownName(ctx: SceneCtx): string[] {
  return [
    ...(ctx.module?.npcs ?? []).map((n) => n.name),
    ...(ctx.agents ?? []).map((a) => a?.name).filter((n): n is string => !!n),
  ];
}

/** 从 knowledge 条目中提取干净的话题核心（去掉第一人称/所有格前缀，截取到句末标点或第一逗号分句） */
export function extractTopic(raw: string): string {
  // Strip leading first-person / possessive / time phrases, including "自己"
  // Longest alternatives first so "我这里有" isn't partially consumed as "我这"
  let t = raw.replace(/^(我这里有|我这里|我已经|我这儿|我这|我们这儿|我们|我自己|自己|我)[，,：:、]?\s*/, "");
  // Strip leading 的 left by possessive phrases like "自己的孩子" → "孩子"
  t = t.replace(/^的/, "");
  // Cut at sentence-ending punctuation (single occurrence suffices — "镇上警察？他们不会管的。"
  // must collapse to "镇上警察", not the whole rhetorical question) or long dash
  const cut = t.search(/[。！？…—\u2014]/);
  if (cut > 0) t = t.slice(0, cut);
  // Strip trailing 的 to avoid "关于xxx的的事" from template "关于${k}的事"
  t = t.replace(/[的]+$/, "");
  // Cut at awkward trailing verbs/adverbs to avoid "又" / "还" dangling after truncation
  t = t.replace(/[又还][要再]?$/, "");
  // Long run-on statements (>15 chars) collapse to the first comma clause,
  // so "加比比较叛逆，喜欢出去玩，十五岁就搬到外面拖车住了" becomes "加比比较叛逆"
  if (t.length > 15) {
    const comma = t.search(/[，,]/);
    if (comma > 0) t = t.slice(0, comma);
  }
  // Trim whitespace/punctuation and cap at 25 chars
  return t.replace(/[，,、\s]+$/, "").slice(0, 25);
}
