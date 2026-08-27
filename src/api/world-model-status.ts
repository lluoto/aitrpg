// 世界模型加载状态 — 供 /api/config 暴露的机器可判定出口
//
// 事故背景：世界模型目录被搬到了另一个盘，默认路径是相对进程 CWD 的
// "../世界模型/..."。world-model-loader.ts 里文件找不到时只是
// `log.warn(...)` 后 return——按 log.ts 自己的分类，降级继续跑本来就该是
// warn，级别没错，但一条 warn 滚过日志里没人看见，那一整局叙述质量相关的
// 观察全部作废，没有任何人发现。
//
// 修法不是改日志级别，是给它一个可被程序断言的出口——GET /api/config 已经
// 有同类先例（llm.hasKey，一个"真 key 配没配"的布尔量），这里加对称的一项。
//
// 抽成独立模块（而不是直接写在 server.ts 的路由里）是为了可测：server.ts
// 导入即执行 Bun.serve()，本仓所有测试都刻意不起一个真实的 Bun.serve 实例
// （entity-id-consolidation.test.ts 的注释也是这么说的）。这个函数不依赖
// server.ts，可以被单测直接调用，也是 /api/config 实际调用的同一份代码——
// 不是另开一条会漂移的平行实现。
//
// ⚠ exists 与 loaded 分工不同，不要混用：
//   · exists — 文件此刻在不在磁盘上（existsSync，廉价）。回答的是「事前
//     门禁」：需要时能不能加载成功。适合在服务启动、健康检查这类还没建
//     会话的时刻问。
//   · loaded — 世界模型这一次进程里是否**已经**读进内存。这是**懒加载**
//     的运行时状态（见 game-session.ts:591「懒加载：首次注入时才加载世界
//     模型」）——开跑前查它必然是 false，拿它当事前门禁是先有鸡还是先有
//     蛋。它只适合当**事后观测**：开跑几回合、建过会话之后，loaded 应该
//     翻成 true，用来证明真的载入了，不只是文件存在。
//   两者都为 true 才说明「文件在 + 已经加载」；exists:true 但 loaded:false
//   完全正常（还没到加载的时候），不是 bug，也不该被当成 bug 报出来。

import { existsSync } from "fs";
import { sharedWorldModel, DEFAULT_V18_PATH, DEFAULT_CTHULHU_PATH } from "../world/world-model-loader";

export interface WorldModelStatus {
  worldModel: { path: string; exists: boolean; loaded: boolean; entryCount: number };
  cthulhuModel: { path: string; exists: boolean; loaded: boolean };
}

/**
 * 读世界模型 loader 的当前状态，不触发加载。
 *
 * ⚠ 世界模型 229MB、加载约 1.2s，/api/config 必须保持廉价——这里只读
 * `sharedWorldModel(path)` 返回的既有实例状态（`isLoaded()` / `getStats()`）
 * 与 `existsSync(path)`，不调用 `.load()`。没加载就如实报 `loaded: false`，
 * 不要顺手加载一次。
 *
 * 路径参数默认取进程级配置（WORLD_MODEL_PATH/CTHULHU_MODEL_PATH 环境变量
 * 或内置默认值），可选参数只为测试注入不同路径，不改变 /api/config 的
 * 真实调用方式（真实调用永远用默认值）。
 */
export function worldModelStatus(
  v18Path: string = DEFAULT_V18_PATH,
  cthulhuPath: string = DEFAULT_CTHULHU_PATH,
): WorldModelStatus {
  const wm = sharedWorldModel(v18Path);
  const cth = sharedWorldModel(cthulhuPath);
  return {
    worldModel: { path: v18Path, exists: existsSync(v18Path), loaded: wm.isLoaded(), entryCount: wm.getStats().total },
    cthulhuModel: { path: cthulhuPath, exists: existsSync(cthulhuPath), loaded: cth.isLoaded() },
  };
}
