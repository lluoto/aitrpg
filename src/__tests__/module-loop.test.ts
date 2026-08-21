/**
 * 主循环的脚手架。
 *
 * 存在理由：`runModule` / `processScene` 此前**零测试覆盖** —— 改主干不会弄红任何东西，
 * 也就没有任何东西拦得住回归。这个坑仓库里踩过，见
 * `narrative-entity-recognition.test.ts:55`：
 * 「这道门原先长在 runModuleInner 的闭包里，测不到 —— 于是四局实跑一次都没演」。
 *
 * 三条注入缝都是现成的：`decide` 注决策、`onLine` 收播报、`LLM_DISABLED` 断网。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { llmEnabled, runModule } from "../play-module";
import { BARN_OF_PREMIER, BARN_SUPPORT } from "../module/barn-of-premier";
import type { PlayerDecision } from "../agent/player-agent";

/** 场景标题行，见 play-module.ts:1468 */
const HEADER = /^\n?━ (?:再次来到 )?(.+)$/;
const bareScene = (s: string) => s.replace(/（再次来到）\s*$/, "").trim();
/** 选项文本带「 (已访问2次)」「 (已充分探索)」这类后缀 */
const bareOpt = (s: string) => s.replace(/\s*\((?:已访问\d+次|已充分探索)\)\s*$/, "").trim();

interface Stop {
  scene: string;
  options: string[];
  chose: string;
  /** 做这个决定时的播报位置。目的地 = 这之后的第一个进场标题 */
  at: number;
  /** 这个岔口问的是"查什么"还是"去哪" —— 两者的选项不是一回事，别混着算 */
  kind: "investigate" | "move";
}

interface LoopRun {
  entries: { name: string; at: number }[];
  stops: Stop[];
  lines: string[];
}

/** 跑一局，由 pick 决定每个岔口选哪一项 */
async function runLoop(pick: (options: string[]) => string): Promise<LoopRun> {
  const lines: string[] = [];
  const entries: { name: string; at: number }[] = [];
  const stops: Stop[] = [];

  await runModule(BARN_OF_PREMIER, BARN_SUPPORT, {
    onLine: (line) => {
      const m = line.match(HEADER);
      if (m) entries.push({ name: m[1]!.trim(), at: lines.length });
      lines.push(line);
    },
    decide: async (context: string, options: string[]): Promise<PlayerDecision> => {
      const scene = bareScene(context.match(/【场景】(.*)/)?.[1] ?? "?");
      const chose = pick(options);
      const kind = options.some(o => o.startsWith("调查")) ? "investigate" : "move";
      stops.push({ scene, options, chose, at: lines.length, kind });
      // intent 跟着选的东西走 —— 真的 agent 是自己报 intent 的（见 player-agent.ts）。
      // 之前这里写死 "move"，结果调查阶段永远被跳过，等于没在测反转后的路径。
      const intent = chose.startsWith("调查") ? "investigate" : "move";
      return { action: chose, intent };
    },
  });

  return { entries, stops, lines };
}

/** 玩家选的那一项，实际把他送到了哪里 */
function scoreHonored(run: LoopRun) {
  let scored = 0, honored = 0, unresolvable = 0;
  const broken: string[] = [];
  for (const st of run.stops) {
    if (st.kind !== "move") continue; // "查什么"的选项不是连接，不该拿来对
    const here = BARN_OF_PREMIER.scenes.find(s => s.name === st.scene);
    const conn = here?.connections.find(c => c.condition.trim() === bareOpt(st.chose));
    if (!conn) { unresolvable++; continue; }
    const target = BARN_OF_PREMIER.scenes.find(s => s.id === conn.targetSceneId);
    const arrived = run.entries.find(e => e.at >= st.at);
    if (!arrived) continue; // 终局之后没有下一次进场，不计分
    scored++;
    if (arrived.name === target?.name) honored++;
    else broken.push(`${st.scene} 选「${bareOpt(st.chose)}」应到 ${target?.name}，实到 ${arrived.name}`);
  }
  return { scored, honored, unresolvable, broken };
}

let saved: string | undefined;
beforeAll(() => { saved = process.env.LLM_DISABLED; process.env.LLM_DISABLED = "true"; });
afterAll(() => {
  if (saved === undefined) delete process.env.LLM_DISABLED;
  else process.env.LLM_DISABLED = saved;
});

