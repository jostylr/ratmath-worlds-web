// Spherical space, filled by the 120 dodecahedral rooms of the 120-cell.
// This is Worlds/Spherical/SphericalSpaceWorld.swift, without its explorer;
// the tour's words are copied from it.
import { newState, copyState, keyframe, toggle, movePad, readout, group, Camera } from './engine.js';
import { FRAGMENT } from './shaders/spherical-space.js';

// Indices into the state's values: the frame takes the first sixteen.
const ALONG = 16;
const HEADING_YAW = 17;
const HEADING_PITCH = 18;
const FOG = 19;
const SHOW_YOU = 20;
const SHOW_BEACON = 21;
const LAYERS = 22;

const HOME = [0, 0, 0, 1];
const HOME_FRAME = { position: HOME, right: [1, 0, 0, 0], up: [0, 1, 0, 0], forward: [0, 0, 1, 0] };

const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const comb = (pairs) => [0, 1, 2, 3].map(i => pairs.reduce((s, [k, v]) => s + k * v[i], 0));
const normal4 = v => { const l = Math.sqrt(dot4(v, v)); return v.map(c => c / l); };

function tidied(f) {
  const o = normal4(f.position);
  const r = normal4(comb([[1, f.right], [-dot4(f.right, o), o]]));
  const u = normal4(comb([[1, f.up], [-dot4(f.up, o), o], [-dot4(f.up, r), r]]));
  const w = normal4(comb([[1, f.forward], [-dot4(f.forward, o), o], [-dot4(f.forward, r), r], [-dot4(f.forward, u), u]]));
  return { position: o, right: r, up: u, forward: w };
}

const direction = (f, local) => normal4(comb([[local[0], f.right], [local[1], f.up], [-local[2], f.forward]]));

/** Walks along the great circle in direction d, carrying the frame. */
function walked(f, distance, d) {
  const o = f.position;
  const moved = comb([[Math.cos(distance), o], [Math.sin(distance), d]]);
  const carried = comb([[-Math.sin(distance), o], [Math.cos(distance), d]]);
  const carry = e => { const a = dot4(e, d); return comb([[1, e], [-a, d], [a, carried]]); };
  return tidied({ position: moved, right: carry(f.right), up: carry(f.up), forward: carry(f.forward) });
}

function store(f, state) {
  for (let i = 0; i < 4; i += 1) {
    state.values[i] = f.position[i];
    state.values[4 + i] = f.right[i];
    state.values[8 + i] = f.up[i];
    state.values[12 + i] = f.forward[i];
  }
}

function stored(state) {
  const v = start => state.values.slice(start, start + 4);
  return tidied({ position: v(0), right: v(4), up: v(8), forward: v(12) });
}

function frame(state) {
  const f = stored(state);
  if (state.values[ALONG] === 0) { return f; }
  const local = Camera.rotate([0, 0, -1], state.values[HEADING_YAW], state.values[HEADING_PITCH]);
  return walked(f, state.values[ALONG], direction(f, local));
}

const distanceFromHome = state => Math.acos(Math.min(Math.max(dot4(frame(state).position, HOME), -1), 1));
const degrees = radians => (radians * 180 / Math.PI).toFixed(1) + '°';

const defaults = newState();
store(HOME_FRAME, defaults);
defaults.values[FOG] = 1;
defaults.values[LAYERS] = 1;
defaults.yaw = 0.25;
defaults.pitch = 0.1;
defaults.cameraDistance = 1;

function walking(base, distance, yaw = 0, pitch = 0, lookYaw = 0, lookPitch = 0) {
  const state = copyState(base);
  state.values[ALONG] = distance;
  state.values[HEADING_YAW] = yaw;
  state.values[HEADING_PITCH] = pitch;
  state.yaw = lookYaw;
  state.pitch = lookPitch;
  return state;
}

// MARK: Guided tour

