import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('src/index.html', root), 'utf8');
const css = readFileSync(new URL('src/style.css', root), 'utf8');
const main = readFileSync(new URL('src/main.ts', root), 'utf8');
const renderer = readFileSync(new URL('src/render/domPong.ts', root), 'utf8');

test('ball and both paddles exist as DOM elements, without a WebGL canvas', () => {
  for (const id of ['stage', 'paddleLeft', 'paddleRight', 'pongBall', 'pongBallGlow']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /<canvas\b/);
  assert.match(main, /new DomPong\(stage\)/);
  assert.doesNotMatch(main, /new ThreePong/);
});

test('visible retro sprites have a high contrast CSS background and mobile minimum sizes', () => {
  assert.match(css, /\.pong-paddle--left\s*\{[^}]*background:#39f8ec/s);
  assert.match(css, /\.pong-paddle--right\s*\{[^}]*background:#ff597e/s);
  assert.match(css, /\.pong-ball\s*\{[^}]*min-width:9px;[^}]*background:#fffdf0/s);
  assert.match(css, /\.pong-stage\s*\{[^}]*position:absolute/s);
  assert.match(renderer, /FIELD\.height/);
  assert.doesNotMatch(renderer, /WebGLRenderer|\.getContext\(/);
});
