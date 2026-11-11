// The words on the spines: each book in the room where the viewer stands is
// lettered with the first word of its text. The shader reads them, with a
// small font, from the table built here (the uData texture). The words are
// worked out by spines-worker.js, a few workers at once. BabelSpines.swift
// in the app does the same.
import * as L from './library.js';

/**
 * Characters 32 to 126, each eight dots wide and twelve high, drawn from
 * Georgia Bold. Each glyph is four numbers of three rows; a row is eight
 * bits, the lowest bit on the left, and the top row comes first.
 */
const GLYPHS = [
  0, 0, 0, 0, 1579008, 530456, 1579008, 0, 3423232, 36, 0, 0,
  524288, 2915880, 1315966, 0, 3932160, 8134246, 3958394, 0, 2967040, 7872301, 7525588, 0,
  1444864, 3042838, 16724795, 0, 1579008, 24, 0, 0, 1585152, 789516, 527372, 8216,
  1575936, 3158064, 1060912, 1048, 1579008, 6204, 0, 0, 0, 8263704, 530456, 0,
  0, 0, 1579008, 2064, 0, 1835008, 28, 0, 0, 0, 1579008, 0,
  2105344, 1052688, 788488, 1028, 0, 6710844, 3958374, 0, 0, 1580056, 3938328, 0,
  0, 3175996, 8289816, 0, 0, 7632444, 6451256, 15462, 0, 3422256, 8270388, 12336,
  0, 31868, 6316092, 15478, 798720, 6700550, 3958374, 0, 0, 2260606, 528400, 1032,
  6700032, 8142438, 4089446, 0, 0, 6710844, 3178086, 3120, 0, 1579008, 1579008, 0,
  0, 1579008, 1579008, 2064, 0, 407648, 6305804, 0, 0, 32256, 15998, 0,
  0, 7347206, 134192, 0, 2497536, 1587300, 1837056, 0, 4460544, 11385218, 228789, 14338,
  1579008, 3421208, 16212540, 0, 6700800, 7224934, 8382182, 0, 4619264, 460615, 8144391, 0,
  6692608, 13027046, 4155078, 0, 4620032, 3026438, 16745990, 0, 5144064, 3026446, 921102, 0,
  6716416, 15926083, 8283747, 0, 6743808, 6710886, 15165030, 0, 1588224, 1579032, 3938328, 0,
  3176448, 3158064, 1979958, 0, 2516736, 1969686, 15152702, 0, 921088, 921102, 16698894, 0,
  6743808, 6192742, 15419994, 0, 5170944, 8018510, 6775410, 0, 6700032, 12829667, 3958467, 0,
  7224832, 4091630, 921102, 0, 6700032, 12829667, 3958467, 28728, 3546880, 1979958, 15169078, 0,
  6716416, 8142406, 4088416, 0, 14286592, 1579032, 3938328, 0, 4646656, 4605510, 3950150, 0,
  4646656, 2894854, 1579036, 0, 1233664, 8281690, 2368564, 0, 2518784, 1580076, 15938100, 0,
  4648704, 1584172, 3938328, 0, 6454784, 1849392, 16762380, 0, 789504, 789516, 789516, 15372,
  263168, 526348, 1052688, 8224, 3158016, 3158064, 3158064, 15408, 1579008, 26148, 0, 0,
  0, 0, 0, 65280, 1054720, 0, 0, 0, 0, 3421720, 8271420, 0,
  394752, 6716982, 4089446, 0, 0, 2518040, 3935750, 0, 6320128, 6780540, 8283751, 0,
  0, 8270872, 3933702, 0, 817152, 789532, 1838092, 0, 0, 3552792, 8127548, 26214,
  394752, 6716982, 8283750, 0, 530432, 1579008, 3676184, 0, 3158016, 3158048, 3158064, 7216,
  394752, 1451526, 7222846, 0, 1579008, 1579032, 3676184, 0, 0, 5930794, 14375514, 0,
  0, 6716980, 8283750, 0, 0, 6710808, 3958374, 0, 0, 6716980, 4089446, 3590,
  0, 6780424, 8283751, 28768, 0, 2915360, 1838092, 0, 0, 1844280, 4076092, 0,
  1572864, 1580060, 3676184, 0, 0, 6710788, 8283750, 0, 0, 2911744, 1579052, 0,
  0, 6181632, 2373246, 0, 0, 1846272, 7746584, 0, 0, 2903552, 1579068, 3592,
  0, 3682816, 8277016, 0, 1587200, 792600, 1579016, 12312, 526336, 526344, 526344, 2056,
  1580032, 3151896, 1579032, 3096, 0, 6029312, 50, 0,
];
const GLYPH_COUNT = 96;
/** Letters a spine can hold, and leading blanks skipped before the word. */
const LONGEST = 16;
const SKIPPED = 24;

