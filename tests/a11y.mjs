// Serves public/ and runs axe-core (WCAG 2.2 AA tags) on every page in
// light and dark mode. Exit code 1 if any violation is found.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('public');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const pages = ['/', '/accessibility.html', '/thanks.html', '/sorry.html'];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let failures = 0;
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ colorScheme: scheme });
  for (const p of pages) {
    const page = await context.newPage();
    await page.goto(base + p, { waitUntil: 'networkidle' });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    const v = results.violations;
    console.log(`${scheme.padEnd(5)} ${p.padEnd(22)} ${v.length ? v.length + ' violation(s)' : 'clean'}  (${results.passes.length} rules passed)`);
    for (const item of v) {
      failures++;
      console.log(`  - [${item.impact}] ${item.id}: ${item.help}`);
      for (const n of item.nodes.slice(0, 3)) console.log(`      ${n.target.join(' ')}`);
    }
    await page.close();
  }
  await context.close();
}
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
