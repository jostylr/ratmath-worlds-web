// The art gallery's rules: designs, addresses, where each frame hangs and
// what its picture is. The counterpart of GalleryWorld.swift, and it must
// agree with it: an address copied from the app has to show the same room and
// the same pictures here. A scene is { place, x, z, yaw, pitch, zoom } and a
// place is { design, room: [column, row, floor], wall, picture }.
import { combine, unit } from '../babel/library.js';
import * as W from '../babel/world.js';

// Floor 0 is mixed, floors 1 to 8 have a rule each, floor 9 the visitor's
// formula; then the cycle repeats, upward and downward.
export const NAMES = ['mix', 'plasma', 'truchet', 'mondrian', 'automaton', 'julia', 'rose', 'bits', 'voronoi', 'formula'];
export const TITLES = [
  'Mixed', 'Plasma', 'Truchet tiles', 'Mondrian', 'Automaton', 'Julia set', 'Rose', 'Bit games', 'Voronoi', 'Formula',
];
export const FORMULA = 9;
export const LONGEST_PROGRAM = 24;
const FIRST_FORMULA = 'xy*4*s';

const mod = (value, by) => ((value % by) + by) % by;
const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);
export const kindOfFloor = floor => mod(floor, 10);

// One character for each step of a formula, with the number the shader
// knows it by.
const STEPS = {
  x: 1, y: 2, r: 3, a: 4, t: 5, u: 6,
  0: 10, 1: 11, 2: 12, 3: 13, 4: 14, 5: 15, 6: 16, 7: 17, 8: 18, 9: 19,
  '+': 20, '-': 21, '*': 22, '/': 23,
  s: 24, c: 25, q: 26, b: 27, f: 28, l: 29, g: 30, d: 31, w: 32, n: 33,
  e: 34, p: 35, i: 36, h: 37, o: 38, m: 39, z: 40,
};
const SYMBOLS = Object.fromEntries(Object.entries(STEPS).map(([symbol, code]) => [code, symbol]));

/** The steps of a formula, or null if it cannot be read. */
export function programOf(text) {
  const out = [];
  for (const c of text.toLowerCase()) {
    if (c === ' ') { continue; }
    if (!(c in STEPS)) { return null; }
    out.push(STEPS[c]);
  }
  return out.length <= LONGEST_PROGRAM ? out : null;
}

export const formulaText = design => design.program.map(code => SYMBOLS[code]).join('');

// MARK: Design

const FIELDS = [['g', 'sides'], ['w', 'walls'], ['v', 'perRow'], ['s', 'rows'], ['h', 'height'], ['k', 'key']];

export function normalized(design) {
  const d = { ...design };
  for (const [, name] of FIELDS) { d[name] = Math.round(Number(d[name]) || 0); }
  d.sides = clamp(2 * Math.floor(d.sides / 2), 4, 12);
  // Every room keeps at least two ways out.
  d.walls = clamp(d.walls, 1, d.sides - 2);
  d.perRow = clamp(d.perRow, 1, 6);
  d.rows = clamp(d.rows, 1, 3);
  d.height = clamp(d.height, 26, 50);
  d.key = clamp(d.key, 0, 999999);
  d.program = d.program && d.program.length > 0 ? [...d.program] : programOf(FIRST_FORMULA);
  return d;
}

export const PLAIN = Object.freeze(normalized({ sides: 6, walls: 4, perRow: 2, rows: 1, height: 34, key: 0, program: [] }));

export const picturesPerWall = d => d.perRow * d.rows;

export function geometry(design) {
  const wanted = ((design.perRow * 1.45) / 2 + 0.25) / Math.tan(Math.PI / design.sides);
  return W.roomGeometry(design.sides, design.walls, wanted, design.height / 10);
}

/** `gallery`, or the fields that differ from it, with the formula after =. */
export function designCode(design) {
  const d = normalized(design);
  const parts = FIELDS.filter(([, name]) => d[name] !== PLAIN[name]).map(([letter, name]) => letter + d[name]);
  if (formulaText(d) !== formulaText(PLAIN)) { parts.push('=' + formulaText(d)); }
  return parts.length === 0 ? 'gallery' : parts.join('.');
}

/**
 * Reads a design code: { design, floor }, or null. A scheme's name is
 * allowed too, and is handed back as the floor it lives on.
 */
