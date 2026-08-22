# 外部 review 请求：诊断判据是否可信

> 用途：把这份连同下面列出的文件一起交给**另一个模型**（不是写这些代码的那个），
> 请它独立判断。写这份文件的模型在同一类错误上连犯六次仍未自查出来，
> 需要的是失效模式不同的第二双眼睛，不是同一个人再看一遍。

---

## 背景：为什么找你

这是一个 CoC 7e 跑团引擎的仓库。近期工作大量依赖**自写的诊断脚本**来判断
「某个行为对不对」——因为很多行为离线测试盖不到（LLM 路径、随机骰、多局统计）。

问题是：**这些判据本身反复出错，而且错的方式高度雷同**。已知六次：

| # | 判据 | 错法 | 后果 |
|---|---|---|---|
| 1 | 「切割截断语义单元」检查 | 判据太宽 | 174 个假阳性淹没 2 个真问题 |
| 2 | 「倒下的人还在行动」 | 把急救苏醒后的正常行动也算违规 | 永远报警，等于没测 |
| 3 | 「敌人战斗数值解析」测试 | 用例里干扰项恰好在目标之后 | 实现改错也全绿（变异检验才抓出） |
| 4 | 「文件是否被引用」 | 用去扩展名短词做子串匹配 | 18 个文件全部"命中" |
| 5 | 「不可再生数据有多少」 | `.txt` 源材料判据漏了根目录 | 算出 53MB，实际 489MB（差 9 倍） |
| 6 | 「玩家说法能否匹配」 | 12 种用例里 8 种都含完整地名 | 跑出 100%，补进会掉的用例后是 66.9% |

**共同点**：判据要么太宽（假阳性）、要么太松（假阴性）、要么用例没有区分力。
每次都是「写完就用」，没有先验证判据本身能不能区分对错两种情形。

---

## 请你做的事

审下面列出的诊断脚本，对**每一个**回答三个问题：

### Q1. 这个判据能区分对错吗？
构造两种输入：一种「行为正确」、一种「行为错误」。
判据对二者的输出是否不同？如果都输出「通过」或都输出「报警」，它就是坏的。

### Q2. 假阳性 / 假阴性风险在哪？
- 什么情况下它会报一个**其实没问题**的东西？
- 什么情况下**真有问题**它却不报？

### Q3. 用例有没有区分力？
特别针对含测试用例的脚本：这些用例是不是**都太容易**？
（第 6 号错误就是这么来的：所有用例都含完整地名，于是 100% 通过。）

---

## 待审文件

以下都在 `C:\aitrpg\poc\tools\`（这个目录被 .gitignore 排除，是诊断脚本区）：

| 文件 | 它声称在量什么 | 当前结论 |
|---|---|---|
| `_diag-phrasing.ts` | 玩家的自然语言说法能否匹配到目标场景 | 含完整地名 100%，否则 0~3% |
| `_diag-downed.ts` | 昏迷的调查员是否还在掷骰 | 违规 0 次 |
| `_diag-wounds.ts` | 伤势分级／重伤检定／惩罚骰是否生效 | 40 局 74 次伤害，≥50% 有 4 次 |
| `_diag-combat.ts` | Boss 是否真的还手、玩家是否掉血 | 12 局挥击 46 次，打昏 2 次 |
| `_diag-fuzz.ts` | 随机玩法能否通关、有无死循环 | 10/10 通关 |
| `_audit-backup.ts` | 哪些数据丢了不可再生 | 500MB 不可再生 |

以及 `C:\aitrpg\poc\scripts\preflight.ts`（改动前后的自检，含 6 项检查）。

---

## 已知的环境约束（避免你误判）

- **Windows PowerShell 5.1**。仓库源码是 UTF-8 **无 BOM**，
  `Select-String` / `Get-Content` 读中文会 mojibake。用 `fs.readFileSync` 或专用工具。
- 诊断脚本一律走 `onLine` 回调在内存收集，自己 `Bun.write` 落盘，
  **不经控制台重定向**——`bun run x.ts *> file` 会把 UTF-8 写坏。
  （曾因此得出「12 局 0 次触发」的假结论，实际是编码问题。）
- 测试用 `bun test`。**只有测试条数是可靠回归信号**，
  `expect()` 计数会被一条无种子的随机测试搅动。
- 已知两条偶发假红：`coc-engine.test.ts:131`（约 1%）、
  `npc-reaction.test.ts` 的「高稳定性减少负面情绪」。

---

## 输出格式

对每个脚本给：

```
## <文件名>
- 能否区分对错：能 / 不能 / 存疑（说明理由）
- 假阳性风险：<具体场景>
- 假阴性风险：<具体场景>
- 用例区分力：<针对含用例的脚本>
- 建议：<具体改法，或"无需改">
```

最后给一段总评：**这六次错误有没有共同的根因？**
如果有，什么样的检查能一次性挡住这一类，而不是逐个打补丁？

---

## 一个请求

请**不要**只做表面复核（"看起来合理"）。上面六次错误里，
至少四次在肉眼审读时都"看起来合理"——它们是在
**构造反例**或**做变异检验**（把实现改坏看测试红不红）时才暴露的。

如果你判断某个判据可疑，请直接给出能让它露馅的**具体输入**。


======================================================================
# 附：待审脚本全文
======================================================================

## tools/_diag-phrasing.ts

```ts
// 量「玩家说的话没被匹配上、引擎替他挑了」有多频繁。
//
// 记录里的原话：玩家说的话只要不含某个场景名的前 8 个字，就被静默丢弃，
// 引擎按分数自己挑一个地方送过去。「比菜单更糟 —— 菜单至少还承认玩家做了选择」。
//
// matchKeys 那轮改进（整句 / 去括号 / 场景真名 三个键）之后应该好转，
// 但从没量过。这里用主循环脚手架灌不同说法，看 forced 比例。
process.env.LLM_DISABLED = "true";

