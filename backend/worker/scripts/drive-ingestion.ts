#!/usr/bin/env tsx
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../src/config";
import { GoogleDriveSource, readBootstrapFiles } from "../src/driveSource";
import { DriveTestImporter } from "../src/driveTestImporter";
import { assertDriveTarget, DEFAULT_DRIVE_FOLDER, discoverDriveFiles, drainDriveQueue, newDriveState, parseFolderId, validateDriveState, type DriveState, type DriveTarget } from "../src/driveIngestion";

const args = process.argv.slice(2);
const value = (name: string) => { const index = args.indexOf(name); if (index < 0) return undefined; const next = args[index + 1]; if (!next || next.startsWith("--")) throw new Error(`Missing value for ${name}`); return next; };
const log = (message: string) => console.log(`[drive ${new Date().toISOString()}] ${message}`);

async function main(): Promise<void> {
  if (args.includes("--help")) {
    console.log("Drive → full-test draft imports. Options: --target staging|production (default staging), --folder <URL/ID>, --once, --dry-run, --bootstrap <manifest.json>, --retry-failed. First full scan imports 2026 10 then 2026 09, baselines older files. Later scans import new PDF IDs. Requires GOOGLE_APPLICATION_CREDENTIALS for unattended scans. See docs/drive-ingestion.md.");
    return;
  }
  const allowed = new Set(["--target", "--folder", "--once", "--dry-run", "--bootstrap", "--retry-failed"]);
  for (const arg of args) if (arg.startsWith("--") && !allowed.has(arg)) throw new Error(`Unknown option ${arg}`);
  const selectedTarget = value("--target") ?? process.env.GOOGLE_DRIVE_TARGET ?? "staging";
  if (selectedTarget !== "staging" && selectedTarget !== "production") throw new Error("--target must be staging or production");
  const target: DriveTarget = selectedTarget;
  assertDriveTarget(process.env.SUPABASE_URL ?? "", target);
  const rootFolderId = parseFolderId(value("--folder") ?? process.env.GOOGLE_DRIVE_FOLDER_ID ?? DEFAULT_DRIVE_FOLDER);
  const bootstrap = value("--bootstrap");
  if (bootstrap && !args.includes("--once")) throw new Error("--bootstrap requires --once; use normal watch mode afterward");
  const dryRun = args.includes("--dry-run");
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const directory = path.join(repo, "tmp", "drive-ingestion", target, rootFolderId);
  const statePath = path.join(directory, "state.json");
  const lockPath = path.join(directory, "watcher.lock");
  await fs.mkdir(directory, { recursive: true });
  const lock = await fs.open(lockPath, "wx").catch(() => { throw new Error(`Another watcher holds ${lockPath}. If it stopped, verify its PID before removing this lock.`); });
  await lock.writeFile(JSON.stringify({ pid: process.pid, rootFolderId, target }));
  const save = async (state: DriveState) => {
    await fs.writeFile(`${statePath}.tmp`, JSON.stringify(state, null, 2));
    await fs.rename(`${statePath}.tmp`, statePath);
  };
  try {
    let state: DriveState;
    try { state = validateDriveState(JSON.parse(await fs.readFile(statePath, "utf8")), rootFolderId, target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; state = newDriveState(rootFolderId, target); }
    const interval = Number(process.env.GOOGLE_DRIVE_POLL_INTERVAL_MS ?? 300000);
    if (!Number.isSafeInteger(interval) || interval < 60000 || interval > 86400000) throw new Error("GOOGLE_DRIVE_POLL_INTERVAL_MS must be 60000–86400000");
    const source = bootstrap ? null : new GoogleDriveSource(process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "");
    let importer: DriveTestImporter | undefined;
    let stopping = false;
    let retryRequested = args.includes("--retry-failed");
    const shutdown = new AbortController();
    const stop = () => { stopping = true; shutdown.abort(); log("Stopping after the current scan completes"); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    log(`Verified ${target} target ${process.env.SUPABASE_URL}; Drive folder ${rootFolderId}`);
    try {
      do {
        try {
          if (bootstrap) {
            const manifest = await readBootstrapFiles(bootstrap);
            if (manifest.rootFolderId !== rootFolderId) throw new Error("Bootstrap manifest is for a different folder");
            for (const file of manifest.files) if (!Object.hasOwn(state.entries, file.id)) state.entries[file.id] = { file, status: "pending" };
            // Do not mark initialized: the first full scan must still baseline the older archive.
          } else {
            const files = await source!.inventory(rootFolderId);
            discoverDriveFiles(state, files);
            log(`Complete inventory: ${files.length} PDFs`);
          }
          if (retryRequested) {
            for (const entry of Object.values(state.entries)) if (entry.status === "failed") { entry.status = "pending"; delete entry.error; }
            retryRequested = false;
          }
          log(`Queue: ${Object.values(state.entries).filter(e => e.status === "pending").length} pending; ${Object.values(state.entries).filter(e => e.status === "baseline").length} older files baselined`);
          if (dryRun) {
            console.log(JSON.stringify(state, null, 2));
          } else {
            await save(state);
            importer ??= new DriveTestImporter(loadConfig(), args.includes("--retry-failed"), process.env.GOOGLE_DRIVE_ADMIN_ID, target);
            const quotaHalt = await drainDriveQueue(state, {
              preflight: (file, id) => importer!.preflight(file, id),
              download: file => bootstrap ? fs.readFile(path.join(repo, "Tests Unparsed", "drive-downloads", rootFolderId, `${file.id}.pdf`)) : source!.download(file),
              ingest: (file, bytes, id) => importer!.ingest(file, bytes, id), save, log,
            });
            if (quotaHalt) stopping = true;
          }
        } catch {
          // Do not print third-party credential errors or signed URLs.
          log("Scan failed; state preserved. Check credentials, folder access, and target connectivity.");
          if (args.includes("--once") || dryRun) throw new Error("Drive scan failed; no baseline was reset");
        }
        if (bootstrap || args.includes("--once") || dryRun || stopping) break;
        await delay(interval, undefined, { signal: shutdown.signal }).catch(error => { if (error.name !== "AbortError") throw error; });
      } while (!stopping);
    } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
  } finally { await lock.close(); await fs.unlink(lockPath); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Drive ingestion failed"); process.exitCode = 1; });
