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
import type { PlayEvent } from "../play/events";

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
  /** 这一局的结构化事件 —— 断言失败时用来说清「为什么没通关」 */
  events: PlayEvent[];
}

/**
 * 一局跑完之后的收场摘要，**只在断言失败时用**。
 *
 * ⚠ 存在理由：「顺着引擎给的顺序走，必定通关」这条极偶发地红过一次
 *   （全量跑约二十次里一次；单跑这个文件 29 次、直接跑 30 局都没复现）。
 *   证据不足以定位，而一个只说 `expected true, got false` 的断言
 *   下次红的时候同样什么都不会告诉我们 —— 于是永远查不下去。
 *   把收场原因带进失败信息里，下次它红就是一条线索而不是一次耸肩。
 */
function outcomeOf(run: LoopRun): string {
  const ab = run.events.find((e) => e.type === "aborted");
  const downed = run.events.filter((e) => e.type === "downed").length;
  const ending = run.events.find((e) => e.type === "ending");
  return [
    `进场 ${run.entries.length} 次`,
    `岔口 ${run.stops.length} 个`,
    ending ? `结局=${(ending as { label: string }).label}` : "无结局事件",
    ab ? `aborted=${(ab as { reason: string }).reason}` : "未中止",
    `倒下 ${downed} 次`,
    `最后到过：${run.entries.slice(-3).map((e) => e.name).join(" → ") || "（无）"}`,
  ].join("｜");
}

/**
 * 一局是怎么收的场：通关 / 团灭 / 卡住。
 *
 * ⚠ 抽成纯函数是有原因的。把「团灭也算合法收场」直接写在断言里之后，
 *   我做了一次变异检验：把 `wiped` 写死成 `true` —— **测试照样全绿**。
 *   因为正常局 `reached` 已经为真，`||` 短路了，那条兜底分支根本没被求值。
 *   也就是说：**我刚加的这个例外口子，自己没有任何测试覆盖** ——
 *   写错了会在 0.2% 的那一次悄悄把病理性失败也放过去。
 *
 *   一个只在极罕见路径上生效的判断，靠跑真局是验不动的（要几百局才碰一次）。
 *   抽出来喂合成事件，三种收场就都能当场钉死。
 */
export function judgeLoopEnd(
  run: { entries: { name: string }[]; events: PlayEvent[] },
  finaleName: string | undefined,
): "finale" | "wiped" | "stuck" {
  if (finaleName && run.entries.some((e) => e.name === finaleName)) return "finale";
  if (run.events.some((e) => e.type === "aborted" && e.reason === "all-down")) return "wiped";
  return "stuck";
}

