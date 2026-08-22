// 诊断产物往哪写。
//
// 两件事值得单独放一个文件：
//
// 1. **目录得先存在**。`Bun.write` 会自己建目录，但产物落在哪儿这件事
//    散在六个脚本里各写一遍字符串，改一次要改六处 —— 改漏一处就出现
//    「跑了但没产物」，而脚本本身照样退出 0。
//
// 2. **产物不入库**。`analysis/` 在 .gitignore 里，这是有意的：
//    诊断产物是每次跑出来的快照，不是源码。判据（`src/diagnostics/`）
//    和跑局脚本（`scripts/diag/`）入库，**产物不入库**。
//    上一版把产物写进 `tools/`，而整个 `tools/` 是 ignored 的 ——
//    于是连脚本一起没进仓库，`docs/handoff.md` 指着一批新克隆里根本
//    不存在的文件叫人去跑。

import { mkdirSync } from "fs";
import { join } from "path";

export const DIAG_OUT_DIR = "analysis/diag";

/** 写一份诊断产物，返回落盘路径 */
export async function writeReport(name: string, body: string): Promise<string> {
  mkdirSync(DIAG_OUT_DIR, { recursive: true });
  const path = join(DIAG_OUT_DIR, name).replace(/\\/g, "/");
  await Bun.write(path, body.endsWith("\n") ? body : body + "\n");
  return path;
}
