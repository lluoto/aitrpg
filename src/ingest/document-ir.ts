/**
 * Source-exact document representation.
 *
 * rawStart/rawEnd are [start, end) character offsets in the page text returned
 * by pdf-parse. They are neither PDF byte offsets nor visual page coordinates.
 */
export const DOCUMENT_IR_SCHEMA_VERSION = "1.0.0";

export type DocumentHashSource = "pdf_bytes_sha256" | "synthetic_fixture";
export type EvidencePrecision = "exact_text" | "page_text" | "synthetic_fixture";

export interface DocumentPage {
  pageNumber: number;
  rawText: string;
  rawTextHash: string;
  documentHash: string | null;
  hashSource: DocumentHashSource;
}

export interface DocumentIR {
  schemaVersion: typeof DOCUMENT_IR_SCHEMA_VERSION;
  /** SHA-256 of original PDF bytes; null for page-text-only synthetic fixtures. */
  documentHash: string | null;
  hashSource: DocumentHashSource;
  sourceDescriptor?: string;
  pages: DocumentPage[];
}

export interface EvidenceSpan {
  documentHash: string | null;
  pageNumber: number;
  /** Half-open character interval in DocumentPage.rawText: [rawStart, rawEnd). */
  rawStart: number;
  rawEnd: number;
  exactText: string;
  textHash: string;
}

export interface EvidenceRef {
  spans: EvidenceSpan[];
  precision: EvidencePrecision;
}

export type DocumentBlockKind = "heading" | "paragraph" | "marked_item" | "list_item" | "unknown";

export interface DocumentBlock {
  id: string;
  kind: DocumentBlockKind;
  text: string;
  evidence: EvidenceRef;
  parentSectionId?: string;
  nameEvidence?: EvidenceRef;
  bodyEvidence?: EvidenceRef;
}

export function sha256(value: string | Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}

export function createPdfDocumentIR(pdfBytes: Uint8Array, pages: Array<{ pageNumber: number; rawText: string }>): DocumentIR {
  const documentHash = sha256(pdfBytes);
  return {
    schemaVersion: DOCUMENT_IR_SCHEMA_VERSION,
    documentHash,
    hashSource: "pdf_bytes_sha256",
    pages: pages.map((page) => ({
      pageNumber: page.pageNumber,
      rawText: page.rawText,
      rawTextHash: sha256(page.rawText),
      documentHash,
      hashSource: "pdf_bytes_sha256",
    })),
  };
}

/** Page-text-only test input deliberately has no PDF byte hash. */
export function createSyntheticDocumentIR(rawPages: string[], sourceDescriptor: string): DocumentIR {
  return {
    schemaVersion: DOCUMENT_IR_SCHEMA_VERSION,
    documentHash: null,
    hashSource: "synthetic_fixture",
    sourceDescriptor,
    pages: rawPages.map((rawText, index) => ({
      pageNumber: index + 1,
      rawText,
      rawTextHash: sha256(rawText),
      documentHash: null,
      hashSource: "synthetic_fixture",
    })),
  };
}

export function evidenceSpan(page: DocumentPage, rawStart: number, rawEnd: number): EvidenceSpan {
  if (!Number.isInteger(rawStart) || !Number.isInteger(rawEnd) || rawStart < 0 || rawEnd < rawStart || rawEnd > page.rawText.length) {
    throw new Error(`evidence span out of bounds: p${page.pageNumber} [${rawStart},${rawEnd})`);
  }
  const exactText = page.rawText.slice(rawStart, rawEnd);
  return {
    documentHash: page.documentHash,
    pageNumber: page.pageNumber,
    rawStart,
    rawEnd,
    exactText,
    textHash: sha256(exactText),
  };
}

export function validateEvidenceRef(reference: EvidenceRef, document: DocumentIR): void {
  for (const span of reference.spans) {
    const page = document.pages.find((candidate) => candidate.pageNumber === span.pageNumber);
    if (!page) throw new Error(`evidence page missing: p${span.pageNumber}`);
    if (span.documentHash !== document.documentHash) throw new Error(`evidence document hash mismatch: p${span.pageNumber}`);
    if (!Number.isInteger(span.rawStart) || !Number.isInteger(span.rawEnd) || span.rawStart < 0 || span.rawEnd < span.rawStart || span.rawEnd > page.rawText.length) {
      throw new Error(`evidence span out of bounds: p${span.pageNumber} [${span.rawStart},${span.rawEnd})`);
    }
    const exactText = page.rawText.slice(span.rawStart, span.rawEnd);
    if (span.exactText !== exactText) throw new Error(`evidence exactText mismatch: p${span.pageNumber}`);
    if (span.textHash !== sha256(exactText)) throw new Error(`evidence text hash mismatch: p${span.pageNumber}`);
  }
}
