// 普瑞米尔的谷仓 — 交互式跑团模拟
// 核心架构：KP 场景描述 -> PL 决策 -> 引擎检定 -> 世界推进
// 有 LLM 时 LLM 驱动，无 LLM 时模板驱动
// bun run src/play-module.ts

import { createCoCCharacter, getCoCArchetypes, type CoCGeneratedCharacter } from "./character/coc-character";
import { CoCEngine, SanityEngine, type CoCCheckResult } from "./rules/coc-engine";
import { BARN_OF_PREMIER } from "./module/barn-of-premier";
import { WorldState } from "./world/state";
import { PlayerAgent, createPlayerCharacter } from "./agent/player-agent";
import { displayCharacterSheet, characterSummary, getHighlightedSkills } from "./pl/character-display";
import type { Clue, Scene, ModuleNPC, NPCInstanceState } from "./module/types";
import type { PlayerDecision } from "./agent/player-agent";

const log: string[] = [];
function say(m: string) { console.log(m); log.push(m); }
function divider(t?: string) { say(""); say("\u2501".repeat(60)); if (t) say("  " + t); say("\u2501".repeat(60)); }

// ── 角色创建 ──
async function createPC(name: string, archId: string) {
  const archs = getCoCArchetypes();
  const arch = archs.find((a: any) => a.id === archId)!;
  return await createCoCCharacter({ name, archetypeId: archId, method: "point_buy" as const, points: 480 }, arch);
}

// ── 检定 ──
function check(skillVal: number, pcName: string, skillLabel: string, diff: "regular"|"hard"|"extreme" = "regular"): CoCCheckResult {
  const r = CoCEngine.skillCheck(skillVal, diff);
  const labels: Record<string,string> = { critical:"大成功★", extreme:"极限成功", hard:"困难成功", regular:"成功", fail:"失败", fumble:"大失败" };
  say(`➜ ${pcName} [${skillLabel}] ${skillVal}% → d100=${r.roll} → ${labels[r.successLevel]||r.successLevel}`);
  return r;
}

