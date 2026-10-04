// A formula in z, such as `sin(z) - z^2/2`, turned into a short list of
// steps that the shader and the page both run (see `labFormula` in
// shaders/newton-lab.js). Each step works on a stack of numbers, and each
// number carries its own slope, so the slope of the whole formula comes out
// alongside its value with no algebra. This is Worlds/Flat/FormulaProgram.swift.

/** The steps' numbers, as the shader knows them. */
export const Op = {
  z: 1, constant: 2, add: 3, subtract: 4, multiply: 5, divide: 6, negate: 7, power: 8,
  sin: 9, cos: 10, exp: 11, log: 12, sqrt: 13, sinh: 14, cosh: 15, tan: 16, tanh: 17,
};

/** The most steps a program may have, and the deepest its stack may go. */
export const LONGEST = 48;
export const DEEPEST = 8;

// MARK: Reading a formula

const FUNCTIONS = {
  sin: Op.sin, cos: Op.cos, tan: Op.tan, exp: Op.exp, log: Op.log, ln: Op.log,
  sqrt: Op.sqrt, sinh: Op.sinh, cosh: Op.cosh, tanh: Op.tanh,
};
const NAMES = [...Object.keys(FUNCTIONS), 'pi', 'z', 'i', 'e'];

const isDigit = c => (c >= '0' && c <= '9') || c === '.';
const isLetter = c => /\p{L}/u.test(c);

function tokens(text) {
  const out = [];
  const characters = [...text.toLowerCase().replaceAll('−', '-').replaceAll('·', '*').replaceAll('π', 'pi')];
  let index = 0;
  while (index < characters.length) {
    const character = characters[index];
    if (character === ' ') {
      index += 1;
    } else if (isDigit(character)) {
      let end = index;
      while (end < characters.length && isDigit(characters[end])) { end += 1; }
      const written = characters.slice(index, end).join('');
      if (!/^(\d+\.?\d*|\.\d+)$/.test(written)) { return null; }
      out.push({ number: Number(written) });
      index = end;
    } else if (isLetter(character)) {
      let end = index;
      while (end < characters.length && isLetter(characters[end])) { end += 1; }
      // Letters run together are split into the longest names known.
      let rest = characters.slice(index, end).join('');
      while (rest.length > 0) {
        let known = null;
        for (const name of NAMES) {
          if (rest.startsWith(name) && (known === null || name.length > known.length)) { known = name; }
        }
        if (known === null) { return null; }
        out.push({ name: known });
        rest = rest.slice(known.length);
      }
      index = end;
    } else if ('+-*/^()'.includes(character)) {
      out.push({ symbol: character });
      index += 1;
    } else {
      return null;
    }
  }
  return out;
}

