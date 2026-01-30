import test from 'node:test';
import assert from 'node:assert/strict';
import { computeClosure, assertNoCycles, reparent } from '../packages/core/tree.js';

test('closure table includes self edges and proper depths', () => {
  const tasks = [
    { id: 'a', parent_id: null },
    { id: 'b', parent_id: 'a' },
    { id: 'c', parent_id: 'b' }
  ];
  const edges = computeClosure(tasks);
  const edge = (ancestor, descendant) => edges.find(e => e.ancestor_id === ancestor && e.descendant_id === descendant);

  assert.equal(edge('a', 'a').depth, 0);
  assert.equal(edge('a', 'b').depth, 1);
  assert.equal(edge('a', 'c').depth, 2);
  assert.equal(edge('b', 'c').depth, 1);
});

test('assertNoCycles throws on cycles', () => {
  const tasks = [
    { id: 'a', parent_id: 'b' },
    { id: 'b', parent_id: 'a' }
  ];
  assert.throws(() => assertNoCycles(tasks));
});

test('reparent rejects cycles', () => {
  const tasks = [
    { id: 'a', parent_id: null },
    { id: 'b', parent_id: 'a' }
  ];
  assert.throws(() => reparent(tasks, 'a', 'b'));
});
