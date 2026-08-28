// PlayerAgent 的三个扮演字段（personality/backstory/currentGoal）的取值决策。
//
// 三个字段各自的兜底链，逐字段独立：
//   personality  = HTTP 字段 → 模组 → backgroundProfile 推导 → LLM
//   backstory    = HTTP 字段 → 模组 → backgroundProfile 推导 → LLM
//   currentGoal  = HTTP 字段 → 模组 →（跳过推导）→ LLM      （profile 里没有目标）
//
// 抽成纯函数（不碰模块级单例、不碰 process.env），才能既被 web 路（POST /party、
// POST /sessions）复用，又被文本命令（创建队友）复用 —— 两条路掰成两套做法，
// 是本仓反复修的老毛病。LLM 那一步由调用方以回调注入，注入方自己负责
// `llmEnabled()` 判据与失败兜底，这里只看"能不能拿到一个确定值"。

import type { BackgroundProfile } from "./coc-character";

export interface PlayerMeta {
  personality?: string;
  backstory?: string;
  currentGoal?: string;
}

/** 模组配置来源（ModulePlayerSetup 的三个字段，见 module/types.ts:478-493）。 */
export interface PlayerModuleSource {
  personality?: string;
  background?: string;
  motive?: string;
}

/** LLM 那一步的来源：给定角色背景八项，让调用方去增强/生成。返回空串/undefined 视为没拿到。 */
export type MetaLLMProvider = (field: keyof PlayerMeta, profile?: BackgroundProfile) => Promise<string | undefined>;

export const PLAYER_META_KEYS: (keyof PlayerMeta)[] = ["personality", "backstory", "currentGoal"];

/** personality ← traits + beliefs（background-profile.ts 的八项里有这两项）。 */
export function derivePersonalityFromProfile(profile: BackgroundProfile): string {
  return [profile.traits, profile.beliefs].filter(Boolean).join("；");
}

/** backstory ← significantPeople + meaningfulPlace + woundsAndScars。 */
export function deriveBackstoryFromProfile(profile: BackgroundProfile): string {
  return [profile.significantPeople, profile.meaningfulPlace, profile.woundsAndScars]
    .filter(Boolean)
    .join("；");
}

/** backgroundProfile 没有「当前目标」这一项，推导这一步对 currentGoal 直接跳过。 */
function deriveForField(field: keyof PlayerMeta, profile?: BackgroundProfile): string | undefined {
  if (!profile) return undefined;
  if (field === "personality") return derivePersonalityFromProfile(profile);
  if (field === "backstory") return deriveBackstoryFromProfile(profile);
  return undefined; // currentGoal 无推导来源
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * 走兜底链前三层（HTTP → 模组 → 推导），同步、无副作用。
 *
 * GameSession 构造函数**不能 await**（构造器不是 async），而 web 那条路的
 * LLM 层尚未注入 —— 前三层全是同步数据，所以拆出一个同步版本给构造器用。
 * currentGoal 无推导来源且无模组/HTTP 时在这里就是 undefined（让它缺席，
 * 不是塞一句"看起来像玩家填的"假数据）。
 */
export function resolvePlayerMetaSync(opts: {
  http?: PlayerMeta;
  module?: PlayerModuleSource;
  profile?: BackgroundProfile;
}): PlayerMeta {
  const { http = {}, module: mod = {}, profile } = opts;
  const out: PlayerMeta = {};

  for (const field of PLAYER_META_KEYS) {
    if (nonEmpty(http[field])) {
      out[field] = http[field];
      continue;
    }
    const moduleValue =
      field === "personality" ? mod.personality
      : field === "backstory" ? mod.background
      : mod.motive;
    if (nonEmpty(moduleValue)) {
      out[field] = moduleValue;
      continue;
    }
    const derived = deriveForField(field, profile);
    if (nonEmpty(derived)) out[field] = derived;
  }

  return out;
}

/**
 * 逐字段走兜底链，返回每个字段最终取到的值（取不到就是 undefined）。
 *
 * 链的顺序固定：HTTP（优先）→ 模组 → 推导（currentGoal 跳过）→ LLM。
 * 某一层拿到非空就停，不往下继续 —— 让 HTTP 里显式给的值永远压过其它来源
 * （"玩家手填的"不该被模组/推导盖掉）。
 *
 * @param http    HTTP 请求体里的字段（最优先）
 * @param module  当前模组的 ModulePlayerSetup（personality/background/motive）
 * @param profile 车卡生成的 backgroundProfile（推导来源）
 * @param llm     可选的 LLM 生成回调；undefined 或返回空时视为"这一层没有"。
 *                注入方负责走 `llmEnabled()` 判据与失败兜底。
 */
export async function resolvePlayerMeta(opts: {
  http?: PlayerMeta;
  module?: PlayerModuleSource;
  profile?: BackgroundProfile;
  llm?: MetaLLMProvider;
}): Promise<PlayerMeta> {
  const { http = {}, module: mod = {}, profile, llm } = opts;
  if (!llm) return resolvePlayerMetaSync({ http, module: mod, profile });
  const out = { ...resolvePlayerMetaSync({ http, module: mod, profile }) };

  for (const field of PLAYER_META_KEYS) {
    if (out[field] !== undefined) continue; // 前三层已经定了，不覆盖
    const fromLlm = await llm(field, profile);
    if (nonEmpty(fromLlm)) out[field] = fromLlm;
  }

  return out;
}
