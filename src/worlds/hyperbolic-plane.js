// The hyperbolic plane laboratory: a tiling drawn in the Poincaré disk that
// can be walked across, with straight lines, circles and parallels to try.
// This is Worlds/Hyperbolic/HyperbolicPlaneWorld.swift, without its explorer;
// the tour's words are copied from it.
import { newState, copyState, keyframe, slider, picker, toggle, readout, group, Format } from './engine.js';
import { Hyp, Frame, Line, Tiling } from './hyperbolic-math.js';
import { FRAGMENT } from './shaders/hyperbolic-plane.js';

// Indices into the state's values.
const P = 0;
const Q = 1;
const MODEL = 2;
// Where the viewer stands: true distance and bearing from the centre of the
// central tile, and the direction they face.
const RHO = 3;
const BETA = 4;
const THETA = 5;
// A step still being taken, measured in the viewer's own view.
const GLIDE = 6;
const GLIDE_ANGLE = 7;
const RINGS = 8;
const TRIANGLES = 9;
const CONSTRUCTION = 10;
const POINT_X = 11;
const POINT_Y = 12;
const WALKED = 13;

/** Radius of the disk in view units; HyperbolicPlane.metal uses the same. */
const DISK_RADIUS = 0.9;

const defaults = newState();
defaults.values[P] = 5;
defaults.values[Q] = 4;
defaults.values[POINT_X] = 0.46;
defaults.values[POINT_Y] = 0.30;
defaults.cameraDistance = 1;

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

// MARK: Reading the state

function tiling(state) {
  const p = clamp(Math.round(state.values[P]), 3, 8);
  const q = Math.max(clamp(Math.round(state.values[Q]), 3, 8), Tiling.minimumQ(p));
  return new Tiling(p, q);
}

function frame(state) {
  const v = state.values;
  const base = new Frame(Hyp.scale(Hyp.expi(v[BETA]), Math.tanh(v[RHO] / 2)), v[THETA]);
  if (v[GLIDE] === 0) { return base; }
  return base.translated(Hyp.scale(Hyp.expi(v[GLIDE_ANGLE]), Math.tanh(v[GLIDE] / 2)));
}

function setFrame(f, state) {
  state.values[RHO] = 2 * Math.atanh(Math.min(Hyp.length(f.a), 1 - 1e-12));
  state.values[BETA] = Hyp.arg(f.a);
  state.values[THETA] = f.theta;
  state.values[GLIDE] = 0;
}

/**
 * Moves the viewer by a step measured in their own view. Far from the centre
 * the position is swapped for an equivalent one near it, and the points
 * pinned to the plane are carried along, so nothing visible changes except
 * that colours counted from the centre start again.
 */
function move(step, state, probe) {
  const before = frame(state);
  let after = before.translated(step);
  state.values[WALKED] += 2 * Math.atanh(Math.min(Hyp.length(step), 1 - 1e-12));
  if (Hyp.length(after.a) > Math.tanh(3.5)) {
    const moved = after;
    after = tiling(state).recentered(moved);
    const carry = z => after.apply(moved.inverse(z));
    const point = carry(Hyp.clamped([state.values[POINT_X], state.values[POINT_Y]]));
    state.values[POINT_X] = point[0];
    state.values[POINT_Y] = point[1];
    const carried = carry(Hyp.clamped([probe[0], probe[1]]));
    probe[0] = carried[0];
    probe[1] = carried[1];
    probe[2] = 0;
    probe[3] = 0;
  }
  setFrame(after, state);
}

const zoom = state => defaults.cameraDistance / state.cameraDistance;

/** A Poincaré view point as drawn: farther out in the Klein model. */
function drawn(poincare, state) {
  const blend = clamp(state.values[MODEL], 0, 1);
  const target = Hyp.length(poincare);
  if (!(blend > 0 && target > 1e-9)) { return poincare; }
  // Invert r ↦ mix(r, r ⁄ (1 + √(1 − r²)), blend) by bisection.
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i += 1) {
    const r = (low + high) / 2;
    const value = r + (r / (1 + Math.sqrt(1 - r * r)) - r) * blend;
    if (value < target) { low = r; } else { high = r; }
  }
  return Hyp.scale(poincare, (low + high) / 2 / target);
}

