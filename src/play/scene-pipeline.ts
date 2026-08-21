// 从 play-module.ts 抽出来的一段（脚本搬运，见 tools/_extract-block.ts）。
//
// 抽出来的理由是可寻址性：原先 runModuleInner 一个函数 2615 行、占全文件 74%，
// 里面按注释能切出近 30 个块，但没有一个是能整段读进来的单元 ——
// 每次改动只能靠行号开窗口猜，窄了缺上下文、宽了浪费。
//
// ⚠ 纯搬运，不改行为。判据是全量测试与主循环脚手架全绿。

import type {
  ModuleNPC, ModuleData, ModuleSupport, SceneConnection, Clue,
} from "../module/types";
import type { WorldState } from "../world/state";
import type { PlayerAgent } from "../agent/player-agent";
import type { LLMClient } from "../llm/client";
import { extractMessageContent } from "../llm/client";
import { resolveCheckValue } from "../character/coc-character";
import {
  buildNpcContext, generateNpcReply, generatePcQuestion,
  generateNpcTransition, generateOpeningTransition,
} from "../llm/npc-dialogue-prompts";
import type { SceneContext } from "../llm/npc-dialogue-prompts";
import { checkDialogueText } from "../world/world-constraint";
import { say, sayMech, runCtx } from "./narration";
import { buildWorldContext } from "./llm-context";
import { runSceneTraps } from "./traps";
import { runCombatEncounter } from "./combat";
import {
  buildPcImpression, handleNonSpeakingNpc, brainwaveFlavor, buildIdentityLine,
  buildDialogueForRel, buildFollowUp, buildToneBridge, revealNpcKnowledge,
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
  isPassiveClue, MAX_SCENE_ACTIONS, type ClueCtx,
} from "./clue-check";
// 从 move-util 取而不是从 play-module —— 后者会成环
import { chooseConnection, isRedundantMoveLine, noticesEntity } from "./move-util";
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
  const {
    module, support, world, cast, cursor, dedup, wm, llmClient,
    agents, agents: [pl1, pl2],
  } = ctx;
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

/** 每人已经开口过几次 —— 供 askerScore 做"别包场"的惩罚项 */
const askCounts = new Map<string, number>();

/**
 * 这一轮谁开口。
 *
 * 提问者原先写死 pl1，第二名调查员整局一句话都没说过；改成硬轮流之后
 * 又变成了两人排队发言。真实的队伍里谁接话取决于这个人是谁、这话题跟他有没有关系，
 * 所以交给 askerScore 打分，同分时才随机。
 */
export function pickAsker(ctx: SceneCtx, topic: string): PlayerAgent {
  const {
    module, support, world, cast, cursor, dedup, wm, llmClient,
    agents, agents: [pl1, pl2],
  } = ctx;
  const scored = [pl1, pl2].map((p) => ({
    p,
    // 微小抖动：分数持平时不至于每次都选同一个
    score: askerScore(p.pc, topic, askCounts.get(p.name) ?? 0) + Math.random() * 0.2,
  }));
  scored.sort((a, b) => b.score - a.score);
  const chosen = scored[0].p;
  askCounts.set(chosen.name, (askCounts.get(chosen.name) ?? 0) + 1);
  return chosen;
}

export async function conductNpcConversation(ctx: SceneCtx, npc: ModuleNPC, w: WorldState): Promise<void> {
  const {
    module, support, world, cast, cursor, dedup, wm, llmClient,
    agents, agents: [pl1, pl2],
  } = ctx;
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
  const {
    module, support, world, cast, cursor, dedup, wm, llmClient,
    agents, agents: [pl1, pl2],
  } = ctx;
  if (topic && topic.length > 1) {
    return [
      "这件事的具体情况，您还知道些什么吗？",
      "能跟我们细说说当时的情形吗？",
      "关于这一点，您还记得什么吗？",
    ][Math.floor(Math.random() * 3)];
  }
  return [
    "关于这个案子，你们还知道些什么吗？",
    "能再说说你们知道的情况吗？",
  ][Math.floor(Math.random() * 2)];
}