// ── 根据成功等级生成发现 flavor ──
function discoveryFlavor(level: string): string {
  const m: Record<string, string[]> = {
    critical: ["震撼人心的发现——", "天哪——"],
    extreme:  ["一个重要的发现——", "关键线索——"],
    hard:     ["一个重要的发现——", "有价值的发现——"],
    regular:  ["一个发现——", "有了——"],
  };
  const pool = m[level] || m.regular;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── 失败 flavor ──
function failFlavor(fumble: boolean): string {
  if (fumble) {
    return ["可惜没能发现什么——反而一个失手把东西碰乱了。", "糟糕，什么也没找到，还弄出了不小的动静。"][Math.floor(Math.random() * 2)];
  }
  return ["可惜没能发现什么有用的东西。", "搜索了一番，一无所获。", "什么也没有。"][Math.floor(Math.random() * 3)];
}

// ── 主流程 ──
async function runModule() {
  divider("\u300a\u666e\u745e\u7c73\u5c14\u7684\u8c37\u4ed3\u300bCoC 7e \u4ea4\u4e92\u5f0f\u6a21\u62df");

  // 1. Create characters
  const c1 = await createPC("\u4ea8\u5229\u00b7\u6469\u6839", "detective");
  const c2 = await createPC("\u8a79\u59c6\u65af\u00b7\u5361\u7279", "doctor_medicine");

  const san1 = new SanityEngine(c1.attributes.power ?? 50);
  san1.state.currentSAN = c1.attributes.power ?? 50;
  san1.state.maxSAN = c1.attributes.power ?? 50;
  const san2 = new SanityEngine(c2.attributes.power ?? 50);
  san2.state.currentSAN = c2.attributes.power ?? 50;
  san2.state.maxSAN = c2.attributes.power ?? 50;

  // 2. Show full sheets
  divider("\u8c03\u67e5\u5458\u521b\u5efa\u5b8c\u6210");
  say(displayCharacterSheet(c1));
  say(displayCharacterSheet(c2));

  // 3. Init world + agents
  const world = new WorldState(BARN_OF_PREMIER);
  const pl1 = new PlayerAgent(createPlayerCharacter(
    c1, "\u4ea8\u5229\u00b7\u6469\u6839", "\u79c1\u5bb6\u4fa6\u63a2",
    "\u6c89\u9ed8\u5be1\u8a00\uff0c\u89c2\u5bdf\u5165\u5fae\u3002\u60ef\u72ec\u81ea\u884c\u52a8\u3002",
    "\u524d\u8b66\u5bdf\u73b0\u79c1\u5bb6\u4fa6\u63a2\u3002\u89c1\u8fc7\u592a\u591a\u6848\u5b50\u3002",
    "\u627e\u5230\u52a0\u6bd4\u00b7\u7279\u91cc\u574e"
  ));
  const pl2 = new PlayerAgent(createPlayerCharacter(
    c2, "\u8a79\u59c6\u65af\u00b7\u5361\u7279", "\u533b\u751f",
    "\u7406\u6027\u6c89\u7a33\uff0c\u5b66\u672f\u6d3e\u3002\u7d27\u5f20\u65f6\u4fdd\u6301\u51b7\u9759\u3002",
    "\u5f53\u5730\u533b\u9662\u533b\u751f\uff0c\u53c2\u519b\u533b\u961f\u6bd5\u4e1a\u3002",
    "\u786e\u4fdd\u53d7\u5bb3\u8005\u5b89\u5168"
  ));

  const llmDisabled = process.env.LLM_DISABLED === "true" || process.env.LLM_MODE === "template";
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  const llmOk = !llmDisabled && !!(apiKey && !apiKey.startsWith("${") && apiKey !== "sk-placeholder");
  say(`\nLLM: ${llmOk ? "\u5df2\u8fde\u63a5, \u6b63\u5728\u4f7f\u7528\u2714" : "\u672a\u914d\u7f6e\uff0c\u4f7f\u7528\u6a21\u677f"}`);
  if (llmOk && !llmDisabled) {
    say("(\u8bbe LLM_DISABLED=true \u53ef\u5f3a\u5236\u6a21\u677f\u6a21\u5f0f)");
  }

  // ── Scene processor: entry → exploration → analysis → advance ──
  async function processScene(): Promise<sceneConnection | null> {
    const scene = world.currentScene!;
    world.advanceRound();
    const round = world.round;

    say(`\n\u2501 ${scene.name}`);

    // ── Phase 1: Scene entry - KP roleplay narration ──
    const sceneName = scene.name.replace(/^.+?[：:]\s*/, ""); // strip prefix like "序幕："
    const firstVisit = world.round <= 1 || scene.order <= 1;
    const leadin = firstVisit
      ? `\n你们来到${sceneName}。`
      : `\n回到${sceneName}，眼前的一切——`;
    say(`\n${scene.description}`);
    if (scene.atmosphere) {
      say(scene.atmosphere);
    }

    // ── NPC encounters woven into scene ──
    for (const npcId of scene.npcIds) {
      const npc = BARN_OF_PREMIER.npcs.find(n => n.id === npcId) as ModuleNPC;
      if (!npc) continue;
      const npcState = world.getNpcState(npc.id);
      if (!npcState || !npcState.isAlive) continue;

      const firstMeeting = !npcState.knownByPlayers;
      if (firstMeeting) world.meetNpc(npc.id);
      const speechProfile = classifySpeechStyle(npc.personality.speech);

      if (firstMeeting) {
        // Set mood from attitude
        const moodMap: Record<string, string> = { "友好": "friendly", "热心": "friendly", "合作": "cooperative", "冷漠": "neutral", "警惕": "wary", "敌意": "hostile", "畏惧": "fearful" };
        for (const [kw, m] of Object.entries(moodMap)) {
          if (npc.personality.attitude.includes(kw)) { world.setNpcMood(npc.id, m); break; }
        }

        const desc = npc.description;
        if (speechProfile.type === "none" || speechProfile.type === "coma_rapid") {
          say(`\n就在你们面前，${desc.replace(/^[，。]+/, "")}——似乎无法与你们正常交流。`);
        } else if (speechProfile.type === "brainwave") {
          say(`\n${desc}`);
          const bd = ["脑波中传来一阵安宁——像婴儿的满足感", "脑波突然变得急促，带着不安和恐惧", "一阵温暖的情绪波动传来，仿佛在寻求安慰"];
          say(bd[Math.floor(Math.random() * bd.length)]);
        } else {
          // KP roleplay: description → approach → dialogue
          const intro = desc.length > 20
            ? `${desc.replace(/。.*$/, "")}。`
            : desc;
          const approachBehavior = npc.behaviors?.find(b => b.trigger === "player_approach");
          const behaviorText = approachBehavior
            ? approachBehavior.action.replace(npc.name, "").trim().replace(/^，+/, "")
            : "";

          // Build a flowing narrative: who they see → what they do → what they say
          const flowParts = [intro];
          if (behaviorText) flowParts.push(behaviorText);
          say(`\n${flowParts.join("")}`);
          const greeting = generateNpcDialogue(npc, npcState, speechProfile, world);
          say(`"${greeting}"`);
          world.adjustRelationship(npc.id, 1);
        }
      } else {
        // Returning encounter
        if (speechProfile.type === "none" || speechProfile.type === "brainwave") {
          handleNonSpeakingNpc(npc, speechProfile);
        } else {
          const greeting = generateNpcDialogue(npc, npcState, speechProfile, world);
          say(`\n"${greeting}"`);
          world.adjustRelationship(npc.id, 1);
        }
      }

      // Reveal NPC knowledge as conversation
      revealNpcKnowledge(npc, world);

      // npc_dialogue clues
      for (const clue of scene.clues) {
        if (world.isClueFound(clue.id)) continue;
        for (const method of clue.findMethods) {
          if (method.type === "npc_dialogue") { world.discoverClue(clue.id); }
        }
      }
    }

    // ── Auto clues (automatic type, not tied to NPC) ──
    for (const clue of scene.clues) {
      if (world.isClueFound(clue.id)) continue;
      for (const method of clue.findMethods) {
        if (method.type === "automatic") {
          world.discoverClue(clue.id);
          say(`\n${clue.revelation}`);
        }
      }
    }

    // ====== Speech style classification ======
    type SpeechProfile = {
      type: "fast_anxious" | "short_terse" | "mumbling" | "gentle_slow"
           | "coma_rapid" | "official" | "rude_timid" | "talkative"
           | "mental_voice" | "brainwave" | "none" | "generic";
      keywords: string[];
    };

    function classifySpeechStyle(desc: string): SpeechProfile {
      if (!desc || desc === "无") return { type: "none", keywords: [] };
      // Check in priority order (most specific first)
      if (desc.includes("脑波")) return { type: "brainwave", keywords: ["脑波", "情绪"] };
      if (desc.includes("电子音") || desc.includes("脑海")) return { type: "mental_voice", keywords: ["电子音", "脑海"] };
      if (desc.includes("昏迷")) return { type: "coma_rapid", keywords: ["昏迷", "急促"] };
      if (desc.includes("欲言又止")) return { type: "fast_anxious", keywords: ["快", "焦虑", "欲言又止"] };
      if (desc.includes("粗鲁")) return { type: "rude_timid", keywords: ["粗鲁", "胆怯"] };
      if (desc.includes("含糊")) return { type: "mumbling", keywords: ["含糊"] };
      if (desc.includes("话多")) return { type: "talkative", keywords: ["话多", "聊"] };
      if (desc.includes("官方")) return { type: "official", keywords: ["官方"] };
      if (desc.includes("温和")) return { type: "gentle_slow", keywords: ["温和", "慢"] };
      if (desc.includes("不喜欢多说") || desc.includes("简短")) return { type: "short_terse", keywords: ["短", "不喜"] };
      if (desc.includes("快") || desc.includes("急促")) return { type: "fast_anxious", keywords: ["快", "焦虑"] };
      return { type: "generic", keywords: [] };
    }

    // ====== Non-speaking NPC handling ======
    function handleNonSpeakingNpc(npc: ModuleNPC, profile: SpeechProfile): void {
      if (profile.type === "none") {
        say(`${npc.name}无法说话——${npc.description.slice(0, 80)}`);
      } else if (profile.type === "brainwave") {
        const brainwaveDescriptions = [
          "传来一阵安宁的脑波——像是婴儿的满足感",
          "脑波突然变得急促，带着不安和恐惧",
          "一阵温暖的情绪波动传来，仿佛在寻求安慰",
        ];
        say(`${npc.name}的脑波在变化: ${brainwaveDescriptions[Math.floor(Math.random() * brainwaveDescriptions.length)]}`);
      }
    }

    // ====== NPC dialogue generation with identity + speech style variants ======
    function generateNpcDialogue(
      npc: ModuleNPC, npcState: NPCInstanceState,
      profile: SpeechProfile, w: WorldState
    ): string {
      const rel = npcState.relationship;
      const lines: string[] = [];

      // Layer 1: Relationship-based opening
      if (rel <= -3) {
        lines.push(...getDialogueForRel(npc, "hostile", profile));
      } else if (rel <= -1) {
        lines.push(...getDialogueForRel(npc, "cold", profile));
      } else if (rel <= 0) {
        lines.push(...getDialogueForRel(npc, "neutral", profile));
      } else if (rel <= 3) {
        lines.push(...getDialogueForRel(npc, "friendly", profile));
      } else {
        lines.push(...getDialogueForRel(npc, "warm", profile));
      }

      // Layer 2: NPC identity line (role + traits + attitude)
      const identityLine = getNpcIdentityLine(npc, profile, rel);
      if (identityLine && lines.length < 3) lines.push(identityLine);

      // Layer 3: Follow-up question
      if (profile.type !== "coma_rapid") {
        lines.push(...getFollowUpForProfile(profile));
      }

      return lines.join(" ");
    }

    /** Generate a role/identity-aware line based on NPC data */
    function getNpcIdentityLine(npc: ModuleNPC, profile: SpeechProfile, rel: number): string {
      const role = npc.role || "";
      const traits = npc.personality.traits ?? [];
      const att = npc.personality.attitude || "";
      const group = profile.type;

      if (rel < 0) return ""; // don't reveal identity when cold/hostile

      // Extract a short role hint
      const roleHint = role.includes("——") ? role.split("——")[0] : role;

      // Build from personality traits + attitude
      if (traits.includes("焦虑") || group === "fast_anxious") {
        return `作为${roleHint}，我、我真的不知道该怎么办了……`;
      }
      if (traits.includes("警惕") || group === "short_terse") {
        return `我就是个${roleHint}，你们想问什么？`;
      }
      if (traits.includes("温和") || group === "gentle_slow") {
        return `我是这里的${roleHint}，有什么需要尽管说。`;
      }
      if (traits.includes("话多") || group === "talkative") {
        return `嘿嘿，我这个${roleHint}可是知道不少事的！`;
      }
      if (group === "official") {
        return `我是${roleHint}，请配合我的工作。`;
      }
      if (group === "mumbling" || group === "rude_timid") {
        return ""; // these types don't introduce themselves
      }
      if (att.includes("希望") || att.includes("配合")) {
        return `拜托了，请一定要帮我……`;
      }
      return "";
    }

    function getDialogueForRel(npc: ModuleNPC, relLevel: string, profile: SpeechProfile): string[] {
      const a = profile.type;
      const role = npc.role || "";
      // Extract a short role label for weaving into dialogue
      const roleShort = role.includes("——") ? role.split("——")[0] : role;
      const roleAware = roleShort.length > 0 && roleShort.length < 12;

      switch (relLevel) {
        case "hostile":
          if (a === "rude_timid") return ["滚、滚开！别过来！"];
          if (a === "official") return [`我${roleAware ? `这个${roleShort}可` : ""}没空跟你们纠缠。请离开。`];
          if (a === "short_terse") return ["别烦我。"];
          if (a === "fast_anxious") return [`我${roleAware ? `只是个${roleShort}` : ""}……真的不想说这些……请走……`];
          if (a === "gentle_slow") return [`对、对不起……我现在${roleAware ? `作为${roleShort}` : ""}真的不能和你们说话……`];
          if (a === "talkative") return ["嘿，现在不是聊天的时候，没看到我正忙着吗？"];
          if (a === "mumbling") return ["唔……走开……不关你事……"];
          if (a === "coma_rapid") return ["不……不……别靠近我……走开！"];
          return ["别来烦我。"];
        case "cold":
          if (a === "short_terse") return [`嗯。${roleAware ? `我这${roleShort}还有事，` : ""}快点说。`];
          if (a === "rude_timid") return ["你想干嘛？我警告你，我不好惹。"];
          if (a === "official") return [`有什么事？我是${roleAware ? `${roleShort}` : "公职人员"}，长话短说。`];
          if (a === "mumbling") return ["呃……你谁啊……找我有事？"];
          if (a === "fast_anxious") return [`我${roleAware ? `这个${roleShort}现在` : ""}有点忙……你是？`];
          if (a === "talkative") return ["哟，新面孔啊。不过我现在没空闲聊。"];
          return ["我跟你不熟。"];
        case "neutral":
          if (a === "short_terse") return ["你是？……什么事？"];
          if (a === "mumbling") return ["唔……嗯……你说什么来着？"];
          if (a === "official") return [`你好，${roleAware ? `我是${roleShort}。` : ""}请说明来意。`];
          if (a === "fast_anxious") return [`你、你好……我${roleAware ? `是${roleShort}` : ""}……请问有什么可以帮你的？`];
          if (a === "coma_rapid") return ["呃……！……你们是……？水……给我水……"];
          if (a === "rude_timid") return [`喂，干什么的？${roleAware ? `我这儿${roleShort}不欢迎闲人。` : ""}`];
          return ["你好。"];
        case "friendly":
          if (a === "fast_anxious") return [`啊，你们来了！太好了！我${roleAware ? `这个${roleShort}` : ""}一直在这里等你们……`];
          if (a === "gentle_slow") return [`欢迎，欢迎。${roleAware ? `我是这儿的${roleShort}，` : ""}慢慢来，不用着急。`];
          if (a === "short_terse") return ["又来了？行，问吧。"];
          if (a === "talkative") return [`嘿！又见面了！${roleAware ? `我这个${roleShort}可是知道些事情的。` : ""}来来来，我跟你说点有意思的。`];
          if (a === "mumbling") return ["哦……是你啊……好、好……"];
          if (a === "official") return [`又见面了。${roleAware ? `作为${roleShort}，` : ""}这次有什么需要？`];
          if (a === "rude_timid") return ["哦，又是你们啊……行吧，有啥事？"];
          return ["你们好，又见面了。"];
        case "warm":
          if (a === "gentle_slow") return [`啊，亲爱的朋友们。能再见到你们真是太好了。来，坐下慢慢说${roleAware ? `，我这${roleShort}慢慢讲给你们听` : ""}。`];
          if (a === "talkative") return [`哈哈，我就知道你们还会来找我的！来来来，${roleAware ? `我这${roleShort}正好有件事要告诉你们` : "我正好有件事要告诉你们"}！`];
          if (a === "fast_anxious") return [`谢天谢地你们来了！我${roleAware ? `这个${roleShort}` : ""}等了你们好久……快、快请进！`];
          if (a === "short_terse") return [`来了？好。${roleAware ? `我这${roleShort}这边说。` : "坐。"}要说什么？`];
          return ["欢迎回来，我的朋友。"];
        default:
          return ["你好。"];
      }
    }

    function getFollowUpForProfile(profile: SpeechProfile): string[] {
      switch (profile.type) {
        case "fast_anxious":
          return ["你有什么要问的吗？快、快点……我、我担心时间不够……"];
        case "short_terse":
          return ["……还有事？"];
        case "mumbling":
          return ["唔……你想问啥……"];
        case "gentle_slow":
          return ["你想了解些什么呢？我慢慢讲给你听。"];
        case "coma_rapid":
          return ["我……我不能说太多……他们……他们还在监视……"];
        case "official":
          return ["请在规定范围内提问。"];
        case "rude_timid":
          return ["啧，问吧问吧，快点啊。"];
        case "talkative":
          return ["我跟你说啊，这事情可复杂了！你问对人了！"];
        case "mental_voice":
          return ["你能听到我吗？……请帮我……救救我的女儿……"];
        default:
          return ["你想问什么？"];
      }
    }

    // ====== Reveal NPC knowledge as conversational continuation ======
    function revealNpcKnowledge(npc: ModuleNPC, w: WorldState): void {
      if (npc.knowledge.length === 0) return;
      const revealed = npc.knowledge.filter((k, ki) =>
        !w.isClueFound(`clue_kn_${npc.id}_${ki}`)
      );
      if (revealed.length === 0) return;
      const hint = revealed[Math.floor(Math.random() * revealed.length)];
      const hintIndex = npc.knowledge.indexOf(hint);
      say(`\u201c${hint}\u201d`);
      w.discoverClue(`clue_kn_${npc.id}_${hintIndex}`);
    }

    // ====== Dynamic NPC investigate flavor (pulls from NPC data + tracks progression) ======
    function getInvestigateFlavor(npc: ModuleNPC, npcState: NPCInstanceState, profile: SpeechProfile): string {
      const traits = npc.personality.traits ?? [];
      const att = npc.personality.attitude || "";
      const mood = npcState.mood;
      const rel = npcState.relationship;

      // NPC-specific detail: pull key emotional/behavioral phrases from attitude/traits
      const attHint = att.length > 8 ? att.slice(0, 16) : "";
      const traitPhrase = traits.length > 0
        ? (traits.includes("焦虑") ? "神色间掩不住的焦虑" :
           traits.includes("警惕") ? "目光中带着警惕" :
           traits.includes("友善") ? "态度还算友善" :
           traits.includes("温和") ? "神情平和" :
           traits.includes("狡猾") ? "眼神闪烁不定" :
           traits.includes("尽责") ? "一丝不苟地做着自己的事" :
           traits.includes("健谈") ? "看起来很乐意与人交谈" :
           traits.includes("聪明") ? "目光锐利，似乎在思考什么" :
           traits.includes("粗鲁") ? "举止粗鲁，毫不掩饰自己的不耐烦" :
           traits.includes("慈爱") ? "眼神中带着母性的关切" :
           `${traits[0]}的样子`)
        : "";

      // Relationship-driven state change
      const relNote = rel <= -3 ? "对你明显带着敌意" :
                      rel <= -1 ? "态度冷淡，不太想搭理你" :
                      rel >= 4  ? "看到你时表情明显放松了不少" :
                      rel >= 2  ? "对你的态度比之前缓和了一些" : "";

      // Mood-driven observation
      const moodNote = mood === "fearful" ? "显得十分畏惧" :
                       mood === "hostile" ? "浑身散发着抗拒的气息" :
                       mood === "friendly" ? "表情友善" :
                       mood === "wary" ? "保持着戒备的姿态" :
                       mood === "neutral" ? "" : "";

      // Build the observation
      const observations = [traitPhrase, moodNote, relNote, attHint].filter(Boolean);
      const stateDesc = observations.length > 0 ? observations.join("，") : "";

      // Speech-type action framed by NPC state
      const action = getFlavorAction(profile.type, npc, rel);

      if (stateDesc) {
        return `${npc.name}${stateDesc}。${action}`;
      }
      return action;
    }

    function getFlavorAction(type: string, npc: ModuleNPC, rel: number): string {
      const name = npc.name;
      switch (type) {
        case "fast_anxious":
          return `${name}不时抬头张望，欲言又止，似乎急切地想说些什么。`;
        case "short_terse":
          return `${name}简短地应了一声，继续忙着手里的活，没有深谈的打算。`;
        case "mumbling":
          return `${name}蜷在角落里含混不清地嘟囔着，偶尔投来一瞥。`;
        case "gentle_slow":
          return `${name}注意到你在观察，对你温和地点点头，不紧不慢地放下手中的书。`;
        case "coma_rapid":
          return `${name}仍在昏迷中，眉头紧锁，偶尔含糊地吐出几个词。`;
        case "official":
          return `${name}站姿笔直，目光严肃地审视着四周，一丝不苟地履行着职责。`;
        case "rude_timid":
          return `${name}警惕地瞪着你们，但底气不足，声音越来越小。`;
        case "talkative":
          return `${name}一看有人注意自己，立刻露出期盼交谈的表情。`;
        case "mental_voice":
          return `一阵温暖而悲伤的情绪拂过你的意识——${name}在等待你与她交流。`;
        case "brainwave":
          return `脑波的节奏微微变化——${name}似乎感知到了你们的到来。`;
        default:
          if (rel <= -2) return `${name}对你明显表现出排斥的态度。`;
          if (rel >= 3) return `${name}看到你时露出了友善的表情。`;
          return `${name}站在那里，看不出什么特别的情绪。`;
      }
    }

    // ── Phase 4: Exploration — attempt hidden clues ──
    const undiscovered = scene.clues.filter(c => !world.isClueFound(c.id));
    const importantUndiscovered = undiscovered.filter(c => c.importance !== 'color');

    if (importantUndiscovered.length > 0) {
      say(``);

      for (const clue of importantUndiscovered) {
        for (const method of clue.findMethods) {
          if (method.type === "observation") {
            say(`\n\u4ed4\u7ec6\u770b\u6765\u2014\u2014${method.description}\u2026\u2026`);
            say(`  ${clue.revelation.slice(0, 200)}`);
            world.discoverClue(clue.id);
            break;
          }
          if (method.type === "skill") {
            let bestPC: CoCGeneratedCharacter | null = null;
            let bestVal = 0;
            for (const pc of [c1, c2]) {
              const val = (pc.skillValues as Record<string, number>)[method.skillName!] ?? 0;
              if (val > bestVal) { bestVal = val; bestPC = pc; }
            }
            if (bestPC && bestVal > 0) {
              const name = bestPC === c1 ? "\u4ea8\u5229" : "\u8a79\u59c6\u65af";
              // KP describes the attempt — use the description as-is for natural flow
              say(`\n${name}${method.description}\u2026\u2026`);
              const skillKey = method.skillName!;
              const r = check(bestVal, name, skillKey, (method.difficulty as "regular"|"hard"|"extreme") ?? "regular");
              if (r.isSuccess) {
                say(`${discoveryFlavor(r.successLevel)}${clue.revelation.slice(0, 200)}`);
                world.discoverClue(clue.id);
              } else {
                say(`${failFlavor(r.successLevel === "fumble")}`);
              }
            }
            break;
          }
        }
      }
    }

    // ── Phase 5: Show available connections ──
    const unlocked = scene.connections.filter(
      c => !c.requiredClueId || world.isClueFound(c.requiredClueId)
    ) as sceneConnection[];

    if (unlocked.length > 0) {
      if (unlocked.length === 1) {
        say(`\n\u6839\u636e\u4f60\u4eec\u5df2\u7ecf\u77e5\u9053\u7684\u60c5\u51b5\uff0c\u4e0b\u4e00\u6b65\u5c31\u662f${unlocked[0].condition}\u3002`);
      } else {
        say(`\n\u4f60\u4eec\u5df2\u7ecf\u77e5\u9053\u4e86\u4e00\u4e9b\u4e8b\u60c5\u3002\u63a5\u4e0b\u6765\u7684\u65b9\u5411\u2014\u2014`);
        for (const c of unlocked) {
          const desc = c.condition.replace(/^前往/, "");
          say(`  \u2022 ${desc}`);
        }
      }
    } else if (scene.connections.length > 0) {
      say(`\n\u8fd8\u9700\u8981\u66f4\u591a\u7ebf\u7d22\uff0c\u624d\u80fd\u786e\u5b9a\u63a5\u4e0b\u6765\u7684\u65b9\u5411\u3002`);
    }

    // ── Phase 6: Connection selection (PL analysis) ──
    if (unlocked.length === 0) return null;

    // Prefer forward connections (target order > current)
    const forward = unlocked.filter(c => {
      const target = BARN_OF_PREMIER.scenes.find(s => s.id === c.targetSceneId);
      return target && target.order > scene.order;
    });
    const candidates = forward.length > 0 ? forward : unlocked;

    // Single choice → done
    if (candidates.length === 1) return candidates[0];

    // Multiple: score each connection based on:
    //   a) how many found clues unlock this target
    //   b) target scene's importance (core clue count)
    const scored = candidates.map(c => {
      let score = 0;
      for (const clue of scene.clues) {
        if (clue.unlocks?.includes(c.targetSceneId)) {
          score += world.isClueFound(clue.id) ? 3 : 1;
        }
      }
      const targetScene = BARN_OF_PREMIER.scenes.find(s => s.id === c.targetSceneId);
      if (targetScene) {
        score += targetScene.clues.filter(cl => cl.importance === "core").length;
      }
      return { conn: c, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].conn;
  }

  // ── Game loop: scene entry → exploration → analysis → advance ──
  let done = false;
  let rounds = 0;

  while (!done && rounds < 40) {
    rounds++;
    const nextConn = await processScene();
    if (nextConn) {
      const nextScene = BARN_OF_PREMIER.scenes.find(s => s.id === nextConn.targetSceneId);
      world.moveToScene(nextConn.targetSceneId);
      const target = nextConn.targetSceneId;
      const trans = nextConn.condition.replace(/^前往/, "\u4f60\u4eec\u51b3\u5b9a\u524d\u5f80");
      say(`\n${trans}\u3002`);
    } else {
      done = true;
    }
  }

  // ── Ending ──
  say(`\n${"\u2501".repeat(48)}`);
  say(`\n\u591c\u8272\u4e2d\uff0c\u8c03\u67e5\u5458\u56de\u5230\u5730\u9762\u3002`);
  say(`\u52a0\u6bd4\u00b7\u7279\u91cc\u574e\u6d3b\u4e86\u4e0b\u6765\u3002`);
  say(`\u8c01\u8bf4\u7684\u662f\u771f\u8bdd\uff0c\u8c01\u8bf4\u7684\u662f\u5047\u8bdd\uff0c\u53ef\u80fd\u6c38\u8fdc\u8bf4\u4e0d\u6e05\u4e86\u3002`);
  say(`\u201c\u8c22\u8c22\u4f60\u4eec\u2026\u2026\u201d\u2014\u2014\u827e\u7c73\u4e3d\u7684\u58f0\u97f3\u6d88\u5931\u5728\u9ed1\u6688\u4e2d\u3002`);
  say(`\n\u6a21\u7ec4\u7ed3\u675f\u3002\u00a0\u7ea6\u00a0${rounds}\u00a0\u8f6e\u56de\u5408`);
  say(`\n${"\u2501".repeat(48)}`);
  say(characterSummary(c1));
  say(characterSummary(c2));
}

runModule().catch(console.error);
