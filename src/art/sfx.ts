// Small WebAudio blips in the spirit of the game's sounds. The AudioContext is created on first
// use (a user gesture), and nothing plays while settings.sound is off (see setSound).

export type SfxName = 'click' | 'orb' | 'task' | 'goal' | 'challenge' | 'levelup' | 'trade';

let enabled = true;
let ctx: AudioContext | null = null;

/** Mirror settings.sound; App keeps this in sync with the store. */
export function setSound(on: boolean): void {
  enabled = on;
}

function audio(): AudioContext | null {
  if (!enabled || typeof window === 'undefined') return null;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => { /* resumes on the next gesture */ });
  } catch {
    ctx = null;
  }
  return ctx;
}

function note(freq: number, at: number, dur: number, type: OscillatorType = 'square', vol = .05): void {
  const c = audio();
  if (!c) return;
  const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + at;
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + .012);
  g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + .03);
}

export const SFX: Readonly<Record<SfxName, () => void>> = {
  click: () => note(520, 0, .05, 'square', .025),
  orb: () => note(1300 + Math.random() * 700, 0, .1, 'sine', .045),
  task: () => { note(784, 0, .2, 'triangle', .07); note(1175, .1, .34, 'triangle', .06); },
  goal: () => { note(659, 0, .2, 'triangle', .07); note(988, .1, .22, 'triangle', .06); note(1319, .2, .4, 'triangle', .05); },
  challenge: () => {
    [392, 523, 659, 784].forEach((f, i) => note(f, i * .11, .32, 'square', .03));
    [1047, 1319, 1568].forEach(f => note(f, .5, .9, 'triangle', .045));
  },
  levelup: () => [523, 659, 784, 1047].forEach((f, i) => note(f, i * .08, .28, 'triangle', .055)),
  trade: () => { note(660, 0, .12, 'triangle', .06); note(990, .08, .24, 'triangle', .05); },
};
