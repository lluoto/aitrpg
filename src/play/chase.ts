// 敌人逃跑之后：要不要追、追不追得上。
//
// ⚠ `src/rules/coc-chase.ts` 731 行、CoC 7e 的整套追逐规则（抽象距离 + 障碍表 +
//   射程段 + 载具），写完之后**在依赖图上只有测试引用** —— 玩起来根本没有追逐。
//   战斗里敌人受伤过半会逃走，而逃走那一支只印一句「撞破通风管道独自逃走了」就完了。
//   规则在，缺陷也在，只是两者从没接上。这个文件是接口。
//
// 分层同 `ruleset.ts`：规则层（coc-chase）不认识播报、世界状态、PC；
// 这里负责把 PC 翻译成参与者、把结果翻译成播报。

import { ChaseEngine, type ChaseEnvironment, type ChaseState } from "../rules/coc-chase";
import { say } from "./narration";
import { emit } from "./narration";

/** 追逐的收场 */
export interface ChaseOutcome {
  /** 追上了 */
  caught: boolean;
  /** 跑了 */
  escaped: boolean;
  /** 打了几轮 */
  rounds: number;
}

/** 参与追逐的调查员 —— 只要名字和两项属性，不把整个 PC 类型拖进规则层 */
export interface Chaser {
  name: string;
  con: number;
  dex: number;
  /** 相关技能值（没有就按 CON 走，规则层自己会退） */
  skill?: number;
}

/**
 * 场景描述 → 追逐环境。
 *
 * 认不出来就回 `urban`，不猜：障碍表按环境查，猜错了会把「下水道」的
 * 障碍发到麦田里。回退到最常见的一种，比按关键词硬凑可靠。
 */
export function environmentFromScene(sceneName: string, sceneDesc: string): ChaseEnvironment {
  const t = `${sceneName}${sceneDesc}`;
  if (/地下|隧道|下水道|洞穴|地窖|矿/.test(t)) return "underground";
  if (/室内|走廊|大厅|屋内|房间|谷仓|仓库/.test(t)) return "indoor";
  if (/森林|密林|沼泽|荒野|山[林中]/.test(t)) return "wilderness";
  if (/河|湖|码头|船|水下/.test(t)) return "water";
  if (/农[场田]|田野|乡[间村]|小路/.test(t)) return "rural";
  return "urban";
}

/**
 * 跑一场追逐，边跑边播报。
 *
 * `maxRounds` 是硬闸：`resolveRound` 理论上会收敛到追上或逃脱，
 * 但一个不收敛的规则实现会把主循环挂死 —— 上限比死锁好查。
 */
export function runChase(
  chasers: readonly Chaser[],
  fugitive: { name: string; con: number; dex: number; skill?: number },
  environment: ChaseEnvironment,
  startDistance = 15,
  maxRounds = 8,
): ChaseOutcome {
  if (chasers.length === 0) return { caught: false, escaped: true, rounds: 0 };

  const state: ChaseState = ChaseEngine.init(
    chasers.map((c) => ({
      name: c.name, con: c.con, dex: c.dex,
      skill: c.skill ?? c.con, vehicleType: "foot" as const,
    })),
    [{
      name: fugitive.name, con: fugitive.con, dex: fugitive.dex,
      skill: fugitive.skill ?? fugitive.con, vehicleType: "foot" as const,
    }],
    environment,
    startDistance,
  );

  emit({ type: "chase-start", fugitive: fugitive.name, environment, distance: startDistance });

  let rounds = 0;
  for (; rounds < maxRounds; rounds++) {
    const r = ChaseEngine.resolveRound(state);
    for (const line of r.narration) say(`\n${line}`, "verbatim");
    if (r.caught || r.escaped) {
      emit({
        type: "chase-end", fugitive: fugitive.name,
        result: r.caught ? "caught" : "escaped", rounds: rounds + 1,
      });
      return { caught: r.caught, escaped: r.escaped, rounds: rounds + 1 };
    }
  }
  // 到上限还没分出胜负 —— 按跑掉算，并且**说出来**是怎么收的场，
  // 不要让「规则没收敛」伪装成「它跑掉了」。
  emit({ type: "chase-end", fugitive: fugitive.name, result: "timeout", rounds });
  return { caught: false, escaped: true, rounds };
}
