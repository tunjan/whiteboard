// pdf.js resolves four asset directories over HTTP at render time rather than
// bundling them: the Standard 14 fonts a PDF may reference without embedding,
// the CMaps for CJK encodings, the ICC profile for colour conversion, and the
// wasm image decoders (JBIG2 and JPEG2000 — how most scanners write their
// pages). Copy them into `public/` so a self-hosted board serves them itself;
// pdf.js only fetches the ones a given document actually needs.
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIRS = ['standard_fonts', 'cmaps', 'iccs', 'wasm'];

const pkg = createRequire(import.meta.url).resolve('pdfjs-dist/package.json');
const src = dirname(pkg);
const dest = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'pdfjs',
);

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of DIRS) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
console.log(`[pdfjs] copied ${DIRS.join(', ')} to client/public/pdfjs`);
