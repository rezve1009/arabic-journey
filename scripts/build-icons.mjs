import{fileURLToPath}from'node:url';
import fs from 'node:fs/promises';
import {createRequire}from'node:module';
const require=createRequire(import.meta.url);
// Asset build only: use installed sharp or a bundled runtime module path.
const sharp=require(process.env.SHARP_MODULE||'sharp');
const original=await fs.readFile(new URL('../icons/app.svg',import.meta.url),'utf8');
// Keep the existing book artwork. In a maskable icon it stays inside the
// central safe area, while the green background fills every corner.
const maskable=original.replace('rx="18"','rx="0"').replace('<g fill=', '<g transform="translate(8 8) scale(.75)" fill=');
for(const [file,size,svg]of [['app-192.png',192,original],['app-512.png',512,original],['icon-192.png',192,original],['icon-512.png',512,original],['maskable-512.png',512,maskable],['apple-touch-icon.png',180,maskable]]){
 await sharp(Buffer.from(svg),{density:384}).resize(size,size).png().toFile(fileURLToPath(new URL('../icons/'+file,import.meta.url)));
}
console.log('Generated matching regular, maskable and Apple app icons.');