export function parseDesign(code) {
  const d = { ...PLAIN, program: [] };
  let floor = null;
  for (const part of code.toLowerCase().split('.')) {
    if (part === '' || part === 'gallery') { continue; }
    if (part.startsWith('=')) {
      const program = programOf(part.slice(1));
      if (!program || program.length === 0) { return null; }
      d.program = program;
      continue;
    }
    if (NAMES.includes(part)) {
      floor = NAMES.indexOf(part);
      continue;
    }
    const field = FIELDS.find(([letter]) => letter === part[0]);
    if (!field || !/^\d+$/.test(part.slice(1))) { return null; }
    d[field[1]] = Number(part.slice(1));
  }
  return { design: normalized(d), floor };
}

// MARK: Places

export function newPlace(design = PLAIN) {
  return { design: normalized(design), room: [0, 0, 0], wall: 0, picture: 0 };
}

export const hasPicture = place => place.wall > 0 && place.picture > 0;
export const floorTurn = place => mod(place.room[2], 6);

/** What the shader is given so that it can hash the same numbers. */
export function seedParts(place) {
  const low = [0, 0, 0];
  let high = 0x77;
  for (let axis = 0; axis < 3; ++axis) {
    low[axis] = mod(place.room[axis], 4096);
    high = combine(high, ((place.room[axis] - low[axis]) / 4096) >>> 0);
  }
  return { low, high };
}

/** The hash every look in the room is drawn from. */
export function roomSeed(place) {
  const { low, high } = seedParts(place);
  let s = combine(0x5eed0001, place.design.key);
  s = combine(s, low[0]);
  s = combine(s, low[1]);
  s = combine(s, low[2]);
  return combine(s, high);
}

/**
 * The picture in a slot of a furnished wall, both counted from 0; slots run
 * along the top row first: { hash, across, up, halfWidth, halfHeight }.
 */
export function frame(place, wall, slot) {
  const d = place.design;
  const g = geometry(d);
  const row = Math.floor(slot / d.perRow);
  const column = slot % d.perRow;
  const hash = combine(combine(combine(roomSeed(place), wall), row), column);
  const usable = g.halfWall - 0.25;
  const y0 = 0.55;
  const y1 = g.height - 0.35;
  const cellWidth = (2 * usable) / d.perRow;
  const cellHeight = (y1 - y0) / d.rows;
  const halfWidth = Math.min(cellWidth * 0.5 - 0.12, 0.85) * (0.72 + 0.28 * unit(hash, 60));
  const halfHeight = Math.min(halfWidth * (0.7 + 0.6 * unit(hash, 61)), cellHeight * 0.5 - 0.14);
  return {
    hash,
    across: -usable + (column + 0.5) * cellWidth,
    up: y1 - (row + 0.5) * cellHeight,
    halfWidth,
    halfHeight,
  };
}

// MARK: Address: design:column,row,floor:wall.picture

export class AddressError extends Error {}

export function addressText(scene, withView = false) {
  const p = scene.place;
  let out = `${designCode(p.design)}:${p.room.join(',')}`;
  if (hasPicture(p)) { out += `:${p.wall}.${p.picture}`; }
  if (withView) {
    const degrees = radians => Math.round((radians * 180) / Math.PI);
    out += `~${scene.x.toFixed(2)},${scene.z.toFixed(2)},${degrees(scene.yaw)},${degrees(scene.pitch)}`;
  }
  return out;
}

