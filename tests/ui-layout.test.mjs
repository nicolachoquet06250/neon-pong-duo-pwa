import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('src/index.html', root), 'utf8');
const css = readFileSync(new URL('src/style.css', root), 'utf8');
const app = readFileSync(new URL('src/main.ts', root), 'utf8');

test('the normal game UI no longer displays the browser User-Agent', () => {
  assert.doesNotMatch(html, /debugUserAgent|debug-user-agent|DEBUG \/ USER-AGENT/);
  assert.doesNotMatch(css, /\.debug-user-agent/);
  assert.doesNotMatch(app, /debugUserAgent/);
  assert.match(app, /detectDeviceMode\(navigator\.userAgent\)/);
});

test('phone layout allows vertical page scroll, preserving board gestures', () => {
  assert.match(css, /html\[data-device-mode="phone"\] body\s*\{[^}]*touch-action:\s*pan-y;/s);
  assert.match(css, /html\[data-device-mode="phone"\] \.board\s*\{[^}]*touch-action:\s*none;/s);
  assert.match(css, /html\[data-device-mode="phone"\] \.room-panel/);
});
