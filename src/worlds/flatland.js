// Flatland, after Edwin Abbott's book of 1884: a plane whose inhabitants are
// shapes, drawn from above and as one of them sees it, with visitors from the
// third dimension passing through. This is Worlds/Flat/FlatlandWorld.swift,
// without its explorer; the tour's words are copied from it.
import { newState, copyState, keyframe, slider, picker, movePad, readout, group, Format } from './engine.js';
import { SHELF } from './flat-support.js';
import { FRAGMENT } from './shaders/flatland.js';

// Indices into the state's values.
const EYE_X = 0;
const EYE_Y = 1;
const HEADING = 2;
const FOG = 3;
const VIEW_KIND = 4;
const VISITOR = 5;
const HEIGHT = 6;
const NEEDLE = 7;
const FIELD_OF_VIEW = 8;

// The scene; Flatland.metal has the same numbers.
const MAP_CENTRE = [0, -0.3];
/** Plane units from the map's centre to the edge of the view's shorter side:
    a little more when the eye's band shares the view. */
const MAP_SPAN = 4.2;
const SHARED_MAP_SPAN = 5.0;
const VISITOR_CENTRE = [0.4, 0.3];
const SPHERE_RADIUS = 0.9;
const CUBE_HALF_SIDE = 0.62;
const NEEDLE_CENTRE = [-1.1, -1.3];

const defaults = newState();
defaults.values[EYE_X] = 0;
defaults.values[EYE_Y] = -3.1;
defaults.values[HEADING] = Math.PI / 2;
defaults.values[FOG] = 0.35;
defaults.values[FIELD_OF_VIEW] = 110;
defaults.values[HEIGHT] = 0.5;
defaults.cameraDistance = 1;

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

// MARK: Reading the state

const eye = state => [state.values[EYE_X], state.values[EYE_Y]];
const viewIndex = state => Math.round(state.values[VIEW_KIND]);
const visitorIndex = state => Math.round(state.values[VISITOR]);
const field = state => clamp(state.values[FIELD_OF_VIEW], 20, 200) * Math.PI / 180;
const mapScale = state => (viewIndex(state) === 0 ? SHARED_MAP_SPAN : MAP_SPAN) * state.cameraDistance;
/** The map sits a little higher when the eye's band is drawn below it. */
const mapShift = () => 0;

// MARK: The scene

function polygon(p, centre, radius, sides, turn) {
  const q = [p[0] - centre[0], p[1] - centre[1]];
  const sector = 2 * Math.PI / sides;
  const raw = Math.atan2(q[1], q[0]) - turn + sector / 2;
  const angle = raw - sector * Math.floor(raw / sector) - sector / 2;
  return Math.hypot(q[0], q[1]) * Math.cos(angle) - radius * Math.cos(sector / 2);
}

function segmentDistance(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const ap = [p[0] - a[0], p[1] - a[1]];
  const t = clamp((ap[0] * ab[0] + ap[1] * ab[1]) / Math.max(ab[0] * ab[0] + ab[1] * ab[1], 1e-12), 0, 1);
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t);
}

function visitorDistance(p, state) {
  const q = [p[0] - VISITOR_CENTRE[0], p[1] - VISITOR_CENTRE[1]];
  const h = state.values[HEIGHT];
  switch (visitorIndex(state)) {
    case 1: {
      const inside = SPHERE_RADIUS * SPHERE_RADIUS - h * h;
      return inside > 0 ? Math.hypot(q[0], q[1]) - Math.sqrt(inside) : 1e6;
    }
    case 2: {
      let d = -1e6;
      for (let i = 0; i < 3; i += 1) {
        const around = 2.0943951 * i + 0.4;
        const axis = [0.8164966 * Math.cos(around), 0.8164966 * Math.sin(around), 0.5773503];
        d = Math.max(d, Math.abs(axis[0] * q[0] + axis[1] * q[1] + axis[2] * h) - CUBE_HALF_SIDE);
      }
      return d * 1.2247449;
    }
    default:
      return 1e6;
  }
}

/**
 * The distance from a point to each shape: nothing, the Triangle, the Square,
 * the Pentagon, the Hexagon, the Circle, the Needle, the visitor (entry 0 is
 * unused).
 */
