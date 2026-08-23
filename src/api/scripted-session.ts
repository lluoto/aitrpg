/**
 * 剧本杀会话 —— 把 play-module 的剧本引擎接成外部可驱动的一局。
 *
 * 引擎本身是一条从头跑到尾的协程：它播报、遇到岔口时调决策器、拿到决定后继续。
 * 这里做的事只有两件：把播报收进缓冲区，以及在决策点把协程挂起，
 * 等外部提交决定后再放行。剧本逻辑一行不改。
 *
 * 与自由跑团（GameSession）并列，互不共享状态：那边是 KP 即兴生成，
 * 这边是线索门禁 + 多结局，两套规则混在一起只会互相污染。
 */

import { runModule, type LineOrigin } from "../play-module";
import { BARN_OF_PREMIER, BARN_SUPPORT } from "../module/barn-of-premier";
import { voiceKey } from "../voice/speech-plan";
import type { PlayerDecision } from "../agent/player-agent";

/** 引擎停在岔口时对外暴露的东西 */
interface PendingChoice {
  /** 当前处境：场景、在场的人、已知线索、调查进度 */
  context: string;
  /** 可选行动的文字标签，提交时原样回传 */
  options: string[];
}

interface ScriptedSnapshot {
  id: string;
  /** 自上次拉取之后新增的播报行 */
  lines: string[];
  /**
   * 与 lines 逐项对应的预制音频键。有值表示该行有离线合成好的音频可直接放，
   * 文件名就是这个键；null 表示该行经过 LLM（须实时合成）或属机制文本（不念）。
   *
   * 判据来自引擎在出文那一刻记下的来源，不是在这里按文本长相猜的 ——
   * 见 docs/voice-readiness.md 第七节。
   */
  voiceKeys: (string | null)[];
  /** 停在岔口时有值；为空表示引擎仍在推进或已结束 */
  pending: PendingChoice | null;
  finished: boolean;
  /** 累计播报行数，用于前端判断是否漏读 */
  total: number;
}

export class ScriptedSession {
  readonly id: string;
  private lines: string[] = [];
  /** 与 lines 逐项对应，同进同出 */
  private origins: LineOrigin[] = [];
  /** 已被拉走的行数；只发增量，避免每次把整局重传一遍 */
  private cursor = 0;
  private pending: (PendingChoice & { resolve: (d: PlayerDecision) => void }) | null = null;
  private finished = false;
  private failure: string | null = null;

  constructor(id: string) {
    this.id = id;
  }

  /**
   * 开跑。不 await —— 引擎会一直跑到第一个岔口才停，
   * 这里立刻返回，由调用方轮询拿播报。
   */
  start(): void {
    runModule(BARN_OF_PREMIER, BARN_SUPPORT, {
      onLine: (line, origin) => { this.lines.push(line); this.origins.push(origin); },
      decide: (context, options) => this.park(context, options),
    })
      .then(() => { this.finished = true; })
      .catch((err: unknown) => {
        // 引擎抛错要让外部看见，不能只留一个永远不结束的会话
        this.failure = err instanceof Error ? err.message : String(err);
        this.finished = true;
      });
  }

  /** 在岔口挂起，等 submit() 放行 */
  private park(context: string, options: string[]): Promise<PlayerDecision> {
    return new Promise<PlayerDecision>((resolve) => {
      this.pending = { context, options, resolve };
    });
  }

  /** 拉取增量播报与当前岔口 */
  poll(): ScriptedSnapshot {
    const lines = this.lines.slice(this.cursor);
    const origins = this.origins.slice(this.cursor);
    this.cursor = this.lines.length;
    return {
      id: this.id,
      lines,
      // 键只由文本内容决定，与 gen-speech 烘出来的文件名同一口径
      voiceKeys: origins.map((o, i) => (o === "verbatim" ? voiceKey(lines[i]) : null)),
      pending: this.pending ? { context: this.pending.context, options: this.pending.options } : null,
      finished: this.finished,
      total: this.lines.length,
    };
  }

  /**
   * 提交决定。
   *
   * 选项标签原样回传即可：引擎是拿 action 文本去匹配连接条件的
   * （取条件前 8 字做包含判断），标签本身必然命中。
   */
  submit(option: string): { ok: true } | { ok: false; error: string } {
    const p = this.pending;
    if (!p) return { ok: false, error: "当前没有待决策的岔口" };
    if (!p.options.includes(option)) {
      return { ok: false, error: `不是可选项: ${option}` };
    }
    this.pending = null;
    p.resolve({ action: option, intent: "move" });
    return { ok: true };
  }

  get error(): string | null {
    return this.failure;
  }
}

const sessions = new Map<string, ScriptedSession>();

export function createScriptedSession(): ScriptedSession {
  const id = `sc_${Math.random().toString(36).slice(2, 10)}`;
  const session = new ScriptedSession(id);
  sessions.set(id, session);
  session.start();
  return session;
}

export function getScriptedSession(id: string): ScriptedSession | undefined {
  return sessions.get(id);
}
