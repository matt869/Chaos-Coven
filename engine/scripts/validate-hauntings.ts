// Validates every haunting in hauntings/ and exits non-zero if any is invalid.
// Used by CI and the Kiro validate-haunting hook: `npm run validate:hauntings -w engine`.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHauntings } from '../src/haunting/loader.js';

const dir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../hauntings');
const { hauntings, invalid } = await loadHauntings(dir);
for (const h of hauntings) console.log(`ok       ${h.id}`);
for (const bad of invalid) {
  console.error(`INVALID  ${bad.file}`);
  for (const p of bad.problems) console.error(`         - ${p}`);
}
process.exit(invalid.length > 0 ? 1 : 0);