/** Reads a formula; null if it cannot be understood or is too long. */
export function parse(text) {
  const list = tokens(String(text));
  if (!list || list.length === 0) { return null; }
  let position = 0;
  const steps = [];
  let failed = false;

  const push = (op, number = [0, 0]) => steps.push({ op, number });
  const peek = () => (position < list.length ? list[position] : null);
  const take = symbol => {
    if (peek()?.symbol === symbol) { position += 1; return true; }
    return false;
  };
  const startsValue = () => {
    const token = peek();
    return token !== null && (token.number !== undefined || token.name !== undefined || token.symbol === '(');
  };

  function sum() {
    product();
    while (!failed) {
      if (take('+')) { product(); push(Op.add); }
      else if (take('-')) { product(); push(Op.subtract); }
      else { break; }
    }
  }
  function product() {
    signed();
    while (!failed) {
      if (take('*')) { signed(); push(Op.multiply); }
      else if (take('/')) { signed(); push(Op.divide); }
      // Two values side by side are multiplied: 2z, z(z − 1).
      else if (startsValue()) { raised(); push(Op.multiply); }
      else { break; }
    }
  }
  function signed() {
    if (take('-')) {
      signed();
      push(Op.negate);
    } else {
      take('+');
      raised();
    }
  }
  function raised() {
    value();
    if (failed || !take('^')) { return; }
    // A whole-number power is one step; any other is e^(power · log).
    const mark = position;
    let sign = 1;
    if (take('-')) { sign = -1; }
    const n = peek()?.number;
    if (n !== undefined && n === Math.round(n) && Math.abs(n) <= 64
        && (position + 1 >= list.length || list[position + 1].symbol !== '^')) {
      position += 1;
      push(Op.power, [sign * n, 0]);
      return;
    }
    position = mark;
    push(Op.log);
    signed();
    push(Op.multiply);
    push(Op.exp);
  }
  function value() {
    const token = peek();
    if (token === null) { failed = true; return; }
    position += 1;
    if (token.number !== undefined) {
      push(Op.constant, [token.number, 0]);
    } else if (token.name === 'z') {
      push(Op.z);
    } else if (token.name === 'i') {
      push(Op.constant, [0, 1]);
    } else if (token.name === 'e') {
      push(Op.constant, [Math.E, 0]);
    } else if (token.name === 'pi') {
      push(Op.constant, [Math.PI, 0]);
    } else if (token.name !== undefined) {
      const op = FUNCTIONS[token.name];
      if (op === undefined || !take('(')) { failed = true; return; }
      sum();
      if (!take(')')) { failed = true; return; }
      push(op);
    } else if (token.symbol === '(') {
      sum();
      if (!take(')')) { failed = true; }
    } else {
      failed = true;
    }
  }

  sum();
  if (failed || position !== list.length || steps.length > LONGEST) { return null; }
  // A formula that asks for too deep a stack, or leaves it wrong, is refused.
  let depth = 0, deepest = 0;
  for (const step of steps) {
    if (step.op === Op.z || step.op === Op.constant) { depth += 1; }
    else if (step.op >= Op.add && step.op <= Op.divide) { depth -= 1; }
    deepest = Math.max(deepest, depth);
    if (depth < 1) { return null; }
  }
  if (depth !== 1 || deepest > DEEPEST) { return null; }
  return { steps };
}

// MARK: Running it

const plus = (a, b) => [a[0] + b[0], a[1] + b[1]];
const minus = (a, b) => [a[0] - b[0], a[1] - b[1]];
const scaled = (a, s) => [a[0] * s, a[1] * s];
const times = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];

function over(a, b) {
  const bottom = Math.max(b[0] * b[0] + b[1] * b[1], 1e-300);
  return [(a[0] * b[0] + a[1] * b[1]) / bottom, (a[1] * b[0] - a[0] * b[1]) / bottom];
}

function power(a, n) {
  const size = Math.hypot(a[0], a[1]);
  if (!(size > 1e-300)) { return [n === 0 ? 1 : 0, 0]; }
  const angle = Math.atan2(a[1], a[0]) * n;
  return scaled([Math.cos(angle), Math.sin(angle)], size ** n);
}

const sine = a => [Math.sin(a[0]) * Math.cosh(a[1]), Math.cos(a[0]) * Math.sinh(a[1])];
const cosine = a => [Math.cos(a[0]) * Math.cosh(a[1]), -Math.sin(a[0]) * Math.sinh(a[1])];
const sineH = a => [Math.sinh(a[0]) * Math.cos(a[1]), Math.cosh(a[0]) * Math.sin(a[1])];
const cosineH = a => [Math.cosh(a[0]) * Math.cos(a[1]), Math.sinh(a[0]) * Math.sin(a[1])];

