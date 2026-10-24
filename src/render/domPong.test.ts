import { describe, expect, it } from 'vitest';
import { DomPong } from './domPong.ts';

function fakeStage() {
  const makeElement = () => ({ style: { left: '', top: '' }, hidden: true });
  const parts = {
    '#paddleLeft': makeElement(),
    '#paddleRight': makeElement(),
    '#pongBall': makeElement(),
    '#pongBallGlow': makeElement(),
  };
  const trails = Array.from({ length: 5 }, makeElement);
  const stage = {
    querySelector: (selector: keyof typeof parts) => parts[selector] ?? null,
    querySelectorAll: () => trails,
  } as unknown as HTMLElement;
  return { parts, trails, stage };
}

describe('Pong DOM renderer', () => {
  it('renders visible paddle and ball coordinates from the authoritative state', () => {
    const { parts, stage } = fakeStage();
    const renderer = new DomPong(stage);
    renderer.resize();
    renderer.draw({ leftY: 120, rightY: 360, ball: { x: 200, y: 240 } });
    expect(parts['#paddleLeft'].style.top).toBe('25%');
    expect(parts['#paddleRight'].style.top).toBe('75%');
    expect(parts['#pongBall'].style.left).toBe('25%');
    expect(parts['#pongBall'].style.top).toBe('50%');
    expect(parts['#pongBallGlow'].style.left).toBe('25%');
    renderer.destroy();
  });

  it('shows a trail on movement and hides it on an abrupt serve/reset', () => {
    const { trails, stage } = fakeStage();
    const renderer = new DomPong(stage);
    renderer.draw({ leftY: 240, rightY: 240, ball: { x: 400, y: 240 } });
    expect(trails.every(item => item.hidden)).toBe(true);
    renderer.draw({ leftY: 240, rightY: 240, ball: { x: 415, y: 240 } });
    expect(trails.every(item => !item.hidden)).toBe(true);
    renderer.draw({ leftY: 240, rightY: 240, ball: { x: 700, y: 240 } });
    expect(trails.every(item => item.hidden)).toBe(true);
  });

  it('keeps elements inside the playfield if state contains a non-finite value', () => {
    const { parts, stage } = fakeStage();
    new DomPong(stage).draw({ leftY: Number.NaN, rightY: 240, ball: { x: Infinity, y: NaN } });
    expect(parts['#pongBall'].style.left).toBe('50%');
    expect(parts['#pongBall'].style.top).toBe('50%');
    expect(parts['#paddleLeft'].style.top).toBe('50%');
  });
});
