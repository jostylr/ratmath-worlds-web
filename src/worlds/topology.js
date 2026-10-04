// The topology world: surfaces with one side, and how twisting makes them.
// This is Worlds/Topology/TopologyWorld.swift, without its explorer; the
// tour's words are copied from it.
import { newState, copyState, keyframe, slider, picker, toggle, readout, group } from './engine.js';
import { FRAGMENT } from './shaders/topology.js';

// Indices into the state's values.
const SURFACE = 0;
const TWISTS = 1;
const GAP = 2;
const SEAM = 3;
const WIDTH = 4;
const CUT_AWAY = 5;
const SHOW_FLAG = 6;
const FLAG_LAP = 7;

// Geometry of the swept surfaces, as in Topology.metal.
const RING = 1.15;
const SHEET = 0.022;
const FIGURE_SIZE = 0.52;

const SURFACE_NAMES = ['Band', 'Figure-eight tube', 'Klein bottle', 'Roman surface', 'Cross-cap'];
/** Cut-away heights at or above this leave the whole surface visible. */
const CUT_AWAY_DISABLED = 2.6;

const defaults = newState();
defaults.values[TWISTS] = 1;
defaults.values[WIDTH] = 0.42;
defaults.values[CUT_AWAY] = CUT_AWAY_DISABLED;
defaults.yaw = 0.5;
defaults.pitch = -0.55;
defaults.cameraDistance = 5.4;

const surfaceIndex = state => Math.min(Math.max(Math.round(state.values[SURFACE]), 0), 4);
const twistCount = state => Math.round(state.values[TWISTS]);
const isSwept = state => surfaceIndex(state) <= 1;

/**
 * The frame carried round the ring: where the centre of the strip is at
 * angle φ, the direction across the strip, and the direction through it.
 */
function frame(phi, halfTwists) {
  const radial = [Math.cos(phi), 0, Math.sin(phi)];
  const turn = 0.5 * halfTwists * phi;
  const c = Math.cos(turn), s = Math.sin(turn);
  return {
    centre: radial.map(r => r * RING),
    across: [radial[0] * c, s, radial[2] * c],
    normal: [radial[0] * -s, c, radial[2] * -s],
  };
}

/** CPU mirror of worldField in Topology.metal, for the swept surfaces only. */
function distance(p, state) {
  const surface = Math.round(state.values[SURFACE]);
  if (surface > 1) { return Infinity; }
  const rho = Math.hypot(p[0], p[2]);
  const turn = 0.5 * Math.round(state.values[TWISTS]) * Math.atan2(p[2], p[0]);
  const section = [rho - RING, p[1]];
  // (a, b): across the strip, and through it.
  const q = [
    Math.cos(turn) * section[0] + Math.sin(turn) * section[1],
    -Math.sin(turn) * section[0] + Math.cos(turn) * section[1],
  ];
  let d;
  if (surface === 0) {
    const e = [Math.abs(q[0]) - state.values[WIDTH], Math.abs(q[1]) - SHEET];
    d = Math.hypot(Math.max(e[0], 0), Math.max(e[1], 0)) + Math.min(Math.max(e[0], e[1]), 0);
    // A cut down the middle of the strip.
    if (state.values[GAP] > 0) { d = Math.max(d, state.values[GAP] - Math.abs(q[0])); }
  } else {
    // A figure of eight: b² = a²(1 − a²), scaled.
    const w = [q[0] / FIGURE_SIZE, q[1] / FIGURE_SIZE];
    const g = w[1] * w[1] - w[0] * w[0] * (1 - w[0] * w[0]);
    const gradient = [-2 * w[0] + 4 * w[0] * w[0] * w[0], 2 * w[1]];
    d = Math.abs(g) / Math.max(Math.hypot(...gradient), 0.05) * FIGURE_SIZE - SHEET;
  }
  // Keep only the part below the cut-away plane.
  return Math.max(d, p[1] - state.values[CUT_AWAY]);
}