/** The Poincaré view point shown at a drawn position. */
function undrawn(w, state) {
  const blend = clamp(state.values[MODEL], 0, 1);
  const length = Hyp.length(w);
  const r = Math.min(length, 0.999);
  const clamped = length > 0.999 ? Hyp.scale(w, 0.999 / length) : w;
  return Hyp.scale(clamped, 1 + (1 / (1 + Math.sqrt(1 - r * r)) - 1) * blend);
}

// MARK: Constructions

// Linear colours; the render target is sRGB.
const WHITE = [1, 1, 1];
const CYAN = [0.0, 0.42, 0.95];
const RED = [0.85, 0.02, 0.02];
const ORANGE = [1.0, 0.22, 0.0];
const YELLOW = [0.95, 0.62, 0.0];
const SLATE = [0.16, 0.22, 0.50];

// The markers are the shader's own (see HyperbolicPlane.metal): the last
// number says which kind, 0 a dot, 1 a straight line, 2 a circle.

function dot(planePoint, f, state, color, radius = 0.020) {
  const w = drawn(f.inverse(planePoint), state);
  return { raw: [[w[0], w[1], radius / zoom(state), 0], [...color, 0]] };
}

function line(l, color, width = 0.0045) {
  const shape = l.normal
    ? [l.normal[0], l.normal[1], -1, width]
    : [l.center[0], l.center[1], l.radius, width];
  return { raw: [shape, [...color, 1]] };
}

function circle(center, radius, color) {
  return { raw: [[center[0], center[1], radius, 0.0045], [...color, 2]] };
}

/**
 * What to draw for a construction: 1 the line from the viewer to the point,
 * 2 the circle about the viewer through it, 3 the parallels through it to the
 * red line, 4 the point alone.
 */
function constructionMarkers(kind, point, state) {
  const f = frame(state);
  const markers = [];
  switch (kind) {
    case 1:
      markers.push(line(Line.through(f.a, point), CYAN));
      break;
    case 2:
      markers.push(circle(f.a, Hyp.distance(f.a, point), CYAN));
      break;
    case 3:
      // The red line is the horizontal diameter of the central tile.
      markers.push(line(Line.diameter([0, 1]), RED, 0.006));
      // Lines through the point in twelve evenly spaced directions.
      for (let index = 0; index < 12; index += 1) {
        const direction = Hyp.expi(index * Math.PI / 12);
        const ends = [Hyp.translate(direction, point), Hyp.translate(Hyp.scale(direction, -1), point)];
        const misses = ends[0][1] * ends[1][1] > 0;
        markers.push(line(
          Line.through(Hyp.translate(Hyp.scale(direction, 0.5), point), Hyp.translate(Hyp.scale(direction, -0.5), point)),
          misses ? YELLOW : SLATE, 0.003));
      }
      // The two limiting parallels reach the red line only at infinity.
      if (Math.abs(point[1]) > 1e-6) {
        markers.push(line(Line.through(point, [1, 0]), ORANGE, 0.006));
        markers.push(line(Line.through(point, [-1, 0]), ORANGE, 0.006));
      }
      break;
    default:
      break;
  }
  if (kind !== 0) {
    markers.push(dot(point, f, state, kind === 4 ? YELLOW : WHITE));
  }
  // The viewer, always at the centre of the view.
  markers.push({ raw: [[0, 0, 0.014 / zoom(state), 0], [1, 1, 1, 0]] });
  return markers;
}

// MARK: Guided tour

/**
 * Keyframes that walk a path of straight legs, each `length` long, in
 * directions measured in the viewer's own view, turning left by `turn` after
 * each.
 */
function walk(start, legs, length, turn, legDuration, turnDuration) {
  const frames = [];
  const state = copyState(start);
  for (let leg = 0; leg < legs; leg += 1) {
    state.values[GLIDE_ANGLE] = Math.PI / 2;
    state.values[GLIDE] = length;
    frames.push(keyframe(state, legDuration, 0.4));
    // Fold the finished step into the position; the picture is unchanged.
    setFrame(frame(state), state);
    frames.push(keyframe(state, 0));
    if (leg < legs - 1 || turn !== 0) {
      state.values[THETA] += turn;
      frames.push(keyframe(state, turnDuration, 0.3));
    }
  }
  return frames;
}

