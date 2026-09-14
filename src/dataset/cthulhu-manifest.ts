// Source registration for the seven-work Project Gutenberg dataset.
// This records statements carried by the files; it is not a legal conclusion.

export type CthulhuWorkId =
  | "at_the_mountains_of_madness"
  | "cool_air"
  | "the_call_of_cthulhu"
  | "the_case_of_charles_dexter_ward"
  | "the_colour_out_of_space"
  | "the_curse_of_yig"
  | "the_dunwich_horror";

export interface CthulhuWorkManifest {
  workId: CthulhuWorkId;
  title: string;
  authors: string[];
  gutenbergEbookId: string;
  releaseDate: string;
  language: string;
  originalPublication: {
    statement: string;
    evidenceLocation: string;
  };
  sourceText: { path: string; sha256: string };
  chapterDirectory: string;
  expectedChapters: number;
  chapterInventorySha256: string;
  extractedArtifact: {
    path: string;
    sha256: string;
    expectedRows: number;
    expectedCoveredChapters: number;
  };
  licenseEvidence: {
    sourcePath: string;
    statementLocation: string;
    statement: string;
  };
}

export interface CthulhuDatasetManifest {
  datasetId: "cthulhu-gutenberg-source-bound";
  version: "1";
  evidencePrecision: "chunk";
  works: CthulhuWorkManifest[];
  corpusScopes: Array<{ id: string; allowedWorkIds: CthulhuWorkId[] }>;
  aggregateArtifact: {
    path: string;
    sha256: string;
    expectedRows: 145;
    status: "migration_analysis_only";
  };
  ignoredArtifacts: Array<{
    path: string;
    sha256: string;
    status: "ignored_empty_legacy_artifact";
  }>;
}

const LICENSE_STATEMENT =
  "You may copy it, give it away or re-use it under the terms of the Project Gutenberg License included with this eBook or online at www.gutenberg.org.";

