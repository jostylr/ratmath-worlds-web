// The gallery's measurements, walking, and what the shader is told:
// the counterpart of BabelWorld.swift. A scene is
// { place, x, z, yaw, pitch, zoom }, where `place` is as in library.js.
import * as L from './library.js';

export const SLAB = 0.45;
export const VESTIBULE = 1.2;
export const VESTIBULE_HALF = 1.2;
export const DOOR_HALF = 0.6;
export const STAIR_Z = 0.74;
export const STAIR_RADIUS = 0.44;
export const MARGIN = 0.10;
export const EYE = 1.62;
export const LENS = 1.5;

const DIRECTIONS = [[1, 0, 0], [0, 1, 0], [-1, 1, 0], [-1, 0, 0], [0, -1, 0], [1, -1, 0]];

const rotate = (p, a) => [Math.cos(a) * p[0] - Math.sin(a) * p[1], Math.sin(a) * p[0] + Math.cos(a) * p[1]];

/** The measurements of a gallery and its vestibules; the shader uses the same. */
export function geometry(design) {
  // Wide enough for the shelf of books.
  const wanted = ((design.volumes * 0.075) / 2 + MARGIN) / Math.tan(Math.PI / design.sides);
  return roomGeometry(design.sides, design.walls, wanted, design.height / 10);
}

/**
 * A room with `furnished` of its walls closed and an apothem of at least
 * `wanted`: more if a doorway needs it.
 */
export function roomGeometry(n, furnished, wanted, height) {
  const open = n - furnished;
  const slope = Math.tan(Math.PI / n);
  const apothem = Math.min(Math.max(wanted, 1.9, 0.85 / slope), 7.0);
  const g = {
    n, open, apothem, height,
    halfWall: apothem * slope,
    shaft: 0.36 * apothem,
    angle: wall => (2 * Math.PI * wall) / n,
    normal: wall => [Math.cos(g.angle(wall)), Math.sin(g.angle(wall))],
    // The k-th wall without shelves: opposite pairs, spread round the room.
    openWall: k => {
      const pairs = Math.floor((open + 1) / 2);
      return Math.floor((Math.floor(k / 2) * (n / 2)) / pairs) + (k % 2 === 1 ? n / 2 : 0);
    },
    isOpen: wall => {
      for (let k = 0; k < open; ++k) { if (g.openWall(k) === wall) { return true; } }
      return false;
    },
    shelvedIndex: wall => {
      let count = 0;
      for (let j = 0; j < wall; ++j) { if (!g.isOpen(j)) { count += 1; } }
      return count;
    },
    wallOfShelved: index => {
      const shelved = [];
      for (let j = 0; j < n; ++j) { if (!g.isOpen(j)) { shelved.push(j); } }
      return shelved[index];
    },
    direction: (wall, floorTurn) => DIRECTIONS[(Math.floor((wall * 6) / n) + floorTurn) % 6],
    reach: p => {
      let most = -Infinity;
      for (let i = 0; i < n; ++i) {
        const normal = g.normal(i);
        most = Math.max(most, p[0] * normal[0] + p[1] * normal[1]);
      }
      return most;
    },
    isInGallery: p => g.reach(p) <= apothem,
    /** Whether a person may stand at a point of the floor. */
    allows: p => {
      const most = g.reach(p);
      if (most <= apothem - 0.28) { return most >= g.shaft + 0.22; }
      for (let k = 0; k < open; ++k) {
        const wall = g.openWall(k);
        const q = rotate(p, -g.angle(wall));
        if (!(q[0] > apothem - 0.3 && Math.abs(q[1]) <= VESTIBULE_HALF)) { continue; }
        const x = q[0] - apothem - VESTIBULE;
        const side = wall < n / 2 ? 1 : -1;
        if (x < -VESTIBULE + 0.28) { return Math.abs(q[1]) <= DOOR_HALF - 0.2; }
        if (x > VESTIBULE - 0.28) {
          return g.isOpen((wall + n / 2) % n) && Math.abs(q[1]) <= DOOR_HALF - 0.2 && x < VESTIBULE + 0.3;
        }
        const fromStair = Math.hypot(x, q[1] - side * STAIR_Z);
        return Math.abs(q[1]) <= VESTIBULE_HALF - 0.25 && fromStair >= STAIR_RADIUS + 0.22;
      }
      return false;
    },
  };
  return g;
}

