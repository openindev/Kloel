import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdentifier, canonicalPhone } from '../src/crm/schema.js';

test('Brazilian mobile with and without 9th digit normalize to one CRM identity', () => {
  assert.equal(normalizeIdentifier('phone', '+556493128506'), '+5564993128506');
  assert.equal(normalizeIdentifier('phone', '+55 (64) 99312-8506'), '+5564993128506');
  assert.equal(canonicalPhone('+556433128506'), '+556433128506'); // landline (starts 2-5) untouched
  assert.equal(canonicalPhone('+14155550100'), '+14155550100');
});
