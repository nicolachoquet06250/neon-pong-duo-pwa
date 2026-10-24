import { FIELD } from '../config/constants.ts';

export type Phase = 'waiting' | 'countdown' | 'playing' | 'gameover';
export type Side = 'left' | 'right';
export interface Snapshot {
  type: 'state';
  seq: number;
  phase: Phase;
  countdown: number;
  ball: { x: number; y: number };
  leftY: number;
  rightY: number;
  scoreL: number;
  scoreR: number;
  winner: Side | null;
}
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
export function normalizeRoom(raw: string | null | undefined): string | null {
  const code = raw?.trim().toUpperCase() ?? '';
  return /^[A-HJ-NP-Z2-9]{10}$/.test(code) ? code : null;
}
export function newRoom(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => alphabet[byte & 31]).join('');
}

/** Pure authoritative simulation. Renderers, transport, and input never enter this class. */
export class PongGame {
  phase: Phase = 'waiting';
  ball = { x: FIELD.width / 2, y: FIELD.height / 2 };
  leftY = FIELD.height / 2;
  rightY = FIELD.height / 2;
  scoreL = 0;
  scoreR = 0;
  winner: Side | null = null;
  countdown = 0;
  private direction: 1 | -1 = 1;
  private vx: number = FIELD.startSpeed;
  private vy = FIELD.startSpeed * .30;
  private seq = 0;
  private rng: () => number;

  constructor(rng: () => number = Math.random) { this.rng = rng; }

  setPaddle(side: Side, centerY: number): void {
    if (!Number.isFinite(centerY)) return;
    const half = FIELD.paddleHeight / 2;
    const y = clamp(centerY, FIELD.margin + half, FIELD.height - FIELD.margin - half);
    if (side === 'left') this.leftY = y;
    else this.rightY = y;
  }

  /** Returns true if a new match started. */
  start(): boolean {
    if (this.phase !== 'waiting' && this.phase !== 'gameover') return false;
    this.scoreL = 0; this.scoreR = 0; this.winner = null;
    this.leftY = this.rightY = FIELD.height / 2;
    this.direction = this.rng() < .5 ? -1 : 1;
    this.serve();
    return true;
  }

  wait(): void { this.phase = 'waiting'; this.countdown = 0; }

  private serve(): void {
    this.ball = { x: FIELD.width / 2, y: FIELD.height / 2 };
    const angle = (this.rng() - .5) * .60;
    this.vx = this.direction * FIELD.startSpeed * Math.cos(angle);
    this.vy = FIELD.startSpeed * Math.sin(angle);
    this.phase = 'countdown';
    this.countdown = FIELD.countdown;
  }

  step(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, .05);
    if (this.phase === 'countdown') {
      this.countdown = Math.max(0, this.countdown - step);
      if (this.countdown <= 0) this.phase = 'playing';
      return;
    }
    if (this.phase !== 'playing') return;
    // Bounded substeps prevent tunnelling through paddles after a frame hitch.
    const subdivisions = Math.ceil(step / (1 / 120));
    for (let i = 0; i < subdivisions && this.phase === 'playing'; i++) {
      this.integrate(step / subdivisions);
    }
  }

  private integrate(dt: number): void {
    const ball = this.ball;
    const radius = FIELD.ballRadius;
    const lastX = ball.x;
    ball.x += this.vx * dt;
    ball.y += this.vy * dt;
    if (ball.y - radius < FIELD.margin) {
      ball.y = FIELD.margin + radius; this.vy = Math.abs(this.vy);
    }
    if (ball.y + radius > FIELD.height - FIELD.margin) {
      ball.y = FIELD.height - FIELD.margin - radius; this.vy = -Math.abs(this.vy);
    }
    const leftFace = FIELD.leftX + FIELD.paddleWidth;
    const rightFace = FIELD.rightX;
    if (this.vx < 0 && lastX - radius >= leftFace && ball.x - radius <= leftFace &&
        Math.abs(ball.y - this.leftY) <= FIELD.paddleHeight / 2 + radius) {
      ball.x = leftFace + radius;
      this.bounce(1, (ball.y - this.leftY) / (FIELD.paddleHeight / 2));
    } else if (this.vx > 0 && lastX + radius <= rightFace && ball.x + radius >= rightFace &&
               Math.abs(ball.y - this.rightY) <= FIELD.paddleHeight / 2 + radius) {
      ball.x = rightFace - radius;
      this.bounce(-1, (ball.y - this.rightY) / (FIELD.paddleHeight / 2));
    }
    if (ball.x < -radius) this.point('right');
    if (ball.x > FIELD.width + radius) this.point('left');
  }

  private bounce(horizontal: 1 | -1, relativeHit: number): void {
    const speed = Math.min(FIELD.maxSpeed, Math.hypot(this.vx, this.vy) * FIELD.speedGain);
    const angle = clamp(relativeHit, -.94, .94) * FIELD.reboundAngle;
    this.vx = horizontal * speed * Math.cos(angle);
    this.vy = speed * Math.sin(angle);
  }

  private point(winner: Side): void {
    if (winner === 'left') this.scoreL++;
    else this.scoreR++;
    if (this.scoreL >= FIELD.maxScore || this.scoreR >= FIELD.maxScore) {
      this.phase = 'gameover'; this.winner = winner;
      this.countdown = 0;
      return;
    }
    this.direction = winner === 'left' ? 1 : -1;
    this.serve();
  }

  snapshot(): Snapshot {
    return { type: 'state', seq: ++this.seq, phase: this.phase,
      countdown: this.countdown, ball: { ...this.ball },
      leftY: this.leftY, rightY: this.rightY,
      scoreL: this.scoreL, scoreR: this.scoreR, winner: this.winner };
  }
}