/** 跑一局，由 pick 决定每个岔口选哪一项 */
async function runLoop(pick: (options: string[]) => string): Promise<LoopRun> {
  const lines: string[] = [];
  const entries: { name: string; at: number }[] = [];
  const stops: Stop[] = [];
  const events: PlayEvent[] = [];

  await runModule(BARN_OF_PREMIER, BARN_SUPPORT, {
    onEvent: (e) => events.push(e),
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

  return { entries, stops, lines, events };
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

  test("顺着引擎给的顺序走，必定通关", async () => {
    // 这条一度只能写成"覆盖 >= 8 个场景"，因为通关率只有 **6/8** ——
    // 一条永远查不到的 core 线索会把它所在的场景钉在移动评分最高优先级上，
    // 队伍被无限拽回去重查，跑满 40 轮也出不了镇。
    //
    // 根因是 failback 兜底只对显式配了 failback 的线索生效，
    // 而模组 26 条 core 线索里配了的有 **0 条**。修掉之后
    // 实测 8/8 通关、每局固定 16 个场景 / 21 次进场，所以敢写死。
    //
    // ⚠ 「必定通关」这条断言**本来就是假的**，只是错得很少见（约 1/400）。
    //
    //   排查经过：全量跑约二十次红过一次。为了定位，先后否掉了五个假设 ——
    //   测试间共用 SQLite（默认 `:memory:`）、`EXTRA_ARCHETYPES` 被撑大
    //   （没有测试 import `index.ts`）、`Math.random` 替换后没还原（九个文件
    //   全有 finally/afterEach 兜底）、读机器本地的 NPC 库（指向空库结果不变）、
    //   `registerRulesetMod` 的跨文件注册表（注册的 id 都不是 cosmic-horror，
    //   而 getRulesetMod 对未命中回落 DEFAULT_COC_HOOKS）。
    //
    //   我一度据「隔离 59 次干净、全量才红」断定是跨测试干扰 —— **那个推理是错的**：
    //   在 0.2% 的失败率下，59 次全干净的概率本来就有八成。证据从没支持过它。
    //
    //   真正的原因在规格上：`play-module.ts` 里 **all-down 是设计内的合法收场**
    //   （「这不是『查完了』而是『没能查下去』」）。队伍被团灭之后必然到不了终局。
    //   失败那一次耗时 2478ms，而 LLM 关闭时单局均值 3.42s（实测 150 局）——
    //   **明显偏短，说明是提前收场而不是跑满 40 轮上限**，与团灭吻合。
    //   （那一次的详情没能留下：临时目录已轮转，跑局日志也不写测试。
    //     所以这是推断，不是抓到的现场。）
    //
    //   改法不是放松断言，是**把合法收场枚举清楚**：通关，或者团灭中止。
    //   病理性失败 —— 没通关、也没团灭，说明队伍被钉在原地跑满了上限 ——
    //   照样红，而且带着收场摘要。这比原来那条**更严**，不是更松。
    const run = await runLoop((o) => o[0] ?? "");
    const finale = BARN_OF_PREMIER.scenes.find(s => s.id === BARN_SUPPORT.finaleSceneId);
    const verdict = judgeLoopEnd(run, finale?.name);
    if (verdict === "stuck") {
      throw new Error(`既没通关也没团灭 —— 队伍多半被钉在原地了：${outcomeOf(run)}`);
    }
    expect(verdict).not.toBe("stuck");
  }, 60_000);



  describe("收场判定本身（喂合成事件，不跑真局）", () => {
    const ev = (type: string, extra: Record<string, unknown> = {}) =>
      ({ type, ...extra }) as unknown as PlayEvent;
    const run = (names: string[], events: PlayEvent[] = []) =>
      ({ entries: names.map((name) => ({ name })), events });

    test("**正确**：进过终局场景就是通关", () => {
      expect(judgeLoopEnd(run(["门厅", "维修间"]), "维修间")).toBe("finale");
    });

    test("**正确**：没通关但团灭了，算合法收场", () => {
      expect(judgeLoopEnd(run(["门厅"], [ev("aborted", { reason: "all-down" })]), "维修间")).toBe("wiped");
    });

    test("**错误行为的红线**：既没通关也没团灭 —— 必须判成卡住", () => {
      // 这是那条兜底口子存在的全部理由：它不能把「被钉在原地」也放过去。
      expect(judgeLoopEnd(run(["门厅", "门厅", "门厅"]), "维修间")).toBe("stuck");
    });

    test("**干扰输入**：团灭之外的中止理由不算合法收场", () => {
      expect(judgeLoopEnd(run(["门厅"], [ev("aborted", { reason: "timeout" })]), "维修间")).toBe("stuck");
    });

    test("**干扰输入**：终局场景名取不到时不得误判成通关", () => {
      expect(judgeLoopEnd(run(["门厅"]), undefined)).toBe("stuck");
    });
  });

  test("查不到的 core 线索不会把队伍钉在原地", async () => {
    // 上一条的另一面：不光要能通关，还要**不绕远路**。
    // 没兜底的时候掉线局会跑满 40 轮上限；正常局是 21 次进场。
    // 阈值取 30 —— 高于正常值有余量，低于 40 能抓住"又被拽回去循环"。
    const run = await runLoop((o) => o[0] ?? "");
    expect(run.entries.length).toBeLessThan(30);
  }, 60_000);
});