/** Stands the viewer in front of the chosen book, or at the usual spot. */
export function standSensibly(scene) {
  const p = scene.place;
  const g = geometry(p.design);
  if (L.hasBook(p)) {
    const normal = g.normal(g.wallOfShelved(p.wall - 1));
    const tangent = [-normal[1], normal[0]];
    const usable = g.halfWall - MARGIN;
    const across = ((p.volume - 0.5) / p.design.volumes) * 2 * usable - usable;
    const back = Math.max(g.shaft + 0.3, g.apothem - 1.25);
    const along = (across * back) / g.apothem;
    let spot = [normal[0] * back + tangent[0] * along, normal[1] * back + tangent[1] * along];
    if (!g.allows(spot)) { spot = [normal[0] * back, normal[1] * back]; }
    scene.x = spot[0];
    scene.z = spot[1];
    scene.yaw = Math.atan2(-normal[0], -normal[1]);
    const shelfHeight = (g.height - 2 * MARGIN) / p.design.shelves;
    const bookY = g.height - MARGIN - (p.shelf - 0.5) * shelfHeight;
    scene.pitch = Math.atan2(bookY - EYE, g.apothem - back);
  } else {
    // In a corner, between the railing and the shelves, facing the shaft.
    const corner = g.angle(1) + Math.PI / g.n;
    const radius = (g.shaft + g.apothem) / 2 / Math.cos(Math.PI / g.n);
    scene.x = radius * Math.cos(corner);
    scene.z = radius * Math.sin(corner);
    scene.yaw = Math.atan2(scene.x, scene.z);
    scene.pitch = -0.06;
  }
}

/** A scene at a place, standing where `view` says or somewhere sensible. */
export function sceneAt(place, view = null, zoom = 1) {
  const scene = { place, x: 0, z: 0, yaw: 0, pitch: 0, zoom };
  if (view) {
    Object.assign(scene, view);
  } else {
    standSensibly(scene);
  }
  if (!geometry(place.design).allows([scene.x, scene.z])) { standSensibly(scene); }
  return scene;
}

export function clearBook(place) {
  place.wall = 0;
  place.shelf = 0;
  place.volume = 0;
  place.page = 0;
}

/** Forgets a chosen book that the design no longer has room for. */
export function tidy(place) {
  const d = place.design;
  if (place.wall > d.walls || place.shelf > d.shelves || place.volume > d.volumes) { clearBook(place); }
  place.page = Math.min(place.page, d.pages);
}

/** Walks the viewer: `forward` and `right` in metres, `up` in floors. */
export function walk(scene, forward, right, up) {
  const p = scene.place;
  // A reader stays put.
  if (p.page > 0) { return; }
  const g = geometry(p.design);

  if (up !== 0) {
    const next = p.offset[2] + (up > 0 ? 1 : -1);
    if (Math.abs(next) < 1e15) {
      p.offset = [p.offset[0], p.offset[1], next];
      clearBook(p);
    }
    return;
  }

  const ahead = [-Math.sin(scene.yaw), -Math.cos(scene.yaw)];
  const across = [Math.cos(scene.yaw), -Math.sin(scene.yaw)];
  move(scene, [ahead[0] * forward + across[0] * right, ahead[1] * forward + across[1] * right]);
}

/**
 * A step across the floor of a room, sliding along whatever is in the way:
 * { there, turn, room, crossing }, or null if nothing gives. Past the middle
 * of a vestibule the next gallery takes over: `room` is the step to it,
 * `turn` what to add to the viewer's yaw, and `crossing` carries any point of
 * the old gallery's floor into the new one's frame.
 */
