// Penrose's rhombus tiling, made by de Bruijn's pentagrid: five families of
// parallel lines, every crossing of two of them a tile. This is
// Worlds/Flat/PenroseWorld.swift, without its explorer; the tour's words are
// copied from it.
import { newState, copyState, keyframe, slider, toggle, readout, group } from './engine.js';
import { SHELF, lookDown, pan, dive, sub, flatPointExplorer } from './flat-support.js';
import { FRAGMENT } from './shaders/penrose.js';

// Indices into the state's values.
const SHIFT_X = 0;
const SHIFT_Y = 1;
const RIBBONS = 2;
const CORNERS = 3;

const FARTHEST = 300;
const CLOSEST = 1.5;

const GOLDEN = (1 + Math.sqrt(5)) / 2;

const defaults = lookDown(newState(), 16);

// MARK: The pentagrid

const e = j => [Math.cos(2 * Math.PI * j / 5), Math.sin(2 * Math.PI * j / 5)];

/** The offsets before any phason shift: they add up to zero, and no three
    lines meet at a point. */
const BASE_OFFSETS = [0.13, 0.27, -0.31, 0.22, -0.31];

function offsets(state) {
  const [a, b] = [state.values[SHIFT_X], state.values[SHIFT_Y]];
  return BASE_OFFSETS.map((g, j) => {
    const t = 4 * Math.PI * j / 5;
    return g + a * Math.cos(t) + b * Math.sin(t);
  });
}

function centre(gamma) {
  let c = [0, 0];
  for (let j = 0; j < 5; j += 1) { c = [c[0] + e(j)[0] * gamma[j], c[1] + e(j)[1] * gamma[j]]; }
  return c;
}

const dotE = (x, j) => x[0] * e(j)[0] + x[1] * e(j)[1];
const det = (r, s) => e(r)[0] * e(s)[1] - e(r)[1] * e(s)[0];

/** The tile where lines r = kᵣ and s = kₛ cross: its five whole numbers
    (for the corner with Kᵣ = kᵣ and Kₛ = kₛ), where the lines cross in the
    grid, and that corner's place in the picture. */
function tileAt(r, s, kr, ks, gamma) {
  const er = e(r), es = e(s);
  const d = det(r, s);
  const ar = kr - gamma[r];
  const bs = ks - gamma[s];
  const crossing = [(ar * es[1] - bs * er[1]) / d, (bs * er[0] - ar * es[0]) / d];
  const k = [0, 0, 0, 0, 0];
  k[r] = kr;
  k[s] = ks;
  for (let j = 0; j < 5; j += 1) {
    if (j !== r && j !== s) { k[j] = Math.ceil(dotE(crossing, j) + gamma[j]); }
  }
  let base = [0, 0];
  for (let j = 0; j < 5; j += 1) { base = [base[0] + e(j)[0] * k[j], base[1] + e(j)[1] * k[j]]; }
  return { r, s, kr, ks, k, crossing, base, isThick: s - r === 1 || s - r === 4 };
}

/** The tile that holds the point p of the picture, or null. */
function find(p, gamma) {
  const c = centre(gamma);
  const x0 = [(p[0] - c[0]) / 2.5, (p[1] - c[1]) / 2.5];
  for (let r = 0; r < 4; r += 1) {
    for (let s = r + 1; s < 5; s += 1) {
      const er = e(r), es = e(s);
      const d = det(r, s);
      const tr = dotE(x0, r) + gamma[r];
      const ts = dotE(x0, s) + gamma[s];
      for (let kr = Math.ceil(tr - 1.2); kr <= Math.floor(tr + 1.2); kr += 1) {
        for (let ks = Math.ceil(ts - 1.2); ks <= Math.floor(ts + 1.2); ks += 1) {
          const t = tileAt(r, s, kr, ks, gamma);
          const q = [p[0] - t.base[0], p[1] - t.base[1]];
          const a = (q[0] * es[1] - q[1] * es[0]) / d;
          const b = (er[0] * q[1] - er[1] * q[0]) / d;
          if (a >= 0 && a <= 1 && b >= 0 && b <= 1) { return t; }
        }
      }
    }
  }
  return null;
}