import { chooseConnection, type MoveWorldView } from "../src/play-module";
import { BARN_OF_PREMIER } from "../src/module/barn-of-premier";
import type { SceneConnection } from "../src/module/types";

const view: MoveWorldView = {
  isSceneVisited: () => false,
  visitCount: () => 0,
  sceneExists: (id) => BARN_OF_PREMIER.scenes.some((s) => s.id === id),
  sceneName: (id) => BARN_OF_PREMIER.scenes.find((s) => s.id === id)?.name ?? "",
};

interface Case { desc: string; say: (c: SceneConnection, name: string) => string }

// 玩家可能怎么表达「我要去 X」
const PHRASINGS: Case[] = [
  { desc: "照抄选项原文", say: (c) => c.condition },
  { desc: "只说地名", say: (_c, n) => n },
  { desc: "「去」+地名", say: (_c, n) => `去${n}` },
  { desc: "「我们去」+地名", say: (_c, n) => `我们去${n}看看` },
  { desc: "「前往」+地名", say: (_c, n) => `前往${n}` },
  { desc: "地名+「那边」", say: (_c, n) => `${n}那边应该有线索` },
  { desc: "带犹豫的口语", say: (_c, n) => `嗯……先去${n}吧` },
  { desc: "地名在句中", say: (_c, n) => `我觉得${n}值得看看，走吧` },

  // 下面这些是**该失败也可能失败**的 —— 上面八种全含完整地名，
  // 全中不说明匹配好，只说明用例太容易。判据要有区分力就得有会掉的。
  { desc: "只说地名前两字", say: (_c, n) => `去${n.slice(0, 2)}` },
  { desc: "同义改写（不含原名）", say: () => "换个地方看看" },
  { desc: "代词指代", say: () => "去那边" },
  { desc: "描述目的地特征", say: () => "去那个有灯光的房间" },
];

let rows: string[] = [];
const tally = new Map<string, { hit: number; total: number }>();

for (const scene of BARN_OF_PREMIER.scenes) {
  const conns = scene.connections as SceneConnection[];
  if (conns.length < 2) continue; // 单出口没得选，不算数

  for (const target of conns) {
    const name = view.sceneName(target.targetSceneId);
    if (!name) continue;

    for (const p of PHRASINGS) {
      const said = p.say(target, name);
      const r = chooseConnection({ action: said }, conns, view);
      const hit = r.conn?.targetSceneId === target.targetSceneId && !r.forced;

      const t = tally.get(p.desc) ?? { hit: 0, total: 0 };
      t.total++; if (hit) t.hit++;
      tally.set(p.desc, t);

      if (!hit && rows.length < 20) {
        rows.push(`  想去「${name}」说的是「${said}」→ ${r.forced ? "**被替选**到" : "匹配到"}「${r.conn ? view.sceneName(r.conn.targetSceneId) : "(null)"}」`);
      }
    }
  }
}

const out: string[] = ["# 玩家说的话，引擎认不认", ""];
out.push("拿模组里每个多出口场景 × 每个出口 × 8 种说法，看能不能匹配到玩家想去的地方。");
out.push("");
out.push("| 说法 | 命中 | 总数 | 命中率 |");
out.push("|---|---|---|---|");
for (const [k, v] of tally) {
  const pct = ((v.hit / v.total) * 100).toFixed(0);
  out.push(`| ${k} | ${v.hit} | ${v.total} | ${pct}% |`);
}
const all = [...tally.values()].reduce((a, b) => ({ hit: a.hit + b.hit, total: a.total + b.total }), { hit: 0, total: 0 });
out.push("");
out.push(`**合计 ${all.hit}/${all.total} = ${((all.hit / all.total) * 100).toFixed(1)}%**`);
out.push("");
out.push("没命中的例子：");
out.push("");
out.push(...rows);

await Bun.write("tools/diag-phrasing.md", out.join("\n") + "\n");
console.log(`合计命中 ${all.hit}/${all.total} = ${((all.hit / all.total) * 100).toFixed(1)}%  -> tools/diag-phrasing.md`);
```

## tools/_diag-downed.ts

```ts
// 量「倒下之后还在行动」有多普遍。
//
// 昏迷（hp<=0）现在只是个数字：scene-pipeline 里没有任何一处检查它，
// 于是出现「两名调查员都失去了意识」之后接着查线索、掷理智、陷入疯狂的序列。
// 这是既有缺陷 —— 陷阱早就能把人打昏，只是以前罕见；敌人开始还手后变常见了。
process.env.LLM_DISABLED = "true";

import { runModule } from "../src/play-module";
import { BARN_OF_PREMIER, BARN_SUPPORT } from "../src/module/barn-of-premier";
import type { PlayerDecision } from "../src/agent/player-agent";

const N = Number(process.argv[2] ?? 20);

