import { describe, it, expect } from 'vitest';
import { FIELD } from '../config/constants.ts';
import { PongGame, newRoom, normalizeRoom } from './engine.ts';

describe('PongGame', () => {
  it('validates room codes', () => {
    const room = newRoom();
    expect(room).toHaveLength(10);
    expect(normalizeRoom(` ${room.toLowerCase()} `)).toBe(room);
    expect(normalizeRoom('abcdefghjk')).toBe('ABCDEFGHJK');
    expect(normalizeRoom('ABC')).toBeNull();
    expect(normalizeRoom('OOOOOOOOOO')).toBeNull();
  });
  it('keeps paddles inside the field', () => {
    const game = new PongGame();
    game.setPaddle('left', -1000);
    game.setPaddle('right', 1000);
    game.setPaddle('left', NaN);
    expect(game.leftY).toBe(FIELD.margin + FIELD.paddleHeight/2);
    expect(game.rightY).toBe(FIELD.height - FIELD.margin - FIELD.paddleHeight/2);
  });
  it('starts on a countdown, not instantly', () => {
    const game = new PongGame(() => .5);
    expect(game.start()).toBe(true);
    expect(game.phase).toBe('countdown');
    expect(game.start()).toBe(false);
    for(let i=0; i<100; i++) game.step(1/30);
    expect(game.phase).toBe('playing');
  });
  it('scores on crossing the right edge and serves again', () => {
    const game = new PongGame(() => .5);
    game.start();
    for(let i=0; i<80; i++) game.step(1/30);
    game.ball.x = FIELD.width + 30;
    game.step(1/30);
    expect(game.scoreL).toBe(1);
    expect(game.phase).toBe('countdown');
  });
  it('does not score while waiting or counting down', () => {
    const game = new PongGame();
    game.ball.x = 1000;
    game.step(1 / 30);
    expect(game.scoreL).toBe(0);
    game.start();
    game.ball.x = 1000;
    game.step(1 / 30);
    expect(game.scoreL).toBe(0);
  });
  it('finishes match after seven points', () => {
    const game = new PongGame(() => .5);
    game.start();
    for(let j=0; j<7; j++) {
      for(let i=0; i<80; i++) game.step(1/30);
      game.ball.x = FIELD.width + 40;
      game.step(1/30);
    }
    expect(game.phase).toBe('gameover');
    expect(game.winner).toBe('left');
    expect(game.start()).toBe(true);
    expect(game.scoreL).toBe(0);
  });
});