/** Reads an address into a scene; missing parts are taken from `base`. */
export function parseAddress(input, base) {
  let text = input.trim().replaceAll(' ', '');
  const hash = text.indexOf('#');
  if (hash >= 0) { text = text.slice(hash + 1); }
  let view = null;
  const tilde = text.lastIndexOf('~');
  if (tilde >= 0) {
    const numbers = text.slice(tilde + 1).split(',').map(Number);
    if (numbers.length === 4 && numbers.every(Number.isFinite)) { view = numbers; }
    text = text.slice(0, tilde);
  }
  const parts = text.split(':');
  if (parts.length > 3) { throw new AddressError('An address has at most three parts: design:room:picture.'); }

  const place = { design: normalized(base.place.design), room: [...base.place.room], wall: 0, picture: 0 };
  let roomPart = '';
  let picturePart = '';
  let schemeFloor = null;
  const takeDesign = read => {
    place.design = read.design;
    schemeFloor = read.floor;
  };
  if (parts.length === 1) {
    const read = parts[0] === '' ? null : parseDesign(parts[0]);
    if (read) { takeDesign(read); } else { roomPart = parts[0]; }
  } else {
    if (parts[0] !== '') {
      const read = parseDesign(parts[0]);
      if (!read) {
        throw new AddressError(`“${parts[0]}” is not a gallery design. Try gallery, fields such as g8.w6.v3, a formula such as =xy*4*s, or a scheme's name.`);
      }
      takeDesign(read);
    }
    roomPart = parts[1];
    if (parts.length === 3) { picturePart = parts[2]; }
  }
  // A scheme's name goes to the floor it hangs on.
  if (schemeFloor !== null) { place.room[2] = schemeFloor; }
  if (roomPart !== '') {
    const pieces = roomPart.split(',');
    const numbers = pieces.map(Number);
    if (pieces.length < 2 || pieces.length > 3 || !pieces.every(piece => /^[+-]?\d+$/.test(piece))
        || !numbers.every(value => Math.abs(value) < 2 ** 50)) {
      throw new AddressError('A room is three whole numbers: column,row,floor.');
    }
    place.room[0] = numbers[0];
    place.room[1] = numbers[1];
    if (numbers.length === 3) { place.room[2] = numbers[2]; }
  }
  if (picturePart !== '') {
    const pieces = picturePart.split('.').filter(piece => piece !== '');
    const [w, n] = pieces.map(Number);
    const d = place.design;
    if (pieces.length !== 2 || !pieces.every(piece => /^\d+$/.test(piece))
        || w < 1 || w > d.walls || n < 1 || n > picturesPerWall(d)) {
      throw new AddressError(`A picture is wall.number: walls 1 to ${d.walls}, pictures 1 to ${picturesPerWall(d)}.`);
    }
    place.wall = w;
    place.picture = n;
  }

  const scene = { place, x: base.x, z: base.z, yaw: base.yaw, pitch: base.pitch, zoom: base.zoom };
  if (view) {
    [scene.x, scene.z] = view;
    scene.yaw = (view[2] * Math.PI) / 180;
    scene.pitch = (view[3] * Math.PI) / 180;
  }
  if (!view || !geometry(place.design).allows([scene.x, scene.z])) { standSensibly(scene); }
  return scene;
}

// MARK: Standing and walking

export const eyeHeight = scene => Math.min(W.EYE, geometry(scene.place.design).height - 0.2);

/** Stands the viewer before the chosen picture, or in a corner of the room. */
export function standSensibly(scene) {
  const p = scene.place;
  const g = geometry(p.design);
  if (hasPicture(p)) {
    const f = frame(p, p.wall - 1, p.picture - 1);
    const normal = g.normal(g.wallOfShelved(p.wall - 1));
    const tangent = [-normal[1], normal[0]];
    // Far enough back for the frame to fit the view, short of the railing.
    const wanted = Math.max(2.7 * Math.max(f.halfWidth, f.halfHeight), 1.2);
    const back = Math.min(wanted, g.apothem - g.shaft - 0.3);
    // Where the room is too small to step back, a wider lens does it.
    scene.zoom = clamp(wanted / back, 1, 1.6);
    const out = g.apothem - back;
    let spot = [normal[0] * out + tangent[0] * f.across, normal[1] * out + tangent[1] * f.across];
    if (!g.allows(spot)) { spot = [normal[0] * out, normal[1] * out]; }
    [scene.x, scene.z] = spot;
    const toPicture = [
      normal[0] * g.apothem + tangent[0] * f.across - spot[0],
      normal[1] * g.apothem + tangent[1] * f.across - spot[1],
    ];
    scene.yaw = Math.atan2(-toPicture[0], -toPicture[1]);
    scene.pitch = Math.atan2(f.up - eyeHeight(scene), Math.hypot(...toPicture));
  } else {
    const corner = g.angle(1) + Math.PI / g.n;
    const radius = (g.shaft + g.apothem) / 2 / Math.cos(Math.PI / g.n);
    scene.x = radius * Math.cos(corner);
    scene.z = radius * Math.sin(corner);
    scene.yaw = Math.atan2(scene.x, scene.z);
    scene.pitch = -0.04;
  }
}

export function sceneAt(place) {
  const scene = { place, x: 0, z: 0, yaw: 0, pitch: 0, zoom: 1 };
  standSensibly(scene);
  return scene;
}

