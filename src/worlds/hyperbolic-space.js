// The hyperbolic room: one chamber repeated to fill hyperbolic 3-space. This
// is Worlds/Hyperbolic/HyperbolicSpaceWorld.swift, without its explorer; the
// tour's words are copied from it.
import {
  newState, copyState, keyframe, slider, picker, toggle, movePad, readout, group, Camera, Format,
} from './engine.js';
import { FRAGMENT } from './shaders/hyperbolic-space.js';
import { rideRandom, pick } from './ride-support.js';

// MARK: Arithmetic of hyperbolic 3-space
//
// Points live on the hyperboloid x² + y² + z² − w² = −1 and are written
// [x, y, z, w].

const add = (a, b) => a.map((c, i) => c + b[i]);
const sub = (a, b) => a.map((c, i) => c - b[i]);
const times = (a, s) => a.map(c => c * s);

const Hyp3 = {
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3],

  ORIGIN: [0, 0, 0, 1],

  /** A position and three directions at right angles: right, up, back. */
  frame: () => ({ right: [1, 0, 0, 0], up: [0, 1, 0, 0], back: [0, 0, 1, 0], position: [0, 0, 0, 1] }),

  /** Walks `distance` in a direction given in the frame's own axes, carrying
      the axes along without turning them. */
  moved(f, direction, distance) {
    const length = Math.hypot(...direction);
    if (!(length > 1e-12) || distance === 0) { return f; }
    const l = direction.map(c => c / length);
    const v = add(add(times(f.right, l[0]), times(f.up, l[1])), times(f.back, l[2]));
    const carried = add(times(f.position, Math.sinh(distance)), times(v, Math.cosh(distance)));
    const change = sub(carried, v);
    return Hyp3.normalized({
      right: add(f.right, times(change, l[0])),
      up: add(f.up, times(change, l[1])),
      back: add(f.back, times(change, l[2])),
      position: add(times(f.position, Math.cosh(distance)), times(v, Math.sinh(distance))),
    });
  },

  /** Turns the axes by the orbit camera's angles. */
  turned(f, yaw, pitch) {
    const axis = v => {
      const r = Camera.rotate(v, yaw, pitch);
      return add(add(times(f.right, r[0]), times(f.up, r[1])), times(f.back, r[2]));
    };
    return { right: axis([1, 0, 0]), up: axis([0, 1, 0]), back: axis([0, 0, 1]), position: f.position };
  },

  reflected(f, normal) {
    return {
      right: Hyp3.reflect(f.right, normal),
      up: Hyp3.reflect(f.up, normal),
      back: Hyp3.reflect(f.back, normal),
      position: Hyp3.reflect(f.position, normal),
    };
  },

  /** Removes the rounding error that builds up over many steps. */
  normalized(f) {
    const unit = v => times(v, 1 / Math.sqrt(Math.max(Hyp3.dot(v, v), 1e-12)));
    const position = times(f.position, 1 / Math.sqrt(Math.max(-Hyp3.dot(f.position, f.position), 1e-12)));
    let back = add(f.back, times(position, Hyp3.dot(f.back, position)));
    back = unit(back);
    let up = add(f.up, times(position, Hyp3.dot(f.up, position)));
    up = sub(up, times(back, Hyp3.dot(up, back)));
    up = unit(up);
    let right = add(f.right, times(position, Hyp3.dot(f.right, position)));
    right = sub(right, times(back, Hyp3.dot(right, back)));
    right = sub(right, times(up, Hyp3.dot(right, up)));
    right = unit(right);
    return { right, up, back, position };
  },

  /** The point reached by walking along a vector given in the frame's axes. */
  pointAt(f, offset) {
    const distance = Math.hypot(...offset);
    if (!(distance > 1e-12)) { return f.position; }
    const l = offset.map(c => c / distance);
    const v = add(add(times(f.right, l[0]), times(f.up, l[1])), times(f.back, l[2]));
    return add(times(f.position, Math.cosh(distance)), times(v, Math.sinh(distance)));
  },

  reflect: (v, normal) => sub(v, times(normal, 2 * Hyp3.dot(v, normal))),

  distance: (a, b) => Math.acosh(Math.max(-Hyp3.dot(a, b), 1)),

  /** A point from its distance and direction from the middle of the central
      room. */
  pointFromCentre: q => Hyp3.pointAt(Hyp3.frame(), q),

  fromCentre(p) {
    const r = Math.acosh(Math.max(p[3], 1));
    const s = Math.hypot(p[0], p[1], p[2]);
    return s > 1e-12 ? [p[0] * r / s, p[1] * r / s, p[2] * r / s] : [0, 0, 0];
  },
};

