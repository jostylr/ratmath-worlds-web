// The arithmetic of the Library of Babel: which book stands where.
//
// This is RatMathWorlds/Worlds/Babel/BabelLibrary.swift and BabelAddress.swift
// in JavaScript, and must give the same answers: an address copied from the
// app has to open the same book here. Everything is whole-number arithmetic
// on 32-bit values and on strings of small digits. web/babel-test.mjs checks
// both against the same vectors.

// MARK: Hashing

export function mix(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

export function combine(a, b) {
  return mix((a ^ ((b + 0x9e3779b9 + (a << 6) + (a >>> 2)) >>> 0)) >>> 0);
}

/** The k-th number in 0...1 drawn from a hash. */
export function unit(h, k) {
  return (mix((h + Math.imul(k, 0x9e3779b9)) >>> 0) & 0xffff) / 65535;
}

const signed = value => value >>> 0;

// MARK: Design

export const MODE = { shuffled: 0, ordered: 1, seeded: 2 };

export const BORGES = Object.freeze({
  sides: 6, walls: 4, shelves: 5, volumes: 32, pages: 410, lines: 40, columns: 80,
  alphabet: 25, key: 0, height: 26, uniform: 0, mode: 0,
});

const PRESETS = [
  ['borges', BORGES],
  ['borges41', { ...BORGES, walls: 5 }],
  ['basile', { ...BORGES, alphabet: 29 }],
  ['reals', { ...BORGES, mode: 1 }],
  ['seeds', { ...BORGES, mode: 2 }],
  ['tiny', { ...BORGES, sides: 4, walls: 2, shelves: 2, volumes: 4, pages: 1, lines: 2, columns: 2, alphabet: 2 }],
];

const FIELDS = [
  ['g', 'sides'], ['w', 'walls'], ['s', 'shelves'], ['v', 'volumes'], ['p', 'pages'], ['l', 'lines'],
  ['c', 'columns'], ['a', 'alphabet'], ['k', 'key'], ['h', 'height'], ['u', 'uniform'], ['m', 'mode'],
];

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

/** The same design with every number brought into its allowed range. */
export function normalized(design) {
  const d = { ...design };
  for (const [, name] of FIELDS) { d[name] = Math.round(Number(d[name]) || 0); }
  // Borges: triangular and pentagonal rooms are inconceivable.
  d.sides = clamp(2 * Math.floor(d.sides / 2), 4, 12);
  d.walls = clamp(d.walls, 1, d.sides - 1);
  d.shelves = clamp(d.shelves, 1, 12);
  d.volumes = clamp(d.volumes, 1, 80);
  d.pages = clamp(d.pages, 1, 1000);
  d.lines = clamp(d.lines, 1, 60);
  d.columns = clamp(d.columns, 1, 120);
  d.alphabet = d.alphabet >= 30 ? 95 : clamp(d.alphabet, 2, 29);
  d.key = clamp(d.key, 0, 999999);
  d.height = clamp(d.height, 20, 60);
  d.uniform = d.uniform ? 1 : 0;
  d.mode = d.mode === 1 || d.mode === 2 ? d.mode : 0;
  return d;
}

export const sameDesign = (a, b) => FIELDS.every(([, name]) => a[name] === b[name]);
export const booksPerRoom = d => d.walls * d.shelves * d.volumes;
export const charactersPerPage = d => d.lines * d.columns;
export const charactersPerBook = d => d.pages * d.lines * d.columns;
const designKey = d => FIELDS.map(([, name]) => d[name]).join(',');

/** The symbols a book is written in, in digit order. */
export function symbols(design) {
  if (design.alphabet === 25) { return 'abcdefghilmnopqrstuvxy ,.'; }
  if (design.alphabet === 95) {
    let all = '';
    for (let c = 32; c <= 126; ++c) { all += String.fromCharCode(c); }
    return all;
  }
  return ' abcdefghijklmnopqrstuvwxyz,.'.slice(0, design.alphabet);
}

export function blank(design) {
  return Math.max(symbols(design).indexOf(' '), 0);
}

const RELATIVES = { j: 'i', k: 'c', w: 'v', z: 's', q: 'c', x: 's' };

/**
 * Digits of a typed text. Letters the alphabet lacks become their nearest
 * relative, or a blank; "/" ends a line.
 */
export function digitsOfText(design, text) {
  const set = symbols(design);
  const space = blank(design);
  const slashBreaks = !set.includes('/');
  const out = [];
  let column = 0;
  for (const raw of text) {
    if (raw === '\n' || (raw === '/' && slashBreaks)) {
      do { out.push(space); column += 1; } while (column % design.columns !== 0);
      column = 0;
      continue;
    }
    let c = raw;
    if (!set.includes(c)) { c = c.toLowerCase(); }
    if (!set.includes(c) && RELATIVES[c]) { c = RELATIVES[c]; }
    const index = c.length === 1 ? set.indexOf(c) : -1;
    out.push(index >= 0 ? index : space);
    column += 1;
  }
  return out;
}

/** The text as this library can write it. */
export function normalizedText(design, text) {
  const set = symbols(design);
  if (set.includes('/')) { return text; }
  return text.split(/[/\n]/).map(part => digitsOfText(design, part).map(d => set[d]).join('')).join('/');
}

export function designCode(design) {
  const d = normalized(design);
  const preset = PRESETS.find(([, p]) => sameDesign(p, d));
  if (preset) { return preset[0]; }
  return FIELDS.filter(([, name]) => d[name] !== BORGES[name]).map(([letter, name]) => letter + d[name]).join('.');
}

/** Reads a design code, or returns null. A preset may be followed by fields. */
export function parseDesign(code) {
  let d = { ...BORGES };
  for (const part of code.toLowerCase().split('.')) {
    if (part === '') { continue; }
    const preset = PRESETS.find(([name]) => name === part);
    if (preset) { d = { ...preset[1] }; continue; }
    const field = FIELDS.find(([letter]) => letter === part[0]);
    if (!field || !/^\d+$/.test(part.slice(1))) { return null; }
    d[field[1]] = Number(part.slice(1));
  }
  return normalized(d);
}

// MARK: Whole numbers of any size, as digits in a small base, lowest first

function trimmed(digits) {
  let n = digits.length;
  while (n > 0 && digits[n - 1] === 0) { n -= 1; }
  return n === digits.length ? digits : digits.slice(0, n);
}

/** digits × factor + addend, in the same base. */
function multiplyAdd(digits, base, factor, addend) {
  const out = new Uint8Array(digits.length + 16);
  let carry = addend;
  let n = 0;
  for (let i = 0; i < digits.length; ++i) {
    const v = digits[i] * factor + carry;
    out[n++] = v % base;
    carry = Math.floor(v / base);
  }
  while (carry > 0) {
    out[n++] = carry % base;
    carry = Math.floor(carry / base);
  }
  return out.slice(0, n);
}

function divide(digits, base, divisor) {
  const out = new Uint8Array(digits.length);
  let remainder = 0;
  for (let i = digits.length - 1; i >= 0; --i) {
    const current = remainder * base + digits[i];
    out[i] = Math.floor(current / divisor);
    remainder = current % divisor;
  }
  return { quotient: trimmed(out), remainder };
}

/** The same number in another base. Quadratic, so only for short numbers. */
function convert(digits, from, to) {
  let out = new Uint8Array(0);
  for (let i = digits.length - 1; i >= 0; --i) {
    out = multiplyAdd(out, to, from, digits[i]);
  }
  return trimmed(out);
}

// Crockford's base 32: no I, L, O or U, and case does not matter.
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function base32Digits(text) {
  const out = [];
  for (const raw of text.toUpperCase()) {
    if (raw === '-' || raw === ' ') { continue; }
    let c = raw;
    if (c === 'O') { c = '0'; }
    if (c === 'I' || c === 'L') { c = '1'; }
    const value = BASE32.indexOf(c);
    if (value < 0) { return null; }
    out.push(value);
  }
  return trimmed(Uint8Array.from(out.reverse()));
}

function base32Text(digits) {
  const d = trimmed(digits);
  if (d.length === 0) { return '0'; }
  let out = '';
  for (let i = 0; i < d.length; ++i) {
    // Groups of four, counted from the right.
    if (i > 0 && (d.length - i) % 4 === 0) { out += '-'; }
    out += BASE32[d[d.length - 1 - i]];
  }
  return out;
}

// MARK: Coordinates
//
// A room's number is written in the alphabet's base and its digits are dealt
// out in turn to column, row and floor. Each digit then stands for a signed
// one (0, 1, −1, 2, −2, …), so that room 0 is the middle of the library and
// small room numbers are its neighbours in every direction. Coordinates are
// three arrays of signed digits, lowest first.

// Base 2 has no negative digit to offer, so its digits go in pairs.
const coordinateBase = design => (design.alphabet >= 3 ? design.alphabet : 4);
const signedDigit = t => (t % 2 === 1 ? (t + 1) / 2 : -t / 2);
const plainDigit = s => (s > 0 ? 2 * s - 1 : -2 * s);

function trimAxis(axis) {
  while (axis.length > 0 && axis[axis.length - 1] === 0) { axis.pop(); }
  return axis;
}

function coordinatesOfRoom(room, design) {
  let digits = room;
  if (design.alphabet === 2) {
    digits = [];
    for (let i = 0; i < room.length; i += 2) {
      digits.push(room[i] + 2 * (i + 1 < room.length ? room[i + 1] : 0));
    }
  }
  const axes = [[], [], []];
  for (let i = 0; i < digits.length; ++i) { axes[i % 3].push(signedDigit(digits[i])); }
  return axes.map(trimAxis);
}

function roomOfCoordinates(axes, design) {
  const length = Math.max(axes[0].length, axes[1].length, axes[2].length);
  let digits = new Uint8Array(3 * length);
  for (let i = 0; i < length; ++i) {
    for (let axis = 0; axis < 3; ++axis) {
      digits[3 * i + axis] = i < axes[axis].length ? plainDigit(axes[axis][i]) : 0;
    }
  }
  if (design.alphabet === 2) {
    const bits = new Uint8Array(2 * digits.length);
    for (let i = 0; i < digits.length; ++i) {
      bits[2 * i] = digits[i] % 2;
      bits[2 * i + 1] = Math.floor(digits[i] / 2);
    }
    digits = bits;
  }
  return trimmed(digits);
}

/** Adds a whole number to balanced digits. */
function addToAxis(offset, digits, base) {
  if (offset === 0) { return digits; }
  const low = base % 2 === 1 ? -(base - 1) / 2 : -(base / 2 - 1);
  const high = low + base - 1;
  const out = digits.slice();
  let carry = offset;
  let i = 0;
  while (carry !== 0) {
    const v = (i < out.length ? out[i] : 0) + carry;
    let r = ((v % base) + base) % base;
    if (r > high) { r -= base; }
    carry = (v - r) / base;
    if (i < out.length) { out[i] = r; } else { out.push(r); }
    i += 1;
  }
  return trimAxis(out);
}

const moved = (axes, offset, design) =>
  axes.map((axis, i) => addToAxis(offset[i], axis, coordinateBase(design)));

/** The coordinates as ordinary numbers, when they are small enough. */
function integersOf(axes, design) {
  const base = coordinateBase(design);
  const out = [0, 0, 0];
  for (let axis = 0; axis < 3; ++axis) {
    let value = 0;
    let bound = 1;
    for (let i = axes[axis].length - 1; i >= 0; --i) {
      bound = bound * base + base;
      if (!(bound < 1e15)) { return null; }
      value = value * base + axes[axis][i];
    }
    out[axis] = value;
  }
  return out;
}

/**
 * What the shader needs to give every room its own look: the two lowest
 * digits of each coordinate, a hash of all the rest, and the floor's
 * remainder on division by six.
 */
function shaderSeed(axes, design) {
  const base = coordinateBase(design);
  const low = [0, 0, 0];
  let high = 0x12345678;
  for (let axis = 0; axis < 3; ++axis) {
    const d = axes[axis];
    low[axis] = (d.length > 0 ? d[0] : 0) + base * (d.length > 1 ? d[1] : 0);
    high = combine(high, d.length > 2 ? d.length : 0);
    for (let i = 2; i < d.length; ++i) { high = combine(high, signed(d[i])); }
  }
  let turn = 0;
  for (let i = axes[2].length - 1; i >= 0; --i) {
    turn = (((turn * base + axes[2][i]) % 6) + 6) % 6;
  }
  return { low, high, floorTurn: turn };
}

// MARK: The rule that says which book stands at which place, and back

function seedOf(which, design) {
  let s = combine((0xb0b31000 + which) >>> 0, design.key);
  s = combine(s, charactersPerBook(design));
  return combine(s, design.alphabet);
}

function chain(s, digit) {
  let x = Math.imul((s ^ (digit + 1)) >>> 0, 0x9e3779b1) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca77) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
}