const tour = [
  {
    title: 'A room with twelve walls',
    body: `
      You are in the middle of a room shaped like a dodecahedron:
      twelve pentagon walls, of which only the edges are drawn, as
      beams. Through the walls are more rooms, all exactly alike.

      Three rooms meet round every beam. In flat space dodecahedra
      cannot do that: they would need 116.6° each, and three of those
      leave a gap. Here the walls meet at 120°, and the rooms fit
      perfectly.`,
    tryIt: 'Drag to look around',
    build: base => [keyframe(walking(base, 0, 0, 0, 0.8, 0.3), 3.0), keyframe(walking(base, 0, 0, 0, -0.4, -0.1), 9.0)],
  },
  {
    title: 'Ten rooms, and home again',
    body: `
      We walk straight ahead, through the middle of a wall, into the
      next room and on. Each room's middle is a tenth of the way
      round. After ten rooms the walk arrives back in the room it
      started from, from behind, without ever turning.

      This space has no edge, and yet it is finite: 120 rooms fill it
      completely, the way six squares make a cube's surface.`,
    tryIt: 'Walk with W or the up arrow',
    build: base => [keyframe(walking(base, 0), 1.5, 0.5), keyframe(walking(base, 2 * Math.PI), 30.0, 0, true)],
  },
  {
    title: 'Farther looks bigger',
    body: `
      A red beacon hangs at the point opposite home, as far away as
      anything can be. Light from it reaches us along every direction
      at once, so it fills the whole sky behind the beams.

      Rays from your eye spread apart until a quarter of the way
      round, then close in again. So past that, the farther away
      something is, the larger it looks, and the beams of the far
      rooms seem to swell as the fog lifts.`,
    tryIt: 'Seeing far → Fog off, Beacon opposite home',
    build(base) {
      const state = walking(base, 0, 0, 0, 0.2, 0.1);
      state.values[FOG] = 0;
      state.values[SHOW_BEACON] = 1;
      return [keyframe(state, 3.0)];
    },
  },
  {
    title: 'The back of your own head',
    body: `
      Now the beacon is gone and you are drawn as a gold ball. Light
      that leaves you and goes all the way round comes back to you
      from behind. Wherever the beams leave a gap, the gold you see is
      yourself, a whole great circle away.`,
    tryIt: 'Seeing far → Show yourself',
    build(base) {
      const state = walking(base, 0.3, 0, 0, 0.3, 0.2);
      state.values[FOG] = 0;
      state.values[SHOW_YOU] = 1;
      return [keyframe(state, 3.0)];
    },
  },
  {
    title: 'Rooms in layers',
    body: `
      The colours show distance from home. Next door are 12 rooms,
      one through each wall. Then come 20, 12, 30, 12, 20 and 12, and
      finally one room, opposite home: 120 in all.

      The layers grow and then shrink again, like circles of latitude
      on a globe, which grow to the equator and shrink to the far
      pole.`,
    build(base) {
      const state = walking(base, 0.25, 0.7, 0.3, 0.9, 0.2);
      state.values[FOG] = 0;
      return [keyframe(state, 6.0)];
    },
  },
  {
    title: 'Less room than flat space',
    body: `
      In the hyperbolic room, space grows faster than in flat space:
      within a few rooms there are thousands. Here it grows more
      slowly, and then stops. The whole space has volume 2π², about
      19.7, and a straight walk of 2π covers everything.

      Einstein's first model of the universe, in 1917, was this
      space. Whether our own universe curves this way, the other, or
      not at all is measured from the pattern of the oldest light; so
      far it looks flat to within about half a percent.`,
    build: base => [keyframe(walking(base, 0.9, -0.4, 0.2, -0.3, 0.1), 8.0)],
  },
  {
    title: 'Your turn',
    body: `
      Walk with W A S D or the arrows and drag to look. Count the rooms
      on the way round, find the room opposite home, and turn the fog
      off to see all the way round. Every group of controls has an ⓘ
      note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 3.0)],
  },
];

// MARK: World

export const world = {
  id: 'spherical-space',
  title: 'Spherical space',
  formula: '{5, 3, 3}: 120 rooms with twelve walls',
  summary: 'The hyperbolic room\'s opposite: a space that curves back on itself, finite but without an edge. 120 rooms, each with twelve pentagon walls, fill it exactly. Walk straight ahead through ten of them and you are home; look far enough and you see the back of your own head.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [0.5, 2.2],
  paletteNames: ['Rooms'],
  controlGroups: [
    group('Walk', `
      Drag to look round. W and S, or the arrows, walk forward and
      back along whatever you face; A and D step sideways. Each
      step is a hundredth of a radian of the great circle you walk
      along.

      The space is the surface of a ball in four dimensions, of
      radius 1. Every straight line is a great circle of length 2π,
      and the farthest anything can be is π, the point opposite.`, [
      movePad('Move'),
      readout('From home', state => degrees(distanceFromHome(state))),
    ]),
    group('The rooms', `
      Every room is a regular dodecahedron, with twelve pentagon
      walls. Three rooms meet round every beam, where flat space
      would need angles of 116.6° and has only room for 360°; here
      each wall meets the next at exactly 120°. 120 rooms fill the
      whole space: the 120-cell, a regular solid of four dimensions.

      Seen from one room, the others come in layers: 12 next door,
      then 20, 12, 30, 12, 20, 12, and a single room opposite. The
      colours follow the layers.`, [
      toggle('Colour by layer', LAYERS),
      readout('Rooms', () => '120'),
      readout('Volume of the space', () => '2π² ≈ 19.74'),
    ]),
    group('Seeing far', `
      Light travels on great circles. Rays leaving your eye spread
      apart until they are a quarter of the way round, then close
      in again, and all meet at the point opposite you. So beyond a
      quarter of the way round, things look larger the farther
      away they are, and a ball at the opposite point fills the
      whole sky.

      Rays that go all the way round come back to you from behind.
      Turn off the fog to see that far, and turn on yourself.`, [
      toggle('Fog', FOG),
      toggle('Show yourself', SHOW_YOU),
      toggle('Beacon opposite home', SHOW_BEACON),
    ]),
  ],
  viewNote: `
    Zoom narrows the view like a longer lens. Reset view returns you to
    the middle of the home room.`,
  tour,
  shaderValues(state) {
    const f = frame(state);
    const values = new Array(32).fill(0);
    for (let i = 0; i < 4; i += 1) {
      values[i] = f.position[i];
      values[4 + i] = f.right[i];
      values[8 + i] = f.up[i];
      values[12 + i] = f.forward[i];
    }
    values[16] = state.values[FOG] > 0.5 ? 1 : 0;
    values[17] = state.values[SHOW_YOU] > 0.5 ? 1 : 0;
    values[18] = state.values[SHOW_BEACON] > 0.5 ? 1 : 0;
    values[19] = state.values[LAYERS] > 0.5 ? 1 : 0;
    values[20] = defaults.cameraDistance / state.cameraDistance;
    return values;
  },
  discreteValues: new Set([FOG, SHOW_YOU, SHOW_BEACON, LAYERS]),
  cameraBacksAwayWhenMoving: false,
  step(state, probe, forward, right) {
    let f = frame(state);
    state.values[ALONG] = 0;
    const size = 0.01;
    if (forward !== 0) { f = walked(f, size * forward, direction(f, Camera.rotate([0, 0, -1], state.yaw, state.pitch))); }
    if (right !== 0) { f = walked(f, size * right, direction(f, Camera.rotate([1, 0, 0], state.yaw, state.pitch))); }
    store(f, state);
  },
  stepHint: 'Arrow keys or W A S D walk; drag to look.',
  resetView(state) {
    state.values = [...defaults.values];
    state.yaw = defaults.yaw;
    state.pitch = defaults.pitch;
  },
  tourKeepsPalette: false,
  pitchRange: [-1.5, 1.5],
};
