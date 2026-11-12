import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenes/scenarios.js';
import { GOLDEN_DIR, goldenPath, traceScenario } from './trace.js';

const UPDATE = process.env.UPDATE_GOLDEN === '1';

/**
 * Golden execution traces recorded before the summon-module component split.
 * Any refactor must reproduce these traces exactly: same entity relations,
 * same command results, same events in the same order, same quota usage —
 * including multi-level subordinates (sub-first), full-quota arbitration
 * (contention/replace) and cleanup ordering (exit).
 */
describe('golden execution traces', () => {
  for (const scenario of SCENARIOS) {
    it(`reproduces the recorded trace: ${scenario.id} (${scenario.title})`, () => {
      const trace = traceScenario(scenario);
      const path = goldenPath(scenario.id);
      if (UPDATE) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(path, `${JSON.stringify(trace, null, 2)}\n`);
        return;
      }
      expect(existsSync(path), `missing golden trace: ${path}`).toBe(true);
      const golden = JSON.parse(readFileSync(path, 'utf8'));
      expect(trace).toEqual(golden);
    });
  }
});
