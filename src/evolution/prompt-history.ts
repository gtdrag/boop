/**
 * Version management for prompt files.
 *
 * Tracks prompt evolution in ~/.boop/memory/prompt-versions/{phase}/
 * with versioned content files and a JSON index.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { PlanningSubPhase } from "../shared/types.js";

export interface PromptVersion {
  phase: PlanningSubPhase;
  version: number;
  createdAt: string;
  changeSummary: string;
  sourceRunId?: string;
}

function defaultMemoryDir(): string {
  return path.join(os.homedir(), ".boop", "memory");
}

function phaseDir(phase: PlanningSubPhase, memoryDir: string): string {
  return path.join(memoryDir, "prompt-versions", phase);
}

function indexPath(phase: PlanningSubPhase, memoryDir: string): string {
  return path.join(phaseDir(phase, memoryDir), "index.json");
}

function versionFilePath(phase: PlanningSubPhase, version: number, memoryDir: string): string {
  return path.join(phaseDir(phase, memoryDir), `v${version}.md`);
}

function readIndex(phase: PlanningSubPhase, memoryDir: string): PromptVersion[] {
  const p = indexPath(phase, memoryDir);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf-8")) as PromptVersion[];
}

function writeIndex(phase: PlanningSubPhase, entries: PromptVersion[], memoryDir: string): void {
  const dir = phaseDir(phase, memoryDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(indexPath(phase, memoryDir), JSON.stringify(entries, null, 2));
}

export function saveVersion(
  phase: PlanningSubPhase,
  content: string,
  changeSummary: string,
  memoryDir?: string,
): PromptVersion {
  const dir = memoryDir ?? defaultMemoryDir();
  const entries = readIndex(phase, dir);
  const nextVersion = entries.length > 0 ? entries[entries.length - 1].version + 1 : 1;

  const entry: PromptVersion = {
    phase,
    version: nextVersion,
    createdAt: new Date().toISOString(),
    changeSummary,
  };

  fs.mkdirSync(phaseDir(phase, dir), { recursive: true });
  fs.writeFileSync(versionFilePath(phase, nextVersion, dir), content);

  entries.push(entry);
  writeIndex(phase, entries, dir);

  return entry;
}

export function loadVersion(
  phase: PlanningSubPhase,
  version: number,
  memoryDir?: string,
): string | null {
  const dir = memoryDir ?? defaultMemoryDir();
  const p = versionFilePath(phase, version, dir);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf-8");
}

export function getCurrentVersion(
  phase: PlanningSubPhase,
  memoryDir?: string,
): PromptVersion | null {
  const dir = memoryDir ?? defaultMemoryDir();
  const entries = readIndex(phase, dir);
  if (entries.length === 0) return null;
  return entries[entries.length - 1];
}

export function rollback(
  phase: PlanningSubPhase,
  toVersion: number,
  promptsDir: string,
  memoryDir?: string,
): void {
  const content = loadVersion(phase, toVersion, memoryDir);
  if (content === null) {
    throw new Error(`Version ${toVersion} not found for phase "${phase}"`);
  }
  const target = path.join(promptsDir, phase, "system.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

export function listVersions(
  phase: PlanningSubPhase,
  memoryDir?: string,
): PromptVersion[] {
  const dir = memoryDir ?? defaultMemoryDir();
  return readIndex(phase, dir);
}
