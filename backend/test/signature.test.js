import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, createSigner } from '../src/signature.js';
import { validateReset } from '../src/baseline.js';

test('Appendix A signature test vector 1', () => {
  const payload = {team_id: 't1', event_type: 'goal'};
  assert.equal(canonical(payload), '{"event_type":"goal","team_id":"t1"}');
  assert.equal(createSigner('demo-salt')('evt-1', payload), '972a8b558690b19121cc5bea84978f85e8eb15a3735018db36616bab1d7ec501');
});
test('canonicalization recursively sorts Unicode code points and preserves arrays', () => {
  assert.equal(canonical({'😀': 1, '\ue000': 2, a: [{z: null, b: 'اردو'}, true, 2]}), '{"a":[{"b":"اردو","z":null},true,2],"":2,"😀":1}');
});
test('salt is required and never trimmed', () => {
  assert.throws(() => createSigner(undefined));
  assert.throws(() => createSigner(''));
  assert.notEqual(createSigner(' x ')('id', {}), createSigner('x')('id', {}));
});
test('reset accepts defaults and rejects malformed inputs', () => {
  assert.deepEqual(validateReset({}), []);
  assert.deepEqual(validateReset({seed: 0, stock: {'var-jersey-001-M': 0}}), []);
  for (const body of [null, [], {seed: 1.5}, {stock: null}, {stock: {'var-jersey-001-M': -1}}, {stock: {unknown: 2}}]) assert.ok(validateReset(body).length);
});