function distances(p, state) {
  const needle = state.values[NEEDLE];
  const along = [Math.cos(needle) * 0.55, Math.sin(needle) * 0.55];
  return [
    Infinity,
    polygon(p, [-2.7, -0.3], 0.62, 3, 0.5),
    polygon(p, [-1.6, 1.7], 0.62, 4, 0.3),
    polygon(p, [0.3, 2.5], 0.66, 5, 0.2),
    polygon(p, [2.1, 1.5], 0.70, 6, 0),
    Math.hypot(p[0] - 2.9, p[1] + 0.5) - 0.6,
    segmentDistance(p,
      [NEEDLE_CENTRE[0] - along[0], NEEDLE_CENTRE[1] - along[1]],
      [NEEDLE_CENTRE[0] + along[0], NEEDLE_CENTRE[1] + along[1]]) - 0.025,
    visitorDistance(p, state),
  ];
}

function nearest(p, state) {
  const all = distances(p, state);
  const best = { distance: Infinity, shape: 0 };
  for (let index = 1; index < all.length; index += 1) {
    if (all[index] < best.distance) {
      best.distance = all[index];
      best.shape = index;
    }
  }
  return best;
}

/** What the visitor's slice looks like to Flatland. */
function slice(state) {
  const h = Math.abs(state.values[HEIGHT]);
  switch (visitorIndex(state)) {
    case 1: {
      const inside = SPHERE_RADIUS * SPHERE_RADIUS - h * h;
      if (!(inside > 0)) { return 'nothing: it is clear of the plane'; }
      return inside < 0.02 ? 'a point' : 'a circle of radius ' + Format.number(Math.sqrt(inside), 2);
    }
    case 2:
      if (h > CUBE_HALF_SIDE * Math.sqrt(3)) { return 'nothing: it is clear of the plane'; }
      return h > CUBE_HALF_SIDE / Math.sqrt(3) ? 'a triangle' : 'a hexagon';
    default:
      return 'no visitor';
  }
}

const degrees = value => `${Math.round(value)}°`;

// MARK: Guided tour

function standing(base, x, y, facing) {
  const state = copyState(base);
  state.values[EYE_X] = x;
  state.values[EYE_Y] = y;
  state.values[HEADING] = facing;
  return state;
}

