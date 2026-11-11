// Flying through a lattice near the speed of light: aberration, Doppler
// colour and brightness, worked out exactly. This is
// Worlds/Relativity/LorentzWorld.swift, without its explorer; the tour's
// words are copied from it.
import { newState, copyState, keyframe, slider, toggle, readout, group, Format } from './engine.js';
import { FRAGMENT } from './shaders/lorentz.js';

// Indices into the state's values.
const SPEED = 0;
const ABERRATION = 1;
const DOPPLER = 2;
const BRIGHTNESS = 3;
const FLYING = 4;
const TEMPERATURE = 5;

/** The way the traveller is heading, slightly off the lattice's axes. */
const HEADING = (() => {
  const v = [0.21, 0.13, -1];
  const n = Math.hypot(...v);
  return v.map(c => c / n);
})();
const START = [0.5, 0.5, 0.5];

const defaults = newState();
defaults.values[ABERRATION] = 1;
defaults.values[DOPPLER] = 1;
defaults.values[BRIGHTNESS] = 1;
defaults.values[FLYING] = 1;
defaults.values[TEMPERATURE] = 5200;
defaults.yaw = 0;
defaults.pitch = 0;
defaults.cameraDistance = 1;

const beta = state => Math.min(Math.max(state.values[SPEED], 0), 0.999);
const gamma = b => 1 / Math.sqrt(1 - b * b);
const degrees = radians => (radians * 180 / Math.PI).toFixed(1) + '°';

function at(base, b, yaw = 0, pitch = 0) {
  const state = copyState(base);
  state.values[SPEED] = b;
  state.yaw = yaw;
  state.pitch = pitch;
  return state;
}

// MARK: Guided tour

