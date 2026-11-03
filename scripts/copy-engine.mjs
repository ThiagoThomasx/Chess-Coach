// Copies the Stockfish WASM build from node_modules into public/engine so the
// app serves it locally (no CDN). Runs automatically after `npm install`.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dest = join(root, 'public', 'engine');
const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];

if (!existsSync(src)) {
  console.error('[copy-engine] stockfish package not found; run npm install');
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const f of files) copyFileSync(join(src, f), join(dest, f));
copyFileSync(join(root, 'node_modules', 'stockfish', 'Copying.txt'), join(dest, 'STOCKFISH-LICENSE.txt'));
console.log(`[copy-engine] copied ${files.join(', ')} to public/engine`);