export function clearPicture(place) {
  place.wall = 0;
  place.picture = 0;
}

/** Forgets a chosen picture the design no longer has room for. */
export function tidy(place) {
  if (place.wall > place.design.walls || place.picture > picturesPerWall(place.design)) { clearPicture(place); }
}

/** Moves the viewer across the floor: { moved, crossing }. */
export function move(scene, delta) {
  const p = scene.place;
  const step = W.stepFrom(geometry(p.design), [scene.x, scene.z], delta, floorTurn(p));
  if (!step) { return { moved: false, crossing: null }; }
  if (step.crossing) {
    const room = [p.room[0] + step.room[0], p.room[1] + step.room[1], p.room[2]];
    if (!(Math.abs(room[0]) < 2 ** 50 && Math.abs(room[1]) < 2 ** 50)) { return { moved: false, crossing: null }; }
    p.room = room;
    scene.yaw += step.turn;
  }
  [scene.x, scene.z] = step.there;
  clearPicture(p);
  return { moved: true, crossing: step.crossing };
}

/** Walks the viewer: `forward` and `right` in metres, `up` in floors. */
export function walk(scene, forward, right, up) {
  if (up !== 0) {
    const next = scene.place.room[2] + (up > 0 ? 1 : -1);
    if (Math.abs(next) < 1e15) {
      scene.place.room = [scene.place.room[0], scene.place.room[1], next];
      clearPicture(scene.place);
    }
    return;
  }
  const ahead = [-Math.sin(scene.yaw), -Math.cos(scene.yaw)];
  const across = [Math.cos(scene.yaw), -Math.sin(scene.yaw)];
  move(scene, [ahead[0] * forward + across[0] * right, ahead[1] * forward + across[1] * right]);
}

/** One pace toward a point of the floor; null once arrived or stuck. */
export function pace(scene, target, length) {
  const distance = Math.hypot(target[0] - scene.x, target[1] - scene.z);
  if (!(distance > 0.06)) { return null; }
  const scale = Math.min(length, distance) / distance;
  const result = move(scene, [(target[0] - scene.x) * scale, (target[1] - scene.z) * scale]);
  if (!result.moved) { return null; }
  const goal = result.crossing ? result.crossing(target) : target;
  const left = Math.hypot(goal[0] - scene.x, goal[1] - scene.z);
  return left < distance - length * 0.2 ? goal : null;
}

/**
 * What lies under a point of the view: { picture: { wall, picture } } for a
 * frame in the viewer's own room, or else somewhere to go, as
 * world.js's aimAlong gives it.
 */
export function under(scene, u, v) {
  const p = scene.place;
  const g = geometry(p.design);
  const { origin, direction } = W.sightFrom([scene.x, eyeHeight(scene), scene.z], scene, u, v);
  if (g.isInGallery([scene.x, scene.z])) {
    let best = Infinity;
    let hitWall = 0;
    for (let i = 0; i < g.n; ++i) {
      const normal = g.normal(i);
      const denominator = direction[0] * normal[0] + direction[2] * normal[1];
      if (!(denominator > 1e-6)) { continue; }
      const t = (g.apothem - (origin[0] * normal[0] + origin[2] * normal[1])) / denominator;
      if (t < best) { best = t; hitWall = i; }
    }
    if (Number.isFinite(best) && !g.isOpen(hitWall)) {
      const hit = origin.map((c, i) => c + direction[i] * best);
      const normal = g.normal(hitWall);
      const across = -hit[0] * normal[1] + hit[2] * normal[0];
      const wallIndex = g.shelvedIndex(hitWall);
      for (let slot = 0; slot < picturesPerWall(p.design); ++slot) {
        const f = frame(p, wallIndex, slot);
        if (Math.abs(across - f.across) < f.halfWidth + 0.1 && Math.abs(hit[1] - f.up) < f.halfHeight + 0.1) {
          return { picture: { wall: wallIndex + 1, picture: slot + 1 } };
        }
      }
    }
  }
  return W.aimAlong(g, origin, direction);
}

