// The Escher stairs: three spiral staircases in one space, each walked on both
// faces, with doors that turn the walker onto another face. This is
// Worlds/Escher/EscherWorld.swift, without its explorer; the tour's words are
// copied from it.
import { newState, copyState, keyframe, movePad, readout, group } from './engine.js';
import { FRAGMENT } from './shaders/escher.js';

// MARK: Geometry of the three staircases and their doors; mirrors Escher.metal.

const HALF_WIDTH = 3.2;
const STAIR_WIDTH = 1.6;
const TURN_RISE = 6.4;
const PERIOD = 12.8;
const THICKNESS = 0.1;
const EYE = 0.8;
const CENTRE = 2.4;

const REALM_NAMES = ['Wood', 'Marble', 'Brass', 'Slate', 'Iron', 'Tile'];

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);
/** Rounds halves away from zero, as the app does. */
const round = value => Math.sign(value) * Math.round(Math.abs(value));
/** The remainder of a whole number, never negative. */
const wrap = (value, n) => ((value % n) + n) % n;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = v => {
  const length = Math.hypot(...v);
  return v.map(c => c / length);
};

/** The screw S: a quarter turn about the staircase's axis and a rise of one flight. */
function screw(p, times) {
  // Four quarter turns cancel. Work is constant even for a distant landing.
  const q = turn(p, times);
  return [q[0], p[1] + times * TURN_RISE / 4, q[2]];
}

function turn(d, times) {
  let e = d;
  for (let i = 0; i < wrap(times, 4); i += 1) { e = [-e[2], e[1], e[0]]; }
  return e;
}

/** T, which carries the staircase about y to the one about z, and that to the
    one about x. */
function chart(p, c) {
  let q = p;
  for (let i = 0; i < c; i += 1) { q = [q[2] + PERIOD / 2, q[0] + PERIOD / 2, q[1]]; }
  return q;
}

function chartDirection(d, c) {
  let e = d;
  for (let i = 0; i < wrap(c, 3); i += 1) { e = [e[2], e[0], e[1]]; }
  return e;
}

/** Centre of the door above (side 0) or below (side 1) a landing, in the
    landing's own axes. */
const doorCentre = side => [CENTRE, side === 0 ? STAIR_WIDTH / 2 : -THICKNESS - STAIR_WIDTH / 2, HALF_WIDTH];

/** Whether landing m of a turn has a door, and where it leads. */
function partner(c, m, side) {
  switch (wrap(m, 4)) {
    case 0: return { chart: c, landingShift: 0, side: 1 - side };
    case 1: return { chart: (c + 1) % 3, landingShift: 2, side };
    case 3: return { chart: (c + 2) % 3, landingShift: -2, side };
    default: return null;
  }
}

/** The turn a door gives to offsets from its centre, landing them as offsets
    from its partner's centre. */
function doorTurn(d, m, side, partnerSide) {
  const sA = side === 0 ? 1 : -1;
  const sB = partnerSide === 0 ? 1 : -1;
  const a = [d[0] * sA, d[1] * sA];
  const rolled = wrap(m, 4) === 0 ? [-a[0], -a[1]] : [a[1], -a[0]];
  return [-rolled[0] * sB, rolled[1] * sB, -d[2]];
}

/** The roll a walker makes in a doorway. */
const roll = m => (wrap(m, 4) === 0 ? Math.PI : Math.PI / 2);

/** Where the ribbon's top is, and the way a walker is carried to face, for a
    place t (0 to 1) along the flight toward a landing, in that landing's axes. */
function stairPose(t) {
  const inner = HALF_WIDTH - STAIR_WIDTH;
  const z = -CENTRE + 2 * CENTRE * t;
  // Level on the landings, sloping between them.
  const climb = clamp((z + inner) / (2 * inner), 0, 1);
  // Turning the corner takes place over the landing at each end.
  const zone = (STAIR_WIDTH / 2) / (2 * CENTRE);
  let heading = 0;
  if (t < zone) { heading = Math.PI / 4 * (1 - t / zone); }
  if (t > 1 - zone) { heading = -Math.PI / 4 * (1 - (1 - t) / zone); }
  return { floor: [CENTRE, -TURN_RISE / 4 * (1 - climb), z], heading };
}

