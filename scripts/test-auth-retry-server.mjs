// Isolated port 5175 QA fixture. Seeds a simulated deadline; never sends an email.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 5175);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ttf': 'font/ttf', '.md': 'text/plain' };
http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(root, relative);
    const parts = relative.split(/[\\/]/);
    if (!target.startsWith(root) || parts.some(part => part.startsWith('.')) || !types[path.extname(target)]) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    let body=await readFile(target);
    if(relative==='index.html')body=body.toString().replace('<head>','<head><script>localStorage.setItem("arabic-journey.language","bn");if(!localStorage.getItem("arabic-journey.auth-retry"))localStorage.setItem("arabic-journey.auth-retry",JSON.stringify({email:{until:Date.now()+75000,reason:"email_quota"}}));</script>');
    response.writeHead(200, { 'Content-Type': `${types[path.extname(target)]}${/\.(html|css|js|md)$/.test(target) ? '; charset=utf-8' : ''}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Arabic Journey: http://localhost:${port}`));