async function once(seed: number) {
  const lines: string[] = [];
  let n = seed;
  const rnd = () => { n = (n * 1103515245 + 12345) & 0x7fffffff; return n / 0x7fffffff; };
  await runModule(BARN_OF_PREMIER, BARN_SUPPORT, {
    onLine: (l) => lines.push(l),
    decide: async (_c, options): Promise<PlayerDecision> => {
      const chose = options[Math.floor(rnd() * options.length)] ?? "";
      return { action: chose, intent: chose.startsWith("调查") ? "investigate" : "move" };
    },
  });

  // 判据必须是「**倒着的那个人**在掷骰」，不能是「第一次昏迷之后的所有掷骰」——
  // 后者把急救苏醒之后的正常行动也算进去，永远报警，等于没测。
  // 逐行跟踪每个人的倒下/苏醒状态，只统计处于倒下态时该人自己的检定。
  const down = new Map<string, boolean>();
  let violations = 0;
  const samples: string[] = [];

  for (const l of lines) {
    // 谁倒下了
    const ko = l.match(/❤ (\S+?) HP \d+ → 0（昏迷/);
    if (ko) { down.set(ko[1]!, true); continue; }
    // 谁醒了
    const up = l.match(/(\S+?)猛地咳嗽起来/);
    if (up) { down.set(up[1]!, false); continue; }

    // 倒着的人自己在掷骰 = 违规。
    //
    // 但「体质（重伤）」要排除：它是 HP 归零**那一刻**的结算，
    // 播报顺序排在昏迷行之后，属于同一次受伤的一部分，不是"倒下后又行动"。
    const chk = l.match(/➜ (\S+?) 【(.+?)】/);
    if (chk && down.get(chk[1]!) && !/体质（重伤）/.test(chk[2]!)) {
      violations++;
      if (samples.length < 3) samples.push(l.trim().slice(0, 76));
    }
  }

  return {
    everDown: [...down.keys()].length > 0,
    violations,
    samples,
    bothDown: lines.some((l) => /两名调查员都失去了意识/.test(l)),
    revived: lines.filter((l) => /猛地咳嗽起来/.test(l)).length,
    aborted: lines.some((l) => /调查中止/.test(l)),
  };
}

async function main() {
  let koRuns = 0, bothRuns = 0, viol = 0, revived = 0, aborted = 0;
  const samples: string[] = [];
  for (let i = 1; i <= N; i++) {
    const r = await once(i * 7919);
    if (!r.everDown) continue;
    koRuns++;
    if (r.bothDown) bothRuns++;
    if (r.aborted) aborted++;
    viol += r.violations;
    revived += r.revived;
    for (const s of r.samples) if (samples.length < 5) samples.push(s);
  }
  const out = [
    `${N} 局：出现昏迷 ${koRuns} 局，两人同时倒下 ${bothRuns} 局，走「调查中止」${aborted} 局`,
    `急救唤醒成功 ${revived} 次`,
    "",
    `倒着的人自己掷骰（违规）：${viol} 次`,
    ...samples.map((s) => "    " + s),
    "",
    viol === 0
      ? "✓ 昏迷期间不再行动"
      : "⚠ 仍有倒下的人在掷骰",
  ].join("\n");
  await Bun.write("tools/diag-downed.txt", out + "\n");
  console.log(out);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

## tools/_diag-wounds.ts

```ts
// 量伤势惩罚骰到底触没触发。
//
// ⚠ 不要用 `bun run src/play-module.ts *> file` 再去读那个文件：
// PowerShell 的重定向会把 UTF-8 写坏，中文全成乱码，正则一条都匹配不上，
// 于是"12 局 0 次"这种结论其实是编码问题不是行为问题（踩过）。
// 正确做法是走 onLine 回调在内存里收，脚本自己 Bun.write 落盘。
process.env.LLM_DISABLED = "true";

import { runModule } from "../src/play-module";
import { BARN_OF_PREMIER, BARN_SUPPORT } from "../src/module/barn-of-premier";
import type { PlayerDecision } from "../src/agent/player-agent";

const N = Number(process.argv[2] ?? 12);

interface Hit {
  run: number;
  from: number;
  to: number;
  label: string;
}

async function once(run: number, seed: number) {
  const lines: string[] = [];
  let n = seed;
  const rnd = () => { n = (n * 1103515245 + 12345) & 0x7fffffff; return n / 0x7fffffff; };

  await runModule(BARN_OF_PREMIER, BARN_SUPPORT, {
    onLine: (l) => lines.push(l),
    decide: async (_c, options): Promise<PlayerDecision> => {
      const chose = options[Math.floor(rnd() * options.length)] ?? "";
      return { action: chose, intent: chose.startsWith("调查") ? "investigate" : "move" };
    },
  });

  const dmg: Hit[] = [];
  for (const l of lines) {
    const m = l.match(/HP (\d+) → (\d+)(（(.+?)）)?/);
    if (m) dmg.push({ run, from: +m[1]!, to: +m[2]!, label: m[4] ?? "" });
  }
  return {
    dmg,
    penalty: lines.filter((l) => /惩罚骰/.test(l)),
    conCheck: lines.filter((l) => /体质（重伤）/.test(l)),
    healed: lines.filter((l) => /惩罚骰解除|伤势得到处理/.test(l)),
    // 不变量：重伤体质检定结算的就是这处伤，不该被它自己罚
    selfPenalized: lines.filter((l) => /体质（重伤）/.test(l) && /伤势/.test(l)),
  };
}

async function main() {
  const allDmg: Hit[] = [];
  const allPen: string[] = [];
  const allCon: string[] = [];
  const allHeal: string[] = [];
  const allSelf: string[] = [];

  for (let i = 1; i <= N; i++) {
    const r = await once(i, i * 7919);
    allDmg.push(...r.dmg);
    allPen.push(...r.penalty);
    allCon.push(...r.conCheck);
    allHeal.push(...r.healed);
    allSelf.push(...r.selfPenalized);
  }

  const out: string[] = [];
  out.push(`${N} 局：伤害事件 ${allDmg.length} 次，重伤体质检定 ${allCon.length} 次，惩罚骰播报 ${allPen.length} 次，解除 ${allHeal.length} 次`);
  out.push(
    allSelf.length === 0
      ? "✓ 不变量：没有一次重伤体质检定被它自己那处伤罚到"
      : `✗ 不变量破了：${allSelf.length} 次重伤体质检定被自身伤势罚（双重计算）`,
  );
  for (const l of allSelf.slice(0, 3)) out.push("    " + l.trim());
  out.push("");

  // 按伤害占比分档 —— 想看清为什么触发得少
  const buckets = { "<25%": 0, "25-49%": 0, "≥50%": 0, "≥75%": 0 };
  for (const d of allDmg) {
    const lost = d.from - d.to;
    // maxHp 不在这行里，用「掉血前的 HP」当下界估算不准，所以只统计标签
    if (!d.label) buckets["<25%"]++;
    else if (d.label === "轻伤") buckets["25-49%"]++;
    else if (d.label === "重伤") buckets["≥50%"]++;
    else if (d.label === "致命伤") buckets["≥75%"]++;
  }
  out.push("按引擎判定的伤势分档：");
  for (const [k, v] of Object.entries(buckets)) out.push(`  ${k.padEnd(8)} ${v}`);
  out.push("");

  out.push("伤害明细（前 30 条）：");
  for (const d of allDmg.slice(0, 30)) {
    out.push(`  #${d.run} HP ${d.from}→${d.to} 掉${d.from - d.to} ${d.label || "(无标签)"}`);
  }
  out.push("");

  if (allPen.length) {
    out.push("惩罚骰相关播报：");
    for (const l of allPen.slice(0, 20)) out.push("  " + l.trim());
  } else {
    out.push("⚠ 没有任何惩罚骰播报。");
  }

  await Bun.write("tools/diag-wounds.txt", out.join("\n") + "\n");
  console.log(out.slice(0, 3).join("\n"));
  console.log("→ tools/diag-wounds.txt");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

