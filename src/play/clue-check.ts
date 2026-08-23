// 从 play-module.ts 抽出来的一段（脚本搬运，见 tools/_extract-block.ts）。
//
// 抽出来的理由是可寻址性：原先 runModuleInner 一个函数 2615 行、占全文件 74%，
// 里面按注释能切出近 30 个块，但没有一个是能整段读进来的单元 ——
// 每次改动只能靠行号开窗口猜，窄了缺上下文、宽了浪费。
//
// ⚠ 纯搬运，不改行为。判据是全量测试与主循环脚手架全绿。

import type { Clue, ModuleData, ModuleSupport, Scene } from "../module/types";
import type { WorldState } from "../world/state";
import type { PlayerAgent } from "../agent/player-agent";
import type { LLMClient } from "../llm/client";
import { resolveCheckValue } from "../character/coc-character";
import { generateClueRevelation, generateFailRescue } from "../llm/npc-dialogue-prompts";
import { say, emit } from "./narration";
import { check, sanCheck, discoveryFlavor, failFlavor, healWound } from "./checks";
import { isDowned, standing } from "./run-state";
import { buildWorldContext } from "./llm-context";
// 从 npc-text 取而不是从 play-module —— 后者会成环（play-module 已经 import 本文件）
import { partnerRemark, speechLead } from "./npc-text";
import type { Cast, Cursor, Dedup, WorldModelCtx } from "./run-state";

const OUTGOING = /健谈|外向|好奇|直率|急躁|热情|多话|爱管闲事|喜欢打听|口无遮拦/;
const RESERVED = /寡言|沉默|内向|谨慎|冷淡|木讷|不善言辞|惜字如金|怕生/;

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }

/**
 * 线索检定这一块要的东西。
 *
 * 参数多是实情不是设计失误 —— 它同时碰世界、场景、两名调查员、
 * 两个 agent、LLM、以及本次进场的「试过哪些」。收成一个 ctx
 * 是为了让调用点读起来是「按这套处境查线索」，而不是十个散参数。
 *
 * ⚠ `scene` 与 `attemptedClueIds` 是**每次进场**的，别跨场景复用同一个 ctx。
 */
export interface ClueCtx {
  module: ModuleData;
  support: ModuleSupport;
  world: WorldState;
  scene: Scene;
  cast: Cast;
  cursor: Cursor;
  dedup: Dedup;
  wm: WorldModelCtx;
  agents: [PlayerAgent, PlayerAgent];
  llmClient: LLMClient | null;
  /** 本次进场已试过的线索 —— 试过就从选项里拿掉，防死循环 */
  attemptedClueIds: Set<string>;
}

/**
 * 同伴急救把倒下的人弄醒。CoC 7e：急救成功回 1 HP 并恢复意识。
 *
 * 每次进场试一轮 —— 不做成「每回合都试」是因为那会变成必然成功的仪式，
 * 掷骰就没意义了。救不醒就得拖着走，直到下一个场景。
 */
export function tryReviveDowned(ctx: ClueCtx): void {
  const { cast: { c1, c2, p0, p1 } } = ctx;
  const pairs = [
    { pc: c1, name: p0.shortName, mate: c2, mateName: p1.shortName },
    { pc: c2, name: p1.shortName, mate: c1, mateName: p0.shortName },
  ];
  for (const { pc, name, mate, mateName } of pairs) {
    if (!isDowned(pc)) continue;
    if (isDowned(mate)) continue; // 施救者自己也倒着，没人能救

    const faVal = resolveCheckValue(mate, "急救");
    if (faVal <= 0) continue;
    say(`\n${mateName}半跪下来，检查${name}的伤势……`);
    const r = check(faVal, mateName, "急救", "regular");
    if (r.isSuccess) {
      pc.hp = 1;
      healWound(name); // 处理过的伤口不再压着惩罚骰
      say(`${name}猛地咳嗽起来，睁开了眼睛。`);
      // 掷骰的是**施救者**，苏醒的是**伤者**。两个名字分开写进事件 ——
      // 靠文本猜的话，「谁在掷急救」会被算到躺着的那个人头上。
      emit({ type: "revived", who: name, by: mateName });
    } else {
      say(`${name}没有反应，只能先拖到安全的地方。`);
    }
  }
}