const tour = [
  {
    title: 'A lattice at rest',
    body: `
      Beams one unit apart run in three directions, each glowing
      like a hot wire at about 5,200 K. You are drifting slowly
      through it. For now your speed is nothing worth mentioning,
      and the lattice looks the way a lattice should.`,
    tryIt: 'Drag to look around',
    build: base => [keyframe(at(base, 0, 0.6, 0.2), 3.0), keyframe(at(base, 0, 0, 0), 5.0)],
  },
  {
    title: 'Everything moves ahead',
    body: `
      Now we speed up to half the speed of light. The lattice seems
      to swell out from the middle of the view, beams that were
      beside you slide forward into sight, and straight beams look
      bent, because each point of a beam is moved by a different angle.

      This is aberration. Running through rain, you must tilt your
      umbrella forward: the drops seem to come from ahead. Light
      does the same. James Bradley saw it in 1727 in the stars,
      shifted by the Earth's own speed.`,
    tryIt: 'Speed → Speed, β',
    build: base => [keyframe(at(base, 0.5), 10.0)],
  },
  {
    title: 'Tunnel vision',
    body: `
      At 0.9 of the speed of light, everything that was at your side
      now appears only 26° from straight ahead, and almost the whole
      lattice is gathered into a cone in front of you.

      Look behind. The view there is stretched thin and nearly
      empty: the light you see behind you left the lattice from
      almost directly behind.`,
    tryIt: 'Drag to look behind you',
    build: base => [keyframe(at(base, 0.9), 8.0, 3.0), keyframe(at(base, 0.9, Math.PI), 6.0, 2.0), keyframe(at(base, 0.9), 5.0)],
  },
  {
    title: 'Blue ahead, red behind',
    body: `
      Light from ahead arrives with its frequency raised by
      D = γ(1 + β cos θ): about 4.4 times at this speed. A body
      glowing at 5,200 K looks as if it glowed at over 20,000 K:
      blue-white. Behind, D is less than a quarter, and the glow sinks
      to a dull red and then into the infrared, out of sight.

      First the colours are shown unchanged, then shifted, then
      behind you. Brightness is left off for now; it is the next stop.`,
    tryIt: 'What changes → Doppler colour',
    build(base) {
      const plain = at(base, 0.9, 0.35);
      plain.values[DOPPLER] = 0;
      plain.values[BRIGHTNESS] = 0;
      const coloured = copyState(plain);
      coloured.values[DOPPLER] = 1;
      const behind = copyState(coloured);
      behind.yaw = Math.PI;
      // It ends looking across the way you travel, with the blue of ahead
      // and the red of behind both in view.
      const across = copyState(coloured);
      across.yaw = 1.15;
      return [keyframe(plain, 4.0, 3.0), keyframe(coloured, 2.0, 4.0), keyframe(behind, 6.0, 2.5), keyframe(across, 5.0)];
    },
  },
  {
    title: 'A searchlight ahead',
    body: `
      The light is also crowded together in time and in angle, so it
      arrives more densely. Its brightness is multiplied by D⁴:
      thousands of times straight ahead, and only a few
      ten-thousandths behind.

      A traveller this fast sees the universe shrink into one blazing
      spot ahead, and darkness everywhere else.`,
    tryIt: 'Speed → Speed, β, near 0.99',
    build: base => [keyframe(at(base, 0.97), 8.0)],
  },
  {
    title: 'Shrunk, but not squashed',
    body: `
      Measured in the lattice, your ruler is short by γ; measured by
      you, the lattice's spacing along your path is short by γ. That
      is real. But a photograph does not show it as squashing.

      Light from the far side of a beam set out earlier than light
      from the near side, to arrive together. The shortening and
      this delay combine into what looks like a turn. James Terrell
      and Roger Penrose noticed it in 1959: a ball still looks round.`,
    build: base => [keyframe(at(base, 0.7, 0.8, 0.1), 6.0, 2.0), keyframe(at(base, 0, 0.8, 0.1), 6.0, 1.0), keyframe(at(base, 0.7, 0.8, 0.1), 6.0)],
  },
  {
    title: 'Your turn',
    body: `
      Set the speed, look in every direction, and turn aberration,
      Doppler colour and brightness on and off one at a time to see
      what each contributes. Change the glow at rest. Every group of
      controls has an ⓘ note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(at(base, 0.6), 3.0)],
  },
];

// MARK: World

// MARK: Explorer

/** The angle, in the lattice, of light that is seen at angle `seen` from ahead. */
const latticeAngle = (seen, b) => Math.acos(Math.min(Math.max((Math.cos(seen) - b) / (1 - b * Math.cos(seen)), -1), 1));
/** How many times its frequency is multiplied. */
const dopplerFactor = (lattice, b) => gamma(b) * (1 + b * Math.cos(lattice));

/** What the explorer says about one direction of looking: LorentzWorld.report in the app. */
function explorerReport(seenDegrees, state) {
  const b = beta(state);
  const g = gamma(b);
  const rest = state.values[TEMPERATURE];
  const rows = [];
  for (let index = 0; index <= 12; index += 1) {
    const seen = 15 * index;
    const s = seen * Math.PI / 180;
    const lattice = latticeAngle(s, b);
    const d = dopplerFactor(lattice, b);
    rows.push({
      id: index,
      cells: [`${seen}°`, degrees(lattice), d.toFixed(3), `${Math.round(rest * d)} K`],
      workedTitle: `Seen at ${seen}°, worked`,
      worked: [
        ['cos θ′', Math.cos(s).toFixed(5)],
        ['cos θ = (cos θ′ − β) ⁄ (1 − β cos θ′)', Math.cos(lattice).toFixed(5)],
        ['θ, in the lattice', degrees(lattice)],
        ['D = γ(1 + β cos θ)', d.toFixed(5)],
        ['same as 1 ⁄ (γ(1 − β cos θ′))', (1 / (g * (1 - b * Math.cos(s)))).toFixed(5)],
        [`glow, D × ${Math.trunc(rest)} K`, `${Math.round(rest * d)} K`],
        ['brightness, D⁴', Format.significant(d ** 4, 4)],
      ],
      note: d > 1
        ? 'D is more than 1: this light arrives bluer and brighter than it left.'
        : 'D is less than 1: this light arrives redder and dimmer than it left.',
    });
  }
  const s = Math.min(Math.max(seenDegrees, 0), 180) * Math.PI / 180;
  const lattice = latticeAngle(s, b);
  const d = dopplerFactor(lattice, b);
  return {
    headline: `Light seen ${Math.round(seenDegrees)}° from ahead left the lattice ${degrees(lattice)} from your direction of travel`,
    details: [
      `At β = ${b.toFixed(3)}, γ = ${g.toFixed(4)}.`,
      `Its colour is multiplied by D = ${d.toFixed(4)}: a ${Math.trunc(rest)} K glow looks like ${Math.round(rest * d)} K, and ${Format.significant(d ** 4, 3)} times as bright.`,
      `Everything the lattice sends from your side, at 90°, appears at ${degrees(Math.acos(b))} from straight ahead.`,
    ],
    tableTitle: 'Every 15°', columns: ['seen θ′', 'from θ', 'D', 'glow'], rows, markers: [],
  };
}

const explorer = {
  title: 'Angle explorer',
  subtitle: 'Where light seen at one angle really came from',
  buttonTitle: 'Angle explorer',
  blurb: 'The explorer takes a direction you look in, measured from straight ahead, and works out where that light came from in the lattice, how its colour changed and how much brighter it is.',
  pointTitle: 'Looking, from straight ahead',
  coordinates: [{ label: 'θ′ (°)', range: [0, 180] }],
  moveHint: 'Arrow keys change the angle.',
  initialProbe: () => [60, 0, 0, 0],
  report: (probe, state) => explorerReport(probe[0], state),
  move: (probe, right, up) => [Math.min(Math.max(probe[0] + 2 * (right + up), 0), 180), 0, 0, 0],
};

export const world = {
  id: 'lorentz',
  title: 'Near the speed of light',
  formula: 'cos θ = (cos θ′ − β) ⁄ (1 − β cos θ′)',
  summary: 'Fly through a lattice of glowing beams at up to 99.9% of the speed of light and see what you would really see: the world crowds in ahead of you, turns blue and blazing in front and dull red behind, and seems turned rather than squashed.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [0.4, 2.5],
  paletteNames: ['Glow'],
  controlGroups: [
    group('Speed', `
      β is your speed as a fraction of the speed of light. γ, the
      Lorentz factor, is 1 ⁄ √(1 − β²): how much your clocks run slow as
      measured from the lattice, and how much the lattice's lengths along
      your path shrink as measured by you.

      The picture always shows what reaches your eye at one instant.
      The lattice is at rest, so each ray is followed back through
      it as it really ran, and only the angle and colour at which
      it arrives are changed by your motion.`, [
      slider('Speed, β', SPEED, [0, 0.99], value => value.toFixed(3) + ' c'),
      readout('γ', state => gamma(beta(state)).toFixed(3)),
      readout('Lengths shrink to', state => (100 / gamma(beta(state))).toFixed(1) + '%'),
      readout('The side appears at', state => degrees(Math.acos(beta(state))) + ' from ahead'),
      toggle('Fly', FLYING),
    ]),
    group('What changes', `
      Aberration: light that, in the lattice, comes at you from
      angle θ arrives at angle θ′ with cos θ′ = (cos θ + β) ⁄
      (1 + β cos θ). Everything is pulled toward the way you are
      going. James Bradley found this in starlight in 1727, from the
      Earth's speed of 30 km ⁄ s.

      Doppler colour: every frequency is multiplied by D =
      γ(1 + β cos θ), so a body glowing at temperature T looks as
      if it glowed at D·T. Brightness: the light also arrives more
      densely, by D⁴. Turn each off to see what it does.`, [
      toggle('Aberration', ABERRATION),
      toggle('Doppler colour', DOPPLER),
      toggle('Brightness', BRIGHTNESS),
      slider('Glow at rest', TEMPERATURE, [2000, 9000], value => Math.round(value) + ' K'),
      readout('Ahead, D', state => (gamma(beta(state)) * (1 + beta(state))).toFixed(2)),
      readout('Behind, D', state => (gamma(beta(state)) * (1 - beta(state))).toFixed(2)),
    ]),
  ],
  viewNote: `
    Drag to look around, including behind you. Zoom narrows the view like
    a longer lens. You travel slowly through the lattice so that its
    shape can be followed; the light is drawn as it would arrive at the
    speed set above.`,
  tour,
  explorer,
  shaderValues(state) {
    const values = new Array(32).fill(0);
    values[0] = beta(state);
    values[1] = state.values[ABERRATION] > 0.5 ? 1 : 0;
    values[2] = state.values[DOPPLER] > 0.5 ? 1 : 0;
    values[3] = state.values[BRIGHTNESS] > 0.5 ? 1 : 0;
    values[4] = defaults.cameraDistance / state.cameraDistance;
    values[5] = state.values[TEMPERATURE];
    values[6] = state.values[FLYING] > 0.5 ? 1 : 0;
    for (let i = 0; i < 3; i += 1) {
      values[8 + i] = HEADING[i];
      values[12 + i] = START[i];
    }
    return values;
  },
  discreteValues: new Set([ABERRATION, DOPPLER, BRIGHTNESS, FLYING]),
  cameraBacksAwayWhenMoving: false,
  tourKeepsPalette: false,
  animates: true,
  pitchRange: [-1.5, 1.5],
};
