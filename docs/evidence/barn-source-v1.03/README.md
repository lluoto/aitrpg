# Barn Source-Bound Audit Corpus

This directory is the tracked input for the Barn production-source audit. It is
not a generated module snapshot and does not replace the original PDF as the
authoritative source.

## Origin

- Source: user-provided local `普瑞米尔的谷仓 ver1.03.pdf`.
- Source PDF SHA-256:
  `7af2924849cdca9ade940fa28f730a44e9bce6148b1e67280b627b5e5afbb549`.
- Retention: the user authorized this corpus for tracked clean-clone test
  evidence on 2026-09-15.

## Derivation

`manifest.json` records the only accepted mapping: PDF page 1 is
`00_header.txt`; PDF pages 2 through 18 are `section_01.txt` through
`section_17.txt`. The manifest records a SHA-256 for every section after only
CRLF/CR-to-LF normalization plus one final editor-added newline. The audit rejects a missing section, an altered
section, malformed provenance, or an altered inventory.

The production tests read this corpus through `readOriginalCorpus()` in
`src/ingest/three-way-audit.ts`. They never read ignored `tools/` artifacts.
The old `tools/modules/raw/` copy remains a local historical derivative and is
not clean-clone evidence.

## Scope

The corpus is retained only to verify source claims made by the Barn module.
It is not a license grant or a claim that the repository may distribute other
source material. See `NOTICE.md` for the repository notice.