export const CTHULHU_DATASET_MANIFEST: CthulhuDatasetManifest = {
  datasetId: "cthulhu-gutenberg-source-bound",
  version: "1",
  evidencePrecision: "chunk",
  works: [
    work({ id: "at_the_mountains_of_madness", title: "At the mountains of madness", authors: ["H. P. Lovecraft"], ebook: "70652", release: "April 27, 2023", publication: "United States: Street & Smith Publications, Inc., 1936", publicationEvidence: "source header: Original publication", source: "at_the_mountains_of_madness.txt", sourceHash: "0e458499acb0e9c5915e634dcc5ba96d11cf45e19b9d3e9b2b8af75744ab3b44", chapterHash: "b3e117c192087b83ff8a17c5761c6d84ce364fb22dc1912933d9f70756f669ba", artifact: "mountains_of_madness.jsonl", artifactHash: "fa77928d1c573c6fa6cf9d977c33ecd292c73da1235b73471baf2839621dcec0", chapters: 43, rows: 31, covered: 13 }),
    work({ id: "cool_air", title: "Cool air", authors: ["H. P. Lovecraft"], ebook: "73177", release: "March 16, 2024", publication: "New York, NY: Weird Tales, 1939", publicationEvidence: "source header: Original publication", source: "cool_air.txt", sourceHash: "29e59b5bbb1e15083287d15cbe6dcc45c9e20c8e233ba5ab1f7046f04b490e60", chapterHash: "653244cd17d05ac706a62a84d09caf38435488e837b90373cf08f67e16ff0e68", artifact: "cool_air.jsonl", artifactHash: "645581b67f499b11624053498b088bdf454620f3988f92b4e14ef2b666a4e8c4", chapters: 4, rows: 9, covered: 4 }),
    work({ id: "the_call_of_cthulhu", title: "The call of Cthulhu", authors: ["H. P. Lovecraft"], ebook: "68283", release: "June 10, 2022", publication: "United States: Popular Fiction Publishing Company, 1928", publicationEvidence: "source header: Original publication", source: "the_call_of_cthulhu.txt", sourceHash: "db20dc8b4b2a58af9462c2f66d3deefa843c3bce4390b825f74d31ca231eedca", chapterHash: "2257577ac7853d6fb743b596ea8cf61e23bd5feb103d9055ba2bb6ed6e9d4203", artifact: "call_of_cthulhu.jsonl", artifactHash: "53f197cc3e5756a3bb1ffb12b6f6d54db19d79e1fce8eb32673ab393f077a750", chapters: 14, rows: 21, covered: 11 }),
    work({ id: "the_case_of_charles_dexter_ward", title: "The case of Charles Dexter Ward", authors: ["H. P. Lovecraft"], ebook: "73547", release: "May 5, 2024", publication: "New York, NY: Weird Tales, 1941", publicationEvidence: "source header: Original publication", source: "the_case_of_charles_dexter_ward.txt", sourceHash: "d8b17042fd89a348abf4025913f2cc750043ed37d7e4f03da0ed77d5cc4227a9", chapterHash: "e85e50358f1e465d1c34374a7aba607aa91ea9f999e11f16072bd03373cf8b57", artifact: "dexter_ward.jsonl", artifactHash: "6b7574c489a9dd6c6aa21076f29a3a3cf99193ba282deba9deefa07b3bfa23f9", chapters: 50, rows: 32, covered: 21 }),
    work({ id: "the_colour_out_of_space", title: "The colour out of space", authors: ["H. P. Lovecraft"], ebook: "68236", release: "June 4, 2022", publication: "United States: Experimenter Publishing Company, 1927", publicationEvidence: "source header: Original publication", source: "the_colour_out_of_space.txt", sourceHash: "d3a4d341403fc98099ded127b6572dc976ae436fddd33eb4b69e733679044bd2", chapterHash: "60fb96908643b47838f3092a86ec8a6ab10f52554ba69d3effbab666373a305e", artifact: "colour_out_of_space.jsonl", artifactHash: "1e22c2bf0718c8d065ff40cbffcffdfd193370ba45459990cee1c4cc010e40a2", chapters: 14, rows: 18, covered: 10 }),
    work({ id: "the_curse_of_yig", title: "The curse of Yig", authors: ["Zealia B. Bishop", "H. P. Lovecraft"], ebook: "70912", release: "June 4, 2023", publication: "United States: Popular Fiction Publishing Company, 1929", publicationEvidence: "source header: Original publication", source: "the_curse_of_yig.txt", sourceHash: "4ee1609539c81979e01d342865c83663fc908129185ad23f86af8d4456eebfad", chapterHash: "f03fe89820aa7a46c4a77a4ab51d846a27a58bd025f69ac63ae8883eca96511a", artifact: "curse_of_yig.jsonl", artifactHash: "a5609791dd747dcce79e4d37ce6f3c1f90fb578bbadd9a2fd59aad074c492ed8", chapters: 7, rows: 15, covered: 7 }),
    work({ id: "the_dunwich_horror", title: "The Dunwich horror", authors: ["H. P. Lovecraft"], ebook: "50133", release: "October 4, 2015", publication: "Weird Tales, April 1929", publicationEvidence: "source transcriber note; Gutenberg header has no Original publication field", source: "the_dunwich_horror.txt", sourceHash: "134246cc542e3355d06f5e4e7fe157726ab54de8b1b19dd8c4985cf27384cb02", chapterHash: "dea77401263b8d8645b46e65a383912d579c83bde59e581ff50409bb70b95a9a", artifact: "dunwich_horror.jsonl", artifactHash: "98bd2205ae2c5a15e52a20bf8f8c2a3832c90bf7ecbb7c99a15b1c25756cedda", chapters: 19, rows: 19, covered: 10 }),
  ],
  corpusScopes: [{
    id: "seven-work-corpus",
    allowedWorkIds: ["at_the_mountains_of_madness", "cool_air", "the_call_of_cthulhu", "the_case_of_charles_dexter_ward", "the_colour_out_of_space", "the_curse_of_yig", "the_dunwich_horror"],
  }],
  aggregateArtifact: {
    path: "extracted/cthulhu_world_model.jsonl",
    sha256: "6de4ec192c9460e8a3e742fc148084bce6e1ec3676459921c6921be32b6e7f8d",
    expectedRows: 145,
    status: "migration_analysis_only",
  },
  ignoredArtifacts: [{
    path: "extracted/cthulhu_all.jsonl",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    status: "ignored_empty_legacy_artifact",
  }],
};

function work(input: {
  id: CthulhuWorkId; title: string; authors: string[]; ebook: string; release: string;
  publication: string; publicationEvidence: string; source: string; sourceHash: string; chapterHash: string;
  artifact: string; artifactHash: string; chapters: number; rows: number; covered: number;
}): CthulhuWorkManifest {
  const sourcePath = `source/${input.source}`;
  return {
    workId: input.id,
    title: input.title,
    authors: input.authors,
    gutenbergEbookId: input.ebook,
    releaseDate: input.release,
    language: "English",
    originalPublication: { statement: input.publication, evidenceLocation: input.publicationEvidence },
    sourceText: { path: sourcePath, sha256: input.sourceHash },
    chapterDirectory: `chapters/${input.id}`,
    expectedChapters: input.chapters,
    chapterInventorySha256: input.chapterHash,
    extractedArtifact: {
      path: `extracted/${input.artifact}`,
      sha256: input.artifactHash,
      expectedRows: input.rows,
      expectedCoveredChapters: input.covered,
    },
    licenseEvidence: {
      sourcePath,
      statementLocation: "source header lines 3-7 and full license after ebook END marker",
      statement: LICENSE_STATEMENT,
    },
  };
}