export function stepFrom(g, here, delta, floorTurn) {
  const tries = [
    [here[0] + delta[0], here[1] + delta[1]], [here[0] + delta[0], here[1]], [here[0], here[1] + delta[1]],
  ];
  const there = tries.find(spot => g.allows(spot));
  if (!there) { return null; }
  for (let k = 0; k < g.open; ++k) {
    const wall = g.openWall(k);
    const back = (wall + g.n / 2) % g.n;
    const q = rotate(there, -g.angle(wall));
    if (!(q[0] > g.apothem + VESTIBULE && Math.abs(q[1]) <= VESTIBULE_HALF && g.isOpen(back))) { continue; }
    const crossing = point => {
      const inWall = rotate(point, -g.angle(wall));
      return rotate([2 * (g.apothem + VESTIBULE) - inWall[0], -inWall[1]], g.angle(back));
    };
    return {
      there: crossing(there),
      turn: -(g.angle(back) - g.angle(wall) + Math.PI),
      room: g.direction(wall, floorTurn),
      crossing,
    };
  }
  return { there, turn: 0, room: [0, 0, 0], crossing: null };
}

/**
 * Moves the viewer across the floor. Returns { moved, crossing }.
 */
export function move(scene, delta) {
  const p = scene.place;
  const step = stepFrom(geometry(p.design), [scene.x, scene.z], delta, L.roomOf(p)?.floorTurn ?? 0);
  if (!step) { return { moved: false, crossing: null }; }
  if (step.crossing) {
    const offset = [p.offset[0] + step.room[0], p.offset[1] + step.room[1], p.offset[2]];
    if (!(Math.abs(offset[0]) < 2 ** 50 && Math.abs(offset[1]) < 2 ** 50)) { return { moved: false, crossing: null }; }
    p.offset = offset;
    scene.yaw += step.turn;
    clearBook(p);
  }
  scene.x = step.there[0];
  scene.z = step.there[1];
  return { moved: true, crossing: step.crossing };
}

/**
 * One pace toward a point of the floor. Returns the point in the frame now in
 * force, or null once the viewer has arrived or can get no nearer.
 */
export function pace(scene, target, length) {
  const distance = Math.hypot(target[0] - scene.x, target[1] - scene.z);
  if (!(distance > 0.06)) { return null; }
  const scale = Math.min(length, distance) / distance;
  const result = move(scene, [(target[0] - scene.x) * scale, (target[1] - scene.z) * scale]);
  if (!result.moved) { return null; }
  const goal = result.crossing ? result.crossing(target) : target;
  const left = Math.hypot(goal[0] - scene.x, goal[1] - scene.z);
  // Sliding along a wall that brings the goal no nearer is being stuck.
  return left < distance - length * 0.2 ? goal : null;
}

export const eyeHeight = scene => Math.min(EYE, geometry(scene.place.design).height - 0.2);

function rotateView(v, yaw, pitch) {
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  const x = [v[0], cp * v[1] - sp * v[2], sp * v[1] + cp * v[2]];
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  return [cy * x[0] + sy * x[2], x[1], -sy * x[0] + cy * x[2]];
}

/** The line of sight through a point of the view: { origin, direction }. */
export function sight(scene, u, v) {
  return sightFrom([scene.x, eyeHeight(scene), scene.z], scene, u, v);
}

/** The same from any eye: `view` supplies yaw, pitch and zoom. */
export function sightFrom(origin, view, u, v) {
  const lens = LENS * view.zoom;
  const local = [u * 0.72 * lens, v * 0.72 * lens, -1.65];
  const size = Math.hypot(...local);
  return { origin, direction: rotateView(local.map(c => c / size), view.yaw, view.pitch) };
}

/**
 * The book on the shelves under a point of the view, in the viewer's own
 * gallery: { wall, shelf, volume } counting from 1, or null. `u` and `v` run
 * from −1 to 1 across the shorter side of the view, v upward.
 */
