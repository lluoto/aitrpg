// 一局的可变状态，按「谁在写它」分组。
//
// 起因是拆 play-module：`runModuleInner` 一个闭包里平铺着六类互不相干的状态
// （模组配置 / 角色 / 世界 / 世界模型缓存 / 叙事去重 / 循环游标），
// 于是任何一块想抽出去，参数列表都会横跨好几类 —— 陷阱那块抽出来传了 11 个散参数。
//
// 分组不是为了把参数变少，是为了让**每个参数都是一个完整概念**。
// 收成一个大 bag 会把依赖重新藏起来，那正是抽出闭包要消除的东西：
// 一个函数拿到 `cast` 就说明它会碰角色，拿到 `cursor` 就说明它参与循环推进。
//
// 这里先只收 cast 与 cursor 两类 —— 边界最清楚，且可立刻验证（陷阱参数 11 → 4）。
// 世界模型缓存与叙事去重留在闭包里，等各自的使用方抽出去时再一并处理。

import type { CoCGeneratedCharacter } from "../character/coc-character";
import type { SanityEngine } from "../rules/coc-engine";

/**
 * 本局的两名调查员。
 *
 * 三样东西一一对应且必须同进同出：显示名（p0/p1）、角色卡（c1/c2）、SAN 引擎（san1/san2）。
 * 散着传最容易出的错就是错位 —— 拿 p0 的名字配 c2 的角色卡，
 * 日志上看不出来（名字是对的），但掉的是另一个人的血。
 */
export interface Cast {
  p0: { shortName: string };
  p1: { shortName: string };
  c1: CoCGeneratedCharacter;
  c2: CoCGeneratedCharacter;
  san1: SanityEngine;
  san2: SanityEngine;
}

/**
 * 跨场景的循环游标。
 *
 * ⚠ 这些看着像局部变量，实际是**主循环的不变量**，散在闭包里出过事：
 * `arrivedByPlayerChoice` 就是「静默传送」那个 bug 的所在
 * —— 玩家选定的目的地在到达后被访问次数规则弹走，而没有任何播报。
 * 收成显式契约之后，谁读谁写一目了然。
 */
export interface Cursor {
  /** 主循环轮次，上限见 runModuleInner */
  rounds: number;
  /**
   * 轮流让哪名调查员出手。
   *
   * **线索检定与陷阱共享它** —— 线索那边 `stepCounter++`，陷阱这边只读它决定谁踩中。
   * 这层共享原先埋在闭包里看不出来。另外它还兼任「开局第 0 步不触发陷阱」的哨兵。
   */
  stepCounter: number;
  /** 本局已经响过的陷阱 id，跨进场累积 */
  triggeredTraps: Set<string>;
  /** 主循环是否该收尾 */
  done: boolean;
  /** 这次进场是不是玩家自己选的目的地 —— 是就别再替他改道 */
  arrivedByPlayerChoice: boolean;
}

/** 建一份初始游标 */
export function newCursor(): Cursor {
  return {
    rounds: 0,
    stepCounter: 0,
    triggeredTraps: new Set<string>(),
    done: false,
    arrivedByPlayerChoice: false,
  };
}
