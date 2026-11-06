import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const readSource = async name => (await readFile(new URL(name, root), 'utf8')).replace(/\r\n?/g, '\n');
let html = await readSource('src/index.html');
const css = await readSource('src/style.css');
const parts = await Promise.all(['core', 'extract', 'app'].map(name => readSource(`src/${name}.js`)));
const js = parts.map(part => part.replace(/^import .*?;\s*$/gm, '').replace(/^export /gm, '')).join('\n');
// Literal closing tags in source would break the single-file payload.
const script = `\n(() => {\n'use strict';\n${js.replace(/<\/script/gi, '<\\/script')}\n})();\n`;
const style = `\n${css}\n`;
const hash = value => `'sha256-${createHash('sha256').update(value).digest('base64')}'`;
const csp = `default-src 'none'; script-src ${hash(script)}; style-src ${hash(style)}; base-uri 'none'; form-action 'none'; connect-src 'none'; img-src 'none'; object-src 'none'`;
html = html.replace(/<link\b[^>]*href=["'](?:\.\/)?style\.css["'][^>]*>/, () => `<style>${style}</style>`)
  .replace(/<script\b[^>]*src=["'](?:\.\/)?app\.js["'][^>]*><\/script>/, () => `<script>${script}</script>`)
  .replace('<head>', () => `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
if (html.includes('src="./app.js"') || html.includes('href="./style.css"') || !html.includes('<style>') || !html.includes('<script>')) throw new Error('Build placeholders did not match.');
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/baselens.html', root), html);
console.log(`Built dist/baselens.html (${Buffer.byteLength(html)} bytes)`);
