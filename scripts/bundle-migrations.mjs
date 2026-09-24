import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
const start=process.argv[2]??'0003';
if(!/^\d{4}$/.test(start))throw new Error('Usage: npm run db:bundle -- 0003');
const files=readdirSync('supabase/migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f.slice(0,4)>=start).sort();
if(!files.length)throw new Error('No matching migrations');
const sql=`-- Generated upgrade bundle. Apply ONCE, only after all migrations before ${start}.\n-- Back up your database and test in staging first.\n`+files.map(file=>`\n-- Migration: ${file}\n${readFileSync(`supabase/migrations/${file}`,'utf8')}\n`).join('');
writeFileSync('supabase/upgrade.sql',sql);
console.log(`Created supabase/upgrade.sql with ${files.length} migrations (${files[0]} through ${files.at(-1)}).`);
