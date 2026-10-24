import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticHTML, isDiagnosticPath } from '../server/diagnostics.mjs';

test('standalone page has a visible HTML-first indicator and avoids external dependencies', () => {
  assert.match(diagnosticHTML, /HTML : OK/);
  assert.match(diagnosticHTML, /JavaScript : non exécuté/);
  assert.match(diagnosticHTML, /\/api\/health/);
  assert.match(diagnosticHTML, /new WebSocket/);
  assert.doesNotMatch(diagnosticHTML, /src="[^\"]+"|href="https?:/);
});

test('diagnostic accepts standalone route or root query flag only', () => {
  assert.equal(isDiagnosticPath('/diagnostic', new URLSearchParams()), true);
  assert.equal(isDiagnosticPath('/', new URLSearchParams('diagnostic=1')), true);
  assert.equal(isDiagnosticPath('/', new URLSearchParams()), false);
  assert.equal(isDiagnosticPath('/foo', new URLSearchParams('diagnostic=1')), false);
});
