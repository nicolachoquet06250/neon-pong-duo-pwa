import { clamp } from '../core/engine.ts';
import { FIELD } from '../config/constants.ts';

/** Maps phone touch to absolute paddle position; Meta Neural Band pinch-and-drag to deltas. */
export class PaddleInput {
  private dragging = false;
  private pointerId: number | null = null;
  private lastY = 0;
  private currentY = FIELD.height / 2;
  private readonly deviceLike: boolean;
  private readonly pointerDown = (event: PointerEvent): void => {
    if (!this.enabled || (event.target as HTMLElement)?.closest?.('button, input, a')) return;
    this.dragging = true; this.pointerId = event.pointerId; this.lastY = event.clientY;
    // Meta's glasses WebView has no touch screen and delivers movement deltas.
    if (!this.deviceLike) this.absolute(event.clientY);
  };
  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.enabled || !this.dragging || event.pointerId !== this.pointerId) return;
    if (this.deviceLike) {
      const delta = Number.isFinite(event.movementY) && event.movementY !== 0
        ? event.movementY : event.clientY - this.lastY;
      this.currentY = clamp(this.currentY + delta * 1.55, 0, FIELD.height);
      this.changed(this.currentY);
    } else this.absolute(event.clientY);
    this.lastY = event.clientY;
    event.preventDefault();
  };
  private readonly pointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.resetDrag();
  };
  private readonly keyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || !['ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    this.currentY = clamp(this.currentY + (event.key === 'ArrowDown' ? 35 : -35), 0, FIELD.height);
    this.changed(this.currentY);
  };
  enabled = false;
  changed: (y: number) => void = () => {};

  constructor(private readonly stage: HTMLElement) {
    // UA only selects sensitivity; gestures still work on desktop via mouse drag.
    this.deviceLike = /\bwv\b/.test(navigator.userAgent) && /Android/.test(navigator.userAgent);
    window.addEventListener('pointerdown', this.pointerDown);
    window.addEventListener('pointermove', this.pointerMove, { passive: false });
    window.addEventListener('pointerup', this.pointerUp);
    window.addEventListener('pointercancel', this.pointerUp);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('blur', this.resetDrag);
  }
  private readonly resetDrag = (): void => { this.dragging = false; this.pointerId = null; };
  private absolute(clientY: number): void {
    const bounds = this.stage.getBoundingClientRect();
    if (!bounds.height) return;
    this.currentY = clamp(((clientY - bounds.top) / bounds.height) * FIELD.height, 0, FIELD.height);
    this.changed(this.currentY);
  }
  sync(y: number): void { this.currentY = y; }
  destroy(): void {
    window.removeEventListener('pointerdown', this.pointerDown);
    window.removeEventListener('pointermove', this.pointerMove);
    window.removeEventListener('pointerup', this.pointerUp);
    window.removeEventListener('pointercancel', this.pointerUp);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('blur', this.resetDrag);
  }
}