/**
 * A point of a swept surface from how far round it is (in laps) and how far
 * across (−1 to 1), with the direction a flag planted there points.
 */
function surfacePoint(laps, across, state) {
  const f = frame(laps * 2 * Math.PI, twistCount(state));
  if (surfaceIndex(state) === 0) {
    const reach = across * state.values[WIDTH];
    return { position: f.centre.map((c, i) => c + f.across[i] * reach), normal: f.normal };
  }
  // The figure of eight (sin v, sin v cos v), followed along its length.
  const v = across * Math.PI;
  const a = Math.sin(v), b = Math.sin(v) * Math.cos(v);
  const tangent = [Math.cos(v), Math.cos(2 * v)];
  const length = Math.hypot(...tangent);
  const left = [-tangent[1] / length, tangent[0] / length];
  return {
    position: f.centre.map((c, i) => c + (f.across[i] * a + f.normal[i] * b) * FIGURE_SIZE),
    normal: f.across.map((c, i) => c * left[0] + f.normal[i] * left[1]),
  };
}

/** A flag planted on the surface, as two joined markers. */
function flag(laps, across, state, color) {
  const point = surfacePoint(laps, across, state);
  return [
    { position: point.position, size: 1.3, color, connectsToNext: true },
    { position: point.position.map((c, i) => c + point.normal[i] * 0.34), size: 0.9, color, connectsToNext: false },
  ];
}