/** A room of the honeycomb: a cube or a dodecahedron, with `around` rooms
    sharing each edge. */
class Room {
  constructor(isDodecahedron, around) {
    this.isDodecahedron = isDodecahedron;
    this.around = Math.max(around, isDodecahedron ? 4 : 5);
    const cosDihedral = Math.cos(2 * Math.PI / this.around);
    /** −cos of the angle between neighbouring walls. */
    this.g = -cosDihedral;
    if (isDodecahedron) {
      const phi = (1 + Math.sqrt(5)) / 2;
      const k = 1 / Math.sqrt(1 + phi * phi);
      const f = phi * k;
      this.directions = [];
      for (let index = 0; index < 12; index += 1) {
        const s1 = (index & 1) === 0 ? k : -k;
        const s2 = (index & 2) === 0 ? f : -f;
        switch (index >> 2) {
          case 0: this.directions.push([0, s1, s2]); break;
          case 1: this.directions.push([s1, s2, 0]); break;
          default: this.directions.push([s2, 0, s1]);
        }
      }
      // Neighbouring faces of a dodecahedron lean at cos α = 1 ⁄ √5.
      const cosAlpha = 1 / Math.sqrt(5);
      /** Distance from the middle of the room to each wall. */
      this.inradius = Math.asinh(Math.sqrt((cosAlpha + cosDihedral) / (1 - cosAlpha)));
    } else {
      this.directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      // Neighbouring walls of a cube are at right angles: sinh² a = cos θ.
      this.inradius = Math.asinh(Math.sqrt(cosDihedral));
    }
  }

  normal(index) {
    const u = this.directions[index].map(c => c * Math.cosh(this.inradius));
    return [u[0], u[1], u[2], Math.sinh(this.inradius)];
  }
}

// MARK: The world's state

// Indices into the state's values.
const SHAPE = 0;
const AROUND = 1;
const BEAM = 2;
const VIEW_DISTANCE = 3;
// A step still being taken: distance, then direction in the frame's axes.
const GLIDE = 4;
const GLIDE_X = 5;
const SHOW_HOME = 8;
const WALKED = 9;
/** The home point, as a hyperboloid vector. */
const HOME = 12;
/** The viewer's frame: right, up, back, position. */
const FRAME = 16;

/** cosh of the farthest the viewer may stand from the middle of a room. */
const FARTHEST = Math.cosh(9);
/** A home point farther off than this is far too small to see, and is left
    out before its numbers outgrow single precision. */
const HOME_LIMIT = 1e9;

const vector = (index, state) => state.values.slice(index, index + 4);

function store(v, index, state) {
  for (let i = 0; i < 4; i += 1) { state.values[index + i] = v[i]; }
}

function storeFrame(f, state) {
  store(f.right, FRAME, state);
  store(f.up, FRAME + 4, state);
  store(f.back, FRAME + 8, state);
  store(f.position, FRAME + 12, state);
}

const defaults = newState();
defaults.values[SHAPE] = 0;
defaults.values[AROUND] = 5;
defaults.values[BEAM] = 0.045;
defaults.values[VIEW_DISTANCE] = 4.5;
defaults.values[SHOW_HOME] = 1;
store(Hyp3.ORIGIN, HOME, defaults);
storeFrame(Hyp3.frame(), defaults);
defaults.yaw = 0.42;
defaults.pitch = -0.18;
defaults.cameraDistance = 1;

const room = state => new Room(state.values[SHAPE] > 0.5, Math.round(state.values[AROUND]));

