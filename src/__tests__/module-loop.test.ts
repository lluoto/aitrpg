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
      stops.push({ scene, options, chose, at: lines.length });
      return { action: chose, intent: "move" };
    },
  });

  return { entries, stops, lines };
}

/** 玩家选的那一项，实际把他送到了哪里 */
function scoreHonored(run: LoopRun) {
  let scored = 0, honored = 0, unresolvable = 0;
  const broken: string[] = [];
  for (const st of run.stops) {
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

  test("【记录现状】玩家原样复述一个选项，引擎并不总是照做", async () => {
    // 实测 26/29，三处不兑现每轮都复现（三轮结果完全一致）：
    //   普瑞米尔 选「前往特里坎家」→ 实到 加比的拖车房
    //   谷仓形建筑 选「返回农场外围（陷阱区）」→ 实到 农场主别墅
    //   霍姆斯医院 选「返回镇上」→ 实到 报亭
    //
    // 断言写成"别变差"而不是"必须全中"：全中现在就是红的，
    // 而钉死 26 会让修好之后也红。根因还没查，留给下一轮。
    const run = await runLoop(pickLast);
    const { scored, honored } = scoreHonored(run);
    expect(scored).toBeGreaterThan(20);
    expect(honored).toBeGreaterThanOrEqual(scored - 3);
  }, 60_000);
});