/** Thick and thin tiles whose crossings lie within `radius` of the middle. */
function count(radius, gamma) {
  const reach = radius / 2.5;
  let thick = 0;
  let thin = 0;
  for (let r = 0; r < 4; r += 1) {
    for (let s = r + 1; s < 5; s += 1) {
      const er = e(r);
      const es = e(s);
      const det = er[0] * es[1] - er[1] * es[0];
      const span = Math.ceil(reach + 2);
      for (let kr = -span; kr <= span; kr += 1) {
        for (let ks = -span; ks <= span; ks += 1) {
          const ar = kr - gamma[r];
          const bs = ks - gamma[s];
          const x = [(ar * es[1] - bs * er[1]) / det, (bs * er[0] - ar * es[0]) / det];
          if (Math.hypot(x[0], x[1]) > reach) { continue; }
          if (s - r === 1 || s - r === 4) { thick += 1; } else { thin += 1; }
        }
      }
    }
  }
  return { thick, thin };
}

function ratioText(state) {
  const { thick, thin } = count(30, offsets(state));
  return `${thick} ⁄ ${thin} = ${(thick / Math.max(thin, 1)).toFixed(4)}`;
}

// MARK: Guided tour

function looking(base, x, y, distance) {
  const state = copyState(base);
  state.focus = [x, y, 0];
  state.cameraDistance = distance;
  return state;
}