/**
 * One pass along the digits. Each digit is shifted by an amount that depends
 * on every scrambled digit before it, so a pass can be undone by walking the
 * same way and subtracting.
 */
function pass(digits, forward, scramble, seed, base) {
  const count = digits.length;
  let s = seed;
  for (let step = 0; step < count; ++step) {
    const i = forward ? step : count - 1 - step;
    const shift = (s >>> 8) % base;
    const input = digits[i];
    const output = scramble ? (input + shift) % base : (input + base - shift) % base;
    digits[i] = output;
    s = chain(s, scramble ? output : input);
  }
}

/** The book at a place. `location` has one digit per character, highest first. */
export function bookAt(location, design) {
  const digits = Uint8Array.from(location);
  const base = design.alphabet;
  if (design.mode === MODE.shuffled) {
    pass(digits, true, true, seedOf(1, design), base);
    pass(digits, false, true, seedOf(2, design), base);
  } else if (design.mode === MODE.seeded) {
    // Soak up the place, then let a generator run.
    const state = [seedOf(3, design), seedOf(4, design), seedOf(5, design), seedOf(6, design)];
    for (let i = 0; i < location.length; ++i) {
      if (location[i] === 0) { continue; }
      const j = i & 3;
      state[j] = combine(state[j], i);
      state[(j + 1) & 3] = combine(state[(j + 1) & 3], location[i]);
    }
    for (let round = 0; round < 4; ++round) {
      state[round] = combine(state[round], state[(round + 3) & 3]);
    }
    let [s0, s1, s2, s3] = state;
    for (let i = 0; i < digits.length; ++i) {
      // xoshiro128**
      const times5 = Math.imul(s1, 5);
      const rotated = (times5 << 7) | (times5 >>> 25);
      const result = Math.imul(rotated, 9) >>> 0;
      const t = s1 << 9;
      s2 ^= s0;
      s3 ^= s1;
      s1 ^= s2;
      s0 ^= s3;
      s2 ^= t;
      s3 = (s3 << 11) | (s3 >>> 21);
      digits[i] = (result >>> 8) % base;
    }
  }
  return digits;
}