/** Where the viewer stands, before looking around. */
function body(state) {
  // Animations blend the sixteen numbers, which bends the frame slightly.
  const f = Hyp3.normalized({
    right: vector(FRAME, state),
    up: vector(FRAME + 4, state),
    back: vector(FRAME + 8, state),
    position: vector(FRAME + 12, state),
  });
  if (state.values[GLIDE] === 0) { return f; }
  return Hyp3.moved(f, state.values.slice(GLIDE_X, GLIDE_X + 3), state.values[GLIDE]);
}

/** The viewer's eyes: the body's frame turned by the look angles. */
const eyes = state => Hyp3.turned(body(state), state.yaw, state.pitch);

const zoom = state => defaults.cameraDistance / state.cameraDistance;

/**
 * Walks the viewer, then swaps their position for the matching one in the
 * central room. Every room is alike, so the picture is unchanged, and the
 * numbers stay small however far they go.
 */
function walk(direction, distance, state, probe) {
  const r = room(state);
  // The direction is given in the eyes' axes; the body is what moves.
  const inEyes = Camera.rotate(direction, state.yaw, state.pitch);
  let f = Hyp3.moved(body(state), inEyes, distance);
  state.values[GLIDE] = 0;
  let homePoint = vector(HOME, state);
  let probePoint = Hyp3.pointFromCentre([probe[0], probe[1], probe[2]]);
  for (let i = 0; i < 40; i += 1) {
    let moved = false;
    for (let index = 0; index < r.directions.length; index += 1) {
      const n = r.normal(index);
      if (Hyp3.dot(f.position, n) > 1e-9) {
        f = Hyp3.reflected(f, n);
        homePoint = Hyp3.reflect(homePoint, n);
        probePoint = Hyp3.reflect(probePoint, n);
        moved = true;
      }
    }
    if (!moved) { break; }
  }
  f = Hyp3.normalized(f);
  // With six or more rooms round an edge a room runs out to infinity at its
  // corners, and no wall brings the viewer back. A step that would end too
  // far out for the arithmetic is not taken.
  if (!(f.position[3] < FARTHEST)) { return; }
  storeFrame(f, state);
  store(homePoint, HOME, state);
  const q = Hyp3.fromCentre(probePoint);
  probe[0] = q[0];
  probe[1] = q[1];
  probe[2] = q[2];
  probe[3] = 0;
  state.values[WALKED] += Math.abs(distance);
}

// MARK: Guided tour

function gliding(state, direction, distance) {
  const s = copyState(state);
  s.values[GLIDE_X] = direction[0];
  s.values[GLIDE_X + 1] = direction[1];
  s.values[GLIDE_X + 2] = direction[2];
  s.values[GLIDE] = distance;
  return s;
}

function normalizedOrZero(v) {
  const length = Math.hypot(...v);
  return length > 1e-12 ? v.map(c => c / length) : [0, 0, 0];
}