const tour = [
  {
    title: 'Two tiles that never repeat',
    body: `
      This floor uses just two tiles, both rhombi with sides of
      length 1. The orange one is thick, with corners of 72° and
      108°. The blue one is thin, with corners of 36° and 144°.

      A bathroom floor repeats: slide it by one tile and it lands on
      itself. This one never does. However far you slide it, and in
      whatever direction, it never fits back onto itself.`,
    tryIt: 'Drag to travel across the floor',
    build: base => [
      keyframe(looking(base, 0, 0, 10), 2.5, 1.5),
      keyframe(looking(base, 14, 6, 10), 12.0, 0, true),
    ],
  },
  {
    title: 'Five directions',
    body: `
      Every edge points in one of five directions, a fifth of a
      turn apart, so the floor is full of five-pointed stars,
      pentagons and ten-sided wheels.

      Five-fold symmetry is impossible for any repeating pattern:
      no tiling by regular pentagons exists. Penrose found in 1974
      that it becomes possible once repeating is given up.`,
    tryIt: 'Colour → Ten directions',
    build(base) {
      const state = looking(base, 0, 0, 22);
      state.palette = 1;
      return [keyframe(state, 4.0)];
    },
  },
  {
    title: 'Five families of lines',
    body: `
      Here is how the floor was made. Draw five families of
      parallel lines, each turned a fifth of a turn from the last.
      This is de Bruijn's pentagrid.

      Each place where two lines cross becomes one tile. Lines
      meeting at 72° make a thick tile, lines at 36° a thin one. The
      coloured ribbons are the lines themselves, each running
      through the chain of tiles it made.`,
    tryIt: 'The pentagrid → Show the ribbons',
    build(base) {
      const state = looking(base, 1, 1, 9);
      state.values[RIBBONS] = 1;
      return [keyframe(state, 3.0)];
    },
  },
  {
    title: 'A slice of five dimensions',
    body: `
      Each corner of every tile is reached by stepping along the
      five directions a whole number of times: five whole numbers,
      K₀ to K₄. So every corner is a point of the five-dimensional
      grid of whole numbers.

      The tiling is a thin, flat slice of that grid, laid on the
      plane. Add up the five numbers of a corner and you always get
      1, 2, 3 or 4: the slice passes through just four layers. The
      dots show which.`,
    tryIt: 'Five dimensions → Show the corners; Colour → Five coordinates',
    build(base) {
      const state = looking(base, 1, 1, 9);
      state.values[CORNERS] = 1;
      state.palette = 2;
      return [keyframe(state, 3.0)];
    },
  },
  {
    title: 'The golden ratio, counted',
    body: `
      Count the tiles in a large patch. There are about 1.618 thick
      tiles for every thin one, and the larger the patch the closer
      the count comes to the golden ratio, (1 + √5) ⁄ 2.

      That ratio is not a fraction. A repeating floor would have a
      whole number of each tile in every repeat, and so a ratio that
      is a fraction. This is a short proof that the floor never
      repeats.`,
    tryIt: 'Tiles → Thick ⁄ thin, nearby',
    build: base => [keyframe(looking(base, 0, 0, 70), 6.0)],
  },
  {
    title: 'Sliding the slice',
    body: `
      Now the slice moves through the hidden directions. The five
      families of lines slide against one another, and the floor
      changes by flips: three tiles that make a hexagon swap for the
      other three that fill it, here and there, never all at once.

      After every flip it is still a Penrose tiling. Any patch you
      can see appears in every Penrose tiling, infinitely often, and
      no patch can tell you which tiling you are on.`,
    tryIt: 'Phason shift → Shift, across',
    build(base) {
      const from = looking(base, 0, 0, 14);
      from.values[SHIFT_X] = -0.6;
      const to = copyState(from);
      to.values[SHIFT_X] = 0.6;
      to.values[SHIFT_Y] = 0.3;
      return [keyframe(from, 2.5, 1.0), keyframe(to, 16.0)];
    },
  },
  {
    title: 'Order without repetition',
    body: `
      From far off the floor looks almost regular, and in a sense it
      is: a laser shone through a crystal built this way gives sharp
      spots with ten-fold symmetry. Dan Shechtman saw exactly that in
      an alloy of aluminium and manganese in 1982. Crystallographers
      said it could not happen; it won him the Nobel Prize in 2011.

      Such quasicrystals are ordered, but their order comes from a
      slice of a higher-dimensional grid, as this floor's does.`,
    build: base => [keyframe(looking(base, 0, 0, 40), 3.0), keyframe(looking(base, 0, 0, 200), 10.0)],
  },
  {
    title: 'Your turn',
    body: `
      Travel across the floor, zoom out until the tiles are a haze,
      and switch between the three colourings. Show the ribbons and
      the corners, and slide the phason shift slowly to watch single
      flips. Every group of controls has an ⓘ note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 2.5)],
  },
];

// MARK: World

// MARK: Explorer

const cornerText = c => `(${c.map(n => (n < 0 ? `−${-n}` : String(n))).join(', ')})`;

/** What the explorer says about the tile under a point: PenroseWorld.report in the app. */
function explorerReport(point, state) {
  const g = offsets(state);
  const t = find(point, g);
  if (!t) {
    return {
      headline: 'No tile found here',
      details: ['The search looks a little way round the point\'s place in the grid and found nothing; move the point slightly.'],
      tableTitle: '', columns: [], rows: [], markers: [],
    };
  }
  const rows = [];
  for (let j = 0; j < 5; j += 1) {
    const along = dotE(t.crossing, j) + g[j];
    const crosses = j === t.r || j === t.s;
    rows.push({
      id: j,
      cells: [`e${sub(j)}`, `${72 * j}°`, crosses ? 'crosses here' : `⌈${along.toFixed(3)}⌉`, String(t.k[j])],
      workedTitle: `Family ${j}, worked`,
      worked: [
        ['direction eⱼ', `(${e(j)[0].toFixed(4)}, ${e(j)[1].toFixed(4)})`],
        ['offset γⱼ', g[j].toFixed(4)],
        ['x·eⱼ + γⱼ at the crossing', along.toFixed(4)],
        ['Kⱼ', String(t.k[j])],
        ['Kⱼ·eⱼ', `(${(e(j)[0] * t.k[j]).toFixed(4)}, ${(e(j)[1] * t.k[j]).toFixed(4)})`],
      ],
      note: crosses
        ? `This is one of the two families whose lines cross at this tile. Along the tile its number takes both values ${t.k[j]} and ${t.k[j] + 1}: the tile's edges in direction e${sub(j)} step from one to the other.`
        : 'The crossing lies between two lines of this family, so every corner of the tile has the same whole number here: the line just beyond it, rounded up.',
    });
  }
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([dr, ds]) => {
    const corner = [...t.k];
    corner[t.r] += dr;
    corner[t.s] += ds;
    return cornerText(corner);
  }).join('  ');
  const counts = count(30, g);
  const angle = t.isThick ? 72 : 36;
  return {
    headline: `A ${t.isThick ? 'thick' : 'thin'} tile, ${angle}°: where lines of families ${t.r} and ${t.s} cross`,
    details: [
      `The two families meet at ${angle}°, which is why the tile's sharper angle is ${angle}°.`,
      `Its corners, as points of the five-dimensional grid: ${corners}.`,
      `Each corner is K₀e₀ + … + K₄e₄. The first has K₀ + … + K₄ = ${t.k.reduce((sum, n) => sum + n, 0)}: the layer of the grid it lies in.`,
      `Within 30 units: ${counts.thick} thick and ${counts.thin} thin, a ratio of ${(counts.thick / Math.max(counts.thin, 1)).toFixed(4)}. The golden ratio is ${GOLDEN.toFixed(4)}.`,
    ],
    tableTitle: 'The five families at this crossing', columns: ['', 'turn', 'line', 'Kⱼ'], rows, markers: [],
  };
}