// MARK: The walker

// Indices into the state's values.
const CHART = 0;
const SIDE = 1;
/** Place on the stairs: whole numbers are landings. */
const STAIR = 2;
/** Progress through the door of the landing: 0 on the landing, 1 through. */
const DOOR = 3;
const COUNT = 4;
/** The six most recent doors, newest first: staircase + 3 × face + 6 × landing, or −1. */
const HISTORY = 5;

const defaults = newState();
defaults.values[STAIR] = 0.5;
for (let i = 0; i < 6; i += 1) { defaults.values[HISTORY + i] = -1; }
defaults.yaw = 0;
defaults.pitch = 0.08;
defaults.cameraDistance = 1;

const chartIndex = state => clamp(round(state.values[CHART]), 0, 2);
const sideIndex = state => (state.values[SIDE] > 0.5 ? 1 : 0);
const realm = state => 2 * chartIndex(state) + sideIndex(state);
const landing = state => round(state.values[STAIR]);

const isAtLanding = state => Math.abs(state.values[STAIR] - round(state.values[STAIR])) < 0.07;

/** The door on the landing the walker is at, if there is one. */
function doorHere(state) {
  if (!(isAtLanding(state) || state.values[DOOR] > 0)) { return null; }
  return partner(chartIndex(state), landing(state), sideIndex(state));
}

