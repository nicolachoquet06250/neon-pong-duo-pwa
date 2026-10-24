import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PongGame, newRoom, normalizeRoom } from '../src/core/engine.ts';
import { FIELD } from '../src/config/constants.ts';

test('room code format and normalization', () => {
  const code = newRoom();
  assert.equal(code.length, 10);
  assert.equal(normalizeRoom(' '+code.toLowerCase()+' '), code);
  assert.equal(normalizeRoom('invalid'), null);
});
test('paddles stay inside play field', () => {
  const game = new PongGame();
  game.setPaddle('left', -999);
  assert.equal(game.leftY, FIELD.margin + FIELD.paddleHeight/2);
  game.setPaddle('right', 999);
  assert.equal(game.rightY, FIELD.height-FIELD.margin-FIELD.paddleHeight/2);
  game.setPaddle('left', NaN);
  assert.equal(game.leftY, FIELD.margin + FIELD.paddleHeight/2);
});
test('new match enters countdown and advances into play', () => {
  const game = new PongGame(() => .5);
  assert.equal(game.start(), true);
  assert.equal(game.phase, 'countdown');
  for(let i=0; i<100; i++) game.step(1/30);
  assert.equal(game.phase, 'playing');
  assert.ok(game.snapshot().seq > 0);
});
test('point is scored only after the ball leaves the field', () => {
  const game = new PongGame(() => .5);
  game.start();
  for(let i=0; i<80; i++) game.step(1/30);
  assert.equal(game.phase, 'playing');
  game.ball.x = FIELD.width + 14;
  game.step(1/30);
  assert.equal(game.scoreL, 1);
  assert.equal(game.phase, 'countdown');
});
test('no scoring during waiting and countdown', () => {
  const game = new PongGame();
  game.ball.x = 1000;
  game.step(1/30);
  assert.equal(game.scoreL, 0);
  game.start(); game.ball.x = 1000;
  game.step(1/30);
  assert.equal(game.scoreL, 0);
});
test('win ends match at seven points', () => {
  const game = new PongGame(() => .5);
  game.start();
  for(let point=0; point<7; point++) {
    for(let i=0; i<80; i++) game.step(1/30);
    game.ball.x = FIELD.width+20;
    game.step(1/30);
  }
  assert.equal(game.scoreL, 7);
  assert.equal(game.phase, 'gameover');
  assert.equal(game.winner, 'left');
  assert.equal(game.start(), true);
  assert.equal(game.scoreL, 0);
});