export function bookUnder(scene, u, v) {
  const p = scene.place;
  const d = p.design;
  const g = geometry(d);
  if (!g.isInGallery([scene.x, scene.z])) { return null; }
  const { origin, direction } = sight(scene, u, v);

  let best = Infinity;
  let hitWall = 0;
  for (let i = 0; i < g.n; ++i) {
    const normal = g.normal(i);
    const denominator = direction[0] * normal[0] + direction[2] * normal[1];
    if (!(denominator > 1e-6)) { continue; }
    const t = (g.apothem - (origin[0] * normal[0] + origin[2] * normal[1])) / denominator;
    if (t < best) { best = t; hitWall = i; }
  }
  if (!Number.isFinite(best) || g.isOpen(hitWall)) { return null; }
  const hit = origin.map((c, i) => c + direction[i] * best);
  const normal = g.normal(hitWall);
  const across = -hit[0] * normal[1] + hit[2] * normal[0];
  const usable = g.halfWall - MARGIN;
  const y0 = MARGIN;
  const y1 = g.height - MARGIN;
  if (!(Math.abs(across) < usable && hit[1] > y0 && hit[1] < y1)) { return null; }
  const shelf = Math.min(Math.floor((y1 - hit[1]) / ((y1 - y0) / d.shelves)), d.shelves - 1);
  const volume = Math.min(Math.floor((across + usable) / ((2 * usable) / d.volumes)), d.volumes - 1);
  const wallIndex = g.shelvedIndex(hitWall);
  const slot = (wallIndex * d.shelves + shelf) * d.volumes + volume;
  if (!(slot < (L.roomOf(p)?.bookCount ?? 0))) { return null; }
  return { wall: wallIndex + 1, shelf: shelf + 1, volume: volume + 1 };
}

/**
 * What a line of sight asks for when it lands on something other than a book:
 * { floor: point } to walk to, { floor: foot, climb: ±1 } for a stair,
 * { climb: ±1 } for the shaft, or null.
 */
export function aimUnder(scene, u, v) {
  const { origin, direction } = sight(scene, u, v);
  return aimAlong(geometry(scene.place.design), origin, direction);
}