const tour = [
  {
    title: 'A floor that cannot be laid flat',
    body: `
      These tiles are regular pentagons, and four of them meet at every
      corner, each with a right angle there. Try that with paper: a flat
      regular pentagon has corners of 108°, and four of those is far too
      much to fit round a point.

      In the hyperbolic plane there is more room around every point,
      and the pentagons fit perfectly. Every tile you see is the same
      size and shape. The ones near the edge only look small.`,
    tryIt: 'Tiling → Sides and At a corner',
    build: base => [keyframe(base, 2.5)],
  },
  {
    title: 'The map shrinks things; the plane does not',
    body: `
      We are walking in a straight line. Tiles that were specks at the
      edge grow as we approach, and turn out to be pentagons exactly
      like the one we started in. The ones we leave behind shrink away.

      The plane is infinite, and this disk is a map of all of it. The
      edge is infinitely far away: however long we walk, we are still
      at the centre, and the edge is no nearer.`,
    tryIt: 'Drag anywhere to walk',
    build(base) {
      const start = copyState(base);
      start.values[GLIDE_ANGLE] = 0.35;
      const far = copyState(start);
      far.values[GLIDE] = 5.2;
      return [keyframe(start, 2.0, 1.0), keyframe(far, 16.0)];
    },
  },
  {
    title: 'What straight means',
    body: `
      The blue curve is a straight line: the shortest path between you
      and the white point, and the path you would follow by walking
      without turning. On this map straight lines appear as arcs that
      meet the edge at right angles. Every tile edge is part of one.

      Now the map changes to Klein's, where straight lines are drawn
      straight. The price is that angles are no longer true: the right
      angles of the pentagons look squashed. No flat map of this plane
      gets everything right.`,
    tryIt: 'Map → Poincaré → Klein; Constructions → Line from you',
    build(base) {
      const poincare = copyState(base);
      poincare.values[CONSTRUCTION] = 1;
      poincare.values[POINT_X] = 0.62;
      poincare.values[POINT_Y] = 0.48;
      const klein = copyState(poincare);
      klein.values[MODEL] = 1;
      return [keyframe(poincare, 2.5, 3.0), keyframe(klein, 5.0, 3.0), keyframe(poincare, 5.0)];
    },
  },
  {
    title: 'Triangles that fall short',
    body: `
      The pale lines cut every tile into triangles. Each has angles of
      90°, 36° and 45°, which add up to 171°, not 180°.

      In this plane every triangle's angles add to less than 180°, and
      the shortfall is exactly its area. Bigger triangles fall shorter.
      There are no scale models here: a triangle with the same angles
      as another is the same size.`,
    tryIt: 'Map → Mirror lines',
    build(base) {
      const p = copyState(base);
      p.values[TRIANGLES] = 1;
      p.palette = 1;
      p.cameraDistance = 0.55;
      return [keyframe(p, 3.0)];
    },
  },
  {
    title: 'Room grows exponentially',
    body: `
      The rings are circles around you with true radius 1, 2, 3, 4 and
      5. They are evenly spaced; the map crowds them together.

      A flat circle of radius 5 is about 31 around. This one is 466
      around: the circumference is 2π sinh r, which nearly triples
      with each extra unit. Count how many tiles each ring crosses.
      That is the extra room that let four pentagons share a corner.`,
    tryIt: 'Map → Distance rings',
    build(base) {
      const p = copyState(base);
      p.values[RINGS] = 1;
      return [keyframe(p, 3.0)];
    },
  },
  {
    title: 'More than one parallel',
    body: `
      Euclid assumed that through a point off a line there is exactly
      one line that never meets it. For two thousand years people tried
      to prove that from his other assumptions. This plane is why they
      failed: it obeys all the others, and breaks this one.

      Every yellow line passes through the white point and never meets
      the red line. The two orange lines are the limits of the fan; they
      approach the red line forever and touch it only at infinity.`,
    tryIt: 'Constructions → Parallels',
    build(base) {
      const near = copyState(base);
      near.values[CONSTRUCTION] = 3;
      near.values[POINT_X] = 0.10;
      near.values[POINT_Y] = 0.12;
      near.palette = 2;
      const far = copyState(near);
      far.values[POINT_X] = 0.25;
      far.values[POINT_Y] = 0.62;
      return [keyframe(near, 2.5, 2.0), keyframe(far, 9.0)];
    },
  },
  {
    title: 'Walk a square, and miss home',
    body: `
      The yellow dot marks where we start. Walk forward, turn left a
      quarter turn, and do it again, four times, each leg the same
      length. On a flat floor that brings you home.

      Here it does not. The sides of a hyperbolic square would have to
      lean inward, with corners sharper than 90°. Insist on right-angle
      turns and the path never closes.`,
    tryIt: 'Constructions → Home marker, then drag',
    build(base) {
      const start = copyState(base);
      start.values[CONSTRUCTION] = 4;
      start.values[POINT_X] = 0;
      start.values[POINT_Y] = 0;
      return [keyframe(start, 2.0, 1.0), ...walk(start, 4, 1.5, Math.PI / 2, 3.5, 1.5)];
    },
  },
  {
    title: 'Other floors',
    body: `
      Any regular polygon works, with enough of them at a corner. Seven
      triangles at each corner. Then squares, five to a corner, where a
      flat floor has four. Then heptagons, three to a corner, the
      hyperbolic cousin of the honeycomb.

      The flat plane allows three regular tilings. The hyperbolic plane
      allows infinitely many.`,
    tryIt: 'Tiling → Sides and At a corner',
    build(base) {
      const using = (sides, corner) => {
        const s = copyState(base);
        s.values[P] = sides;
        s.values[Q] = corner;
        return s;
      };
      return [
        keyframe(using(3, 7), 1.0, 3.5),
        keyframe(using(4, 5), 0.0, 3.5),
        keyframe(using(7, 3), 0.0, 3.5),
        keyframe(using(8, 8), 0.0, 3.5),
        keyframe(using(5, 4), 0.0),
      ];
    },
  },
  {
    title: 'How the picture is drawn',
    body: `
      No list of tiles is kept; there are infinitely many. Instead, each
      pixel is reflected in the three sides of one small triangle, over
      and over, until it lands inside that triangle. The number of
      reflections it took decides its colour.

      Walking is one formula applied to every pixel before the folding
      starts. After each step the app quietly swaps your position for an
      equivalent one in the central tile, so the numbers never grow,
      however far you walk.`,
    build(base) {
      const p = copyState(base);
      p.values[TRIANGLES] = 1;
      p.cameraDistance = 0.5;
      return [keyframe(p, 3.0)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Drag to walk. Change the tiling. Switch the map between Poincaré
      and Klein, and turn on the distance rings or the mirror lines.
      Every group of controls has an ⓘ button with a short note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 2.5)],
  },
];