/** 如果线索有 SAN 损失定义，触发检定 */
export function checkClueSanLoss(ctx: ClueCtx, clue: Clue): void {
  const { support, cast: { p0, p1, san1, san2 }, agents, dedup } = ctx;
  const cost = support.traumaticClues[clue.id];
  if (cost) {
    sanCheck(p0.shortName, san1, cost);
    sanCheck(p1.shortName, san2, cost);
    // 刚一起看过让人失去理智的东西，两个人之间总该有句话
    sayPartnerRemark(dedup, pick(agents), "san");
  }
}

/** 线索发现叙述：LLM 可用时生成情景叙述（动作/现场描写，非"结果清单"直出）；不可用/失败降级 flavor+revelation */
export async function narrateClueDiscovery(
  ctx: ClueCtx, clue: Clue, level: string, pcName: string,
): Promise<string> {
  const { llmClient, scene, module, agents: [pl1, pl2], wm, world } = ctx;
  if (llmClient) {
    const text = await generateClueRevelation(
      { name: clue.name, description: clue.description, revelation: clue.revelation },
      { name: scene.name, description: scene.description },
      pcName,
      llmClient,
      buildWorldContext(module, [pl1, pl2], wm, world),
    );
    if (text) return text;
  }
  return `${discoveryFlavor(level)}${sanitizeRevelation(clue.revelation)}`;
}

/**
 * Run a single clue check (observation or skill) and return true if discovered.
 *
 * ── skill 优先，passive 退化成兜底 ──
 * 同一条线索如果既有 skill 又有 passive 方法，原先的实现遇到第一个 passive
 * 就 return，于是 skill 检定**永远不会执行**。普查 32 条线索：4 条是这样，
 * 而且全是 core（黑色钱包、尸体、床位、日记本）。
 *
 * 这直接导致**结局不区分**——True End 要的两条线索（日记、文件）都在卧室，
 * 进门即得，去终局必须穿过卧室，所以走到头必得 True End。实测 10 局全 True End。
 *
 * 现在改成：
 * 1. 先把 methods 分成 skill 组和 passive 组
 * 2. 有 skill 就只跑 skill，不碰 passive
 * 3. skill 失败累计 >= maxFails 时，**如果有 passive 方法**用它揭示
 *    （比 failback/revelation 更自然：作者写的就是"这里还有另一种发现方式"）
 * 4. 没有 skill 的线索，passive 照旧立即生效
 */
