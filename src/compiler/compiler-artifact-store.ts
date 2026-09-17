import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";
import { restoreCompilerArtifactJson, serializeCompilerArtifact, type CompilerArtifactEnvelope, type CompilerArtifactRefusal, type RestoredCompilerArtifact } from "./compiler-artifact";

export interface CompilerArtifactFileOps {
  mkdir(path: string): void;
  open(path: string): number;
  write(fd: number, value: string): void;
  flush(fd: number): void;
  close(fd: number): void;
  replace(tempPath: string, targetPath: string): void;
  remove(path: string): void;
  read(path: string): string;
}

export const compilerArtifactNodeFileOps: CompilerArtifactFileOps = {
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  open: (path) => openSync(path, "wx", 0o600),
  write: (fd, value) => { writeSync(fd, value, undefined, "utf8"); },
  flush: (fd) => fsyncSync(fd),
  close: (fd) => closeSync(fd),
  replace: (tempPath, targetPath) => renameSync(tempPath, targetPath),
  remove: (path) => unlinkSync(path),
  read: (path) => readFileSync(path, "utf8"),
};

/** Atomically replace a local artifact without deleting the prior valid target first. */
export function writeCompilerArtifactAtomically(path: string, text: string, ops: CompilerArtifactFileOps = compilerArtifactNodeFileOps): void {
  ops.mkdir(dirname(path));
  const tempPath = `${path}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = ops.open(tempPath);
    ops.write(fd, text);
    ops.flush(fd);
    ops.close(fd);
    fd = undefined;
    ops.replace(tempPath, path);
  } catch (error) {
    if (fd !== undefined) {
      try { ops.close(fd); } catch { /* Preserve the original storage failure. */ }
    }
    try { ops.remove(tempPath); } catch { /* The target is never removed on a failed write. */ }
    throw error;
  }
}

export function saveCompilerArtifact(path: string, envelope: CompilerArtifactEnvelope, ops: CompilerArtifactFileOps = compilerArtifactNodeFileOps): void {
  writeCompilerArtifactAtomically(path, serializeCompilerArtifact(envelope), ops);
}

export function loadCompilerArtifact(path: string, ops: CompilerArtifactFileOps = compilerArtifactNodeFileOps): RestoredCompilerArtifact | CompilerArtifactRefusal {
  return restoreCompilerArtifactJson(ops.read(path));
}