/** The first word of a text, as character codes less 32. */
export function firstWord(digits, design) {
  const set = L.symbols(design);
  const capitals = design.alphabet !== 95;
  const out = [];
  let started = false;
  for (const digit of digits) {
    const c = set[digit];
    if (c === ' ') {
      if (started) { break; }
      continue;
    }
    started = true;
    let code = c.charCodeAt(0);
    if (code < 32 || code > 126) { code = 63; }
    if (capitals && code >= 97 && code <= 122) { code -= 32; }
    out.push(code - 32);
    if (out.length === LONGEST) { break; }
  }
  return out;
}

/** Slots in the order they are worked out: the wall the viewer faces first. */
function order(design, yaw, geometry) {
  const look = [-Math.sin(yaw), -Math.cos(yaw)];
  const facing = w => {
    const n = geometry.normal(geometry.wallOfShelved(w));
    return n[0] * look[0] + n[1] * look[1];
  };
  const walls = [...Array(design.walls).keys()].sort((a, b) => facing(b) - facing(a));
  const perWall = design.shelves * design.volumes;
  return walls.flatMap(w => [...Array(perWall).keys()].map(i => w * perWall + i));
}

export class Spines {
  /** onArrive is called when more words are known. */
  constructor(onArrive) {
    this.onArrive = onArrive;
    this.rooms = new Map();
    this.current = null;
    this.workers = [];
    this.generation = 0;
  }

  /** The table for the room of a place: the font, then two entries per slot. */
  table(place, yaw, geometry) {
    const design = place.design;
    const perRoom = L.booksPerRoom(design);
    const out = new Float32Array(4 * (GLYPH_COUNT + 2 * perRoom));
    out.set(GLYPHS);
    const key = L.designCode(design) + '|' + place.anchor + '|' + place.offset.join(',');
    const room = this.room(key, place, yaw, geometry);
    for (let slot = 0; slot < perRoom; ++slot) {
      const word = room.words[slot];
      if (!word) { continue; }
      const at = 4 * (GLYPH_COUNT + 2 * slot);
      out[at] = word.length === 0 ? -1 : word.length;
      for (let i = 0; i < word.length; ++i) {
        const k = Math.floor(i / 3);
        out[at + 1 + k] += word[i] * 2 ** (7 * (i % 3));
      }
    }
    return out;
  }

  room(key, place, yaw, geometry) {
    if (this.current !== key) {
      // Walking on: the room left behind stops being worked on.
      this.stopWorkers();
      this.current = key;
    }
    let room = this.rooms.get(key);
    if (!room) {
      room = { words: new Array(L.booksPerRoom(place.design)).fill(null), working: false };
      if (this.rooms.size >= 4) { this.rooms.delete(this.rooms.keys().next().value); }
      this.rooms.set(key, room);
    }
    if (!room.working && room.words.some(w => w === null)) { this.start(room, place, yaw, geometry); }
    return room;
  }

  stopWorkers() {
    for (const worker of this.workers) { worker.terminate(); }
    this.workers = [];
    this.generation += 1;
    for (const room of this.rooms.values()) { room.working = false; }
  }

  start(room, place, yaw, geometry) {
    room.working = true;
    const design = place.design;
    const found = L.roomOf(place);
    const roomDigits = L.roomDigitsOf(place);
    if (!found || !roomDigits || found.bookCount === 0) {
      room.words = room.words.map(w => w ?? []);
      room.working = false;
      return;
    }
    for (let slot = found.bookCount; slot < room.words.length; ++slot) { room.words[slot] = []; }
    const slots = order(design, yaw, geometry).filter(s => room.words[s] === null);
    const count = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 6, slots.length));
    const generation = this.generation;
    let running = count;
    let pending = false;
    for (let w = 0; w < count; ++w) {
      const mine = slots.filter((_, i) => i % count === w);
      let worker;
      try {
        worker = new Worker(new URL('./spines-worker.js', import.meta.url), { type: 'module' });
      } catch {
        room.working = false;
        return;
      }
      this.workers.push(worker);
      worker.onmessage = ({ data }) => {
        if (generation !== this.generation) { return; }
        if (data.done) {
          worker.terminate();
          this.workers = this.workers.filter(x => x !== worker);
          running -= 1;
          if (running === 0) { room.working = false; }
          return;
        }
        for (const { slot, digits } of data.batch) { room.words[slot] = firstWord(digits, design); }
        if (!pending) {
          pending = true;
          setTimeout(() => { pending = false; this.onArrive(); }, 150);
        }
      };
      worker.onerror = () => { running -= 1; };
      worker.postMessage({
        design, room: Array.from(roomDigits), books: found.bookCount,
        count: SKIPPED + LONGEST, order: mine,
      });
    }
  }
}
