import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve('../../tmp/visual-code-500');
const apply = process.argv.includes('--apply');
const env = parse(await fs.readFile('.env.production'));
if (new URL(env.SUPABASE_URL).hostname !== 'ygqndcgpbtmewzkruyuq.supabase.co') throw Error('Wrong production target');
const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const refs = new Set<string>();
async function all(table: string, columns: string) {
  const rows: any[] = [];
  for (let start=0;;start+=1000) {
    const {data,error} = await client.from(table).select(columns).order('id').range(start,start+999);
    if(error) throw Error('Reference inventory failed: '+error.message);
    rows.push(...data); if(data.length<1000) return rows;
  }
}
const drafts = await all('draft_questions','id,visual_code,has_visual_stimulus,stimulus_image_path,stimulus_source_image_path,review_source_image_path');
const questions = await all('questions','id,stimulus_image_path');
for(const row of [...drafts,...questions]) for(const key of ['stimulus_image_path','stimulus_source_image_path','review_source_image_path']) if(row[key]) refs.add(row[key]);
const candidates = new Set<string>();
for(const name of await fs.readdir(path.join(root,'backups'))) {
  if(!name.endsWith('.json')) continue;
  const before = JSON.parse(await fs.readFile(path.join(root,'backups',name),'utf8'));
  const current = drafts.find(x=>x.id===before.id);
  if(!current || (!current.visual_code && current.has_visual_stimulus)) continue;
  for(const key of ['stimulus_image_path','stimulus_source_image_path','review_source_image_path']) {
    const value=before[key];
    if(typeof value==='string' && /^imports\/[a-f0-9-]+\//.test(value) && !value.includes('..') && /\.(png|jpe?g|webp)$/i.test(value) && !refs.has(value)) candidates.add(value);
  }
}
const report:any = {apply,project:'ygqndcgpbtmewzkruyuq',checkedAt:new Date().toISOString(),candidates:[...candidates],deleted:[],alreadyAbsent:[],retainedReferences:refs.size};
for(let n=0;apply && n<report.candidates.length;n+=50) {
  const batch=report.candidates.slice(n,n+50);
  const {data,error}=await client.storage.from('question-assets').remove(batch);
  if(error) throw Error('Storage cleanup failed: '+error.message);
  const removed=(data??[]).map(item=>item.name);
  report.deleted.push(...removed);
  report.alreadyAbsent.push(...batch.filter((name:string)=>!removed.includes(name)));
  await fs.writeFile(path.join(root,'storage-cleanup.json'),JSON.stringify(report,null,2));
}
await fs.writeFile(path.join(root,'storage-cleanup'+(apply?'':'-preview')+'.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({apply,candidates:candidates.size,deleted:report.deleted.length}));