function ease(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** The walker's eye, in the axes of a landing of their own staircase: its
    position, right, up and forward, and the landing whose axes they are
    written in. */
function localPose(state) {
  const sideNow = sideIndex(state);
  const sign = sideNow === 0 ? 1 : -1;
  const progress = clamp(state.values[DOOR], 0, 1);
  let position;
  let heading;
  let rollAngle = 0;
  let index;
  if (progress > 0) {
    // Straight through the door of this landing, rolling over on the way.
    index = landing(state);
    const centre = doorCentre(sideNow);
    position = [centre[0], centre[1], CENTRE + progress * STAIR_WIDTH];
    // The same heading as on the landing, so that a walker who has
    // turned to face the door keeps facing it.
    heading = -Math.PI / 4;
    rollAngle = roll(index) * ease((progress - 0.15) / 0.7);
  } else {
    const s = state.values[STAIR];
    const k = Math.floor(s);
    index = k + 1;
    const pose = stairPose(s - k);
    position = pose.floor;
    position[1] += sideNow === 0 ? EYE : -THICKNESS - EYE;
    heading = pose.heading;
  }

  const up0 = [0, sign, 0];
  const h = heading + sign * state.yaw;
  const p = state.pitch;
  let forward = [Math.sin(h) * Math.cos(p), sign * Math.sin(p), Math.cos(h) * Math.cos(p)];
  let right = normalize(cross(forward, up0));
  let up = cross(right, forward);
  if (rollAngle !== 0) {
    // Roll about the line straight through the door.
    const c = Math.cos(rollAngle), s = Math.sin(rollAngle);
    const rolled = v => [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
    forward = rolled(forward);
    right = rolled(right);
    up = rolled(up);
  }
  return { position, right, up, forward, landing: index };
}

/** The camera in the space itself. */
function camera(state) {
  const local = localPose(state);
  const c = chartIndex(state);
  const place = v => chartDirection(turn(v, local.landing), c);
  return {
    position: chart(screw(local.position, local.landing), c),
    right: place(local.right),
    up: place(local.up),
    forward: place(local.forward),
    landing: local.landing,
  };
}

/** Finishes a passage: the walker now stands on the partner door's landing,
    with their back to it. The picture does not change. */
function arrive(state) {
  const index = landing(state);
  const c = chartIndex(state);
  const sideNow = sideIndex(state);
  const target = partner(c, index, sideNow);
  if (!target) {
    state.values[DOOR] = 0;
    return;
  }
  const through = copyState(state);
  through.values[DOOR] = 1;
  const before = localPose(through);
  const forward = doorTurn(before.forward, index, sideNow, target.side);
  const sign = target.side === 0 ? 1 : -1;

  for (let i = 5; i > 0; i -= 1) { state.values[HISTORY + i] = state.values[HISTORY + i - 1]; }
  state.values[HISTORY] = c + 3 * sideNow + 6 * wrap(index, 4);
  state.values[COUNT] += 1;

  state.values[CHART] = target.chart;
  state.values[SIDE] = target.side;
  state.values[STAIR] = index + target.landingShift;
  state.values[DOOR] = 0;
  state.pitch = Math.asin(clamp(forward[1] * sign, -1, 1));
  // On a landing the walker is carried to face 45° round the corner.
  const yaw = sign * (Math.atan2(forward[0], forward[2]) + Math.PI / 4);
  state.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

/** One step forward (1) or back (−1): along whichever of the stairs ahead,
    the stairs behind, or the door the walker is facing. */
function walk(state, direction) {
  const v = state.values;
  if (v[DOOR] > 0) {
    v[DOOR] += 0.04 * direction;
    if (v[DOOR] >= 1) { arrive(state); }
    if (v[DOOR] < 0) { v[DOOR] = 0; }
    return;
  }
  // Which way the walker faces, measured from the way the stairs lead.
  const sign = sideIndex(state) === 0 ? 1 : -1;
  let facing = sign * state.yaw + (direction < 0 ? Math.PI : 0);
  facing = Math.atan2(Math.sin(facing), Math.cos(facing));
  const near = (angle, within) =>
    Math.abs(Math.atan2(Math.sin(facing - angle), Math.cos(facing - angle))) < within;
  if (isAtLanding(state)) {
    // From a landing: the door is 45° to one side, the stairs onward
    // 45° to the other, and the stairs back are behind.
    if (doorHere(state) !== null && near(Math.PI / 4, 0.75)) {
      v[STAIR] = round(v[STAIR]);
      v[DOOR] = 0.04;
    } else if (near(-Math.PI / 4, 0.8)) {
      v[STAIR] += 0.03;
    } else if (near(-Math.PI * 0.75, 0.8) || near(Math.PI * 1.25, 0.8)) {
      v[STAIR] -= 0.03;
    }
  } else if (Math.cos(facing) > 0.2) {
    v[STAIR] += 0.03;
  } else if (Math.cos(facing) < -0.2) {
    v[STAIR] -= 0.03;
  }
}

// MARK: World

function axisName(v) {
  if (v[0] > 0.5) { return '+x'; }
  if (v[0] < -0.5) { return '−x'; }
  if (v[1] > 0.5) { return '+y'; }
  if (v[1] < -0.5) { return '−y'; }
  return v[2] > 0.5 ? '+z' : '−z';
}

const upName = state => axisName(chartDirection([0, sideIndex(state) === 0 ? 1 : -1, 0], chartIndex(state)));

// MARK: Guided tour

function at(base, stair, yaw = 0, pitch = 0.05, c = 0, side = 0) {
  const state = copyState(base);
  state.values[CHART] = c;
  state.values[SIDE] = side;
  state.values[STAIR] = stair;
  state.yaw = yaw;
  state.pitch = pitch;
  return state;
}

/** The state after walking through the door of the landing. */
function through(state) {
  const s = copyState(state);
  s.values[DOOR] = 1;
  arrive(s);
  return s;
}

/** Keyframes that face the door of a landing, walk through it, and look round. */
function passage(landingState, lookYaw, lookPitch) {
  const facing = copyState(landingState);
  facing.yaw = Math.PI / 4;
  facing.pitch = 0;
  const inDoor = copyState(facing);
  inDoor.values[DOOR] = 0.999;
  const beyond = through(inDoor);
  const looking = copyState(beyond);
  looking.yaw = beyond.yaw + lookYaw;
  looking.pitch = lookPitch;
  return [
    keyframe(facing, 3.0, 1.5),
    keyframe(inDoor, 11.0, 0, true),
    keyframe(beyond, 0),
    keyframe(looking, 5.0),
  ];
}

const tour = [
  {
    title: 'A staircase, and others at odd angles',
    body: `
      You are on a wooden staircase that winds round a square pillar.
      Look about. Other staircases cross the view on their sides,
      winding round pillars that run level instead of upright.

      They are all the same shape. Three of them share this space, one
      about each of its three directions, woven past one another
      without touching.`,
    tryIt: 'Drag to look around; arrow keys to walk',
    build(base) {
      const start = at(base, 0.5, 0.9, 0.1);
      const end = at(base, 1.6, 1.3, -0.25);
      return [keyframe(start, 3.0, 1.5), keyframe(end, 14.0)];
    },
  },
  {
    title: 'Underneath the wood is marble',
    body: `
      Look up at the flight overhead. Its underside is not a plain
      slope. It is a staircase too, made of marble, with treads and
      risers, the right way up for someone standing on the ceiling.

      A stepped ribbon is a staircase on both faces. The top of every
      wooden step is the bottom of a marble one.`,
    tryIt: 'Drag upward to look overhead',
    build(base) {
      const start = at(base, 1.5, 0.2, 0.3);
      const end = at(base, 1.5, 0.9, 1.05);
      return [keyframe(start, 3.0, 0.5), keyframe(end, 8.0)];
    },
  },
  {
    title: 'A marble door',
    body: `
      At this corner stands a door with a marble frame, which means it
      leads to marble. Through it you can see where you will come out:
      the same landing, from below.

      We walk through, and are rolled half-way over as we go. We arrive
      standing on the underside of the landing we just left. Down is
      now the other way.`,
    tryIt: 'Face a door and press the up arrow',
    build: base => passage(at(base, 4), 0.6, -0.1),
  },
  {
    title: 'The same place, the other way up',
    body: `
      Look round from the marble side. The pillar beside you has the
      same band of markings as before, now upside down. The wooden
      treads you climbed are overhead, hanging from what was the
      floor.

      Nothing moved. This is the space you were already in, seen by
      someone whose down is its up.`,
    tryIt: 'Turn round and walk back through the wooden door',
    build(base) {
      const facing = at(base, 4, Math.PI / 4, 0);
      facing.values[DOOR] = 0.999;
      const beyond = through(facing);
      const first = copyState(beyond);
      first.yaw = beyond.yaw - 0.5;
      first.pitch = 0.5;
      const second = copyState(beyond);
      second.yaw = beyond.yaw + 1.2;
      second.pitch = -0.2;
      return [keyframe(first, 3.0, 1.0), keyframe(second, 10.0)];
    },
  },
  {
    title: 'A quarter-turn to brass',
    body: `
      One corner up the wooden stairs, the door is framed in brass. It
      leads to the brass staircase, one of those lying on its side.

      This time the roll is a quarter-turn. When it is done, the brass
      stairs are under our feet and feel upright, and it is the wooden
      staircase that crosses the view sideways.`,
    tryIt: 'Try corner 1 and corner 3',
    build: base => passage(at(base, 5), 0.9, 0.1),
  },
  {
    title: 'Two floors up is where you started',
    body: `
      We climb. Watch the pillar: a band of discs, then one of
      diamonds, then discs again. After two full turns we are not
      merely somewhere that looks the same. We are back.

      The space joins up with itself after two floors, in all three
      directions, the way a circle joins up with itself after one lap.
      Floors that pass out of sight above come back from below.`,
    tryIt: 'Hold the up arrow and count the bands',
    build(base) {
      const start = at(base, 0.5, 0.45, 0.15);
      const end = at(base, 8.5, 0.45, 0.15);
      return [keyframe(start, 2.5, 1.0), keyframe(end, 24.0, 0, true)];
    },
  },
  {
    title: 'How the picture is drawn',
    body: `
      Only one flight of stairs is described to the computer. A
      quarter-turn and a rise repeats it round its pillar; swapping the
      three directions carries it to the other two staircases; and the
      whole space is folded onto one block that repeats.

      A ray leaves your eye for each pixel. If it passes through a
      door, it is moved to the partner door and turned exactly as you
      would be, so what you see through a door is where you will
      arrive.`,
    build: base => [keyframe(at(base, 3, 0.6, 0.0), 4.0)],
  },
  {
    title: 'Your turn',
    body: `
      Walk with the arrow keys: up and down to move, left and right to
      turn. On a landing, turn to face the door and walk into it.

      There are six realms: wood, marble, brass, slate, iron and tile.
      See whether you can stand on all six, and then find your way
      back to the wooden stairs.`,
    build: base => [keyframe(base, 3.0)],
  },
];

export const world = {
  id: 'escher',
  title: 'Escher stairs',
  formula: 'One space, six ways up',
  summary: 'Three spiral staircases share one space, each walked on both faces: wood above and marble beneath, brass and slate, iron and tile. Doors turn you onto another face, where everything you just left is sideways or overhead.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [0.5, 2.2],
  paletteNames: ['Realms'],
  controlGroups: [
    group('Walk', `
      The arrow keys walk: up and down move you forward and back
      along whatever you are facing, left and right turn you. W A S D
      and the buttons do the same, and dragging looks around.

      On a corner landing with a door, the door stands 45° to one
      side and the next flight 45° to the other. Turn to face the
      door and walk forward to go through it. You are rolled over
      on the way, and come out of its partner standing on another
      face of the stairs.`, [
      movePad('Move'),
      readout('Standing on', state => REALM_NAMES[realm(state)]),
      readout('Your up', upName),
      readout('Here', state => {
        if (state.values[DOOR] > 0) { return 'in the doorway'; }
        if (!isAtLanding(state)) { return 'on the stairs'; }
        const target = doorHere(state);
        if (!target) { return 'a landing with no door'; }
        return `door to ${REALM_NAMES[2 * target.chart + target.side].toLowerCase()}`;
      }),
      readout('Doors passed', state => String(Math.trunc(state.values[COUNT]))),
    ]),
    group('The space', `
      There are three staircases, one winding about each of the
      three directions of space. Each is a thin stepped ribbon, and
      a stepped ribbon is a staircase on both faces: the top of the
      wooden stairs is the underside of the marble ones. That makes
      six realms, each with its own down.

      Everything is in one space, which is why the stairs you left
      are still in view after a door, lying on their side or
      hanging overhead. The pillars carry a band of discs on one
      floor and diamonds on the next. Climb two floors and the
      discs are back: the space joins up with itself, in every
      direction.`, [
      readout('About y', () => 'wood above, marble below'),
      readout('About z', () => 'brass, slate'),
      readout('About x', () => 'iron, tile'),
      readout('Repeats every', () => '2 floors'),
    ]),
    group('Doors', `
      A door's frame is made of the material of the face it leads
      to. Three corners of each turn have a door. One leads to the
      other face of the same stairs, and rolls you a half-turn. The
      other two lead to the other two staircases, and roll you a
      quarter-turn.

      Doors come in pairs, and each undoes the other: turn round
      after a door, walk back through, and you are where you were.
      A door is a jump, not a passage: it joins two places in the
      same space.`, [
      readout('Corner 0', state => `to ${REALM_NAMES[realm(state) ^ 1].toLowerCase()}`),
      readout('Corner 1', state =>
        'to ' + REALM_NAMES[2 * ((chartIndex(state) + 1) % 3) + sideIndex(state)].toLowerCase()),
      readout('Corner 2', () => 'no door'),
      readout('Corner 3', state =>
        'to ' + REALM_NAMES[2 * ((chartIndex(state) + 2) % 3) + sideIndex(state)].toLowerCase()),
    ]),
  ],
  viewNote: `
    Zoom narrows the view like a longer lens; it does not move you.
    Reset view returns you to the wooden stairs where you began.`,
  tour,
  shaderValues(state) {
    // The zoom, then the camera's right, up, forward and position.
    const c = camera(state);
    const values = new Array(32).fill(0);
    values[0] = defaults.cameraDistance / state.cameraDistance;
    for (let i = 0; i < 3; i += 1) {
      values[4 + i] = c.right[i];
      values[8 + i] = c.up[i];
      values[12 + i] = c.forward[i];
      values[16 + i] = c.position[i];
    }
    return values;
  },
  discreteValues: new Set([CHART, SIDE, COUNT, ...[0, 1, 2, 3, 4, 5].map(i => HISTORY + i)]),
  cameraBacksAwayWhenMoving: false,
  step(state, probe, forward, right) {
    if (forward !== 0) { walk(state, forward); }
    if (right !== 0) { state.yaw -= 0.07 * right; }
  },
  stepHint: 'Arrow keys or W A S D: up and down walk, left and right turn.',
  resetView(state) {
    state.values = [...defaults.values];
    state.yaw = defaults.yaw;
    state.pitch = defaults.pitch;
  },
  tourKeepsPalette: false,
  pitchRange: [-1.4, 1.4],
};