const tour = [
  {
    title: 'A world with no up',
    body: `
      In 1884 a schoolmaster, Edwin Abbott, imagined a world that is
      a plane. Its people are flat shapes that slide about in it:
      triangles, squares, pentagons, hexagons, and circles, who are
      the priests. There is north and south, east and west, and no
      up or down at all.

      You are looking at it from above, a direction its people
      cannot point in. You can see the inside of every one of them.
      The small white square is the narrator, A. Square.`,
    tryIt: 'Seeing → Show → Map from above',
    build(base) {
      const state = copyState(base);
      state.values[VIEW_KIND] = 1;
      return [keyframe(state, 2.5)];
    },
  },
  {
    title: 'What a Flatlander sees',
    body: `
      The band is everything the Square's eye receives.
      His eye is a point on his edge, and his world is a plane, so
      what reaches it is a line: each point of the band shows what
      lies in one direction.

      Your own eye gets a flat picture of a solid world, one
      dimension short. His gets a line of a flat world, one short
      again. The pale wedge on the map is his field of view, and the
      bright edges are the parts of each shape he can see.`,
    tryIt: 'Drag to turn; walk with the buttons or W A S D',
    build: base => [
      keyframe(base, 2.0, 2.0),
      keyframe(standing(base, 0, -3.1, Math.PI / 2 + 0.5), 4.0, 0.5),
      keyframe(standing(base, 0, -3.1, Math.PI / 2 - 0.5), 6.0, 0.5),
      keyframe(base, 3.0),
    ],
  },
  {
    title: 'Every shape is a stroke',
    body: `
      Here Flatland is as Abbott wrote it, without colour, and for a
      moment without its fog. The triangle, the hexagon and the
      circle are each a plain stroke on the line. Nothing says which
      is which, how far off they are, or whether a corner or a flat
      side is turned toward you.

      Now the fog returns. Farther things are dimmer, so a side that
      slants away fades along its length, and a corner pointing at
      you is brightest in the middle. Flatlanders of the upper
      classes spent years at school learning to read shapes this way.`,
    tryIt: 'Seeing → Fog; View → Colour → Plain',
    build(base) {
      const clear = copyState(base);
      clear.palette = 1;
      clear.values[FOG] = 0;
      const foggy = copyState(clear);
      foggy.values[FOG] = 0.55;
      return [keyframe(clear, 2.0, 5.0), keyframe(foggy, 5.0)];
    },
  },
  {
    title: 'Walking round a triangle',
    body: `
      The other way to know a shape is to go round it. The Square
      walks past the Triangle, keeping his eye on it.

      Watch the red stroke in the band. Facing a corner, it is bright
      in the middle and fades to both ends. Facing a flat side, it is
      even from end to end. He never sees a triangle. He sees a
      stroke that changes as he moves, and works out the triangle.`,
    tryIt: 'Walk up to a shape and round it',
    build(base) {
      const state = copyState(base);
      state.values[FOG] = 0.5;
      return [
        keyframe(standing(state, -2.7, -2.4, Math.PI / 2), 3.0, 1.5),
        keyframe(standing(state, -3.75, -1.3, 0.76), 5.0, 1.5),
        keyframe(standing(state, -3.75, 0.7, -0.76), 6.0),
      ];
    },
  },
  {
    title: 'The Needle',
    body: `
      Abbott's book is a satire on the ranks of Victorian England:
      the more sides, the higher the class, and the women of
      Flatland are drawn as straight lines.

      Side on, a line is a long stroke. Now it turns to point at the
      eye, and the stroke shrinks to a single dim point, nearly
      invisible. In the book that makes a needle dangerous to walk
      into, and the law requires her to keep up a warning cry.`,
    tryIt: 'Seeing → Turn the Needle',
    build(base) {
      const side = standing(base, -1.1, -3.2, Math.PI / 2);
      side.values[FIELD_OF_VIEW] = 70;
      const end = copyState(side);
      end.values[NEEDLE] = Math.PI / 2;
      return [keyframe(side, 3.0, 2.5), keyframe(end, 6.0)];
    },
  },
  {
    title: 'A visitor from Space',
    body: `
      One night a stranger arrives in the Square's locked house. A
      point appears in the empty middle of the room. It grows into a
      circle, larger and larger, then shrinks back to a point and is
      gone.

      It is a sphere, passing through the plane. Flatland only ever
      holds one slice of it, and the Square sees only the edge of
      that slice: a stroke that widens and narrows. The sphere says:
      I am many circles in one.`,
    tryIt: 'Visitor from Space → Sphere, then Height',
    build(base) {
      const above = copyState(base);
      above.values[VISITOR] = 1;
      above.values[HEIGHT] = 1.25;
      const middle = copyState(above);
      middle.values[HEIGHT] = 0;
      const below = copyState(above);
      below.values[HEIGHT] = -1.25;
      return [keyframe(above, 2.0, 1.5), keyframe(middle, 7.0, 2.0), keyframe(below, 7.0)];
    },
  },
  {
    title: 'A cube, corner first',
    body: `
      A cube arrives by one corner. Flatland gets a point, then a
      triangle that grows. The triangle's corners are cut off and it
      becomes a hexagon; then a triangle again, pointing the other
      way, shrinking to a point.

      No Flatlander could guess from this that the visitor has six
      square faces. Each slice is a true part of the cube, and none
      of them looks like it.`,
    tryIt: 'Visitor from Space → Cube, corner first',
    build(base) {
      const above = copyState(base);
      above.values[VISITOR] = 2;
      above.values[HEIGHT] = 1.2;
      const below = copyState(above);
      below.values[HEIGHT] = -1.2;
      return [keyframe(above, 2.0, 1.5), keyframe(below, 16.0)];
    },
  },
  {
    title: 'Upward, not northward',
    body: `
      The Sphere lifts the Square out of his plane, and he sees
      Flatland as you do: every inside laid open. When he returns
      and tries to say where he has been, he has only the words
      north, south, east and west. Upward, not northward, he says,
      and is locked up for it.

      You are in his position one dimension higher. The 4D slices
      world in the main library does to you exactly what the sphere
      did to him: a four-dimensional shape passes through your
      space, and all you get are its solid slices.`,
    tryIt: 'All worlds → 4D slices',
    build(base) {
      const state = copyState(base);
      state.values[VIEW_KIND] = 1;
      state.values[VISITOR] = 1;
      state.values[HEIGHT] = 0.55;
      return [keyframe(state, 2.5)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Drag to turn and walk about. Try to tell the shapes apart with
      the map hidden: choose The eye alone. Take away the fog, or
      the colour. Bring in a visitor and move it through the plane.
      Every group of controls has an ⓘ button with a short note.`,
    build: base => [keyframe(base, 2.5)],
  },
];

// MARK: World

export const world = {
  id: 'flatland',
  title: 'Flatland',
  formula: 'A world of two dimensions, seen in one',
  summary: 'A plane whose inhabitants are triangles, squares and circles. From above you see them whole; they see each other only as a line, brighter and dimmer. Then a sphere passes through, and a circle appears from nowhere.',
  fragment: FRAGMENT,
  shelf: SHELF,
  defaults,
  cameraDistanceRange: [0.3, 1.6],
  paletteNames: ['Painted', 'Plain'],
  controlGroups: [
    group('You, A. Square', `
      Edwin Abbott's Flatland (1884) is told by a square, living
      in a plane with no notion of up or down. You are the small
      white square with the yellow eye. The pale wedge is what
      your eye takes in.

      On the map you look down from the third dimension, which no
      Flatlander can do. From up here every shape's inside is
      open to view, and so is yours.`, [
      movePad('Walk'),
      slider('Field of view', FIELD_OF_VIEW, [40, 180], degrees),
      readout('Where you are', state =>
        `(${Format.number(state.values[EYE_X], 1)}, ${Format.number(state.values[EYE_Y], 1)})`),
    ]),
    group('Seeing', `
      The band is everything your eye receives: one line. Each
      point of it shows whatever lies in that direction. A whole
      hexagon is a short stretch of line; so is a triangle, and
      so is a circle.

      Flatland is foggy, and that is how its people tell shapes
      apart by sight: things farther off are dimmer, so a side
      that slants away fades along its length, and a corner
      pointing at you is brightest in the middle. Turn the fog
      off and every shape is the same flat stroke. Abbott's
      Flatland also has no colour: choose Plain to see it so.`, [
      picker('Show', VIEW_KIND, ['Map and eye', 'Map from above', 'The eye alone']),
      slider('Fog', FOG, [0, 1], value => value.toFixed(2)),
      slider('Turn the Needle', NEEDLE, [0, Math.PI], value => degrees(value * 180 / Math.PI)),
    ]),
    group('Visitor from Space', `
      A solid thing cannot fit in Flatland. Only the slice of it
      that lies in the plane is there, and only the edge of that
      slice can be seen. Height is how far the visitor's centre
      is above the plane; below zero it is on the other side.

      A sphere's slices are circles. A cube lowered corner first
      gives a triangle, then a hexagon, then a triangle the other
      way up. Nothing about the visitor changes as it passes: all
      its slices exist at once, in a direction Flatland has no
      word for.`, [
      picker('Visitor', VISITOR, ['None', 'Sphere', 'Cube, corner first']),
      slider('Height', HEIGHT, [-1.3, 1.3], value => value.toFixed(2), state => visitorIndex(state) !== 0),
      readout('Flatland has', slice),
    ]),
  ],
  viewNote: `
    Drag to turn, and walk with the buttons or W A S D. Shapes are solid:
    you cannot walk through them. Zoom magnifies the map.`,
  tour,
  shaderValues(state) {
    const values = new Array(32).fill(0);
    values[0] = state.values[EYE_X];
    values[1] = state.values[EYE_Y];
    values[2] = state.values[HEADING];
    values[3] = Math.max(state.values[FOG], 0);
    values[4] = viewIndex(state);
    values[5] = visitorIndex(state);
    values[6] = state.values[HEIGHT];
    values[7] = state.values[NEEDLE];
    values[8] = field(state);
    values[9] = mapScale(state);
    values[10] = mapShift(state);
    // 11 and 12 are the explorer's line of sight, which the web leaves out.
    return values;
  },
  discreteValues: new Set([VIEW_KIND, VISITOR]),
  cameraBacksAwayWhenMoving: false,
  drag(state, probe, dx) {
    // The scene follows the finger, so the eye turns the other way.
    state.values[HEADING] += dx * 0.9;
  },
  step(state, probe, forward, right) {
    const heading = state.values[HEADING];
    const ahead = [Math.cos(heading), Math.sin(heading)];
    const side = [ahead[1], -ahead[0]];
    const from = eye(state);
    const target = [
      clamp(from[0] + (ahead[0] * forward + side[0] * right) * 0.12, -3.8, 3.8),
      clamp(from[1] + (ahead[1] * forward + side[1] * right) * 0.12, -3.6, 3.9),
    ];
    // Bodies are solid.
    if (!(nearest(target, state).distance > 0.16)) { return; }
    state.values[EYE_X] = target[0];
    state.values[EYE_Y] = target[1];
  },
  stepHint: 'Arrow keys or W A S D walk and sidestep. Drag the picture to turn.',
  resetView(state) {
    state.values[EYE_X] = defaults.values[EYE_X];
    state.values[EYE_Y] = defaults.values[EYE_Y];
    state.values[HEADING] = defaults.values[HEADING];
  },
  tourKeepsPalette: false,
};
