'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LineFrames } = require('../src/core/line-frames.cjs');

test('byte frames preserve UTF-8 split inside a character and parse coalesced lines', () => {
  const frames = new LineFrames(32), lines = [];
  const wire = Buffer.from(' {"title":"☃😀"}\n\n{"ok":true}\n');
  for (const byte of wire) frames.push(Buffer.from([byte]), line => lines.push(line));
  assert.deepEqual(lines, ['{"title":"☃😀"}', '', '{"ok":true}']);
});

test('frame cap counts bytes and newline, independently for each coalesced frame', () => {
  const frames = new LineFrames(5), lines = [];
  frames.push(Buffer.from('abcd\nabcd\n'), line => lines.push(line));
  assert.deepEqual(lines, ['abcd', 'abcd']);
  assert.throws(() => frames.push(Buffer.from('☃☃'), () => assert.fail('oversized frame dispatched')), RangeError);
  assert.equal(frames.size, 0);
  assert.deepEqual(frames.parts, []);
  assert.throws(() => frames.push(Buffer.from('abcde\n'), () => assert.fail('newline exceeded cap')), RangeError);
});

test('single-response consumers can stop before later frames', () => {
  const frames = new LineFrames(8), lines = [];
  frames.push(Buffer.from('first\nsecond\n'), line => { lines.push(line); return false; });
  assert.deepEqual(lines, ['first']);
});