/** The place of a book; null in a library that cannot be searched. */
export function locationOf(book, design) {
  if (design.mode === MODE.seeded) { return null; }
  const digits = Uint8Array.from(book);
  if (design.mode === MODE.shuffled) {
    pass(digits, false, false, seedOf(2, design), design.alphabet);
    pass(digits, true, false, seedOf(1, design), design.alphabet);
  }
  return digits;
}

/** Place number = room × books per room + slot; null past the last book. */
function locationOfSlot(room, slot, design) {
  const digits = trimmed(multiplyAdd(room, design.alphabet, booksPerRoom(design), slot));
  const length = charactersPerBook(design);
  if (digits.length > length) { return null; }
  const out = new Uint8Array(length);
  for (let i = 0; i < digits.length; ++i) { out[length - 1 - i] = digits[i]; }
  return out;
}

function roomAndSlot(location, design) {
  const reversed = Uint8Array.from(location).reverse();
  const split = divide(reversed, design.alphabet, booksPerRoom(design));
  return { room: split.quotient, slot: split.remainder };
}

function bookOpeningWith(text, design) {
  const digits = new Uint8Array(charactersPerBook(design)).fill(blank(design));
  for (let i = 0; i < Math.min(text.length, digits.length); ++i) { digits[i] = text[i]; }
  return digits;
}

