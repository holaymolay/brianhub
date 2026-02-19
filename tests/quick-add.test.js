import test from 'node:test';
import assert from 'node:assert/strict';
import { suppressQuickAddPointerEvents } from '../apps/web/quickAdd.js';

function createFakeInput() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      const next = listeners.get(type) ?? [];
      next.push(handler);
      listeners.set(type, next);
    },
    emit(type, event) {
      for (const handler of listeners.get(type) ?? []) {
        handler(event);
      }
    },
    listenerCount(type) {
      return (listeners.get(type) ?? []).length;
    }
  };
}

test('quick add pointer guard registers handlers for mousedown and click', () => {
  const input = createFakeInput();
  suppressQuickAddPointerEvents(input);
  assert.equal(input.listenerCount('mousedown'), 1);
  assert.equal(input.listenerCount('click'), 1);
});

test('quick add pointer guard stops propagation on left-click interactions', () => {
  const input = createFakeInput();
  suppressQuickAddPointerEvents(input);

  const events = [{ button: 0, stopped: 0 }, { button: 0, stopped: 0 }];
  for (const event of events) {
    event.stopPropagation = () => {
      event.stopped += 1;
    };
  }

  input.emit('mousedown', events[0]);
  input.emit('click', events[1]);

  assert.equal(events[0].stopped, 1);
  assert.equal(events[1].stopped, 1);
});

test('quick add pointer guard ignores non-left mousedown', () => {
  const input = createFakeInput();
  suppressQuickAddPointerEvents(input);

  const event = { button: 2, stopped: 0, stopPropagation() { this.stopped += 1; } };
  input.emit('mousedown', event);

  assert.equal(event.stopped, 0);
});
