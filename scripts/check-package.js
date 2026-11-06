import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';

const archive = resolve(process.argv[2] || '4onv-baselens-0.1.0.tgz');
const scratch = await mkdtemp(join(tmpdir(), 'baselens-package-'));
const npmCli = process.env.npm_execpath || process.env.BASELENS_NPM_CLI;
if (!npmCli) throw new Error('Run through npm run check:package -- ARCHIVE');
try {
  await writeFile(join(scratch, 'package.json'), '{"private":true,"type":"module"}');
  const args = ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', archive];
  execFileSync(process.execPath, [npmCli, ...args], { cwd: scratch, stdio: 'pipe' });
  await writeFile(join(scratch, 'check.mjs'), `import assert from 'node:assert/strict';\nimport { analyzeLinks } from '@4onv/baselens';\nconst r = analyzeLinks({pageUrl:'https://example.test/forum/',bases:[{href:'/'}],links:[{tag:'a',href:'articles',text:'Articles'}]});\nassert.equal(r.links[0].resolved,'https://example.test/articles');\nassert.equal(r.summary.changed,1);\n`);
  execFileSync(process.execPath, ['check.mjs'], { cwd: scratch, stdio: 'inherit' });
  const html = await readFile(join(scratch, 'node_modules/@4onv/baselens/dist/baselens.html'), 'utf8');
  if (!html.includes('Content-Security-Policy') || !html.includes('Where do your links')) throw new Error('Installed demo missing');
  console.log('Offline archive installation, installed API and packaged demo passed');
} finally {
  if (dirname(resolve(scratch)) !== resolve(tmpdir()) || !basename(scratch).startsWith('baselens-package-')) throw new Error('Unexpected cleanup path');
  await rm(scratch, { recursive: true, force: true });
}