## tools/_diag-combat.ts

```ts
// 量战斗到底有没有发生、玩家掉不掉血。
// 走 onLine 在内存收，不经 PowerShell 重定向（那会把 UTF-8 写坏）。
process.env.LLM_DISABLED = "true";

import { runModule } from "../src/play-module";
import { BARN_OF_PREMIER, BARN_SUPPORT } from "../src/module/barn-of-premier";
import type { PlayerDecision } from "../src/agent/player-agent";

const N = Number(process.argv[2] ?? 10);

async function once(seed: number) {
  const lines: string[] = [];
  let n = seed;
  const rnd = () => { n = (n * 1103515245 + 12345) & 0x7fffffff; return n / 0x7fffffff; };

  await runModule(BARN_OF_PREMIER, BARN_SUPPORT, {
    onLine: (l) => lines.push(l),
    decide: async (_c, options): Promise<PlayerDecision> => {
      const chose = options[Math.floor(rnd() * options.length)] ?? "";
      return { action: chose, intent: chose.startsWith("调查") ? "investigate" : "move" };
    },
  });

  // 战斗段的行范围 —— 用来区分「战斗里挨的打」和「陷阱挨的打」
  const s = lines.findIndex((l) => /战斗轮/.test(l));
  const e = s < 0 ? -1 : lines.findIndex((l, i) => i > s && /═{10,}/.test(l) && i > s + 3);
  const inCombat = s >= 0 ? lines.slice(s, e > s ? e : lines.length) : [];

  return {
    fought: s >= 0,
    won: lines.some((l) => /战斗胜利|被击退/.test(l)),
    attacks: lines.filter((l) => /格斗\(肉搏\)|射击\(手枪\)/.test(l)).length,
    fatigue: lines.filter((l) => /惩罚骰×/.test(l)).length,
    pcDamage: lines.filter((l) => /HP \d+ → \d+/.test(l)).length,
    // 敌人还手相关
    enemySwings: inCombat.filter((l) => /【格斗】/.test(l)).length,
    dodges: inCombat.filter((l) => /【闪避】/.test(l)).length,
    combatDamage: inCombat.filter((l) => /HP \d+ → \d+/.test(l)).length,
    knockouts: inCombat.filter((l) => /昏迷过去|失去了意识/.test(l)).length,
  };
}

async function main() {
  let fought = 0, won = 0, atk = 0, fat = 0, dmg = 0;
  let swings = 0, dodges = 0, cdmg = 0, ko = 0;
  for (let i = 1; i <= N; i++) {
    const r = await once(i * 7919);
    if (r.fought) fought++;
    if (r.won) won++;
    atk += r.attacks;
    fat += r.fatigue;
    dmg += r.pcDamage;
    swings += r.enemySwings;
    dodges += r.dodges;
    cdmg += r.combatDamage;
    ko += r.knockouts;
  }
  const out = [
    `${N} 局：发生战斗 ${fought} 局，其中击退 ${won} 局`,
    `调查员攻击掷骰 ${atk} 次，疲劳惩罚骰播报 ${fat} 次`,
    `玩家 HP 变化 ${dmg} 次（含陷阱）`,
    "",
    "敌人还手：",
    `  敌人挥击 ${swings} 次，玩家闪避掷骰 ${dodges} 次`,
    `  战斗中造成 HP 变化 ${cdmg} 次，打昏 ${ko} 次`,
    swings === 0 ? "  ⚠ 敌人一次都没还手" : "  ✓ 敌人会还手了",
  ].join("\n");
  await Bun.write("tools/diag-combat.txt", out + "\n");
  console.log(out);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

## tools/_diag-fuzz.ts

```ts
// 随机策略跑多局，找只在特定路径上冒出来的毛病。
// 随机玩家最接近真人：既不是永远听引擎的，也不是永远对着干。
process.env.LLM_DISABLED = "true";

