// A number kept as the sum of two, the second far smaller than the first:
// about thirty-two digits where one number has sixteen. The error of each
// operation on the large parts is worked out exactly and carried in the
// small ones. This is `Wide` in the app's WorldDefinition.swift; here a wide
// number is a pair [hi, lo].

const tidy = (hi, lo) => {
  const s = hi + lo;
  return [s, lo - (s - hi)];
};

/** The exact sum of two numbers: its rounded value and what rounding lost. */
function sum(a, b) {
  const s = a + b;
  const bb = s - a;
  return [s, (a - (s - bb)) + (b - bb)];
}

/** A number cut into two halves whose products are exact. */
function halves(a) {
  const t = 134217729 * a;
  const high = t - (t - a);
  return [high, a - high];
}

/** What the rounded product a·b lost, exactly. */
function lost(a, b, p) {
  const [ah, al] = halves(a);
  const [bh, bl] = halves(b);
  return ((ah * bh - p) + ah * bl + al * bh) + al * bl;
}

export const Wide = {
  of: (hi, lo = 0) => [hi, lo],
  add(a, b) {
    const s = sum(a[0], b[0]);
    return tidy(s[0], s[1] + a[1] + b[1]);
  },
  neg: a => [-a[0], -a[1]],
  sub: (a, b) => Wide.add(a, Wide.neg(b)),
  /** A wide number plus an ordinary one. */
  plus: (a, b) => Wide.add(a, [b, 0]),
  mul(a, b) {
    const p = a[0] * b[0];
    return tidy(p, lost(a[0], b[0], p) + a[0] * b[1] + a[1] * b[0]);
  },
  /** A wide number times an ordinary one. */
  times: (a, b) => Wide.mul(a, [b, 0]),
  over(a, b) {
    const first = a[0] / b;
    const rest = Wide.sub(a, Wide.times([b, 0], first));
    return tidy(first, rest[0] / b);
  },

  /** Reads a decimal such as "-0.743643887037158704752191506114774". */
  fromDecimal(text) {
    const match = /^\s*([-−+]?)(\d*)(?:\.(\d*))?\s*$/.exec(text);
    if (!match || (match[2] + (match[3] ?? '')).length === 0) { return null; }
    let value = [0, 0];
    for (const digit of match[2] + (match[3] ?? '')) {
      value = Wide.plus(Wide.times(value, 10), Number(digit));
    }
    for (let i = 0; i < (match[3] ?? '').length; i += 1) { value = Wide.over(value, 10); }
    return match[1] === '-' || match[1] === '−' ? Wide.neg(value) : value;
  },

  /** Written out to a number of decimal places. */
  decimal(a, places) {
    let rest = a[0] < 0 ? Wide.neg(a) : a;
    const whole = Math.floor(rest[0]);
    rest = Wide.plus(rest, -whole);
    if (rest[0] < 0) { rest = [0, 0]; }
    let text = (a[0] < 0 ? '−' : '') + String(whole) + '.';
    for (let i = 0; i < places; i += 1) {
      rest = Wide.times(rest, 10);
      const digit = Math.min(Math.max(Math.floor(rest[0]), 0), 9);
      text += String(digit);
      rest = Wide.plus(rest, -digit);
    }
    return text;
  },
};
