// 「同场景多条线索的 matchTexts 互相撞车」判据——开发·把已有判据补齐
// 到手写侧 N8。
//
// 背景：learn-gate（`src/ingest/narrative-guard.ts` 的
// `evaluateObjectMentionClaims`）对生成端提议的新别名跑三条确定性
// 条件，其中条件 b（加入候选池后 decideClueMatch 必须唯一命中目标
// 线索）只在"生成一条新别名"这个时刻检查一次——`barn-of-premier.ts`
// 里手写的 matchTexts 从没有经过它。N7 给维森酒吧三条线索手工补
// matchTexts 时就踩了这个空子：「前台」同时写进了 clue_bar_mass_
// booking 与 clue_bar_guest_identity 两条线索，「问前台贵客的身份」
// 这类自然语句因此落进 ask（歧义回问）而不是唯一命中。
//
// 这份判据不区分别名的来源（生成的/手写的），只要一条 matchTexts 进了
// 场景数据，就该满足 learn-gate 同一条条件 b——复用
// `resolvesUniquelyTo`（narrative-guard.ts），不重新判定一次。

import type { Scene } from "../module/types";
import { resolvesUniquelyTo } from "../ingest/narrative-guard";
import { decideClueMatch, type ClueMatchCandidate } from "./clue-match";

export interface MatchTextCollision {
  sceneId: string;
  sceneName: string;
  /** 撞车的那一条别名本身 */
  phrase: string;
  /** 这条别名登记在哪条线索的 matchTexts 里 */
  clueId: string;
  /** decideClueMatch(phrase) 在本场景实际命中/牵涉到的其它线索 id */
  collidesWith: string[];
}

/** 场景的线索列表 → decideClueMatch 要的候选形状，与 narrative-guard.ts 的 clueCandidatesForScene 同一套字段来源，就地组装避免多一层间接 import 循环。 */
function candidatesForScene(scene: Scene): ClueMatchCandidate[] {
  return scene.clues.map((c) => ({
    id: c.id,
    texts: [c.name, ...c.findMethods.map((f) => f.description), ...(c.matchTexts ?? [])],
  }));
}

/**
 * 扫描给定场景列表，找出「一条 matchTexts 别名加入候选池后，
 * decideClueMatch 没能唯一命中它登记所在的那条线索」的全部实例——
 * 不管这条别名的来源是手写数据还是摄取管线学会的，判据一视同仁。
 *
 * 用的是场景数据里**已经提交**的完整候选文本（不是"加了这条别名之后
 * 才第一次出现"的候选池）——这与 `evaluateObjectMentionClaims` 评估
 * "要不要接纳一条新声明"时的候选池含义不同（那边要排除当前正在评估
 * 的这条声明本身，模拟"加入前/加入后"的对比）；这里评估的是"已经
 * 写进数据的别名，现在还站不站得住"，直接用完整候选池跑一次
 * `decideClueMatch` 就是这条别名此刻的真实命中结果。
 */
export function findMatchTextCollisions(scenes: Scene[]): MatchTextCollision[] {
  const collisions: MatchTextCollision[] = [];

  for (const scene of scenes) {
    const candidates = candidatesForScene(scene);
    for (const clue of scene.clues) {
      for (const phrase of clue.matchTexts ?? []) {
        if (resolvesUniquelyTo(phrase, clue.id, candidates)) continue;
        const decision = decideClueMatch(phrase, candidates);
        const collidesWith =
          decision.kind === "ask" ? decision.clueIds.filter((id) => id !== clue.id) : [];
        collisions.push({
          sceneId: scene.id,
          sceneName: scene.name,
          phrase,
          clueId: clue.id,
          collidesWith,
        });
      }
    }
  }
  return collisions;
}