/** The same for any room and any line of sight. */
export function aimAlong(g, origin, direction) {
  const here = [origin[0], origin[2]];
  const flat = [direction[0], direction[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const point = t => [here[0] + flat[0] * t, here[1] + flat[1] * t];
  const doorHeight = Math.min(2.1, g.height - 0.25);
  const toFloor = direction[1] < -1e-6 ? -origin[1] / direction[1] : Infinity;
  const toCeiling = direction[1] > 1e-6 ? (g.height - origin[1]) / direction[1] : Infinity;

  // From inside the gallery the line must leave by a doorway to reach
  // anything beyond its walls.
  let doorway = null;
  if (g.isInGallery(here)) {
    let toWall = Infinity;
    let wall = 0;
    for (let i = 0; i < g.n; ++i) {
      const denominator = dot(flat, g.normal(i));
      if (!(denominator > 1e-6)) { continue; }
      const t = (g.apothem - dot(here, g.normal(i))) / denominator;
      if (t < toWall) { toWall = t; wall = i; }
    }
    if (Math.min(toFloor, toCeiling) < toWall) {
      const landing = point(Math.min(toFloor, toCeiling));
      const overShaft = g.reach(landing) < g.shaft;
      if (toCeiling < toFloor) { return overShaft ? { climb: 1 } : null; }
      return overShaft ? { climb: -1 } : { floor: landing };
    }
    const normal = g.normal(wall);
    const across = dot(point(toWall), [-normal[1], normal[0]]);
    const height = origin[1] + direction[1] * toWall;
    if (!(g.isOpen(wall) && Math.abs(across) < DOOR_HALF && height < doorHeight)) { return null; }
    doorway = wall;
  }

  // The stair of the vestibule in view.
  for (let k = 0; k < g.open; ++k) {
    const wall = g.openWall(k);
    const inside = rotate(here, -g.angle(wall))[0] > g.apothem;
    if (!(doorway === wall || (doorway === null && inside))) { continue; }
    const side = wall < g.n / 2 ? 1 : -1;
    const middle = g.apothem + VESTIBULE;
    const centre = rotate([middle, side * STAIR_Z], g.angle(wall));
    const offset = [here[0] - centre[0], here[1] - centre[1]];
    const a = dot(flat, flat);
    const b = dot(offset, flat);
    const h = b * b - a * (dot(offset, offset) - STAIR_RADIUS * STAIR_RADIUS);
    if (!(h > 0 && a > 1e-9)) { continue; }
    const t = Math.max((-b - Math.sqrt(h)) / a, 0);
    const height = origin[1] + direction[1] * t;
    if (!(t < toFloor && ((height >= 0 && height <= g.height) || t === 0))) { continue; }
    // Beside the stair, on the near side of the vestibule's middle.
    const foot = rotate([middle - 0.12, side * (STAIR_Z - STAIR_RADIUS - 0.3)], g.angle(wall));
    return { floor: foot, climb: height > 1.25 ? 1 : -1 };
  }

  if (!(Number.isFinite(toFloor) && toFloor * Math.hypot(...flat) < 16)) { return null; }
  return { floor: point(toFloor) };
}

/** The twenty-four numbers handed to the shader, as listed in Babel.metal. */
export function shaderValues(scene) {
  const p = scene.place;
  const d = p.design;
  const g = geometry(d);
  const room = L.roomOf(p);
  const high = room?.high ?? 0;
  return [
    scene.x, eyeHeight(scene), scene.z, LENS * scene.zoom,
    g.n, g.apothem, g.height, d.walls,
    d.shelves, d.volumes, d.uniform ? 1 : 0, room?.bookCount ?? 0,
    room?.low[0] ?? 0, room?.low[1] ?? 0, room?.low[2] ?? 0, room?.floorTurn ?? 0,
    high & 0xffff, high >>> 16, d.key,
    // A library of a few books has only the one room.
    L.charactersPerBook(d) * Math.log2(d.alphabet) > 40 ? 1 : 0,
    p.wall - 1, p.shelf - 1, p.volume - 1, p.page > 0 ? 1 : 0,
  ];
}

export function roomText(place) {
  const room = L.roomOf(place);
  if (!room) { return 'nowhere'; }
  if (room.integers) { return `column ${room.integers[0]}, row ${room.integers[1]}, floor ${room.integers[2]}`; }
  return 'too far to count';
}

/** How one book looks in the hand; drawn from the same hash as its spine. */
export function bookLook(place) {
  if (place.design.uniform) {
    return {
      cover: 'rgb(92, 51, 31)', paper: 'rgb(237, 227, 204)', ink: 'rgb(20, 18, 15)',
      font: 'Courier, monospace', weight: 400,
    };
  }
  const hash = L.bookHash(place);
  const value = 0.12 + 0.55 * L.unit(hash, 5) * L.unit(hash, 5);
  // The shelves are lit by lamps; the hand holds it in better light.
  const cover = hsv(L.unit(hash, 3), 0.25 + 0.65 * L.unit(hash, 4), value ** 0.45);
  const warmth = L.unit(hash, 30);
  const shade = 0.84 + 0.14 * L.unit(hash, 31);
  const paper = rgb([shade, shade - 0.03 - 0.05 * warmth, shade - 0.06 - 0.14 * warmth]);
  const inks = [[0.07, 0.06, 0.06], [0.20, 0.11, 0.05], [0.06, 0.10, 0.24], [0.26, 0.06, 0.08], [0.07, 0.18, 0.12]];
  const fonts = [
    'Menlo, Monaco, Consolas, monospace', '"Courier New", Courier, monospace', 'Courier, monospace',
    'ui-monospace, SFMono-Regular, Consolas, monospace', 'ui-monospace, SFMono-Regular, Consolas, monospace',
  ];
  const weights = [300, 400, 400, 500, 600];
  return {
    cover,
    paper,
    ink: rgb(inks[Math.floor(L.unit(hash, 32) * 4.999)]),
    font: fonts[Math.floor(L.unit(hash, 33) * 4.999)],
    weight: weights[Math.floor(L.unit(hash, 34) * 4.999)],
  };
}

const rgb = c => `rgb(${c.map(v => Math.round(255 * Math.min(Math.max(v, 0), 1))).join(', ')})`;

function hsv(h, s, v) {
  const channel = shift => {
    const k = ((h + shift) % 1) * 6;
    return v * (1 - s + s * Math.min(Math.max(Math.abs(k - 3) - 1, 0), 1));
  };
  return rgb([channel(0), channel(2 / 3), channel(1 / 3)]);
}