import { runModule } from "../src/play-module";
import { BARN_OF_PREMIER, BARN_SUPPORT } from "../src/module/barn-of-premier";
import type { PlayerDecision } from "../src/agent/player-agent";

const HEADER = /^\n?━ (?:再次来到 )?(.+)$/;

async function once(seedish: number) {
  const entries: string[] = [];
  const lines: string[] = [];
  let moveStops = 0, invStops = 0, emptyOptionStops = 0;
  let n = seedish;
  const rnd = () => { n = (n * 1103515245 + 12345) & 0x7fffffff; return n / 0x7fffffff; };

  await runModule(BARN_OF_PREMIER, BARN_SUPPORT, {
    onLine: (line) => {
      const m = line.match(HEADER);
      if (m) entries.push(m[1]!.trim());
      lines.push(line);
    },
    decide: async (_c, options): Promise<PlayerDecision> => {
      if (options.length === 0) emptyOptionStops++;
      const chose = options[Math.floor(rnd() * options.length)] ?? "";
      if (options.some(o => o.startsWith("调查"))) invStops++; else moveStops++;
      return { action: chose, intent: chose.startsWith("调查") ? "investigate" : "move" };
    },
  });

  const finale = BARN_OF_PREMIER.scenes.find(s => s.id === BARN_SUPPORT.finaleSceneId)?.name;
  // 连续同名进场 = 原地打转
  let maxRepeat = 1, cur = 1;
  for (let i = 1; i < entries.length; i++) {
    if (entries[i] === entries[i - 1]) { cur++; maxRepeat = Math.max(maxRepeat, cur); } else cur = 1;
  }
  // 空行/纯空白播报
  const blank = lines.filter(l => l.trim() === "").length;
  // 结局到底有没有念出来 —— 只"进过终局场景"不等于故事有收场
  const labels = ["True End", "Near-Truth End", "Good End", "Bad End", "Normal End"];
  const endLine = lines.find(l => labels.some(t => l.includes(t)));
  const ending = endLine ? labels.find(t => endLine.includes(t))! : "(无结局)";
  return {
    finale: entries.includes(finale ?? ""),
    entries: entries.length,
    distinct: new Set(entries).size,
    moveStops, invStops, emptyOptionStops, maxRepeat, ending,
    lines: lines.length, blank,
  };
}

async function main() {
  const rows = [];
  for (let i = 1; i <= 10; i++) {
    try {
      rows.push({ i, ...(await once(i * 7919)) });
    } catch (e) {
      console.log(`#${i} 抛异常: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`通关 ${rows.filter(r => r.finale).length}/${rows.length}`);
  console.log(`空选项岔口总数 ${rows.reduce((a, r) => a + r.emptyOptionStops, 0)}`);
  const noEnd = rows.filter(r => r.ending === "(无结局)").length;
  console.log(`跑完没有结局的局：${noEnd}/${rows.length}`);
  console.log("局  进场 不同 移动 调查 到终局 结局");
  for (const r of rows) {
    console.log(`#${r.i}  ${r.entries}  ${r.distinct}  ${r.moveStops}  ${r.invStops}  ${r.finale}  ${r.ending}`);
  }
}

main().catch((e) => { console.error("跑挂了:", e); process.exit(1); });
```

## tools/_audit-backup.ts

```ts
// 分辨「丢了就没了」和「能重新生成」。
//
// risk-01：C:\aitrpg 下只有 poc/ 有版本控制和远端，其余 3.7GB 裸奔。
// 但不是所有东西都值得备份 —— 抽取产物能从源材料重跑，源材料才是根。
// 不分层的话，要么漏掉根，要么把几 GB 中间产物一起搬。
import { readdirSync, statSync } from "fs";
import { join, extname } from "path";

const ROOT = "C:\\aitrpg";

interface Item { path: string; size: number; kind: string }
const items: Item[] = [];

function classify(p: string, name: string): string {
  const rel = p.replace(ROOT + "\\", "");
  const ext = extname(name).toLowerCase();
  if ([".pdf", ".docx", ".xlsx", ".epub", ".mobi"].includes(ext)) return "源材料";
  if (/来源|原著|raw|source/i.test(rel) && [".txt", ".json"].includes(ext)) return "源材料";

  // ⚠ 判据补过一次：原先 .txt 只有落在 来源/原著/raw 路径下才算源材料，
  // 于是「世界模型」根目录下那些**小说全文** txt（每份 15~18MB）被扔进「其它」，
  // 而它们正是整条抽取链的根 —— 章节切片、实体索引、v18 主档全从它们来。
  //
  // 判据：直接躺在 世界模型\ 下、且够大（>1MB）的 .txt = 小说全文。
  // 按章切分的产物在 chapters_* / extracted_* 子目录里，不会命中这一条。
  const depth = rel.split("\\").length;
  if (ext === ".txt" && depth === 2 && rel.startsWith("世界模型\\")) return "源材料";
  if ([".yaml", ".yml", ".md"].includes(ext)) return "手写设计";
  if (rel.includes("_output") || rel.includes("_extracted")) return "抽取产物";
  if (ext === ".jsonl") return "抽取产物";
  if ([".mjs", ".cjs", ".js", ".ts"].includes(ext)) return "脚本";
  if (/\.bak\d*|_bak|_before_/.test(name)) return "备份残留";
  return "其它";
}

function walk(dir: string, depth = 0) {
  if (depth > 6) return;
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (["node_modules", ".git", "dist"].includes(n)) continue;
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, depth + 1);
    else items.push({ path: p, size: st.size, kind: classify(p, n) });
  }
}