const tour = [
  {
    title: 'A room made of beams',
    body: `
      You are standing in the middle of a cube. Only its twelve edges
      are drawn, as beams, so you can see through the walls into the
      cubes beyond, and through those into more.

      Every room is a perfect cube, all the same size, with square
      walls. But this is not a cubic lattice in ordinary space.
      Something is different about how the rooms fit together.`,
    tryIt: 'Drag to look around',
    build(base) {
      const turned = copyState(base);
      turned.yaw = 1.5;
      turned.pitch = -0.3;
      return [keyframe(base, 2.5, 1.0), keyframe(turned, 10.0)];
    },
  },
  {
    title: 'Five cubes round every edge',
    body: `
      We have moved beside one beam and are looking along it to the
      corner where it ends. In an ordinary cubic lattice six beams
      meet at every corner. Here twelve do.

      Around the beam we are following, the others leave the corner
      in rings of five. That is because five rooms share this beam,
      where ordinary space has room for four: these cubes have walls
      that meet at 72° instead of 90°.`,
    tryIt: 'Honeycomb → Around an edge',
    build(base) {
      // Slide diagonally to the vertical edge of the room (the one
      // where the +x and +z walls meet), stop just short of it,
      // and look straight up along it.
      const r = new Room(false, 5);
      const toEdge = Math.atanh(Math.SQRT2 * Math.tanh(r.inradius));
      const s = gliding(base, [Math.SQRT1_2, 0, Math.SQRT1_2], toEdge - 0.30);
      s.yaw = -3 * Math.PI / 4;
      s.pitch = 1.20;
      s.cameraDistance = 1.3;
      const up = copyState(s);
      up.pitch = 1.45;
      return [keyframe(s, 6.0, 1.0), keyframe(up, 4.0)];
    },
  },
  {
    title: 'Walk, and watch home shrink',
    body: `
      The gold ball marks the middle of the room we started in. We
      are backing away from it in a straight line, at a steady pace,
      for about four rooms.

      In ordinary space, something four times as far looks a quarter
      the size. Here apparent size falls exponentially: at four units
      the ball looks over twenty times smaller than it did at one.
      Distant things do not just get small; they vanish.`,
    tryIt: 'Walk → Move, with Home marker on',
    build(base) {
      const start = copyState(base);
      start.yaw = 0.25;
      start.pitch = -0.12;
      start.values[VIEW_DISTANCE] = 6;
      const near = gliding(start, normalizedOrZero([0.25, 0.1, 1]), 0.9);
      const far = gliding(start, normalizedOrZero([0.25, 0.1, 1]), 4.6);
      return [keyframe(near, 3.0, 1.5), keyframe(far, 14.0)];
    },
  },
  {
    title: 'Beams that part company',
    body: `
      Look down this corridor of rooms. In the Axes colouring, the
      blue beams all run the same way as the corridor, and each one
      crosses every cross-wall at right angles.

      In ordinary space, lines at right angles to the same wall are
      parallel and stay the same distance apart. These spread: the
      farther you follow two neighbouring blue beams, the more room
      opens between them, and more corridors fit in the gap.`,
    build(base) {
      const s = copyState(base);
      s.palette = 0;
      s.yaw = 0.0;
      s.pitch = 0.0;
      s.values[VIEW_DISTANCE] = 7;
      const forward = gliding(s, [0, 0, -1], 0);
      forward.cameraDistance = 1.4;
      const walked = gliding(forward, [0, 0, -1], 2.2);
      return [keyframe(forward, 3.0, 2.0), keyframe(walked, 10.0)];
    },
  },
  {
    title: 'Room grows exponentially',
    body: `
      The fog is lifting. Within two units of you there is room for
      about forty of these cubes. Within four, about 2,700. Within
      eight, about eight million.

      The volume inside distance d grows like e^(2d), where ordinary
      space manages only d³. Almost all of the space within any
      distance of you is right at the far edge of it.`,
    tryIt: 'Look → View distance',
    build(base) {
      const near = copyState(base);
      near.palette = 1;
      near.values[VIEW_DISTANCE] = 1.6;
      near.yaw = 0.7;
      near.pitch = -0.35;
      const far = copyState(near);
      far.values[VIEW_DISTANCE] = 8.5;
      far.yaw = 1.1;
      return [keyframe(near, 2.5, 1.0), keyframe(far, 12.0)];
    },
  },
  {
    title: 'Six round an edge: corners at infinity',
    body: `
      Now six cubes share each edge. The walls must meet at 60°, and
      a cube can only manage that by being larger. Its corners have
      been pushed all the way out to infinity: follow a beam and it
      never reaches a corner.

      Then seven. The corners are now beyond infinity, and each wall
      is an unbounded sheet. The rooms are still all alike.`,
    tryIt: 'Honeycomb → Around an edge',
    build(base) {
      const five = copyState(base);
      five.yaw = 0.9;
      five.pitch = -0.25;
      const six = copyState(five);
      six.values[AROUND] = 6;
      const seven = copyState(five);
      seven.values[AROUND] = 7;
      return [keyframe(five, 2.0, 2.0), keyframe(six, 0, 5.0), keyframe(seven, 0, 4.0)];
    },
  },
  {
    title: 'Rooms with twelve walls',
    body: `
      The room is now a dodecahedron: twelve walls, each a regular
      pentagon. Four of them share each edge, so the walls meet at
      right angles, and eight rooms meet at each corner, exactly as
      the cubes of an ordinary building do.

      A building with square corners and five-sided walls cannot be
      built in ordinary space. Here it fills space perfectly.`,
    tryIt: 'Honeycomb → Room',
    build(base) {
      const s = copyState(base);
      s.values[SHAPE] = 1;
      s.values[AROUND] = 4;
      s.values[BEAM] = 0.05;
      s.palette = 1;
      s.yaw = 0.3;
      s.pitch = -0.2;
      const turned = copyState(s);
      turned.yaw = 1.6;
      turned.pitch = 0.25;
      return [keyframe(s, 1.5, 1.5), keyframe(turned, 12.0)];
    },
  },
  {
    title: 'How the picture is drawn',
    body: `
      Only one room exists in the computer. Each pixel sends a ray
      from your eye along a straight line of this space. Whenever
      the ray passes through a wall, it is reflected back into the
      room and carries on, as if it had gone into the next room,
      which is identical.

      Points are kept as four numbers on a hyperboloid, the same way
      a point on a globe is kept as three. Walking is a matrix that
      plays the part a rotation plays on a globe.`,
    build(base) {
      const s = copyState(base);
      s.yaw = -0.5;
      s.pitch = 0.1;
      return [keyframe(s, 4.0)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Drag to look around, and walk with the Move buttons or W A S D.
      Keep the gold home marker in sight for as long as you can, then
      try to find your way back to it.

      Change how many rooms share an edge, switch to dodecahedra,
      and lift the fog. Every group of controls has an ⓘ note.`,
    build: base => [keyframe(base, 3.0)],
  },
];

// MARK: World

// MARK: Ride

// The ride is a wandering walk: turn to face somewhere new, walk straight
// that way for a room or three, and again.
const ride = {
  title: 'Ride',
  note: `
    The ride walks through the rooms by itself: it turns to face a new way,
    walks straight on for a room or three, and turns again. Watch the gold
    ball that marks home. Touching the picture pauses it.`,
  where(state) {
    const home = vector(HOME, state);
    return Math.abs(home[3]) < HOME_LIMIT
      ? `${Format.number(Hyp3.distance(body(state).position, home), 2)} from home` : 'far from home';
  },
  settings: [
    { key: 'speed', title: 'Speed', range: [0.1, 1], initial: 0.35, display: value => `${value.toFixed(2)} a second` },
  ],
  start(seed) {
    const random = rideRandom(seed);
    return {
      next(current, settings) {
        const speed = Math.min(Math.max(settings.speed ?? 0.35, 0.02), 3);
        // Where the walk has got to becomes the place to walk on from, and
        // is swapped for the matching place in the central room.
        const standing = copyState(current);
        walk([0, 0, -1], 0, standing, [0, 0, 0, 0]);
        const yaw = current.yaw + (random() * 2 - 1) * 1.1;
        const pitch = (random() * 2 - 1) * 0.35;
        const facing = gliding(standing, Camera.rotate([0, 0, -1], yaw, pitch), 0);
        facing.yaw = yaw;
        facing.pitch = pitch;
        // A room is about 1.06 across; rooms that reach infinity are walked
        // more warily.
        const rooms = room(current).around >= 6 ? 1 : pick(random, [1, 2, 2, 3]);
        const distance = 1.06 * rooms;
        const arrived = copyState(facing);
        arrived.values[GLIDE] = distance;
        const turn = keyframe(facing, 1.8, 0, true);
        turn.caption = pick(random, [
          'A wandering walk. Nothing turns you, yet the rooms seem to swing as you pass.',
          'A few rooms on, home is already a speck: here things shrink with distance far faster than in flat space.',
          'There is room for thousands of rooms within four steps of home, so a walk that wanders is hard to retrace.',
        ]);
        return [keyframe(gliding(standing, [0, 0, -1], 0), 0, 0, true), turn, keyframe(arrived, distance / speed, 0.6, true)];
      },
    };
  },
};

// MARK: Explorer

const BALL_RADIUS = 0.10;

/** The walls between the middle of the central room and a point, in the
    order a reflection into that room crosses them. */
function wallsTo(r, point, limit = 60) {
  let p = point;
  const crossed = [];
  for (let i = 0; i < limit; i += 1) {
    let moved = false;
    for (let index = 0; index < r.directions.length; index += 1) {
      const n = r.normal(index);
      if (Hyp3.dot(p, n) > 1e-12) {
        p = Hyp3.reflect(p, n);
        crossed.push(index);
        moved = true;
      }
    }
    if (!moved || crossed.length >= limit) { break; }
  }
  return crossed;
}

/** What the explorer measures from you to its white ball: HyperbolicSpaceWorld.report in the app. */
function explorerReport(q, state) {
  const r = room(state);
  const you = body(state).position;
  const point = Hyp3.pointFromCentre(q);
  const radius = Math.hypot(...q);
  const product = -Hyp3.dot(point, you);
  const distance = Math.acosh(Math.max(product, 1));
  const n = (value, digits = 4) => Format.number(value, digits);
  const four = v => `(${n(v[0], 3)}, ${n(v[1], 3)}, ${n(v[2], 3)}; ${n(v[3], 3)})`;

  // Apparent size.
  const here = Math.sinh(BALL_RADIUS) / Math.max(Math.sinh(distance), Math.sinh(BALL_RADIUS));
  const flat = BALL_RADIUS / Math.max(distance, BALL_RADIUS);
  const angle = Math.asin(Math.min(here, 1));
  const flatAngle = Math.asin(Math.min(flat, 1));
  // Room inside a sphere of that radius.
  const area = 4 * Math.PI * Math.sinh(distance) ** 2;
  const volume = Math.PI * (Math.sinh(2 * distance) - 2 * distance);
  // Walls between the middle of this room and the ball.
  const names = r.isDodecahedron ? Array.from({ length: 12 }, (_, i) => String(i + 1)) : ['+x', '−x', '+y', '−y', '+z', '−z'];
  const walls = wallsTo(r, point);
  const sequence = walls.slice(0, 14).map(index => names[index]).join(' ') + (walls.length > 14 ? ' …' : '');

  const rows = [
    {
      id: 1, cells: ['1', 'distance from you', n(distance, 3)], workedTitle: 'Distance, worked',
      worked: [
        ['ball: r = |(x, y, z)|', n(radius)], ['P = (sinh r · dir; cosh r)', four(point)],
        ['check: w² − x² − y² − z²', n(-Hyp3.dot(point, point))], ['you, O', four(you)],
        ['w·w′ − x·x′ − y·y′ − z·z′', n(product)], ['d = arcosh of that', n(distance)],
      ],
      note: 'Every point of this space is stored as four numbers (x, y, z; w) with w² − x² − y² − z² = 1, a point on a hyperboloid, much as a point on a globe is three numbers with x² + y² + z² = 1. The distance between two points comes from multiplying them together with that same pattern of signs.',
    },
    {
      id: 2, cells: ['2', 'how big it looks', Format.degrees(2 * angle, 2)], workedTitle: 'Apparent size, worked',
      worked: [
        ['ball radius, ρ', n(BALL_RADIUS, 2)], ['sin(half-angle) = sinh ρ ⁄ sinh d', n(here)], ['width in your view', Format.degrees(2 * angle)],
        ['flat space: ρ ⁄ d', n(flat)], ['flat width', Format.degrees(2 * flatAngle)],
        ['looks smaller by', `${n(flatAngle / Math.max(angle, 1e-12), 2)}×`],
      ],
      note: 'In flat space something twice as far looks half as wide. Here width falls like 1 ⁄ sinh d, which is about 2e^(−d): each extra unit of distance shrinks things by a factor of 2.7. A few rooms away, a ball is a dot.',
    },
    {
      id: 3, cells: ['3', 'room within reach', Format.significant(volume, 4)], workedTitle: 'Sphere of radius d, worked',
      worked: [
        ['radius, d', n(distance)], ['surface: 4π sinh² d', Format.significant(area, 5)],
        ['flat surface: 4πd²', Format.significant(4 * Math.PI * distance * distance, 5)],
        ['volume: π(sinh 2d − 2d)', Format.significant(volume, 5)],
        ['flat volume: 4⁄3 πd³', Format.significant(4 / 3 * Math.PI * distance ** 3, 5)],
      ],
      note: 'The space inside a given distance grows like e^(2d), not d³. Ten units away there is room for hundreds of millions of rooms. That is why the far field looks so crowded, and why a walk that wanders is so hard to retrace.',
    },
    {
      id: 4, cells: ['4', 'walls in between', String(walls.length)], workedTitle: 'Finding the ball\'s room, worked',
      worked: [['walls crossed', String(walls.length)], ['in order', sequence || 'none: it is in your room']],
      note: 'The picture is drawn the same way. A ray leaves your eye and, each time it passes through a wall, it is reflected back into the one room that is actually computed. The ball\'s room is found by reflecting the ball\'s position in walls until it lands inside the central room.',
    },
  ];
  return {
    headline: `The ball is ${n(distance, 3)} from you`,
    details: [`It is ${n(BALL_RADIUS, 2)} in radius and looks ${Format.degrees(2 * angle, 1)} wide. In flat space at that distance it would look ${Format.degrees(2 * flatAngle, 1)} wide.`],
    tableTitle: 'Measurements', columns: ['', 'quantity', 'value'], rows, markers: [],
  };
}

const explorer = {
  title: 'Measuring explorer',
  subtitle: 'How far, how small, how much room',
  buttonTitle: 'Measuring explorer',
  blurb: 'The explorer places a white ball in the space and works out its distance from you, how small it looks, and how much room lies inside that distance.',
  pointTitle: 'White ball, from the middle of your room',
  coordinates: ['x', 'y', 'z'].map(label => ({ label, range: [-3, 3] })),
  moveHint: 'Arrow keys move the ball across your view; with Shift, ↑ and ↓ move it away and nearer. The ball stays put in the space when you walk: back away from it and watch how quickly it shrinks.',
  initialProbe(state) {
    // Start a little way ahead of the viewer.
    const q = Hyp3.fromCentre(Hyp3.pointAt(eyes(state), [0.25, 0.1, -1.2]));
    return [q[0], q[1], q[2], 0];
  },
  report: (probe, state) => explorerReport([probe[0], probe[1], probe[2]], state),
  move(probe, right, up, away, state) {
    const f = eyes(state);
    const p = Hyp3.pointFromCentre([probe[0], probe[1], probe[2]]);
    // Walk the ball a short way along one of the viewer's directions,
    // carried to where the ball is.
    const direction = add(add(times(f.right, right), times(f.up, up)), times(f.back, -away));
    let tangent = add(direction, times(p, Hyp3.dot(direction, p)));
    const length = Math.sqrt(Hyp3.dot(tangent, tangent));
    if (!(length > 1e-9)) { return probe; }
    tangent = times(tangent, 1 / length);
    const q = Hyp3.fromCentre(add(times(p, Math.cosh(0.06)), times(tangent, Math.sinh(0.06))));
    return [q[0], q[1], q[2], 0];
  },
};

export const world = {
  id: 'hyperbolic-space',
  title: 'Hyperbolic room',
  formula: '{4, 3, 5}: five cubes round every edge',
  summary: 'Stand inside a cube whose copies fill a space with too much room: five cubes fit round each edge where ordinary space allows four. Walk a few rooms away and home shrinks to a speck.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [0.4, 2.5],
  paletteNames: ['Axes', 'Depth', 'Steel'],
  controlGroups: [
    group('Walk', `
      Drag to look around. The buttons, or W A S D and Q E, walk
      you through the rooms. You keep your heading as you go:
      nothing here turns you, though the rooms may make it look so.

      The gold ball marks where you started. Distance in this
      space is measured in units where the curvature is −1; a
      cube room with five to an edge is about 1.06 wall to wall.`, [
      movePad('Move'),
      toggle('Home marker', SHOW_HOME),
      readout('Distance from home', state =>
        Format.number(Hyp3.distance(body(state).position, vector(HOME, state)), 2)),
      readout('Distance walked', state => Format.number(state.values[WALKED], 2)),
    ]),
    group('Honeycomb', `
      The room is a cube or a dodecahedron, and Around an edge
      says how many rooms share each beam. Ordinary space fits
      exactly four cubes round an edge. Asking for five makes each
      cube's corners sharper (72° between walls instead of 90°),
      which only a hyperbolic cube of one particular size can do.

      With six cubes round an edge the corners reach infinity.
      Dodecahedra with four round an edge have walls at right
      angles, like the rooms of an ordinary building, but twelve
      pentagonal walls each.`, [
      picker('Room', SHAPE, ['Cube', 'Dodecahedron']),
      slider('Around an edge', AROUND, [4, 8], value => String(Math.round(value))),
      readout('Honeycomb', state => {
        const r = room(state);
        return r.isDodecahedron ? `{5, 3, ${r.around}}` : `{4, 3, ${r.around}}`;
      }),
      readout('Angle between walls', state => (360 / room(state).around).toFixed(1) + '°'),
      readout('Centre to wall', state => Format.number(room(state).inradius, 3)),
    ]),
    group('Look', `
      Beam is the thickness of the edges. View distance is how far
      you can see before the fog closes in. Raise it and the
      distance fills with beams: the number of rooms within reach
      grows exponentially, so the far field is far more crowded
      than in any ordinary lattice.`, [
      slider('Beam', BEAM, [0.015, 0.12], value => value.toFixed(3)),
      slider('View distance', VIEW_DISTANCE, [1.5, 9], value => value.toFixed(1)),
    ]),
  ],
  viewNote: `
    Zoom narrows the field of view, like a longer lens. It does not move
    you. In the Axes colouring, beams of a cube honeycomb are coloured by
    which of the cube's three directions they run along.`,
  tour,
  explorer,
  ride,
  shaderValues(state, probe) {
    const r = room(state);
    const f = eyes(state);
    const values = new Array(32).fill(0);
    values[0] = r.isDodecahedron ? 1 : 0;
    values[1] = Math.sinh(r.inradius);
    values[2] = Math.cosh(r.inradius);
    values[3] = r.g;
    values[4] = state.values[BEAM];
    values[5] = state.values[VIEW_DISTANCE];
    values[6] = zoom(state);
    values[7] = state.palette;
    const h = vector(HOME, state);
    if (state.values[SHOW_HOME] > 0.5 && Math.abs(h[3]) < HOME_LIMIT) {
      // The page's address keeps six decimals of the home point, which far
      // from home is no longer exactly on the hyperboloid; put it back.
      const size = -Hyp3.dot(h, h);
      const scale = size > 1e-9 ? 1 / Math.sqrt(size) : 1;
      for (let i = 0; i < 4; i += 1) { values[8 + i] = h[i] * scale; }
    }
    // The explorer's white ball; all zero hides it.
    if (probe) {
      const ball = Hyp3.pointFromCentre([probe[0], probe[1], probe[2]]);
      for (let i = 0; i < 4; i += 1) { values[12 + i] = ball[i]; }
    }
    for (let i = 0; i < 4; i += 1) {
      values[16 + i] = f.right[i];
      values[20 + i] = f.up[i];
      values[24 + i] = f.back[i];
      values[28 + i] = f.position[i];
    }
    return values;
  },
  discreteValues: new Set([SHAPE, AROUND, GLIDE_X, GLIDE_X + 1, GLIDE_X + 2, SHOW_HOME]),
  cameraBacksAwayWhenMoving: false,
  step(state, probe, forward, right, up) {
    // The size of the step is the length of the direction, so that held
    // keys can walk in small, smooth paces.
    const length = Math.hypot(right, up, forward);
    walk([right, up, -forward], 0.07 * Math.min(length, 1.5), state, probe);
  },
  resetView(state) {
    storeFrame(Hyp3.frame(), state);
    store(Hyp3.ORIGIN, HOME, state);
    state.values[GLIDE] = 0;
    state.values[WALKED] = 0;
  },
  tourKeepsPalette: false,
  pitchRange: [-1.5, 1.5],
};
