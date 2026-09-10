import { describe, expect, it } from "bun:test";
import { buildDocumentBlocks } from "../ingest/document-blocks";
import { cleanPageWithTrace, joinPagesWithTrace } from "../ingest/clean-text";
import { createSyntheticDocumentIR, sha256, validateEvidenceRef } from "../ingest/document-ir";
import { sectionize } from "../ingest/sectionize";

function blocksFor(pages: string[]) {
  const document = createSyntheticDocumentIR(pages, "document-block-test");
  const traced = joinPagesWithTrace(document.pages.map(cleanPageWithTrace));
  const blocks = buildDocumentBlocks(document, traced);
  for (const block of blocks) validateEvidenceRef(block.evidence, document);
  return { document, traced, blocks };
}

describe("DocumentBlock evidence", () => {
  it("keeps heading, ordinary paragraph, marked item name, and item body separately addressable", () => {
    const { blocks } = blocksFor(["前置散文。\n场景：\n普通正文。\n▶钥匙：打开门。"]);
    const heading = blocks.find((block) => block.kind === "heading");
    const paragraph = blocks.find((block) => block.kind === "paragraph" && block.text === "普通正文。");
    const item = blocks.find((block) => block.kind === "marked_item");
    expect(blocks.find((block) => block.kind === "paragraph" && block.text === "前置散文。")?.parentSectionId).toBeUndefined();
    expect(heading?.evidence.spans).not.toEqual([]);
    expect(paragraph?.parentSectionId).toBe(heading?.id);
    expect(item?.nameEvidence?.spans.map((span) => span.exactText).join("")).toBe("钥匙");
    expect(item?.bodyEvidence?.spans.map((span) => span.exactText).join("")).toBe("打开门。");
  });

  it("represents cross-page prose with multiple page spans instead of one synthetic range", () => {
    const { blocks } = blocksFor(["场景：\n这一段没有收尾", "补上。\n▶物：正文"]);
    const paragraph = blocks.find((block) => block.kind === "paragraph");
    expect(paragraph?.text).toBe("这一段没有收尾补上。");
    expect(new Set(paragraph?.evidence.spans.map((span) => span.pageNumber))).toEqual(new Set([1, 2]));
  });

  it("keeps unnamed and same-named marked items distinct by evidence position", () => {
    const { blocks } = blocksFor(["场景：\n▶没有名字\n▶钥匙：甲\n▶钥匙：乙"]);
    const items = blocks.filter((block) => block.kind === "marked_item");
    expect(items).toHaveLength(3);
    expect(items[0]?.nameEvidence).toBeUndefined();
    expect(items[1]?.id).not.toBe(items[2]?.id);
    expect(items[1]?.evidence.spans[0]?.rawStart).not.toBe(items[2]?.evidence.spans[0]?.rawStart);
  });

  it("uses evidence-derived IDs rather than a position in a filtered output list", () => {
    const { blocks } = blocksFor(["甲：\n甲正文。\n乙：\n乙正文。"]);
    const second = blocks.find((block) => block.text === "乙正文。");
    const afterFiltering = blocks.filter((block) => block.text !== "甲正文。").find((block) => block.text === "乙正文。");
    expect(second?.id).toBe(afterFiltering?.id);
    expect(second?.id).toBe(`block_${sha256("synthetic:document-block-test|paragraph|1:11:15").slice(0, 24)}`);
  });

  it("leaves legacy section body and sourceKey coordinates unchanged", () => {
    const pages = ["场景：\n正文。\n▶物：条目。"];
    const sections = sectionize(pages);
    expect(sections).toEqual([{ title: "场景", body: "正文。", items: [{ name: "物", text: "条目。", source: { page: 1, line: 3 } }], source: { page: 1, line: 1 } }]);
  });
});
