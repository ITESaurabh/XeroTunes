/** Self-check: run with `node src/renderer/utils/knobDrag.check.ts`. */
import assert from 'node:assert';
import { dragTurn } from './knobDrag.ts';

const near = (actual: number, expected: number): void =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`);
const from = (x: number, y: number) => ({ cx: 0, cy: 0, x, y });
const px = (n: number): number => n / 150;

// Grabbed in the middle: a plain slide, 150px up or right for the full range.
near(dragTurn(from(0, 0), 0, -150), 1);
near(dragTurn(from(0, 0), 75, 0), 0.5);

// Sliding straight out from the centre still reads as up/right for up.
near(dragTurn(from(0, -40), 0, -50), px(10));
near(dragTurn(from(0, 40), 0, 50), px(-10));
near(dragTurn(from(40, 0), 50, 0), px(10));

// Circling clockwise turns it up all the way round, including down the right-hand side.
near(dragTurn(from(0, -40), 10, -40), px(10));
near(dragTurn(from(40, 0), 40, 10), px(10));
near(dragTurn(from(0, 40), -10, 40), px(10));
near(dragTurn(from(-40, 0), -40, -10), px(10));

// And anticlockwise turns it down.
near(dragTurn(from(40, 0), 40, -10), px(-10));

console.log('knobDrag ok');