/** The expansion of numerator ⁄ denominator in the alphabet's base. */
function expansion(numerator, denominator, design) {
  const digits = new Uint8Array(charactersPerBook(design));
  const base = BigInt(design.alphabet);
  let remainder = numerator % denominator;
  for (let i = 0; i < digits.length; ++i) {
    remainder *= base;
    digits[i] = Number(remainder / denominator);
    remainder %= denominator;
  }
  return digits;
}

// MARK: Anchors
//
// A room found by something other than counting from room 0: the room of a
// book with a chosen text, of a number's expansion, or of a room number too
// long to hold in ordinary numbers. Places near it are given as steps from it.

const anchorKinds = [{ kind: 'origin' }];
const anchorKeys = ['origin'];
const resolvedAnchors = new Map();

function anchorIndex(kind, key) {
  let index = anchorKeys.indexOf(key);
  if (index < 0) {
    anchorKinds.push(kind);
    anchorKeys.push(key);
    index = anchorKinds.length - 1;
  }
  return index;
}

export const anchorKind = index => anchorKinds[index] ?? anchorKinds[0];

function remember(map, key, value, limit) {
  if (map.size >= limit) { map.delete(map.keys().next().value); }
  map.set(key, value);
  return value;
}

/** Where the anchor is in a given library; null when it cannot be searched. */
function resolveAnchor(index, design) {
  const key = index + '|' + designKey(design);
  if (resolvedAnchors.has(key)) { return resolvedAnchors.get(key); }
  const anchor = anchorKind(index);
  let value = null;
  const placeOfBook = book => {
    const location = locationOf(book, design);
    if (!location) { return null; }
    const split = roomAndSlot(location, design);
    return { axes: coordinatesOfRoom(split.room, design), slot: split.slot };
  };
  if (anchor.kind === 'origin') {
    value = { axes: [[], [], []], slot: null };
  } else if (anchor.kind === 'number') {
    value = { axes: coordinatesOfRoom(convert(anchor.digits, 32, design.alphabet), design), slot: null };
  } else if (anchor.kind === 'quote') {
    value = placeOfBook(bookOpeningWith(digitsOfText(design, anchor.text), design));
  } else {
    value = placeOfBook(expansion(anchor.numerator, anchor.denominator, design));
  }
  // Each entry can be over a megabyte, so only the latest few are kept.
  return remember(resolvedAnchors, key, value, 6);
}

