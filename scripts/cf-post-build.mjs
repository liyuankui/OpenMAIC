import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const BUILD_DIR = '.open-next';
const DO_DIR = path.join(BUILD_DIR, '.build', 'durable-objects');

async function compileClassroomDO() {
  fs.mkdirSync(DO_DIR, { recursive: true });

  console.log('[cf-post-build] Compiling ClassroomDO...');
  await build({
    entryPoints: ['lib/server/adapters/cf-classroom-store.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outdir: DO_DIR,
    external: ['cloudflare:workers'],
  });
  console.log('[cf-post-build] ClassroomDO compiled');
}

function patchWorkerExport() {
  const workerPath = path.join(BUILD_DIR, 'worker.js');
  let content = fs.readFileSync(workerPath, 'utf-8');

  if (content.includes('ClassroomDO')) {
    console.log('[cf-post-build] ClassroomDO already exported');
    return;
  }

  const exportLine = [
    '',
    '// @ts-expect-error: Custom DO for OpenMAIC classroom persistence',
    'export { ClassroomDO } from "./.build/durable-objects/cf-classroom-store.js";',
    '',
  ].join('\n');

  // Insert before `export default {`
  content = content.replace('export default {', `${exportLine}export default {`);
  fs.writeFileSync(workerPath, content);
  console.log('[cf-post-build] worker.js patched with ClassroomDO export');
}

await compileClassroomDO();
patchWorkerExport();