const tour = [
  {
    title: 'A band with two sides',
    body: `
      Take a strip of paper and join its ends to make a ring. It has
      an inside and an outside, painted here blue and orange, and two
      edges, top and bottom.

      An ant on the orange side can walk for ever without meeting
      blue. To get there it would have to climb over an edge.`,
    tryIt: 'Surface → Half-twists at 0',
    build(base) {
      const p = copyState(base);
      p.values[TWISTS] = 0;
      const turned = copyState(p);
      turned.yaw = 1.6;
      return [keyframe(p, 2.5, 0.5), keyframe(turned, 8.0)];
    },
  },
  {
    title: 'Half a twist: one side',
    body: `
      Before joining the ends, turn one of them over. This is the
      Möbius band. Try to paint it in two colours now and you cannot:
      somewhere orange runs straight into blue, with no edge between.

      Watch that seam move round the band. It is not a feature of the
      surface. It is where our attempt to tell two sides apart breaks
      down, and it can be pushed anywhere but never removed.`,
    tryIt: 'Surface → Half-twists at 1; Paint and cut → Seam',
    build(base) {
      const p = copyState(base);
      p.values[TWISTS] = 1;
      p.values[SEAM] = -2.6;
      const moved = copyState(p);
      moved.values[SEAM] = 2.6;
      moved.yaw = 1.1;
      return [keyframe(p, 3.0, 1.0), keyframe(moved, 14.0)];
    },
  },
  {
    title: 'Carry a flag round',
    body: `
      A flag stands on the band, pointing straight out of it. We carry
      it once round, always keeping it upright on the surface.

      It arrives home pointing the other way. It never crossed an edge
      and never left the surface. Carry it round a second time and it
      is the right way up again. On this surface, "up" is not a
      direction you can agree on all the way round.`,
    tryIt: 'Flag → Show flag, Position',
    build(base) {
      const start = copyState(base);
      start.values[TWISTS] = 1;
      start.palette = 1;
      start.values[SHOW_FLAG] = 1;
      start.values[FLAG_LAP] = 0;
      start.yaw = 0.2;
      start.pitch = -0.6;
      const one = copyState(start);
      one.values[FLAG_LAP] = 1;
      const two = copyState(start);
      two.values[FLAG_LAP] = 2;
      return [keyframe(start, 3.0, 1.5), keyframe(one, 10.0, 2.5), keyframe(two, 10.0)];
    },
  },
  {
    title: 'Cut it down the middle',
    body: `
      Cut an ordinary band lengthwise and you get two thinner bands.
      Now cut the Möbius band the same way.

      It does not fall apart. The cut follows the centre line once
      round, and the two halves it seems to separate are joined to
      each other by the twist. What is left is a single band, twice
      as long, with two sides.`,
    tryIt: 'Paint and cut → Cut',
    build(base) {
      const whole = copyState(base);
      whole.values[TWISTS] = 1;
      whole.palette = 1;
      const cut = copyState(whole);
      cut.values[GAP] = 0.16;
      cut.yaw = 1.5;
      return [keyframe(whole, 2.5, 0.5), keyframe(cut, 9.0)];
    },
  },
  {
    title: 'Odd and even',
    body: `
      Two half-twists make one full twist, and the band has two sides
      again: the paint job succeeds with no seam. Three half-twists:
      one side. Four: two.

      All that matters is whether the strip arrives at the join the
      same way up or reversed. An odd number of half-twists reverses
      it.`,
    tryIt: 'Surface → Half-twists',
    build(base) {
      const twisted = n => {
        const s = copyState(base);
        s.values[TWISTS] = n;
        s.yaw = 0.5 + 0.25 * n;
        return s;
      };
      return [keyframe(twisted(2), 2.0, 3.5), keyframe(twisted(3), 2.0, 3.5), keyframe(twisted(4), 2.0, 3.5)];
    },
  },
  {
    title: 'Close up the edge: a Klein bottle',
    body: `
      A Möbius band has one edge. Replace the flat strip with a
      figure of eight, and carry that round with a half-twist instead.
      The result has no edge at all, and still only one side. It is a
      Klein bottle.

      In our space it has to pass through itself, along the circle
      where the figure of eight crosses. In four dimensions there is
      room for it to miss. The crossing belongs to the picture, not
      to the surface.`,
    tryIt: 'Surface → Figure-eight tube',
    build(base) {
      const p = copyState(base);
      p.values[SURFACE] = 1;
      p.values[TWISTS] = 1;
      p.palette = 1;
      const cut = copyState(p);
      cut.values[CUT_AWAY] = 0.0;
      cut.pitch = -0.9;
      cut.yaw = 1.4;
      return [keyframe(p, 3.0, 2.0), keyframe(cut, 10.0)];
    },
  },
  {
    title: 'The bottle',
    body: `
      This is the same surface in its famous shape: a bottle whose
      neck bends round, passes through its own side, and opens out
      into its own base from within.

      The top is being cut away so you can see inside. Follow the
      inside wall up the neck and you arrive on the outside. An ant
      could walk everywhere on it without crossing an edge, because
      there is none.`,
    tryIt: 'Surface → Klein bottle; Paint and cut → Cut away top',
    build(base) {
      const p = copyState(base);
      p.values[SURFACE] = 2;
      p.yaw = 0.3;
      p.pitch = -0.35;
      p.cameraDistance = 7.2;
      const cut = copyState(p);
      cut.values[CUT_AWAY] = 0.0;
      cut.yaw = 1.0;
      cut.pitch = -0.8;
      return [keyframe(p, 3.0, 2.0), keyframe(cut, 10.0)];
    },
  },
  {
    title: 'The projective plane',
    body: `
      Sew a disk onto the single edge of a Möbius band and you get
      another closed, one-sided surface: the projective plane. It
      also cannot sit in our space without crossing itself.

      This picture of it is the Roman surface, found by Jakob Steiner
      in Rome in 1844. It has the symmetry of a tetrahedron, and
      crosses itself along three lines that meet at its centre.`,
    tryIt: 'Surface → Roman surface or Cross-cap',
    build(base) {
      const roman = copyState(base);
      roman.values[SURFACE] = 3;
      roman.yaw = 0.7;
      roman.pitch = -0.5;
      roman.cameraDistance = 5.8;
      const turned = copyState(roman);
      turned.yaw = 2.2;
      const cap = copyState(turned);
      cap.values[SURFACE] = 4;
      cap.yaw = 2.6;
      return [keyframe(roman, 3.0, 0.5), keyframe(turned, 8.0, 0.5), keyframe(cap, 1.0, 5.0)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Choose a surface and a number of half-twists. Move the seam, cut
      the band, cut the top away, and send the flag round. Every
      group of controls has an ⓘ note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 3.0)],
  },
];

