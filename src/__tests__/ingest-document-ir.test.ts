import { describe, expect, it } from "bun:test";
import {
  createPdfDocumentIR,
  createSyntheticDocumentIR,
  evidenceSpan,
  validateEvidenceRef,
} from "../ingest/document-ir";

describe("DocumentIR source-exact contracts", () => {
  it("uses a stable hash of original PDF bytes and changes when a byte changes", () => {
    const first = createPdfDocumentIR(new Uint8Array([1, 2, 3]), [{ pageNumber: 7, rawText: "alpha" }]);
    const again = createPdfDocumentIR(new Uint8Array([1, 2, 3]), [{ pageNumber: 7, rawText: "alpha" }]);
    const changed = createPdfDocumentIR(new Uint8Array([1, 2, 4]), [{ pageNumber: 7, rawText: "alpha" }]);
    expect(first.documentHash).toBe(again.documentHash);
    expect(first.documentHash).not.toBe(changed.documentHash);
    expect(first.pages[0]?.pageNumber).toBe(7);
  });

  it("uses half-open exact spans that round-trip raw page text", () => {
    const document = createPdfDocumentIR(new Uint8Array([1]), [{ pageNumber: 3, rawText: "abcdef" }]);
    const span = evidenceSpan(document.pages[0]!, 1, 4);
    expect(span.exactText).toBe("bcd");
    expect(span.exactText).toBe(document.pages[0]!.rawText.slice(span.rawStart, span.rawEnd));
    expect(() => evidenceSpan(document.pages[0]!, 1, 7)).toThrow("out of bounds");
  });

  it("synthetic page fixtures never claim a PDF byte hash", () => {
    const document = createSyntheticDocumentIR(["fixture page"], "unit-test-pages");
    expect(document.documentHash).toBeNull();
    expect(document.hashSource).toBe("synthetic_fixture");
    const span = evidenceSpan(document.pages[0]!, 0, 7);
    validateEvidenceRef({ spans: [span], precision: "synthetic_fixture" }, document);
  });

  it("rejects out-of-bounds and stale exactText evidence", () => {
    const document = createPdfDocumentIR(new Uint8Array([8]), [{ pageNumber: 1, rawText: "abcdef" }]);
    const span = evidenceSpan(document.pages[0]!, 0, 3);
    expect(() => validateEvidenceRef({ spans: [{ ...span, rawEnd: 7 }], precision: "exact_text" }, document)).toThrow("out of bounds");
    expect(() => validateEvidenceRef({ spans: [{ ...span, exactText: "wrong" }], precision: "exact_text" }, document)).toThrow("exactText");
  });
});
