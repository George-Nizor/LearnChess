/** Preserve licences for code bundled into the public LearnChess build. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'licenses');
fs.mkdirSync(out, { recursive: true });
for (const name of ['alpha', 'tatiana']) {
  if (fs.existsSync(path.join(root, 'dist', 'piece-sets', name))) throw new Error(`Restricted artwork in release: ${name}`);
}
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const full = path.join(directory, item.name);
    return item.isDirectory() && item.name !== 'node_modules' ? files(full) : item.isFile() ? [full] : [];
  });
}
if (files(path.join(root, 'dist', 'sounds')).some(file => file.endsWith('.mp3'))) throw new Error('Unreviewed sound recordings in release');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const notices = [];
const missing = [];
for (const [relative, pkg] of Object.entries(lock.packages)) {
  if (!relative || pkg.dev) continue;
  const directory = path.join(root, relative);
  const name = relative.replace(/^.*node_modules\//, '');
  const licences = files(directory).filter(file => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(path.basename(file)));
  notices.push(`\n=== ${name} ${pkg.version} (${pkg.license || 'see below'}) ===\n`);
  if (!licences.length && name !== '@sqlite.org/sqlite-wasm') missing.push(name);
  if (name === '@sqlite.org/sqlite-wasm') notices.push('SQLite is public domain: https://sqlite.org/copyright.html\n');
  for (const file of licences) notices.push(`--- ${path.relative(directory, file)} ---\n${fs.readFileSync(file, 'utf8')}\n`);
}
if (missing.length) throw new Error(`Missing bundled dependency notices: ${missing.join(', ')}`);
fs.writeFileSync(path.join(out, 'npm-notices.txt'), notices.join(''));
for (const name of ['LICENSE', 'LICENSES.md']) fs.copyFileSync(path.join(root, name), path.join(out, name));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(out, 'SOURCE.txt'), `LearnChess ${version} corresponding source, dependency sources, build scripts and artwork:\nhttps://github.com/George-Nizor/LearnChess/releases/download/v${version}/LearnChess-${version}-sources.zip\n`);
console.log('Verified bundled dependency and asset notices.');
