import { type MythosModule } from "../mythos-module";
import { BARN_OF_PREMIER } from "../../module/barn-of-premier";
import { deriveMythosModule } from "../../module/unified-module";

// 步骤 5B：这是兼容旧导出路径的薄适配，不再维护第二份谷仓事实。
// GameSession 和现有 registry 仍 import MODULE_PREMIERS_BARN；其值完全由
// BARN_OF_PREMIER.runtime 与叙事 NPC 的 runtime 嵌套确定性派生。
export const MODULE_PREMIERS_BARN: MythosModule = deriveMythosModule(BARN_OF_PREMIER);

/** 模组注册信息 */
export const MODULE_REGISTRY: Array<{ id: string; name: string; module: MythosModule }> = [
  { id: "premiers_barn", name: "普瑞米尔的谷仓", module: MODULE_PREMIERS_BARN },
];