// MARK: World

export const world = {
  id: 'hyperbolic-plane',
  title: 'Hyperbolic plane',
  formula: '{p, q}: p-gons, q at every corner',
  summary: 'A plane with more room than a flat one: right-angled pentagons tile it, triangles\' angles fall short of 180°, and through one point run many lines parallel to another. Walk across it and see that every tile is the same size.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [0.25, 2.0],
  paletteNames: ['Rings', 'Triangles', 'Chalk'],
  controlGroups: [
    group('Tiling', `
      Regular polygons with p sides, meeting q at every corner. On
      flat paper only three such tilings exist: squares, triangles
      and hexagons. Asking for more around a corner than will fit
      flat forces the plane to be hyperbolic, and every choice
      with (p − 2)(q − 2) > 4 works.

      Corners must share 360°, so each corner angle is 360° ⁄ q,
      smaller than a flat p-gon's. The shortfall, added over all
      corners, is exactly the tile's area: in this plane, shape
      fixes size.`, [
      slider('Sides, p', P, [3, 8], value => String(Math.round(value))),
      slider('At a corner, q', Q, [3, 8], value => String(Math.round(value))),
      readout('Tiling', state => {
        const t = tiling(state);
        const asked = Math.round(state.values[Q]);
        return asked < t.q
          ? `{${t.p}, ${t.q}}: {${t.p}, ${asked}} is not hyperbolic`
          : `{${t.p}, ${t.q}}`;
      }),
      readout('Corner angle', state => {
        const t = tiling(state);
        const flat = 180 * (t.p - 2) / t.p;
        return `${(360 / t.q).toFixed(1)}°  (flat ${t.p}-gon: ${flat.toFixed(1)}°)`;
      }),
      readout('Side length', state => Format.number(tiling(state).sideLength, 3)),
      readout('Tile area', state => Format.number(tiling(state).tileArea, 3)),
    ]),
    group('Map', `
      The plane is infinite, so it has to be squeezed to fit in a
      disk, and no map can do that without distortion. The edge of
      the disk is infinitely far away.

      Poincaré's map keeps every angle true, and straight lines
      appear as arcs of circles that meet the edge squarely.
      Klein's map draws straight lines straight, but bends the
      angles. Neither shows true sizes: all tiles are equal.`, [
      slider('Poincaré → Klein', MODEL, [0, 1], value =>
        (value < 0.02 ? 'Poincaré' : (value > 0.98 ? 'Klein' : (value * 100).toFixed(0) + '%'))),
      toggle('Distance rings', RINGS),
      toggle('Mirror lines', TRIANGLES),
      readout('Distance walked', state => Format.number(state.values[WALKED], 2)),
    ]),
    group('Constructions', `
      Line: the straight line from you to the white point.
      Circle: every point at that same distance from you. Its
      centre looks off-centre only when you move.

      Parallels: the red line, and lines through the white point.
      Yellow lines never meet the red one. In a flat plane exactly
      one line would be parallel; here a whole fan is, bounded by
      the two orange lines that meet it only at infinity.`, [
      picker('Show', CONSTRUCTION, ['Nothing', 'Line from you', 'Circle about you', 'Parallels', 'Home marker']),
    ]),
  ],
  viewNote: `
    Drag to walk, or use W A S D: the plane slides under you, and you
    always stand at the centre of the disk. Zoom only magnifies the map; it does not
    bring anything nearer. To reach the tiles near the edge, walk to
    them.`,
  tour,
  shaderValues(state) {
    const t = tiling(state);
    const f = frame(state);
    const values = new Array(32).fill(0);
    values[0] = t.p;
    values[1] = t.q;
    values[2] = clamp(state.values[MODEL], 0, 1);
    values[3] = zoom(state);
    values[4] = f.a[0];
    values[5] = f.a[1];
    values[6] = Math.cos(f.theta);
    values[7] = Math.sin(f.theta);
    values[8] = state.values[RINGS] > 0.5 ? 1 : 0;
    values[9] = state.values[TRIANGLES] > 0.5 ? 1 : 0;
    return values;
  },
  discreteValues: new Set([P, Q, RINGS, TRIANGLES, CONSTRUCTION, GLIDE_ANGLE]),
  cameraBacksAwayWhenMoving: false,
  drag(state, probe, dx, dy) {
    // The plane follows the finger, so the viewer steps the other way.
    const scale = DISK_RADIUS * zoom(state);
    const step = Hyp.clamped(undrawn([-dx / scale, dy / scale], state), 0.9);
    move(step, state, probe);
  },
  step(state, probe, forward, right) {
    move(Hyp.scale([right, forward], Math.tanh(0.06)), state, probe);
  },
  resetView(state) {
    state.values[RHO] = 0;
    state.values[BETA] = 0;
    state.values[THETA] = 0;
    state.values[GLIDE] = 0;
    state.values[WALKED] = 0;
  },
  overlayMarkers(state) {
    return constructionMarkers(
      Math.round(state.values[CONSTRUCTION]),
      Hyp.clamped([state.values[POINT_X], state.values[POINT_Y]]),
      state);
  },
  tourKeepsPalette: false,
};
