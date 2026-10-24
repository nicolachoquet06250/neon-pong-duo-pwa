import { FIELD } from '../config/constants.ts';
import type { Snapshot } from '../core/engine.ts';

/**
 * Pong uses plain DOM elements, not WebGL. The scoreboard is already HTML, so
 * the paddles/ball deliberately use the same rendering path on phone and MRBD.
 * Positions are percentages of the 800 x 480 simulation field; the board's
 * CSS aspect ratio preserves its geometry at every viewport size.
 */
export class DomPong {
  private readonly left: HTMLElement;
  private readonly right: HTMLElement;
  private readonly ball: HTMLElement;
  private readonly glow: HTMLElement;
  private readonly trails: HTMLElement[];
  private prev = { x: FIELD.width / 2, y: FIELD.height / 2 };

  constructor(readonly stage: HTMLElement) {
    const required = (selector: string): HTMLElement => {
      const element = stage.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing Pong element: ${selector}`);
      return element;
    };
    this.left = required('#paddleLeft');
    this.right = required('#paddleRight');
    this.ball = required('#pongBall');
    this.glow = required('#pongBallGlow');
    this.trails = Array.from(stage.querySelectorAll<HTMLElement>('.pong-trail'));
  }

  /** The CSS layout scales sprites together with the board; no resize needed. */
  resize(): void {}

  draw(state: Pick<Snapshot, 'ball' | 'leftY' | 'rightY'>): void {
    const x = Number.isFinite(state.ball.x) ? state.ball.x : FIELD.width / 2;
    const y = Number.isFinite(state.ball.y) ? state.ball.y : FIELD.height / 2;
    const leftY = Number.isFinite(state.leftY) ? state.leftY : FIELD.height / 2;
    const rightY = Number.isFinite(state.rightY) ? state.rightY : FIELD.height / 2;
    const atX = (value: number): string => `${(value / FIELD.width) * 100}%`;
    const atY = (value: number): string => `${(value / FIELD.height) * 100}%`;

    this.left.style.top = atY(leftY);
    this.right.style.top = atY(rightY);
    this.ball.style.left = this.glow.style.left = atX(x);
    this.ball.style.top = this.glow.style.top = atY(y);

    const dx = this.prev.x - x;
    const dy = this.prev.y - y;
    const movement = Math.hypot(dx, dy);
    const showTrail = movement > 2 && movement < 65;
    for (let i = 0; i < this.trails.length; i++) {
      const trail = this.trails[i];
      trail.hidden = !showTrail;
      if (showTrail) {
        const factor = (i + 1) / (this.trails.length + 1);
        trail.style.left = atX(x + dx * factor);
        trail.style.top = atY(y + dy * factor);
      }
    }
    this.prev = { x, y };
  }

  destroy(): void {
    // No GPU resources or event listeners to dispose.
  }
}
