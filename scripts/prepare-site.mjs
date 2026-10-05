// Publish only the site's public assets, without repository or test files.
import { mkdir, readdir, copyFile, cp, rm } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const destination = new URL('_site/', root);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const name of await readdir(root)) {
  if (/\.(html|css|svg)$/.test(name)) { await copyFile(new URL(name, root), new URL(name, destination)); }
}
await cp(new URL('src/', root), new URL('src/', destination), { recursive: true });
console.log('Static site prepared in _site/.');