describe("llmEnabled —— 离线跑的开关", () => {
  // 原先有两份判据：llmOnce 只看有没有 key，runModuleInner 里那份还看 LLM_DISABLED。
  // 于是开发机上只要 key 在环境里，LLM_DISABLED=true 拦不住车卡阶段打网络。
  const keys = ["LLM_DISABLED", "LLM_MODE", "LLM_API_KEY", "OPENAI_API_KEY"] as const;
  const snapshot = () => Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const restore = (s: Record<string, string | undefined>) => {
    for (const k of keys) {
      if (s[k] === undefined) delete process.env[k];
      else process.env[k] = s[k];
    }
  };

  test("有 key 时 LLM_DISABLED 也必须拦得住", () => {
    const s = snapshot();
    try {
      process.env.LLM_API_KEY = "sk-real-looking-key";
      delete process.env.OPENAI_API_KEY;
      process.env.LLM_DISABLED = "true";
      expect(llmEnabled()).toBe(false);
    } finally { restore(s); }
  });

  test("LLM_MODE=template 同样拦得住", () => {
    const s = snapshot();
    try {
      process.env.LLM_API_KEY = "sk-real-looking-key";
      delete process.env.LLM_DISABLED;
      process.env.LLM_MODE = "template";
      expect(llmEnabled()).toBe(false);
    } finally { restore(s); }
  });

  test("占位符 key 不算数", () => {
    const s = snapshot();
    try {
      delete process.env.LLM_DISABLED;
      delete process.env.LLM_MODE;
      delete process.env.OPENAI_API_KEY;
      process.env.LLM_API_KEY = "sk-placeholder";
      expect(llmEnabled()).toBe(false);
      process.env.LLM_API_KEY = "${LLM_API_KEY}"; // 没展开的 shell 变量
      expect(llmEnabled()).toBe(false);
    } finally { restore(s); }
  });

  test("有真 key 且没禁用时才算可用", () => {
    const s = snapshot();
    try {
      delete process.env.LLM_DISABLED;
      delete process.env.LLM_MODE;
      process.env.LLM_API_KEY = "sk-real-looking-key";
      expect(llmEnabled()).toBe(true);
    } finally { restore(s); }
  });
});

describe("主循环脚手架", () => {
  // 必须选**最后一项**：options 是按引擎自己的优先级排过序的（play-module.ts:2890-2906），
  // 选第一项等于选了引擎本来就想去的地方 —— 那样"兑现"证明不了它在听玩家的。
  // 实测：选第一项 8/8 全兑现，选最后一项只有 26/29。差的就是这个混淆。
  const pickLast = (o: string[]) => o[o.length - 1] ?? "";

  test("离线跑得完，不抛异常", async () => {
    const run = await runLoop(pickLast);
    expect(run.entries.length).toBeGreaterThan(0);
    expect(run.stops.length).toBeGreaterThan(0);
  }, 60_000);

  test("每个岔口都有选项", async () => {
    // 没选项的岔口意味着问了玩家却不给他任何可选的 —— 那是 bug，不是设计
    const run = await runLoop(pickLast);
    expect(run.stops.filter(s => s.options.length === 0)).toHaveLength(0);
  }, 60_000);

  test("每个选项都能对回当前场景的一条连接", async () => {
    // 选项文本是从 connection.condition 生成的。对不回去就说明标签和连接漂了，
    // 玩家看到的和引擎认的不是一回事。
    const run = await runLoop(pickLast);
    expect(scoreHonored(run).unresolvable).toBe(0);
  }, 60_000);

  test("玩家原样复述一个选项，引擎必须照做", async () => {
    // 曾经是 26/29。三处不兑现根因同一个：主循环的「访问≥6次强制改道」
    // 在玩家**明确选了**去某地、到达后、渲染之前，把人一声不吭地弹到别处。
    // 三处的实到全都是"被选中场景的第一条通往未访问场景的出边"，
    // 且被选中场景此前进场次数都正好是 6。
    const run = await runLoop(pickLast);
    const { scored, honored, broken } = scoreHonored(run);
    expect(scored).toBeGreaterThan(20);
    expect(broken).toEqual([]);
    expect(honored).toBe(scored);
  }, 60_000);

  test("玩家自己决定查什么，而且真的会掷骰", async () => {
    // 循环反转：原先进场就把线索全解光，玩家对"查什么"零决定权。
    // 现在需要动手查的线索（模组里 32 条中的 9 条）会变成岔口上的选项。
    //
    // 光断言"出现了调查选项"不够 —— 那只证明菜单画出来了。
    // 必须证明选了之后**真的掷了骰**，所以去看选择之后紧跟的检定播报。
    const run = await runLoop((o) => o[0] ?? "");
    const invStops = run.stops.filter(s => s.kind === "investigate");
    expect(invStops.length).toBeGreaterThan(0);
    expect(invStops.every(s => s.chose.startsWith("调查"))).toBe(true);

    const rolledAfter = invStops.filter(st =>
      run.lines.slice(st.at, st.at + 12).some(l => l.includes("[检定]")));
    expect(rolledAfter.length).toBeGreaterThan(0);
  }, 60_000);

  test("顺着引擎给的顺序走，仍然能通关", async () => {
    // 这是"不再强制改道"这个改动最该守住的东西：
    // 原先是那条强制改道在把玩家往终局赶。去掉它对正常玩法的影响必须为零。
    const run = await runLoop((o) => o[0] ?? "");
    const finale = BARN_OF_PREMIER.scenes.find(s => s.id === BARN_SUPPORT.finaleSceneId);
    expect(run.entries.some(e => e.name === finale?.name)).toBe(true);
  }, 60_000);
});
