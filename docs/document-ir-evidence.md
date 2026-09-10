# DocumentIR Evidence Boundaries

`DocumentIR` preserves the PDF parser's page text before ingest cleaning. Its
`documentHash` is SHA-256 over original PDF bytes. A raw offset is a JavaScript
character offset in one `pdf-parse` page-text string, using `[rawStart, rawEnd)`.
It is neither a PDF byte offset nor a visual page coordinate.

`runIngest(pdfBytes)` returns a PDF-backed `DocumentIR`. `runIngestFromPages()`
returns `hashSource: "synthetic_fixture"` and `documentHash: null`; page-text
fixtures must never claim a PDF byte hash.

`cleanPageWithTrace` and `joinPagesWithTrace` preserve legacy text output while
recording only raw-derived fragments. Normalized whitespace and inserted
structural newlines have no fabricated raw span. When hard lines or pages join,
the resulting `EvidenceRef` retains multiple exact spans rather than pretending
the text came from one contiguous source range.

Existing `Section.source`, `SectionItem.source`, and `sourceKey(pN:LN)` remain
unchanged scoring-key coordinates. `DocumentBlock` is the parallel source-exact
layer for headings, paragraphs, marked items, list items, and front matter.
Blocks use evidence-derived IDs before classification, so classification or
filtering cannot reorder their identifiers.

This layer is addressability only. It does not classify clues, create mechanics,
write `findMethods`/`unlocks`, change provenance, read a world-model artifact,
or alter ModuleData runtime behavior. A later SourceFactGraph needs candidate
schemas, review/acceptance workflow, and compiler wiring that consume these
EvidenceRefs without replacing legacy scoring coordinates.
