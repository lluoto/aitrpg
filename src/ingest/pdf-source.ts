// 摄取管线 · 第一段：PDF → 逐页文本
//
// 依赖是 pdf-parse v2.4.5，导出的是 PDFParse **类**，不是网上示例里那个默认函数。
// require("pdf-parse")(buffer) 会抛 pdfParse is not a function ——
// 这个坑值半小时，写在这儿免得下一个人再踩。
//
// 本模块只收 Uint8Array，不收路径、不碰 fs：读盘是 tools 脚本的事。
// 中间这几段保持无 IO，才能被纯逻辑单测（tools/ 不进版本库，放那里等于放弃测试）。
//
// getText() 之外还有 getPageTables / getImage / getHyperlinks，
// 模组附件是 6 张图，将来用得上。

import { PDFParse } from "pdf-parse";

/**
 * 抽出逐页原始文本。下游是 cleanPageText。
 *
 * 坏输入一律抛，不返回空数组：空数组会让整条管线安静地产出零个场景，
 * 表现成「模型没干活」，而真正的原因在最上游。
 */
export async function extractPages(data: Uint8Array): Promise<string[]> {
  // 抢在 pdf-parse 之前拦空数据，是为了让错误带上 [ingest] 前缀落在本管线名下。
  // 少了这行也会抛（库自己报 InvalidPDFException），但那条消息指不回这里。
  if (data.length === 0) throw new Error("[ingest] PDF 数据为空");

  const res = await new PDFParse({ data }).getText();

  // 逐页元素的形状是实测的，不是照记忆写的：pages[i] 是对象 { num, text }，
  // num 从 1 起，text 就是该页全文；这与包内 PageTextResult 的声明一致。
  // 取值一路走类型系统（不写 res as any），是为了让「库改了形状、并且改了 .d.ts」
  // 这一类变更直接摔在 bun run typecheck 上，而不是拖到运行时才发作。
  if (res.pages.length === 0) {
    // v2.4.5 对空字节和非 PDF 字节都会先抛 InvalidPDFException，走不到这里。
    // 留着是防以后版本改成「返回空结果」——那样整条管线会安静地产出零个场景。
    throw new Error("[ingest] pdf-parse 未返回逐页结果");
  }

  // 上面那道编译期保证只管得住「形状变了且声明跟着变了」。反过来的情况它一点办法没有：
  // 库改了形状却没更新 .d.ts，类型系统会一路点头放行，p.text 在运行时是 undefined，
  // 本函数于是返回一串 undefined 冒充 string[]。而下游 cleanPageText 的头一行是
  // `if (!raw) return ""`，每个 undefined 都会在下一段悄悄变成空字符串 ——
  // 那正是本模块唯一不能有的失败方式：整条管线产出零个场景、表现成「模型没干活」，
  // 全程没有一个人抛错，而真正的原因在最上游。
  //
  // 所以两道一起才成立：声明变了编译期拦，声明没变运行时拦。
  // 单靠类型不够，这也是为什么这里不能只写 res.pages.map((p) => p.text)。
  return res.pages.map((p) => {
    if (typeof p.text !== "string") {
      throw new Error(`[ingest] pdf-parse 第 ${p.num} 页的 text 不是字符串`);
    }
    return p.text;
  });
}
