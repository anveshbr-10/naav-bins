// Run with `npm test` (Node's built-in test runner; no browser needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCo2, formatKg, formatInr, formatCount, formatDate, formatDateTime } from './format.js';

test('formatCo2 shows grams below 1 kg and an honest zero', () => {
  assert.equal(formatCo2(0), '0 g');
  assert.equal(formatCo2(undefined), '0 g');
  assert.equal(formatCo2(0.21), '210 g');
  assert.equal(formatCo2(1.234), '1.23 kg');
  assert.equal(formatCo2(12.34), '12.3 kg');
});

test('formatKg', () => {
  assert.equal(formatKg(0.115), '115 g');
  assert.equal(formatKg(2.5), '2.50 kg');
  assert.equal(formatKg('junk'), '0 g');
});

test('money and counts use Indian digit grouping and never print NaN', () => {
  assert.equal(formatInr(1234567), '₹12,34,567');
  assert.equal(formatInr(null), '₹0');
  assert.equal(formatCount(100000), '1,00,000');
  assert.equal(formatCount('abc'), '0');
});

test('invalid dates render as a dash instead of "Invalid Date"', () => {
  assert.equal(formatDate('not a date'), '—');
  assert.equal(formatDateTime(undefined), '—');
  assert.notEqual(formatDate('2026-11-17T10:00:00Z'), '—');
});
