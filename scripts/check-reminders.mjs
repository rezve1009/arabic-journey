import fs from 'node:fs';
const env=Object.fromEntries(fs.readFileSync('supabase/.env.push','utf8').trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
const url='https://xtjtpkklmabtookelhrz.supabase.co/functions/v1/reminders';
const denied=await fetch(url,{method:'POST'});
console.log('Without cron secret:',denied.status);
const permitted=await fetch(url,{method:'POST',headers:{'x-cron-secret':env.REMINDER_CRON_SECRET,'content-type':'application/json'},body:'{}'});
console.log('With cron secret:',permitted.status);
if(permitted.ok)console.log(await permitted.text());
if(denied.status!==401||permitted.status!==200)process.exit(1);
