/**
 * 自定义模组索引
 * ==============
 *
 * 从 PDF 提取的模组在此注册，供 GameSession 动态加载。
 *
 * 添加新模组：
 *   1. 运行 extract-module.ts 提取模组
 *   2. 在此文件导入并注册
 *
 * 用法：
 *   import { getModule } from "./custom-modules/index";
 *   const module = getModule("premiers_barn");
 */

import type { MythosModule } from "../mythos-module";
import { MODULE_REGISTRY as PREMIERS_BARN_REGISTRY } from "./premiers_barn";

// ── 模组注册表 ──
// 所有已提取的社区模组在此注册
const _moduleMap = new Map<string, { name: string; module: MythosModule }>();

function register(entries: Array<{ id: string; name: string; module: MythosModule }>) {
  for (const entry of entries) {
    _moduleMap.set(entry.id, entry);
  }
}

// 注册所有已提取的模组
register(PREMIERS_BARN_REGISTRY);

// ── 公开接口 ──

/** 按 ID 获取模组 */
export function getModule(id: string): { name: string; module: MythosModule } | undefined {
  return _moduleMap.get(id);
}