// MARK: Places
//
// A place is { design, anchor, offset: [column, row, floor], wall, shelf,
// volume, page }. Wall, shelf, volume and page count from 1; 0 means none.

export function newPlace(design = BORGES) {
  return { design: normalized(design), anchor: 0, offset: [0, 0, 0], wall: 0, shelf: 0, volume: 0, page: 0 };
}

export const hasBook = place => place.wall > 0 && place.shelf > 0 && place.volume > 0;

export function slotOf(place) {
  if (!hasBook(place)) { return null; }
  return ((place.wall - 1) * place.design.shelves + (place.shelf - 1)) * place.design.volumes + (place.volume - 1);
}

export function setSlot(place, slot) {
  const d = place.design;
  place.volume = (slot % d.volumes) + 1;
  place.shelf = (Math.floor(slot / d.volumes) % d.shelves) + 1;
  place.wall = Math.floor(slot / (d.volumes * d.shelves)) + 1;
}

const roomCache = new Map();
const bookCache = new Map();
const roomKey = place => designKey(place.design) + '|' + place.anchor + '|' + place.offset.join(',');

function bookCountOf(room, design) {
  const perRoom = booksPerRoom(design);
  // Multiplying by the books per room adds at most fifteen digits.
  if (room.length + 15 <= charactersPerBook(design)) { return perRoom; }
  const exists = slot => locationOfSlot(room, slot, design) !== null;
  if (exists(perRoom - 1)) { return perRoom; }
  if (!exists(0)) { return 0; }
  let low = 0;
  let high = perRoom - 1; // low exists, high does not
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (exists(middle)) { low = middle; } else { high = middle; }
  }
  return high;
}

/** What is known about one room: { axes, integers, low, high, floorTurn, bookCount }. */
export function roomOf(place) {
  const key = roomKey(place);
  if (roomCache.has(key)) { return roomCache.get(key); }
  const anchor = resolveAnchor(place.anchor, place.design);
  let value = null;
  if (anchor) {
    const axes = moved(anchor.axes, place.offset, place.design);
    const seed = shaderSeed(axes, place.design);
    value = {
      axes,
      integers: integersOf(axes, place.design),
      ...seed,
      bookCount: bookCountOf(roomOfCoordinates(axes, place.design), place.design),
    };
  }
  return remember(roomCache, key, value, 8);
}

