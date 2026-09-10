import { describe, expect, it } from "bun:test";
import { cleanPageText, cleanPageWithTrace, evidenceRefFromTrace, joinPages, joinPagesWithTrace } from "../ingest/clean-text";
import { createSyntheticDocumentIR, validateEvidenceRef } from "../ingest/document-ir";

describe("trace-aware cleaning", () => {
  it("keeps legacy page and cross-page text byte-for-byte unchanged", () => {
    const document = createSyntheticDocumentIR([
      "标题：\n第一行，\n第二行。",
      "跨页没有收尾",
      "补上。\n\n下一段。",
    ], "trace-compatibility");
    const traced = document.pages.map(cleanPageWithTrace);
    expect(traced.map((page) => page.text)).toEqual(document.pages.map((page) => cleanPageText(page.rawText)));
    expect(joinPagesWithTrace(traced).map((page) => page.text)).toEqual(joinPages(document.pages.map((page) => cleanPageText(page.rawText))));
  });

  it("joins page-internal hard lines with two exact source spans", () => {
    const document = createSyntheticDocumentIR(["木质栅栏，\n上面的油漆。"], "hard-line");
    const traced = cleanPageWithTrace(document.pages[0]!);
    expect(traced.text).toBe("木质栅栏，上面的油漆。");
    expect(traced.fragments).toHaveLength(2);
    expect(traced.fragments.map((fragment) => fragment.evidence.exactText)).toEqual(["木质栅栏，", "上面的油漆。"]);
    validateEvidenceRef(evidenceRefFromTrace(traced), document);
  });

  it("joins cross-page text while retaining spans from both page numbers", () => {
    const document = createSyntheticDocumentIR(["防盗门可", "不多见。\n下一段。"], "cross-page");
    const joined = joinPagesWithTrace(document.pages.map(cleanPageWithTrace));
    expect(joined[0]?.text).toBe("防盗门可不多见。");
    expect(new Set(joined[0]?.fragments.map((fragment) => fragment.evidence.pageNumber))).toEqual(new Set([1, 2]));
    validateEvidenceRef(evidenceRefFromTrace(joined[0]!), document);
  });

  it("normalizes whitespace without assigning a raw span to the synthetic space", () => {
    const document = createSyntheticDocumentIR(["甲\t乙"], "whitespace");
    const traced = cleanPageWithTrace(document.pages[0]!);
    expect(traced.text).toBe("甲 乙");
    expect(traced.fragments.map((fragment) => fragment.evidence.exactText)).toEqual(["甲", "乙"]);
    expect(traced.fragments.some((fragment) => fragment.outputStart <= 1 && 1 < fragment.outputEnd)).toBe(false);
  });

  it("keeps repeated source text at distinct offsets", () => {
    const document = createSyntheticDocumentIR(["同句。\n同句。"], "repeated-text");
    const traced = cleanPageWithTrace(document.pages[0]!);
    const repeats = traced.fragments.filter((fragment) => fragment.evidence.exactText === "同句。");
    expect(repeats).toHaveLength(2);
    expect(repeats[0]?.evidence.rawStart).not.toBe(repeats[1]?.evidence.rawStart);
  });
});
