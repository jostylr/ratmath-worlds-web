// Checks web/src/babel/library.js against answers worked out by the Swift
// version (BabelLibrary.swift and BabelAddress.swift). Each line of
// babel-vectors.txt is an address, then what both must make of it: the
// address in standard form, the room's coordinates and seeds, and the first
// and last characters of the page. Run with: node web/babel-test.mjs
import * as L from './src/babel/library.js';
import { readFileSync } from 'node:fs';

const lines = readFileSync(new URL('./babel-vectors.txt', import.meta.url), 'utf8').trimEnd().split('\n');
let failures = 0;
for (const expected of lines) {
  const code = expected.split(' | ')[0];
  let actual;
  try {
    const { place } = L.parseAddress(code, L.BORGES);
    const room = L.roomOf(place);
    const book = L.bookOf(place);
    const page = book ? L.pageOf(book, place.design, Math.max(place.page, 1)) : null;
    actual = [
      code, L.addressText(place), room?.integers ? room.integers.join(',') : 'big',
      room ? room.low.join(',') : '0,0,0', room?.high ?? 0, room?.floorTurn ?? 0, room?.bookCount ?? -1,
      room ? L.roomSeed(room, place.design) : 0, L.bookHash(place),
      page ? page[0].slice(0, 40) : '-', page ? page[page.length - 1].slice(-20) : '-',
      book ? L.titleOf(book, place.design) : '-',
    ].join(' | ');
  } catch (error) {
    if (!(error instanceof L.AddressError)) { throw error; }
    actual = `${code} | ERR | ${error.message}`;
  }
  if (actual !== expected) {
    failures += 1;
    console.log(`MISMATCH\n  swift: ${expected}\n  js:    ${actual}`);
  }
}
console.log(failures === 0 ? `All ${lines.length} addresses agree.` : `${failures} of ${lines.length} differ.`);
process.exit(failures === 0 ? 0 : 1);