for (const n of readdirSync(ROOT)) {
  if (n === "poc") continue;
  const p = join(ROOT, n);
  try {
    if (statSync(p).isDirectory()) walk(p);
    else items.push({ path: p, size: statSync(p).size, kind: classify(p, n) });
  } catch { /* ignore */ }
}

const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
const byKind = new Map<string, { n: number; size: number }>();
for (const it of items) {
  const cur = byKind.get(it.kind) ?? { n: 0, size: 0 };
  cur.n++; cur.size += it.size;
  byKind.set(it.kind, cur);
}

const RECOVERY: Record<string, string> = {
  "源材料": "**找不回来** — 外部来源，未必还能拿到",
  "手写设计": "**找不回来** — 人写的",
  "脚本": "**找不回来** — 除非 poc 里有副本",
  "抽取产物": "能重跑（前提是源材料 + 脚本都在）",
  "备份残留": "本身就是旧副本，不必再备",
  "其它": "看情况",
};

const out: string[] = ["# 备份分层：什么丢了就没了", ""];
out.push("范围：`C:\\aitrpg` 除 `poc/`（有远端）之外的全部。");
out.push("");
out.push("| 类别 | 文件数 | 大小 (MB) | 丢了怎么办 |");
out.push("|---|---|---|---|");
for (const [k, v] of [...byKind.entries()].sort((a, b) => b[1].size - a[1].size)) {
  out.push(`| ${k} | ${v.n} | ${mb(v.size)} | ${RECOVERY[k] ?? ""} |`);
}

const CRITICAL = ["源材料", "手写设计", "脚本"];
const crit = items.filter((i) => CRITICAL.includes(i.kind));
const critSize = crit.reduce((a, b) => a + b.size, 0);
out.push("");
out.push(`**不可再生合计：${crit.length} 个文件 / ${mb(critSize)} MB**`);
out.push("");
out.push("按大小排前 25 个：");
out.push("");
for (const it of crit.sort((a, b) => b.size - a.size).slice(0, 25)) {
  out.push(`- \`${it.path.replace(ROOT + "\\", "")}\`  ${mb(it.size)} MB  [${it.kind}]`);
}
out.push("");
out.push("最大的抽取产物（能重跑，但要时间）：");
out.push("");
for (const it of items.filter((i) => i.kind === "抽取产物").sort((a, b) => b.size - a.size).slice(0, 8)) {
  out.push(`- \`${it.path.replace(ROOT + "\\", "")}\`  ${mb(it.size)} MB`);
}

await Bun.write("tools/audit-backup.md", out.join("\n") + "\n");
console.log(`不可再生 ${crit.length} 个 / ${mb(critSize)} MB  -> tools/audit-backup.md`);
```

## scripts/preflight.ts

```ts
// 改动前后各跑一次的自检。把我反复犯的几类错做成机器判据，别靠记性。
//
// 用法：
//   bun scripts/preflight.ts            全查
//   bun scripts/preflight.ts --quick    只查快的（跳过测试）
//
// 背景：一轮里连着犯了五次同类失误（机械切割截断语义单元、假绿测试、
// 判据写错），每次都要一个来回才发现。能变成检查项的就别留给注意力。

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const quick = process.argv.includes("--quick");
const problems: string[] = [];
const notes: string[] = [];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const srcFiles = walk("src");

// ── 1. 切割残渣：文档注释紧跟着**语句**（而不是声明） ──
//
// 机械切割最常见的后果：注释块留下、函数头被搬走，于是 `*/` 下面直接是
// 函数体的第一条语句。
//
// ⚠ 判据必须收窄。第一版写成「下一行不是声明就报警」，
// 结果 174 个假阳性 —— 接口字段、对象属性、switch case、联合类型的续行
// 全被算进去了，真问题（2 个）被淹没。判据没验就上，正是这轮反复犯的错。
//
// 现在只认最确定的一种：`*/` 紧跟 `return` / 赋值 / `await`，
// 那在文档注释后面出现几乎必然是切歪了。
const CUT_SIGNS = /^(return\b|await\b|const \w+ = (await )?\w+\(|\w+ = )/;
for (const f of srcFiles) {
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== "*/") continue;
    const next = (lines[i + 1] ?? "").trim();
    if (CUT_SIGNS.test(next)) {
      problems.push(`${f}:${i + 2}  文档注释后面直接是语句 —— 切割可能截断了函数头`);
    }
  }
}

// ── 2. 搬运残渣：同一句占位注释出现多次 ──
const PLACEHOLDER = /已抽到 src\/play\/[\w-]+\.ts（纯搬运/;
for (const f of srcFiles) {
  const lines = readFileSync(f, "utf8").split("\n");
  const hits = lines.map((l, i) => (PLACEHOLDER.test(l) ? i + 1 : 0)).filter(Boolean);
  if (hits.length > 1) {
    problems.push(`${f}  搬运占位注释残留 ${hits.length} 处（L${hits.join(", L")}）`);
  }
}

