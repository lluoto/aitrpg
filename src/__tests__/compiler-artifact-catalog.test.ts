import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CompilerArtifactCatalog, COMPILER_ARTIFACT_CATALOG_ID_LENGTH } from "../compiler/compiler-artifact-catalog";
import { compilerArtifactCatalogNodeFileOps } from "../compiler/compiler-artifact-catalog";
import { compiledModuleHttpFixture } from "./compiled-module-http-lifecycle.test";

function root(): string { return mkdtempSync(join(tmpdir(), "compiler-catalog-")); }
function id(letter: string): string { return letter.repeat(COMPILER_ARTIFACT_CATALOG_ID_LENGTH); }

describe("compiler artifact catalog", () => {
  it("round-trips immutable prepared artifacts and resolved bundles across catalog instances", async () => {
    const dir = root();
    try {
      const fixture = await compiledModuleHttpFixture();
      const catalog = new CompilerArtifactCatalog({ root: dir, generateId: () => id("a") });
      const prepared = catalog.savePrepared(JSON.parse(JSON.stringify(fixture.prepared.artifact)));
      expect(prepared.status).toBe("ok");
      if (prepared.status === "refused") return;
      const loadedPrepared = new CompilerArtifactCatalog({ root: dir }).loadPrepared(prepared.value.id);
      expect(loadedPrepared).toMatchObject({ status: "ok", value: { artifactHash: fixture.prepared.artifact.artifactHash } });
      const bundle = new CompilerArtifactCatalog({ root: dir, generateId: () => id("b") }).saveBundle(fixture.resolved.artifact, fixture.projection);
      expect(bundle.status).toBe("ok");
      if (bundle.status === "refused") return;
      const loadedBundle = new CompilerArtifactCatalog({ root: dir }).loadBundle(bundle.value.id);
      expect(loadedBundle).toMatchObject({ status: "ok", value: { mechanicsHash: (fixture.resolved.artifact.payload as any).identity.mechanicsHash } });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("refuses malformed IDs, immutable collisions, quota overrun, and tampered entries", async () => {
    const dir = root();
    try {
      const fixture = await compiledModuleHttpFixture();
      const catalog = new CompilerArtifactCatalog({ root: dir, generateId: () => id("c") });
      const first = catalog.savePrepared(fixture.prepared.artifact);
      expect(first.status).toBe("ok");
      expect(catalog.loadPrepared("../outside")).toMatchObject({ status: "refused", code: "CATALOG_ID_INVALID" });
      expect(catalog.savePrepared(fixture.prepared.artifact)).toMatchObject({ status: "ok" });
      const changed = structuredClone(fixture.prepared.artifact); (changed as any).artifactHash = "different";
      expect(catalog.savePrepared(changed)).toMatchObject({ status: "refused", code: "CATALOG_INCOMPATIBLE" });
      const quota = new CompilerArtifactCatalog({ root: join(dir, "quota"), maxEntries: 0 });
      expect(quota.savePrepared(fixture.prepared.artifact)).toMatchObject({ status: "refused", code: "CATALOG_QUOTA_EXCEEDED" });
      expect(existsSync(join(dir, "quota", "prepared"))).toBe(true);
      if (first.status === "ok") {
        const path = join(dir, "prepared", `${first.value.id}.json`);
        const original = JSON.parse(await Bun.file(path).text());
        const unknownField = { ...original, unexpected: true }; writeFileSync(path, JSON.stringify(unknownField));
        expect(catalog.loadPrepared(first.value.id)).toMatchObject({ status: "refused", code: "CATALOG_INCOMPATIBLE" });
        const wrongVersion = { ...original, schemaVersion: "0.0.0" }; writeFileSync(path, JSON.stringify(wrongVersion));
        expect(catalog.loadPrepared(first.value.id)).toMatchObject({ status: "refused", code: "CATALOG_INCOMPATIBLE" });
        writeFileSync(path, "{");
        expect(catalog.loadPrepared(first.value.id)).toMatchObject({ status: "refused", code: "CATALOG_CORRUPT" });
        const raw = structuredClone(original); raw.artifact.payload.draft.moduleId = "tampered"; writeFileSync(path, JSON.stringify(raw));
        expect(catalog.loadPrepared(first.value.id)).toMatchObject({ status: "refused", code: "CATALOG_CORRUPT" });
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("serializes quota-boundary writers and does not expose partial temp files", async () => {
    const dir = root();
    try {
      const fixture = await compiledModuleHttpFixture();
      const catalog = new CompilerArtifactCatalog({ root: dir, maxEntries: 1, generateId: (() => { let n = 0; return () => id(n++ ? "e" : "d"); })() });
      const [one, two] = await Promise.all([Promise.resolve(catalog.savePrepared(fixture.prepared.artifact)), Promise.resolve(catalog.savePrepared(fixture.prepared.artifact))]);
      expect([one, two].filter((result) => result.status === "ok")).toHaveLength(1);
      expect([one, two].filter((result) => result.status === "refused")).toMatchObject([{ code: "CATALOG_QUOTA_EXCEEDED" }]);
      writeFileSync(join(dir, "prepared", `${id("f")}.json.abandoned.tmp`), "{");
      expect(catalog.loadPrepared(id("f"))).toMatchObject({ status: "refused", code: "CATALOG_NOT_FOUND" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("cleans failed injected writes without publishing an entry", async () => {
    const dir = root();
    try {
      const fixture = await compiledModuleHttpFixture();
      const catalog = new CompilerArtifactCatalog({ root: dir, generateId: () => id("g"), fileOps: { ...compilerArtifactCatalogNodeFileOps, flush: () => { throw new Error("flush failed"); } } });
      expect(catalog.savePrepared(fixture.prepared.artifact)).toMatchObject({ status: "refused", code: "CATALOG_STORAGE_FAILED" });
      expect(catalog.loadPrepared(id("g"))).toMatchObject({ status: "refused", code: "CATALOG_NOT_FOUND" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("refuses a catalog root that is not a real directory", async () => {
    const dir = root();
    try {
      const fixture = await compiledModuleHttpFixture();
      const fileRoot = join(dir, "not-a-directory");
      writeFileSync(fileRoot, "not a directory");
      const catalog = new CompilerArtifactCatalog({ root: fileRoot });
      expect(catalog.savePrepared(fixture.prepared.artifact)).toMatchObject({ status: "refused", code: "CATALOG_STORAGE_FAILED" });
      expect(catalog.loadPrepared(id("h"))).toMatchObject({ status: "refused", code: "CATALOG_CORRUPT" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
