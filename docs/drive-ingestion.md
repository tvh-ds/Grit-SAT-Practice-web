# Google Drive full-test draft ingestion

Source: [Digital SAT Tests](https://drive.google.com/drive/folders/1xw4T-5X0cOCe-Jr-9lqv7C8zFw6byFYU).
The requested destination is production `sat-practice` (`ygqndcgpbtmewzkruyuq`). Select `--target production` and supply matching production credentials. The script defaults to staging unless production is explicitly selected by flag or `GOOGLE_DRIVE_TARGET`. It refuses a mismatch between the selected target and Supabase URL. Running the local importer writes application data; it does not push repository changes, deploy frontend code, or deploy Edge Functions.

## Behavior

- On the first complete scan, queue `2026 10` first, then `2026 09`. Existing PDFs outside those folders are recorded as the baseline without importing the archive.
- Subsequent scans find new PDF IDs anywhere below the root, including nested or newly moved-in folders. Modification timestamps are not used as a cutoff. Editing an already known file does not automatically reimport it.
- Check every five minutes after the previous scan finishes. Each scan processes the queue sequentially, so October is attempted before September.
- Skip files or paths named `Question Bank`. Math-only and incomplete test PDFs can still fail the existing full-test validation; filenames do not establish that a test is complete.
- Use read-only Drive access. Never move, delete, rename, or edit source files. Shortcuts are not followed.
- Download at most 50 MiB per PDF, verify PDF magic bytes and advertised length, and upload to the existing private `pdf-imports` bucket. The configured Cohere Parse provider receives rendered test pages for OCR. Its normal API usage applies.
- Reuse the existing full-test parsing, answer-key extraction, structural gate, deterministic review, and optional AI review. Imports remain drafts for admin review. The watcher never approves, generates, assigns, or publishes tests.
- Download the PDF first, then page through existing full tests (including published tests) and PDF imports/drafts in the selected database. Compare year, month, region, and variant across filenames and descriptive titles: `202609asiav2.pdf`, `September 2026 Int 2`, and `2026 September International 2` share an identity. Asia/Int/International are aliases; US remains separate. An existing matching test or active/completed import is skipped before OCR. Ambiguous identities, partial tests, and failed/cancelled earlier attempts are held as `needs_review`, with candidate IDs saved in state.
- Save progress atomically under `tmp/drive-ingestion/<target>/<folder-id>/state.json`. State and locks are separate for staging and production; a staging success never causes a production file to be skipped. Stable import UUIDs prevent duplicate database rows after a restart or an uncertain insert response. Identical bytes already imported by this watcher are skipped. Entirely unrelated editorial titles without recognizable administration metadata cannot be proven equivalent by the name check; source filenames on linked imports still participate. This is not a global question-content similarity detector.
- Record failures and continue to later files. Failed downloads or imports require an explicit `--retry-failed`; they are not automatically charged for OCR again every five minutes.
- If all OCR keys run out of quota, stop the watcher and leave later files pending. Restore quota and restart with `--retry-failed`. A run is marked imported only after its structural validation passes; a partial processing result with failed validation remains failed. A partial row whose processing status is `completed` but validation is `failed` requires a guarded reset for reprocessing; do not simply mark its local state successful.

Keep one watcher process for this folder on one computer. Its local lock prevents duplicate local runs; this is not a distributed worker lock. The application worker must not concurrently process the same uploaded import. A second machine must not run its own watcher for the same folder.

## One-time Google setup

The Google Drive connection inside this chat can fetch the initial PDFs. The local watcher needs its own credentials to keep running after the chat ends.

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project and [enable Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com).
2. Open **IAM & Admin → Service Accounts**, create `sat-drive-reader`, and leave optional Google Cloud project roles blank. Drive folder sharing supplies access; an Owner or Editor cloud role is unnecessary.
3. Open that service account's **Keys → Add key → Create new key → JSON**. Save it locally as `D:\SAT website\backend\worker\.env.drive-service-account.json`. This filename is covered by the repository's `.env.*` ignore rule. Do not paste its private key into chat or commit it. [Google's key creation instructions](https://docs.cloud.google.com/iam/docs/keys-create-delete).
4. Copy the service account email, then share the watched Drive folder with that email as **Viewer**. If you cannot share the original folder, ask its owner to do this. Without that access, use an authorized-user credential through Google's supported OAuth flow instead; do not broaden the folder to public access just for this watcher. [Google's server authentication documentation](https://developers.google.com/identity/protocols/oauth2/service-account).
5. Configure the production watcher environment separately from normal staging development. Set `SUPABASE_URL=https://ygqndcgpbtmewzkruyuq.supabase.co` and its corresponding private `SUPABASE_SERVICE_ROLE_KEY`, along with the existing worker/Cohere settings. Add these Drive values (also in `backend/worker/drive.env.example`):

```env
GOOGLE_APPLICATION_CREDENTIALS="D:/SAT website/backend/worker/.env.drive-service-account.json"
GOOGLE_DRIVE_FOLDER_ID=1xw4T-5X0cOCe-Jr-9lqv7C8zFw6byFYU
GOOGLE_DRIVE_POLL_INTERVAL_MS=300000
GOOGLE_DRIVE_TARGET=production
```

## Preview and start

From `D:\SAT website\backend\worker`:

```powershell
# Inventory and show the proposed state. Does not save a baseline or ingest files.
npm run drive:scan -- --target production --dry-run

# One real scan, including the priority backlog on the first scan.
npm run drive:scan -- --target production

# Continuous checks while this Node process/computer stays running.
npm run drive:watch -- --target production
```

For persistence across logouts or restarts, run `npm run drive:watch` under your normal process supervisor with this working directory and environment. No Windows scheduled task or startup service is installed automatically. The watcher does not need the Express server, because it calls the same pipeline directly.

## Initial October/September bootstrap

The initial downloaded corpus is under `Tests Unparsed/drive-downloads/<root-folder-id>/<Drive-file-id>.pdf`. The metadata-only manifest `tmp/drive-priority-backlog.json` contains October's ten PDFs followed by September's four PDFs. Both locations are ignored by Git.

```powershell
# Preview without Google worker credentials or OCR calls.
npm run drive:scan -- --target production --bootstrap ../../tmp/drive-priority-backlog.json --dry-run

# Process only new connector-downloaded files into production draft imports.
npm run drive:scan -- --target production --bootstrap ../../tmp/drive-priority-backlog.json
```

Bootstrap state leaves `initializedAt` empty so that the first later full Drive inventory can still baseline the old archive. Stable file/import IDs let the normal watcher reuse the initial results. Do not remove the state to retry a failed file.

## Recovery

Inspect an import's recorded UUID in the existing admin import review screen. Correct connectivity, credentials, OCR quota, or source problems before explicitly retrying:

```powershell
npm run drive:scan -- --target production --retry-failed
# Or retry only the locally downloaded bootstrap queue:
npm run drive:scan -- --target production --bootstrap ../../tmp/drive-priority-backlog.json --retry-failed
```

`--retry-failed` requeues failures once at startup. A generated test is never reprocessed. An import already in a processing status is left pending, preventing an automatic second OCR run. A killed process can leave such an import requiring manual investigation before resetting its status.

If a crash leaves `watcher.lock`, read the PID in that file and verify that process is no longer running before removing that specific file. Never delete the entire state directory to clear a lock. Corrupt state and root/project mismatches cause an error rather than silently resetting the baseline.

## Verification and dependency notes (2026-10-31)

`google-auth-library` is pinned at `11.3.2` and installed with lifecycle scripts disabled. The native npm audit reports no advisory against that new library or its dependency subtree. Existing worker/tooling advisories remain in Express/body-parser/proxy-addr/qs and the Vitest/Vite/tinypool/source-map-js development stack. The standalone watcher does not import Express or expose the test UI/dev servers. Review those separate runtime/development paths before production release; no production release is part of this change. Revisit the audit by 2026-11-07.

The existing worker-wide typecheck also traverses `frontend/src/lib/reviewAnnotations.ts`, where four pre-existing `r is possibly undefined` errors currently block a clean check. Drive-specific verification is recorded separately from those existing errors.
