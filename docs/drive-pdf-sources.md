# Drive PDF sources and final crop retention

## Runtime setup required before production activation

The chat's Google Drive connection is not a credential for the application.
The existing `GoogleDriveSource` accepts a private service-account JSON file or
an `authorized_user` OAuth credential file through `google-auth-library`.
Drive access stays read-only; original files remain in their existing folders.

For a service account:

1. Enable Google Drive API in the Google Cloud project.
2. Create a service account, without granting unrelated Google Cloud IAM roles.
3. Give its email Viewer access to the original Drive folder. The folder owner
   may need to do this if the current user cannot change sharing.
4. Save the private JSON credential on the worker machine. For the existing
   Windows setup, use `backend/worker/.env.drive-service-account.json`.
5. Set these worker environment variables and restart the worker:

```env
GOOGLE_APPLICATION_CREDENTIALS="D:/SAT website/backend/worker/.env.drive-service-account.json"
GOOGLE_DRIVE_FOLDER_ID=1xw4T-5X0cOCe-Jr-9lqv7C8zFw6byFYU
```

On a hosted worker, use its private mounted-secret path instead of the Windows
path. Never commit or paste the credential contents. An OAuth credential using
the user's existing Drive permissions is the alternative when the original
folder cannot be shared with a service account.

The production Edge Function also needs `WORKER_URL` pointing to that running
worker and the same `WORKER_AUTH_TOKEN`. A localhost worker cannot be called
directly by Supabase Cloud. Student access to saved crops does not require the
worker to be online; viewing original draft pages does.

## Behavior

- Drive-first imports register a checksum-verified PDF source and fetch it for
  processing without uploading the original PDF to Supabase Storage.
- Auto-cropping saves only successful crops. Uncertain visuals wait for manual
  cropping; no full-page image is uploaded as a fallback.
- The authenticated admin source-page endpoint retrieves and renders the page
  through the worker. Review and cropping share the rendering. Temporary
  in-memory caches expire after 15 minutes and are bounded to 512 MiB per worker.
- Source-document/page references belong to drafts so refinement cannot silently
  substitute a different PDF. Renaming a Drive file is harmless; content changes
  fail checksum verification until an administrator resolves the original.
- Published drafts release original-page references and keep the question's
  final image path. Storage cleanup deletes unused crop versions, legacy source
  pages and unshared originals after checking current references. Existing
  published full-page images require an approved replacement and are retained
  as reported exceptions until then.
- Text-only questions retain no final image. One final image may legitimately
  be shared by multiple questions; cleanup must not duplicate or delete it.

## Migration

Run from `backend/worker`, using the corresponding environment credentials:

```powershell
# Preview only; no database or Storage mutations.
npx tsx scripts/migrate-drive-sources.ts

# Apply verified staging matches.
npx tsx scripts/migrate-drive-sources.ts --apply

# Production preview, then apply after reviewing the manifest.
npx tsx scripts/migrate-drive-sources.ts --production
npx tsx scripts/migrate-drive-sources.ts --production --apply
```

Manifests are saved under ignored `tmp/drive-source-migration-<target>.json`.
Checksum matches are required; names identify candidates only. Unmatched draft
sources remain protected and are reported for the user to supply. Refinement
paths pointing to a former import remain protected until individually verified.
Perform applied migrations with ingestion/review jobs stopped, and recheck
student question images after cleanup. Deleted files are recoverable only from
the verified Drive original; never assume a database rollback restores Storage.

## Current implementation verification

The frontend build, Edge Function type check, and 235 worker tests passed.
Source binding and unpublished cleanup eligibility were exercised in a rolled
back staging transaction. The worker's runtime dependency audit is clean.
The worker-wide strict type check still reports four existing undefined-value
errors in `frontend/src/lib/reviewAnnotations.ts:8`.

Live Google Drive reads, browser cropping, corpus migration, and production
activation require configuring and verifying the runtime Drive credential and
reachable worker. Do not activate the Drive-only upload flow before that check.