const explorer = {
  ...flatPointExplorer,
  title: 'Tile explorer',
  subtitle: 'Where one tile comes from',
  buttonTitle: 'Tile explorer',
  blurb: 'The explorer takes the tile under a point and shows the two grid lines that cross there, and the five whole numbers that place each of its corners.',
  pointTitle: 'Point on the floor',
  coordinates: [{ label: 'x', range: [-40, 40] }, { label: 'y', range: [-40, 40] }],
  moveHint: 'Arrow keys move the point. Click or tap the picture to put it there.',
  initialProbe: state => [state.focus[0] + 0.3, state.focus[1] + 0.2, 0, 0],
  report: (probe, state) => explorerReport([probe[0], probe[1]], state),
};

export const world = {
  id: 'penrose',
  title: 'Penrose tilings',
  formula: 'Two tiles, five directions, no repeat',
  summary: 'A floor of two kinds of rhombus that covers the whole plane and never repeats itself. It is a flat slice of a five-dimensional grid, and the golden ratio is hidden in its count of tiles.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [CLOSEST, FARTHEST],
  paletteNames: ['Thick and thin', 'Ten directions', 'Five coordinates'],
  controlGroups: [
    group('Tiles', `
      There are two tiles, both rhombi with sides of length 1: a
      thick one with angles of 72° and 108°, and a thin one with
      angles of 36° and 144°. Every edge points in one of five
      directions, a fifth of a turn apart.

      Within any large patch, there are about 1.618 thick tiles for
      every thin one: the golden ratio. Because that ratio is not a
      fraction, the pattern can never repeat by sliding.`, [
      readout('Thick ⁄ thin, nearby', ratioText),
      readout('Golden ratio', () => GOLDEN.toFixed(4)),
    ]),
    group('The pentagrid', `
      Draw five families of parallel lines, one line every unit,
      each family turned a fifth of a turn from the last. Every
      place where two lines cross becomes one tile, and its shape
      is set by the angle at which they cross: 72° makes a thick
      tile, 36° a thin one.

      Shown as ribbons, each line becomes a chain of tiles joined
      edge to edge, all with one edge in common. The ribbons never
      end and never cross one another twice.`, [
      toggle('Show the ribbons', RIBBONS),
    ]),
    group('Five dimensions', `
      Every corner of every tile is a sum K₀e₀ + K₁e₁ + … + K₄e₄ of
      the five unit directions, with whole numbers Kⱼ. So each
      corner is a point of the five-dimensional grid of whole
      numbers, laid flat. The tiling is a thin slice through that
      grid, projected onto the plane.

      The sum K₀ + … + K₄ is always 1, 2, 3 or 4: the slice passes
      through just four layers of the grid. The corners can be
      coloured by their layer.`, [
      toggle('Show the corners', CORNERS),
    ]),
    group('Phason shift', `
      Sliding the slice through the hidden three dimensions moves
      the five families of lines against one another. The tiling
      changes only by flips: three tiles that form a hexagon swap
      for the other three that fill it. Each flip is a local move,
      yet the result is again a Penrose tiling.

      Every finite patch of any Penrose tiling appears in every
      other one, infinitely often. No patch can tell you which
      tiling you are on.`, [
      slider('Shift, across', SHIFT_X, [-1, 1], value => value.toFixed(2)),
      slider('Shift, up', SHIFT_Y, [-1, 1], value => value.toFixed(2)),
    ]),
  ],
  viewNote: `
    Drag to move across the floor and pinch to zoom. Double-tap to dive
    toward a spot. The colour schemes show the tiles' two shapes, their
    ten directions, or the layer of five-dimensional space they come from.`,
  tour,
  explorer,
  shaderValues(state, probe) {
    const gamma = offsets(state);
    const c = centre(gamma);
    const values = new Array(32).fill(0);
    for (let j = 0; j < 5; j += 1) { values[j] = gamma[j]; }
    values[5] = c[0];
    values[6] = c[1];
    values[7] = state.values[RIBBONS] > 0.5 ? 1 : 0;
    values[8] = state.values[CORNERS] > 0.5 ? 1 : 0;
    values[12] = -1;
    // The tile under the explorer's point is lit.
    const tile = probe && find([probe[0], probe[1]], gamma);
    if (tile) {
      values[12] = tile.r;
      values[13] = tile.s;
      values[14] = tile.kr;
      values[15] = tile.ks;
    }
    return values;
  },
  discreteValues: new Set([RIBBONS, CORNERS]),
  cameraBacksAwayWhenMoving: false,
  drag: (state, probe, dx, dy) => pan(state, dx, dy),
  tourKeepsPalette: false,
  pitchRange: [0, 0],
  flatFocus: true,
  zoomTarget: (viewPoint, state, factor) => dive(viewPoint, state, factor, world.cameraDistanceRange),
  urlDigits: 6,
  shelf: SHELF,
};