// ── 3. 循环依赖：src/play/* 反向 import play-module ──
// 抽出来的模块反向 import 原文件就是环。tsc 不报，得自己看。
for (const f of srcFiles.filter((p) => p.includes("play") && !p.endsWith("play-module.ts"))) {
  const t = readFileSync(f, "utf8");
  if (/from\s+["']\.\.\/play-module["']/.test(t)) {
    problems.push(`${f}  反向 import play-module —— 成环，把需要的东西也抽出来`);
  }
}

// ── 4. 中文过 PowerShell：脚本里不该用 Select-String 读源码 ──
// 排除本文件 —— 它是那个检查器，提到这两个词是判据本身。
// 只认**真调用**（spawnSync / 反引号命令串里出现），不认文案里提到这两个词 ——
// 否则连「警告不要用它」的文字本身都会被报，判据自己咬自己。
for (const f of walk("scripts")) {
  if (f.endsWith("preflight.ts")) continue;
  const t = readFileSync(f, "utf8");
  const realCall = /spawnSync\([^)]*(Select-String|Get-Content)|["'`][^"'`]*\|\s*(Select-String|Get-Content)/;
  if (realCall.test(t)) {
    notes.push(`${f}  真的在调 Select-String/Get-Content —— 读中文源码会 mojibake，用 fs.readFileSync`);
  }
}

// ── 5. typecheck ──
const tsc = spawnSync("bun", ["run", "typecheck"], { encoding: "utf8", shell: true });
const tsErrors = (tsc.stdout + tsc.stderr).split("\n").filter((l) => /error TS/.test(l));
if (tsErrors.length) {
  const syntax = tsErrors.filter((l) => /TS1\d{3}/.test(l));
  problems.push(`typecheck 报 ${tsErrors.length} 个错`);
  if (syntax.length) {
    problems.push(`  其中 ${syntax.length} 个是**语法错** —— 通常意味着切歪了，不是缺 import`);
  }
  for (const e of tsErrors.slice(0, 5)) problems.push("  " + e.trim());
}

// ── 6. 测试条数（只有条数是可靠回归信号） ──
if (!quick) {
  const t = spawnSync("bun", ["test"], { encoding: "utf8", shell: true });
  const ran = (t.stdout + t.stderr).match(/Ran (\d+) tests/);
  const failed = (t.stdout + t.stderr).match(/(\d+) fail/);
  if (ran) notes.push(`测试 ${ran[1]} 条`);
  if (failed && failed[1] !== "0") problems.push(`测试有 ${failed[1]} 条失败`);
}

// ── 输出 ──
console.log(problems.length === 0 ? "✓ preflight 通过" : `✗ preflight 发现 ${problems.length} 个问题`);
for (const p of problems) console.log("  " + p);
if (notes.length) {
  console.log("");
  for (const n of notes) console.log("  · " + n);
}
process.exit(problems.length ? 1 : 0);
```

======================================================================
# 附：最近一次产物（供对照）
======================================================================

## tools/diag-phrasing.md

```
# 玩家说的话，引擎认不认

拿模组里每个多出口场景 × 每个出口 × 8 种说法，看能不能匹配到玩家想去的地方。

| 说法 | 命中 | 总数 | 命中率 |
|---|---|---|---|
| 照抄选项原文 | 38 | 38 | 100% |
| 只说地名 | 38 | 38 | 100% |
| 「去」+地名 | 38 | 38 | 100% |
| 「我们去」+地名 | 38 | 38 | 100% |
| 「前往」+地名 | 38 | 38 | 100% |
| 地名+「那边」 | 38 | 38 | 100% |
| 带犹豫的口语 | 38 | 38 | 100% |
| 地名在句中 | 38 | 38 | 100% |
| 只说地名前两字 | 1 | 38 | 3% |
| 同义改写（不含原名） | 0 | 38 | 0% |
| 代词指代 | 0 | 38 | 0% |
| 描述目的地特征 | 0 | 38 | 0% |

**合计 305/456 = 66.9%**

没命中的例子：

  想去「加比的拖车房」说的是「去加比」→ **被替选**到「加比的拖车房」
  想去「加比的拖车房」说的是「换个地方看看」→ **被替选**到「加比的拖车房」
  想去「加比的拖车房」说的是「去那边」→ **被替选**到「加比的拖车房」
  想去「加比的拖车房」说的是「去那个有灯光的房间」→ **被替选**到「加比的拖车房」
  想去「普瑞米尔」说的是「去普瑞」→ **被替选**到「加比的拖车房」
  想去「普瑞米尔」说的是「换个地方看看」→ **被替选**到「加比的拖车房」
  想去「普瑞米尔」说的是「去那边」→ **被替选**到「加比的拖车房」
  想去「普瑞米尔」说的是「去那个有灯光的房间」→ **被替选**到「加比的拖车房」
  想去「特里坎家」说的是「去特里」→ **被替选**到「特里坎家」
  想去「特里坎家」说的是「换个地方看看」→ **被替选**到「特里坎家」
  想去「特里坎家」说的是「去那边」→ **被替选**到「特里坎家」
  想去「特里坎家」说的是「去那个有灯光的房间」→ **被替选**到「特里坎家」
  想去「维森酒吧」说的是「去维森」→ **被替选**到「特里坎家」
  想去「维森酒吧」说的是「换个地方看看」→ **被替选**到「特里坎家」
  想去「维森酒吧」说的是「去那边」→ **被替选**到「特里坎家」
  想去「维森酒吧」说的是「去那个有灯光的房间」→ **被替选**到「特里坎家」
  想去「警察局」说的是「去警察」→ **被替选**到「特里坎家」
```

## tools/diag-downed.txt

```
25 局：出现昏迷 12 局，两人同时倒下 1 局，走「调查中止」1 局
急救唤醒成功 5 次

倒着的人自己掷骰（违规）：0 次

✓ 昏迷期间不再行动
```

## tools/diag-wounds.txt

```
30 局：伤害事件 98 次，重伤体质检定 17 次，惩罚骰播报 88 次，解除 1 次
✓ 不变量：没有一次重伤体质检定被它自己那处伤罚到

按引擎判定的伤势分档：
  <25%     35
  25-49%   35
  ≥50%     14
  ≥75%     0

伤害明细（前 30 条）：
  #1 HP 10→6 掉4 轻伤
  #1 HP 6→2 掉4 轻伤
  #1 HP 2→0 掉2 昏迷/濒死！
  #2 HP 10→7 掉3 轻伤
  #2 HP 10→6 掉4 轻伤
  #2 HP 6→2 掉4 轻伤
  #3 HP 10→9 掉1 (无标签)
  #3 HP 10→5 掉5 重伤
  #3 HP 9→8 掉1 (无标签)
  #4 HP 12→10 掉2 (无标签)
  #4 HP 10→9 掉1 (无标签)
  #5 HP 11→6 掉5 轻伤
  #5 HP 6→2 掉4 轻伤
  #5 HP 2→0 掉2 昏迷/濒死！
  #7 HP 9→5 掉4 轻伤
  #7 HP 5→3 掉2 (无标签)
  #7 HP 3→2 掉1 (无标签)
  #8 HP 11→10 掉1 (无标签)
  #8 HP 10→7 掉3 轻伤
  #8 HP 7→5 掉2 (无标签)
  #8 HP 13→10 掉3 (无标签)
  #9 HP 12→7 掉5 轻伤
  #9 HP 7→5 掉2 (无标签)
  #9 HP 5→3 掉2 (无标签)
  #9 HP 10→4 掉6 重伤
  #10 HP 10→5 掉5 重伤
  #10 HP 11→9 掉2 (无标签)
  #10 HP 9→7 掉2 (无标签)
  #10 HP 7→3 掉4 轻伤
  #10 HP 5→0 掉5 昏迷/濒死！
```

## tools/diag-combat.txt

```
12 局：发生战斗 9 局，其中击退 3 局
调查员攻击掷骰 75 次，疲劳惩罚骰播报 8 次
玩家 HP 变化 40 次（含陷阱）

敌人还手：
  敌人挥击 46 次，玩家闪避掷骰 27 次
  战斗中造成 HP 变化 20 次，打昏 2 次
  ✓ 敌人会还手了
```

## tools/audit-backup.md

```
# 备份分层：什么丢了就没了

范围：`C:\aitrpg` 除 `poc/`（有远端）之外的全部。

| 类别 | 文件数 | 大小 (MB) | 丢了怎么办 |
|---|---|---|---|
| 抽取产物 | 858 | 2590.6 | 能重跑（前提是源材料 + 脚本都在） |
| 其它 | 97519 | 601.4 | 看情况 |
| 源材料 | 111 | 474.4 | **找不回来** — 外部来源，未必还能拿到 |
| 手写设计 | 901 | 12.0 | **找不回来** — 人写的 |
| 脚本 | 121 | 2.5 | **找不回来** — 除非 poc 里有副本 |
| 备份残留 | 6 | 0.3 | 本身就是旧副本，不必再备 |

**不可再生合计：1133 个文件 / 488.9 MB**

按大小排前 25 个：

- `世界模型\黎明之剑.txt`  18.2 MB  [源材料]
- `世界模型\《战神领主》【爱上阅读_www.isyd.net】.txt`  16.8 MB  [源材料]
- `世界模型\异常生物见闻录_远瞳.txt`  15.7 MB  [源材料]
- `世界模型\《英雄信条》【爱上阅读_www.isyd.net】.txt`  15.6 MB  [源材料]
- `世界模型\末法王座-庄毕凡.txt`  14.8 MB  [源材料]
- `世界模型\《异界全职业大师》【爱上阅读_www.isyd.net】.txt`  13.9 MB  [源材料]
- `世界模型\Éñ¼¶Ìì¸³.txt`  11.9 MB  [源材料]
- `世界模型\《召唤圣剑》作者：西贝猫.txt`  11.9 MB  [源材料]
- `世界模型\《琥珀之剑》（校对版全本）作者：绯炎.txt`  11.2 MB  [源材料]
- `世界模型\琥珀之剑.txt`  11.1 MB  [源材料]
- `世界模型\《网游之帝皇崛起》（校对版全本）作者：坠落凡尘.txt`  11.0 MB  [源材料]
- `世界模型\《巫师之旅》作者：一行白鹭上青天.txt`  10.6 MB  [源材料]
- `世界模型\永恒国度.txt`  10.4 MB  [源材料]
- `世界模型\黎明之剑.epub`  10.2 MB  [源材料]
- `世界模型\《惊悚乐园》（校对版全本+番外）作者：三天两觉.txt`  9.8 MB  [源材料]
- `世界模型\秦吏.txt`  9.8 MB  [源材料]
- `世界模型\《奥术神座》（精校版全本+番外）作者：爱潜水的乌贼.txt`  9.5 MB  [源材料]
- `世界模型\疯巫妖_utf8.txt`  9.4 MB  [源材料]
- `世界模型\《巨龙王座》（校对版全本）作者：焰闪.txt`  9.0 MB  [源材料]
- `世界模型\《奥术起源》（校对版全本）作者：永夜骑士.txt`  9.0 MB  [源材料]
- `世界模型\网游之射破苍穹_龙大人.txt`  8.5 MB  [源材料]
- `世界模型\《绝对暴力》【爱上阅读_www.isyd.net】.txt`  8.0 MB  [源材料]
- `世界模型\末法王座-庄毕凡.epub`  7.7 MB  [源材料]
```
