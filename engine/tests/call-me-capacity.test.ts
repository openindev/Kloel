import test from 'node:test';
import assert from 'node:assert/strict';
import { isCapacityError } from '../src/call-me.js';
test('retries only trunk capacity errors', () => {
  assert.equal(isCapacityError({ sip: '503', sipStatus: 'Service Unavailable' }), true);
  assert.equal(isCapacityError({ sip: '486', sipStatus: 'Channel limit reached' }), true);
  assert.equal(isCapacityError({ sip: '486', sipStatus: 'Busy Here' }), false);
  assert.equal(isCapacityError({ sip: '603', sipStatus: 'Decline' }), false);
  assert.equal(isCapacityError({ sip: '480', sipStatus: 'Temporarily Unavailable' }), false);
  assert.equal(isCapacityError({ sip: '408', sipStatus: 'Request Timeout' }), false);
  assert.equal(isCapacityError({ message: 'sip request timed out' }), true);
});