export const world = {
  id: 'topology',
  title: 'One-sided surfaces',
  formula: 'Turn a strip half-way round, and join the ends',
  summary: 'A strip of paper has two sides until you give it a half-twist and join the ends. Follow a flag round a Möbius band and watch it come back upside-down, then close the band up into a Klein bottle.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [1.2, 12.0],
  paletteNames: ['Sides', 'Stripes', 'Chalk'],
  controlGroups: [
    group('Surface', `
      The band and the figure-eight tube are made the same way:
      a flat shape is carried once round a circle, turning as it
      goes. Half-twists says how far it turns: each one is 180°.

      With an even number, the shape arrives the way it left and
      the surface has two sides. With an odd number it arrives
      reversed, and the surface has only one. A band with one
      half-twist is the Möbius band. A figure-eight tube with one
      is a Klein bottle: a Möbius band with its edge closed up.`, [
      picker('Surface', SURFACE, SURFACE_NAMES),
      slider('Half-twists', TWISTS, [0, 5], value => String(Math.round(value)), isSwept),
      readout('Sides', state => (isSwept(state) ? (twistCount(state) % 2 === 0 ? '2' : '1') : '1')),
      readout('Edges', state => (surfaceIndex(state) === 0 ? (twistCount(state) % 2 === 0 ? '2' : '1') : 'none')),
    ]),
    group('Paint and cut', `
      The Sides colouring tries to paint one face orange and the
      other blue. On a one-sided surface that must fail somewhere,
      along a seam where orange meets blue with no edge between
      them. Seam moves it. It can be put anywhere, but it cannot
      be removed.

      Cut slices the band lengthwise down the middle. A two-sided
      band falls into two rings. A Möbius band stays in one piece,
      twice as long.`, [
      slider('Seam', SEAM, [-Math.PI, Math.PI], value => (value * 180 / Math.PI).toFixed(0) + '°', isSwept),
      slider('Cut', GAP, [0, 0.3], value => (value < 0.005 ? 'Off' : value.toFixed(2)),
        state => surfaceIndex(state) === 0),
      slider('Cut away top', CUT_AWAY, [-1.2, CUT_AWAY_DISABLED], value => (value >= 2.0 ? 'Off' : value.toFixed(2))),
    ]),
    group('Flag', `
      A flag is planted on the surface, standing straight up from
      it, and carried round. Position is how many laps it has
      gone. On a two-sided surface it comes home after one lap
      pointing the way it started. On a one-sided surface it comes
      home pointing the opposite way, and needs a second lap to
      be itself again.`, [
      toggle('Show flag', SHOW_FLAG),
      slider('Position, laps', FLAG_LAP, [0, 2], value => value.toFixed(2),
        state => state.values[SHOW_FLAG] > 0.5 && isSwept(state)),
    ]),
  ],
  viewNote: `
    Drag to turn the surface and zoom to move closer; double-click a spot
    on the band or the tube to fly to it. Stripes run along the surface
    and make the twist easier to follow.`,
  tour,
  distance,
  shaderValues(state) {
    const values = new Array(32).fill(0);
    values[0] = surfaceIndex(state);
    // Whole twists only: anything else would not join up.
    values[1] = twistCount(state);
    values[2] = state.values[GAP];
    values[3] = state.values[SEAM];
    values[4] = state.values[WIDTH];
    values[5] = state.values[CUT_AWAY];
    return values;
  },
  discreteValues: new Set([SURFACE, TWISTS, SHOW_FLAG]),
  overlayMarkers(state) {
    if (!(state.values[SHOW_FLAG] > 0.5) || !isSwept(state)) { return []; }
    return flag(state.values[FLAG_LAP], 0, state, [1, 1, 1]);
  },
  tourKeepsPalette: false,
};