export async function runClueCheck(ctx: ClueCtx, clue: Clue): Promise<boolean> {
  const {
    world, scene, module, llmClient, attemptedClueIds, dedup, wm, agents,
    cast: { p0, p1, c1, c2, san1, san2 }, cursor,
  } = ctx;
  const [pl1, pl2] = agents;
  if (world.isClueFound(clue.id)) return false;

  const PASSIVE_TYPES = new Set(["observation", "automatic", "item"]);
  const skillMethods = clue.findMethods.filter(
    (m) => m.type === "skill" && m.skillName,
  );
  const passiveMethods = clue.findMethods.filter((m) =>
    PASSIVE_TYPES.has(m.type),
  );

  // ── 有 skill 方法：skill 优先，passive 退化成兜底 ──
  if (skillMethods.length > 0) {
    for (const method of skillMethods) {
      // 昏迷的人不参与轮转 —— CoC 7e：HP 归零即失去意识，不能行动
      const pcList = standing([c1, c2]).sort((a, b) => {
        const va = resolveCheckValue(a, method.skillName!);
        const vb = resolveCheckValue(b, method.skillName!);
        return vb - va;
      });
      if (pcList.length === 0) return false; // 都倒下了，这条线索查不成
      const offset = cursor.stepCounter++ % pcList.length;
      const pc = pcList[offset]!;
      const val = resolveCheckValue(pc, method.skillName!);
      if (val > 0) {
        const name = pc === c1 ? p0.shortName : p1.shortName;
        say(`\n${name}${method.description}……`);
        const r = check(
          val,
          name,
          method.skillName!,
          (method.difficulty as "regular" | "hard" | "extreme") ??
            "regular",
        );

        if (r.isSuccess) {
          say(await narrateClueDiscovery(ctx, clue, r.successLevel, name));
          sayPartnerRemark(dedup, pc === c1 ? pl2 : pl1, "clue");
          world.discoverClue(clue.id);
          checkClueSanLoss(ctx, clue);
          return true;
        } else {
          // 失败 → 累计失败次数；大失败额外加重
          const failCount = world.incrementClueFail(clue.id);
          if (r.successLevel === "fumble") {
            say(`${failFlavor(true)}`);
            const fumbleCost = "0/1d3";
            sanCheck(name, pc === c1 ? san1 : san2, fumbleCost);
          } else {
            say(`${failFlavor(false)}`);
          }

          // ── 兜底：连续失败达到阈值 → 用 passive 方法揭示（比 failback 更自然） ──
          const fb = clue.failback;
          if (fb || clue.importance === "core") {
            const maxFails = fb?.maxFails ?? 2;
            if (failCount >= maxFails) {
              // 优先用 passive 方法 —— 作者写的"另一种发现方式"
              if (passiveMethods.length > 0) {
                say(await narrateClueDiscovery(ctx, clue, "regular", ""));
                world.discoverClue(clue.id);
                world.resetClueFails(clue.id);
                checkClueSanLoss(ctx, clue);
                return true;
              }
              // 无 passive → 用 failback/revelation
              const authored = fb
                ? fb.fallbackRevelation
                : clue.revelation;
              let rescueText = "";
              const fallbackText = authored
                ? `历经周折，${sanitizeRevelation(authored)}`
                : "";
              if (!fallbackText && llmClient) {
                rescueText = await generateFailRescue(
                  { name: clue.name, description: clue.description },
                  { name: scene.name, description: scene.description },
                  failCount,
                  llmClient,
                  buildWorldContext(module, [pl1, pl2], wm, world),
                );
              }
              const finalText = fallbackText || rescueText;
              say(
                `\n${finalText ? "（屡次搜寻未果，你们决定换个方式）\n" : ""}${finalText}`,
              );
              if (fb?.sanCost) {
                sanCheck(p0.shortName, san1, fb.sanCost);
                sanCheck(p1.shortName, san2, fb.sanCost);
              }
              world.discoverClue(clue.id);
              world.resetClueFails(clue.id);
              return true;
            }
          }
          // 失败 → 继续尝试下一个 skill method
        }
      }
      // PC 没有此技能/属性 → 尝试下一个 skill method
    }
    attemptedClueIds.add(clue.id); // 所有 skill 方法均失败 → 标记防死循环
    return false;
  }

  // ── 只有 passive 方法：直接揭示 ──
  if (passiveMethods.length > 0) {
    say(await narrateClueDiscovery(ctx, clue, "regular", ""));
    world.discoverClue(clue.id);
    checkClueSanLoss(ctx, clue);
    return true;
  }

  // 没有任何方法（数据错误）
  return false;
}

// ⚠ 这里原先还有一个**模块级**的 `const attemptedClueIds = new Set<string>()`，
//   带着一段「这个 Set 原先只写不读，现在真的用上了」的注释 —— 但 tsc 报它
//   从没被读过。真正生效的那一份在 `scene-pipeline.ts`：**按进场新建**、
//   传进 ctx，失败时 add、给选项过滤时读（见本文件 :49 的 ctx 字段）。
//
//   模块级这个是 ctx 化重构之前的残留。留着有真实危险：它跨场景共享，
//   正是本文件开头第 35 行警告的那件事（「别跨场景复用同一个 ctx」）。
//   谁哪天顺手引用了它，上一个场景试失败的线索会在下一个场景里也消失。
//
//   注释描述的行为是对的，只是描述的是**另一个变量**。删掉重复品。

/** 一个场景里最多让玩家行动几次。存在只为兜底：别把整局锁死在一个房间 */
export const MAX_SCENE_ACTIONS = 6;

/**
 * 这条线索不动手也会注意到吗。
 *
 * 判据跟 runClueCheck 的实际行为对齐：它遍历 findMethods，
 * 碰到 observation/automatic/item 就直接揭示，只有 skill 才掷骰。
 * 所以"有任一被动方法"= 进门就会看见。
 */