/** The hash every look in the room is drawn from; the shader computes the same. */
export function roomSeed(room, design) {
  if (design.uniform) { return 0x0b0b0b0b; }
  let s = combine(0x5eed0001, design.key);
  s = combine(s, signed(room.low[0]));
  s = combine(s, signed(room.low[1]));
  s = combine(s, signed(room.low[2]));
  return combine(s, room.high);
}

/** The hash a book's looks are drawn from. */
export function bookHash(place) {
  const room = roomOf(place);
  let h = combine(room ? roomSeed(room, place.design) : 0, Math.max(place.wall - 1, 0));
  h = combine(h, Math.max(place.shelf - 1, 0));
  return combine(h, Math.max(place.volume - 1, 0));
}

/** The chosen book's digits, or null if none stands there. */
export function bookOf(place) {
  const slot = slotOf(place);
  if (slot === null) { return null; }
  const key = roomKey(place) + '|' + slot;
  if (bookCache.has(key)) { return bookCache.get(key); }
  let value = null;
  const room = roomOf(place);
  if (room) {
    const location = locationOfSlot(roomOfCoordinates(room.axes, place.design), slot, place.design);
    if (location) { value = bookAt(location, place.design); }
  }
  return remember(bookCache, key, value, 4);
}

export function pageOf(book, design, number) {
  const set = symbols(design);
  const start = (number - 1) * charactersPerPage(design);
  const lines = [];
  for (let line = 0; line < design.lines; ++line) {
    let text = '';
    const from = start + line * design.columns;
    for (let i = 0; i < design.columns; ++i) { text += set[book[from + i]]; }
    lines.push(text);
  }
  return lines;
}

export function titleOf(book, design) {
  const set = symbols(design);
  let text = '';
  for (let i = 0; i < Math.min(24, book.length); ++i) { text += set[book[i]]; }
  return text.trim();
}

// MARK: The typable address: design:room:wall.shelf.volume.page

export class AddressError extends Error {}

const offsetText = offset => (offset.every(v => v === 0) ? '' : '+' + offset.join(','));

function escaped(text, design) {
  const underscoreIsSpace = !symbols(design).includes('_');
  let out = '';
  for (const c of text) {
    if (c === ' ' && underscoreIsSpace) {
      out += '_';
    } else if ('\'":%_~+ #'.includes(c) || c.charCodeAt(0) > 126) {
      for (const byte of new TextEncoder().encode(c)) {
        out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
      }
    } else {
      out += c;
    }
  }
  return out;
}

