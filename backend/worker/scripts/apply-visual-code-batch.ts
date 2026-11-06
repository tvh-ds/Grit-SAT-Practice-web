import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { validateVisualCode } from '../../supabase/functions/_shared/visualCode';

// Deliberate production-only migration of the frozen, already existing draft selection.
const root = path.resolve('../../tmp/visual-code-500');
const apply = process.argv.includes('--apply');
const env = parse(await fs.readFile('.env.production'));
if (new URL(env.SUPABASE_URL).hostname !== 'ygqndcgpbtmewzkruyuq.supabase.co') throw new Error('Unexpected production project');
const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const ready = JSON.parse(await fs.readFile(path.join(root, 'ready.json'), 'utf8'));
const logPath = path.join(root, apply ? 'apply-report.json' : 'preflight-report.json');
const report: any = { project: 'ygqndcgpbtmewzkruyuq', apply, startedAt: new Date().toISOString(), applied: [], alreadyApplied: [], blocked: [], pending: [] };
const backupDir = path.join(root, 'backups');
await fs.mkdir(backupDir, { recursive: true });
for (const source of ready) {
  let result: any;
  try { result = JSON.parse(await fs.readFile(path.join(root, 'conversions', source.id + '.json'), 'utf8')); }
  catch { report.pending.push(source.id); continue; }
  const noVisual = result.outcome === 'no_visual';
  if (result.outcome === 'blocked') { report.blocked.push({ id: source.id, reason: result.reason }); continue; }
  const code = result.markup;
  if (result.id !== source.id || result.model !== 'gpt-6.1-terra' || result.reasoning_effort !== 'medium' || result.source_sha256 !== source.image_sha256) {
    report.blocked.push({ id: source.id, reason: 'Conversion identity/model/source mismatch' }); continue;
  }
  const validation = noVisual ? null : validateVisualCode(code, result.format);
  if (validation) { report.blocked.push({ id: source.id, reason: validation }); continue; }
  const { data: before, error } = await client.from('draft_questions').select('*').eq('id', source.id).single();
  if (error) throw new Error('Unable to read selected draft: ' + error.message);
  if (before.question_id) { report.blocked.push({ id: source.id, reason: 'Draft was published since selection' }); continue; }
  if ((!noVisual && before.visual_code === code && before.visual_format === result.format) || (noVisual && !before.has_visual_stimulus && !before.stimulus_image_path)) {
    report.alreadyApplied.push(source.id); continue;
  }
  if (before.stimulus_image_path !== source.stimulus_image_path) { report.blocked.push({ id: source.id, reason: 'Source changed since selection' }); continue; }
  if (!apply) { report.applied.push({ id: source.id, outcome: noVisual ? 'no_visual' : 'code', dryRun: true }); continue; }
  const backup = path.join(backupDir, source.id + '.json');
  try { await fs.writeFile(backup, JSON.stringify(before), { flag: 'wx' }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
  const metadata = { ...(before.parser_metadata ?? {}), visual_conversion: { model: result.model, reasoning_effort: result.reasoning_effort, source_sha256: result.source_sha256, outcome: noVisual ? 'no_visual' : 'code', converted_at: new Date().toISOString(), uncertainties: result.uncertainties ?? [] } };
  const payload = noVisual ? { visual_code: null, visual_format: null, has_visual_stimulus: false, stimulus_image_path: null, stimulus_source_image_path: null, review_source_image_path: null, stimulus_crop_rect: null, stimulus_crop_source: null, stimulus_crop_status: null, review_state: 'complete', review_route: 'batch_ready', status: before.status === 'needs_review' ? 'approved' : before.status, parser_metadata: metadata } : { visual_code: code, visual_format: result.format, has_visual_stimulus: true, parser_metadata: metadata };
  const { data, error: updateError } = await client.from('draft_questions').update(payload).eq('id', source.id).is('question_id', null).eq('stimulus_image_path', source.stimulus_image_path).select('id,visual_code,visual_format,has_visual_stimulus,stimulus_image_path');
  if (updateError) throw new Error('Conversion save failed: ' + updateError.message);
  if (data?.length !== 1 || data[0].stimulus_image_path || data[0].has_visual_stimulus !== !noVisual || (!noVisual && data[0].visual_code !== code)) throw new Error('Conversion verification failed for ' + source.id);
  report.applied.push({ id: source.id, outcome: noVisual ? 'no_visual' : 'code' });
  await fs.writeFile(logPath, JSON.stringify(report, null, 2));
}
report.completedAt = new Date().toISOString();
await fs.writeFile(logPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ apply, applied: report.applied.length, alreadyApplied: report.alreadyApplied.length, blocked: report.blocked.length, pending: report.pending.length }));