/** The thirty-two numbers handed to the shader, as listed in Gallery.metal. */
export function shaderValues(scene) {
  const p = scene.place;
  const d = p.design;
  const g = geometry(d);
  const { low, high } = seedParts(p);
  const values = new Float32Array(32);
  values.set([
    scene.x, eyeHeight(scene), scene.z, W.LENS * scene.zoom,
    g.n, g.apothem, g.height, d.walls,
    d.rows, d.perRow, 0, 0,
    low[0], low[1], low[2], floorTurn(p),
    high & 0xffff, high >>> 16, d.key, 1,
    kindOfFloor(p.room[2]), d.program.length,
  ]);
  d.program.forEach((code, i) => {
    values[24 + Math.floor(i / 3)] += code * (i % 3 === 0 ? 1 : i % 3 === 1 ? 64 : 4096);
  });
  return values;
}

// MARK: What a picture is

/** The label of the chosen picture: { title, lines }, or null. */
export function caption(place) {
  if (!hasPicture(place)) { return null; }
  const h = frame(place, place.wall - 1, place.picture - 1).hash;
  const u = k => unit(h, k);
  const floorKind = kindOfFloor(place.room[2]);
  const kind = floorKind === 0 ? 1 + Math.floor(u(50) * 7.999) : floorKind;
  const fixed = (value, digits) => value.toFixed(digits);
  let lines;
  if (kind === 1) {
    lines = [
      'Two sine waves added together, on a plane that three other waves have first bent out of shape.',
      'The bending angle and the scale come from this picture’s number.',
    ];
  } else if (kind === 2) {
    const n = 3 + Math.floor(u(1) * 8);
    lines = [
      `${n} × ${n} square tiles. Each carries two quarter circles joining the middles of its sides, and is laid one of two ways round.`,
      `Every choice is a coin toss, yet the arcs always join into loops and long wandering paths. There are 2^${n * n} ways to lay this floor.`,
    ];
  } else if (kind === 3) {
    lines = [
      'A rectangle is cut in two, and each piece cut again, up to five times. Where and which way come from the picture’s number.',
      'About one piece in three is painted red, blue or yellow.',
    ];
  } else if (kind === 4) {
    const rule = [30, 90, 110, 54, 60, 73, 105, 150, 126, 22, 45, 18, 182, 122, 146, 62][Math.floor(u(1) * 15.999)];
    lines = [
      `Rule ${rule}. The top row is the start. Each cell of the next row is decided by the three cells above it, and the rule’s number in binary, ${rule.toString(2).padStart(8, '0')}, lists the eight answers.`,
      u(2) > 0.5 ? 'It starts from a single live cell.' : 'It starts from a scatter of live cells.',
    ];
  } else if (kind === 5) {
    const angle = u(1) * 2 * Math.PI;
    const re = 0.7885 * Math.cos(angle);
    const im = 0.7885 * Math.sin(angle);
    lines = [
      `The Julia set of z → z² + c with c = ${fixed(re, 3)} ${im < 0 ? '−' : '+'} ${fixed(Math.abs(im), 3)}i.`,
      'Each point is squared and shifted by c, over and over. Dark points never leave; the colours count how long the others take.',
    ];
  } else if (kind === 6) {
    const k = 2 + Math.floor(u(1) * 7);
    lines = [
      `The rose r = |cos(${k}θ ⁄ 2)|, which has ${k} petals.`,
      `Each petal is filled with ${2 + Math.floor(u(2) * 6)} bands, counted outward from the middle.`,
    ];
  } else if (kind === 7) {
    const size = 32 << Math.floor(u(1) * 2.999);
    const operation = ['x XOR y', 'x AND y', 'x OR y', 'x × y'][Math.floor(u(2) * 3.999)];
    lines = [
      `A ${size} × ${size} grid of whole numbers. Each square is coloured by (${operation}) mod ${3 + Math.floor(u(4) * 28.999)}.`,
      'XOR, AND and OR work on the binary digits of x and y one place at a time, which is where the nested squares and triangles come from.',
    ];
  } else if (kind === 8) {
    const n = 3 + Math.floor(u(1) * 6);
    lines = [
      `${n * n} points are scattered, one in each square of a ${n} × ${n} grid. Every place takes the colour of the point nearest to it.`,
      'The dark lines are where two points are equally near.',
    ];
  } else {
    lines = [
      `Formula: ${formulaText(place.design)}`,
      `Worked at every point with t = ${fixed(u(1), 3)} and u = ${fixed(u(2), 3)}, this picture’s own two numbers.`,
    ];
  }
  return { title: `${TITLES[kind]} No. ${h % 100000}`, lines };
}