// ── Scene processor: entry → exploration → analysis → advance ──
export async function processScene(ctx: SceneCtx): Promise<SceneConnection | null> {
  const {
    module, support, world, cast, cursor, dedup, wm, llmClient,
    agents, agents: [pl1, pl2],
  } = ctx;
  const scene = world.currentScene!;
  world.advanceRound();
  const round = world.round;

  // Use global visit tracking — moveToScene increments before processScene runs,
  // so count > 1 means this is a revisit
  const prevVisits = cursor.visitCount.get(scene.id) ?? 0;
  const isRevisit = prevVisits > 0;
  say(`\n${isRevisit ? "\u2501 \u518d\u6b21\u6765\u5230" : "\u2501"} ${scene.name}`);

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
          say(`\n${transition}`);
          lastTransitionText = transition;
          introShown = true;
        } catch { /* 过渡失败则直接进入下一位 NPC */ }
      }
    } else if (scene.openingAtmosphere) {
      // 场景有开场氛围（如"孩子跑回屋内"）时，首位 NPC 出场前生成承接过渡，
      // 只做"承接动作"衔接（孩子进屋→大人开门），外貌由后续 impression 单独给出，
      // 不设 introShown，避免首 NPC 的外貌信息缺失。
      try {
        const transition = await generateOpeningTransition(npc, scene, scene.openingAtmosphere, llmClient, buildWorldContext(module, [pl1, pl2], wm, world));
        say(`\n${transition}`);
        lastTransitionText = transition;
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
          if (!introShown) say(`\n${pcImpression}`);
          say(`\n${mentalVoiceBridge(speechProfile, displayName, "——")}`);
          say(quoteDialogue(dialogueText));
        } else if (speechProfile.type === "coma_rapid") {
          if (!introShown) say(`\n${pcImpression}`);
          say(`\n${displayName}昏迷中似乎在说着什么。`, "verbatim");
          say(quoteDialogue(dialogueText));
        } else {
          if (!introShown) {
            say(`\n${pcImpression}。`);
            // 首次见面自报家门：调查员先表明身份与来意（承接敲门/进屋），NPC 才承接回应进入正题
            say(`\n你们上前，向对方表明了自己的身份与来意。`, "verbatim");
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
          if (!introShown) say(`\n${pcImpression}——依然昏迷，但嘴唇仍在翕动。`);
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
        if (!introShown) say(`\n就在你们面前，${pcImpression}——似乎无法与你们正常交流。`);
      } else if (speechProfile.type === "brainwave") {
        // 出场过渡已显示（entrance）则不重复打印印象
        if (!introShown) say(`\n${pcImpression}`);
        say(brainwaveFlavor(npc, displayName));
      } else if (speechProfile.type === "mental_voice") {
        // Telepathic encounter: full description, then direct mental communication
        if (!introShown) say(`\n${pcImpression}`);
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
        if (!introShown) say(`\n${pcImpression}。`);
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
        if (!introShown) say(`\n${pcImpression}——依然处于昏迷状态，无法交流。`);
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
    const decision = decider
      ? await decider(ctx, [...labels, leaveLabel])
      : await pl1.decideViaLLM(ctx, labels, [leaveLabel]);

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

  // 走上下文里的决策器；没给就是内置 AI 玩家，与原有跑法完全一致
  const decider = runCtx.getStore()?.decide;
  const decision = decider
    ? await decider(plContext, moveLabels)
    : await pl1.decideViaLLM(plContext, [], moveLabels);

  // 匹配逻辑见 chooseConnection（本文件顶部）—— 挪出闭包是为了能单测
  const picked = chooseConnection(decision, unlocked as SceneConnection[], {
    isSceneVisited: (id) => world.isSceneVisited(id),
    visitCount: (id) => cursor.visitCount.get(id) ?? 0,
    sceneExists: (id) => module.scenes.some(s => s.id === id),
    sceneName: (id) => module.scenes.find(s => s.id === id)?.name ?? "",
  });
  const chosenConn = picked.conn;
  if (!chosenConn) return null;
  // 记下"接下来这一步是玩家自己选的还是引擎替他挑的"。
  // 主循环的「访问≥6次强制改道」要看它 —— 玩家明确要去的地方不能把人弹走。
  cursor.arrivedByPlayerChoice = !picked.forced;

  // 只报地名的那种就别说了 —— 下一行的场景标题会把同一件事再讲一遍
  const dest = module.scenes.find(s => s.id === chosenConn.targetSceneId);
  if (!isRedundantMoveLine(chosenConn.condition, dest?.name ?? "")) {
    say(`\n${chosenConn.condition}。`, "verbatim");
  }
  return chosenConn;
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
