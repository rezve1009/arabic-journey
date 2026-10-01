import fs from 'node:fs';
const base='https://rezve1009.github.io/arabic-journey/';
const worker=await (await fetch(base+'service-worker.js?verify=6c79985')).text();
const assets=JSON.parse(worker.match(/const ASSETS=(\[[^;]+\])/)[1]);
let checked=0;
for(const asset of assets){const res=await fetch(new URL(asset,base));if(!res.ok)throw Error(asset+' HTTP '+res.status);if(asset==='./'||asset==='./index.html'||/\.(js|css|webmanifest)$/.test(asset)){const relative=asset==='./'?'index.html':asset.slice(2);const local=fs.readFileSync(relative,'utf8').replaceAll('\r\n','\n');const remote=(await res.text()).replaceAll('\r\n','\n');if(local!==remote)throw Error('Content mismatch: '+relative);}else await res.arrayBuffer();checked++;}
console.log('Verified '+checked+' hosted assets; runtime text matches the release.');