/** The formula's value at z, and its slope there. */
export function evaluate(program, z) {
  const stack = [];
  for (const step of program.steps) {
    const op = step.op;
    if (op === Op.z) {
      stack.push({ v: z, d: [1, 0] });
    } else if (op === Op.constant) {
      stack.push({ v: step.number, d: [0, 0] });
    } else if (op >= Op.add && op <= Op.divide) {
      const b = stack.pop(), a = stack.pop();
      if (op === Op.add) {
        stack.push({ v: plus(a.v, b.v), d: plus(a.d, b.d) });
      } else if (op === Op.subtract) {
        stack.push({ v: minus(a.v, b.v), d: minus(a.d, b.d) });
      } else if (op === Op.multiply) {
        stack.push({ v: times(a.v, b.v), d: plus(times(a.d, b.v), times(a.v, b.d)) });
      } else {
        const value = over(a.v, b.v);
        stack.push({ v: value, d: over(minus(a.d, times(value, b.d)), b.v) });
      }
    } else {
      const a = stack.pop();
      let value, slope;
      if (op === Op.negate) {
        value = [-a.v[0], -a.v[1]];
        slope = [-1, 0];
      } else if (op === Op.power) {
        value = power(a.v, step.number[0]);
        slope = scaled(power(a.v, step.number[0] - 1), step.number[0]);
      } else if (op === Op.sin) {
        value = sine(a.v);
        slope = cosine(a.v);
      } else if (op === Op.cos) {
        value = cosine(a.v);
        slope = scaled(sine(a.v), -1);
      } else if (op === Op.exp) {
        value = scaled([Math.cos(a.v[1]), Math.sin(a.v[1])], Math.exp(a.v[0]));
        slope = value;
      } else if (op === Op.log) {
        value = [Math.log(Math.max(Math.hypot(a.v[0], a.v[1]), 1e-300)), Math.atan2(a.v[1], a.v[0])];
        slope = over([1, 0], a.v);
      } else if (op === Op.sqrt) {
        value = power(a.v, 0.5);
        slope = over([0.5, 0], value);
      } else if (op === Op.sinh) {
        value = sineH(a.v);
        slope = cosineH(a.v);
      } else if (op === Op.cosh) {
        value = cosineH(a.v);
        slope = sineH(a.v);
      } else if (op === Op.tan) {
        const bottom = cosine(a.v);
        value = over(sine(a.v), bottom);
        slope = over([1, 0], times(bottom, bottom));
      } else {
        const bottom = cosineH(a.v);
        value = over(sineH(a.v), bottom);
        slope = over([1, 0], times(bottom, bottom));
      }
      stack.push({ v: value, d: times(slope, a.d) });
    }
  }
  const last = stack[stack.length - 1];
  return last ? { value: last.v, slope: last.d } : { value: [0, 0], slope: [0, 0] };
}

/** The steps as the shader reads them: four numbers to a step. */
export function table(program) {
  const out = new Float32Array(4 * program.steps.length);
  program.steps.forEach((step, index) => {
    out[4 * index] = step.op;
    out[4 * index + 1] = step.number[0];
    out[4 * index + 2] = step.number[1];
  });
  return out;
}

// MARK: Keeping a formula in a world's numbers

/** The characters a stored formula may use. Each takes six bits, and
    eight of them fit exactly in one of a world's values. */
const ALPHABET = [...'0123456789.abcdefghijklmnopqrstuvwxyz+-*/^() '];
export const CHARACTERS_PER_VALUE = 8;

/** Packs a formula's text into `count` values; null if it does not fit or
    uses other characters. */
export function pack(text, count) {
  const characters = [...String(text).toLowerCase().replaceAll('−', '-')];
  if (characters.length > count * CHARACTERS_PER_VALUE) { return null; }
  const values = new Array(count).fill(0);
  for (let index = 0; index < characters.length; index += 1) {
    const code = ALPHABET.indexOf(characters[index]);
    if (code < 0) { return null; }
    values[Math.floor(index / CHARACTERS_PER_VALUE)] += (code + 1) * 64 ** (index % CHARACTERS_PER_VALUE);
  }
  return values;
}

export function unpack(values) {
  let text = '';
  for (const value of values) {
    let rest = Math.round(value);
    if (!Number.isFinite(rest) || rest < 0) { break; }
    for (let i = 0; i < CHARACTERS_PER_VALUE; i += 1) {
      const code = rest % 64;
      rest = Math.floor(rest / 64);
      if (code < 1 || code > ALPHABET.length) { return text; }
      text += ALPHABET[code - 1];
    }
  }
  return text;
}