export const isPassiveClue = (cl: Clue) =>
  cl.findMethods.some(m => m.type === "observation" || m.type === "automatic" || m.type === "item");

/**
 * 要动手查才拿得到的线索 —— 这些**不再自动掷骰**，交给玩家决定查不查。
 *
 * 这是"循环反转"的核心：原先进场就把所有线索解光，
 * 走到岔口时玩家已经无事可做，只剩"去哪"可选。
 * color（花絮）仍走自动 —— 让玩家逐条勾选氛围描写只是噪音。
 */
export function investigableClues(ctx: ClueCtx): Clue[] {
  const { scene, world, attemptedClueIds } = ctx;
  return scene.clues.filter(cl =>
    !world.isClueFound(cl.id) &&
    cl.importance !== "color" &&
    !isPassiveClue(cl) &&
    !attemptedClueIds.has(cl.id));
}


/** Strip game mechanic suffixes (ScX/Y, CM+X) from revelation text */
function sanitizeRevelation(text: string): string {
  // Remove full parenthetical SAN blocks: （Sc0/1d3） (SC1d3+1/1d6+1)
  let s = text.replace(/[（(]\s*[Ss][Cc]\s*\d+(?:[dD]\d+)?(?:\s*\+\s*\d+)?(?:\s*\/\s*\d+(?:[dD]\d+)?(?:\s*\+\s*\d+)?)?\s*[）)]/g, "");
  // Remove bare Sc0/1d3 / sc1/1d3+1 / SC1d3+1/1d6+1
  s = s.replace(/[Ss][Cc]\s*\d+(?:[dD]\d+)?(?:\s*\+\s*\d+)?(?:\s*\/\s*\d+(?:[dD]\d+)?(?:\s*\+\s*\d+)?)?/g, "");
  // Remove ,CM+3 / CM+3
  s = s.replace(/[，,]?\s*[Cc][Mm]\s*\+\s*\d+/g, "");
  // Remove game mechanic stats: 故障值\d+, 伤害[dD]\d+[+-]?\d*, 贯穿属性, 之类
  s = s.replace(/[，,]\s*(?:故障值\s*\d+|伤害\s*(?:为\s*)?[dD]\s*\d+(?:\s*[+-]\s*\d+)?|具有?贯穿属性|因为磨损[\s\S]*?(?=[。，]|$))/g, "");
  // 贯穿属性 without 具有 prefix (e.g. "，贯穿属性。")
  s = s.replace(/[，,]\s*贯穿属性/g, "");
  // Remove isolated dice patterns like 1D4+1, 1d6 that survived
  s = s.replace(/[，,]\s*(?:\d+\s*[dD]\s*\d+(?:\s*[+-]\s*\d+)?)/g, "");
  // Remove dangling punctuation from partially-stripped parentheticals
  s = s.replace(/[（(]\s*[，,、]+\s*/g, "（").replace(/\s*[，,、]+\s*[）)]/g, "）");
  // Remove now-empty parentheses （） （） etc.
  s = s.replace(/[（(]\s*[）)]/g, "");
  // Fix trailing punctuation
  return s.replace(/[。，]+\s*$/, "。").trim();
}

/**
 * 同伴接一句话。
 *
 * 不是每个发现都配一句 —— 每次都接会变成噪音，反而更假。寡言的人开口更少。
 */
function sayPartnerRemark(dedup: Dedup, partner: PlayerAgent, kind: "clue" | "san"): void {
  const traits = partner.pc.personality || "";
  const chance = RESERVED.test(traits) && !OUTGOING.test(traits) ? 0.25 : 0.5;
  if (Math.random() > chance) return;
  const remark = partnerRemark(traits, kind, dedup.lastPartnerRemark);
  dedup.lastPartnerRemark = remark;
  const gesture = kind === "san" ? "转过头" : "凑过来看了一眼";
  say(`\n${partner.name}${speechLead(gesture)}"${remark}"`);
}
// nextRevealBridge 已随 buildRevealBridge 一起搬到 src/play/reveal-bridge.ts