function unescaped(text, design) {
  const spaced = symbols(design).includes('_') ? text : text.replaceAll('_', ' ');
  // %XX stands for a byte; a % that is not followed by two hex digits stands
  // for itself.
  const raw = new TextEncoder().encode(spaced);
  const bytes = [];
  for (let i = 0; i < raw.length; ++i) {
    const hex = i + 2 < raw.length ? String.fromCharCode(raw[i + 1], raw[i + 2]) : '';
    if (raw[i] === 0x25 && /^[0-9a-fA-F]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(raw[i]);
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

export function roomText(place) {
  const anchor = anchorKind(place.anchor);
  if (anchor.kind === 'quote') {
    return "'" + escaped(anchor.text, place.design) + "'" + offsetText(place.offset);
  }
  if (anchor.kind === 'fraction') {
    return `=${anchor.numerator}/${anchor.denominator}` + offsetText(place.offset);
  }
  const room = roomOf(place);
  if (!room) { return '0'; }
  return base32Text(convert(roomOfCoordinates(room.axes, place.design), place.design.alphabet, 32));
}

/** The address of a place, with where the viewer stands if `view` is given. */
export function addressText(place, view = null) {
  let out = designCode(place.design) + ':' + roomText(place);
  if (hasBook(place)) {
    out += `:${place.wall}.${place.shelf}.${place.volume}`;
    if (place.page > 0) { out += '.' + place.page; }
  }
  if (view) {
    const degrees = radians => Math.round((radians * 180) / Math.PI);
    out += `~${view.x.toFixed(2)},${view.z.toFixed(2)},${degrees(view.yaw)},${degrees(view.pitch)}`;
  }
  return out;
}

function triple(text) {
  const parts = text.split(',');
  if (parts.length !== 3) { return null; }
  const out = [];
  for (const part of parts) {
    if (!/^\s*[+-]?\d+\s*$/.test(part)) { return null; }
    const value = Number(part);
    if (!(Math.abs(value) < 2 ** 50)) { return null; }
    out.push(value);
  }
  return out;
}

function readOffset(rest, place) {
  if (rest === '') { return; }
  const offset = rest.startsWith('+') ? triple(rest.slice(1)) : null;
  if (!offset) { throw new AddressError('Steps from a quotation are written +column,row,floor.'); }
  place.offset = offset;
}

function anchorSlot(place) {
  const resolved = resolveAnchor(place.anchor, place.design);
  if (!resolved) {
    throw new AddressError('A library of seeds cannot be searched: its books are not arranged by their text.');
  }
  return resolved.slot;
}

function fraction(text) {
  const slash = text.indexOf('/');
  if (slash >= 0) {
    const p = text.slice(0, slash);
    const q = text.slice(slash + 1);
    if (!/^\d{1,20}$/.test(p) || !/^\d{1,20}$/.test(q)) { return null; }
    const numerator = BigInt(p);
    const denominator = BigInt(q);
    if (denominator <= 0n || denominator >= 1n << 56n || numerator >= denominator) { return null; }
    return [numerator, denominator];
  }
  const point = text.indexOf('.');
  if (point < 0) { return text === '0' ? [0n, 1n] : null; }
  const whole = text.slice(0, point);
  const decimals = text.slice(point + 1);
  if ((whole !== '' && whole !== '0') || decimals.length > 16 || !/^\d*$/.test(decimals)) { return null; }
  return [BigInt(decimals === '' ? '0' : decimals), 10n ** BigInt(decimals.length)];
}

/** The book that opens with a text, open at its first page. */
export function placeQuoting(text, design) {
  const place = newPlace(design);
  const words = normalizedText(place.design, text);
  if (words === '') { throw new AddressError('There is nothing to look for.'); }
  if (digitsOfText(place.design, words).length > charactersPerBook(place.design)) {
    throw new AddressError('That text is longer than a book of this library.');
  }
  place.anchor = anchorIndex({ kind: 'quote', text: words }, 'quote:' + words);
  const slot = anchorSlot(place);
  if (slot !== null) {
    setSlot(place, slot);
    place.page = 1;
  }
  return place;
}

/** Reads an address: { place, view }. A missing design means `current`. */
export function parseAddress(input, current) {
  let text = input.trim().replace(/[“”’‘]/g, "'");
  // What a browser makes of quotes typed into its address bar.
  if (!text.includes("'")) {
    text = text.replaceAll('"', "'").replaceAll('%22', "'").replaceAll('%27', "'");
  }
  const hash = text.indexOf('#');
  if (hash >= 0) { text = text.slice(hash + 1); }

  let view = null;
  const tilde = text.lastIndexOf('~');
  if (tilde >= 0) {
    const numbers = text.slice(tilde + 1).split(',').map(Number);
    if (numbers.length === 4 && numbers.every(Number.isFinite)) {
      view = {
        x: numbers[0], z: numbers[1],
        yaw: (numbers[2] * Math.PI) / 180, pitch: (numbers[3] * Math.PI) / 180,
      };
    }
    text = text.slice(0, tilde);
  }

  // Inside quotes a space is free to stand for itself.
  let inQuote = false;
  text = Array.from(text, c => {
    if (c === "'") { inQuote = !inQuote; }
    if (c === ' ') { return inQuote ? '%20' : ''; }
    return c;
  }).join('');

  const parts = text.split(':');
  if (parts.length > 3) {
    throw new AddressError('An address has at most three parts: design:room:place.');
  }

  const place = newPlace(current);
  let roomPart = '0';
  let placePart = '';
  if (parts.length === 1) {
    const design = parts[0] === '' ? null : parseDesign(parts[0]);
    if (design) { place.design = design; } else { roomPart = parts[0]; }
  } else {
    if (parts[0] !== '') {
      const design = parseDesign(parts[0]);
      if (!design) {
        throw new AddressError(`“${parts[0]}” is not a library design. Try borges, or fields such as w5.v20.a29.`);
      }
      place.design = design;
    }
    roomPart = parts[1] === '' ? '0' : parts[1];
    if (parts.length === 3) { placePart = parts[2]; }
  }
  const design = place.design;

  // The room.
  let explicitSlot = null;
  if (roomPart.startsWith("'")) {
    const close = roomPart.lastIndexOf("'");
    if (close <= 0) { throw new AddressError('The quotation has no closing quote.'); }
    const wanted = unescaped(roomPart.slice(1, close), design);
    if (wanted === '') { throw new AddressError('The quotation is empty.'); }
    const words = normalizedText(design, wanted);
    if (digitsOfText(design, words).length > charactersPerBook(design)) {
      throw new AddressError('That text is longer than a book of this library.');
    }
    place.anchor = anchorIndex({ kind: 'quote', text: words }, 'quote:' + words);
    readOffset(roomPart.slice(close + 1), place);
    explicitSlot = anchorSlot(place);
  } else if (roomPart.startsWith('=')) {
    let body = roomPart.slice(1);
    let rest = '';
    const plus = body.indexOf('+');
    if (plus >= 0) {
      rest = body.slice(plus);
      body = body.slice(0, plus);
    }
    const value = fraction(body);
    if (!value) { throw new AddressError('After = comes a number from 0 up to 1, such as 1/7 or 0.25.'); }
    place.anchor = anchorIndex(
      { kind: 'fraction', numerator: value[0], denominator: value[1] }, `fraction:${value[0]}/${value[1]}`
    );
    readOffset(rest, place);
    explicitSlot = anchorSlot(place);
  } else if (roomPart.startsWith('@')) {
    const offset = triple(roomPart.slice(1));
    if (!offset) { throw new AddressError('After @ come three whole numbers: column,row,floor.'); }
    place.offset = offset;
  } else {
    const digits = roomPart.length <= 400 ? base32Digits(roomPart) : null;
    if (!digits) {
      throw new AddressError(`“${roomPart}” is not a room. Use digits and letters (no I, L, O, U), @column,row,floor, or a 'quotation'.`);
    }
    const axes = coordinatesOfRoom(convert(digits, 32, design.alphabet), design);
    const integers = integersOf(axes, design);
    if (integers && integers.every(v => Math.abs(v) < 2 ** 50)) {
      place.offset = integers;
    } else {
      place.anchor = anchorIndex({ kind: 'number', digits }, 'number:' + Array.from(digits).join(','));
    }
  }

  // The place in the room.
  if (placePart !== '') {
    const pieces = placePart.split('.').filter(piece => piece !== '');
    if (pieces.length < 3 || pieces.length > 4 || !pieces.every(piece => /^\d+$/.test(piece))) {
      throw new AddressError('The place is wall.shelf.volume, with the page after it if you like: 2.4.17.112.');
    }
    const n = pieces.map(Number);
    const inRange = (value, top) => value >= 1 && value <= top;
    if (!inRange(n[0], design.walls) || !inRange(n[1], design.shelves) || !inRange(n[2], design.volumes)) {
      throw new AddressError(`This library has ${design.walls} walls of ${design.shelves} shelves, each of ${design.volumes} books.`);
    }
    [place.wall, place.shelf, place.volume] = n;
    if (n.length === 4) {
      if (!inRange(n[3], design.pages)) {
        throw new AddressError(`The books of this library have ${design.pages} pages.`);
      }
      place.page = n[3];
    }
  } else if (explicitSlot !== null && place.offset.every(v => v === 0)) {
    // A quotation names a book, so open it.
    setSlot(place, explicitSlot);
    place.page = 1;
  }
  return { place, view };
}

/** A room a short way from the middle, for the dice. */
export function randomPlace(design) {
  const place = newPlace(design);
  const reach = charactersPerBook(place.design) > 12 ? 2 ** 20 : 2;
  const pick = () => Math.floor(Math.random() * (2 * reach + 1)) - reach;
  place.offset = [pick(), pick(), pick()];
  return place;
}

/** How many books: exactly when small, else as a power of ten. */
export function bookCountText(design) {
  const n = charactersPerBook(design);
  const digits = n * Math.log10(design.alphabet);
  if (digits < 15) { return Math.round(design.alphabet ** n).toLocaleString('en-US'); }
  return `${design.alphabet}^${n.toLocaleString('en-US')} ≈ 10^${Math.floor(digits).toLocaleString('en-US')}`;
}
