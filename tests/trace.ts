import { join } from 'node:path';
import { SummonKernel, type EntityView } from '../src/kernel/kernel.js';
import type { KernelEvent } from '../src/kernel/types.js';
import type { QuotaUsage } from '../src/kernel/quota.js';
import type { Scenario } from '../src/scenes/scenarios.js';

export interface BeatTrace {
  beat: string;
  tick: number;
  views: EntityView[];
  quota: QuotaUsage[];
  events: KernelEvent[];
}

export interface ScenarioTrace {
  scenario: string;
  beats: BeatTrace[];
}

/**
 * Records the execution trace of a scenario: after every beat, snapshot the
 * full entity relations (owner/commander chains), command results (stance,
 * target, command source), lifecycle state and quota usage, plus the events
 * emitted since the previous beat. The trace is the pre-refactor baseline:
 * the component split must reproduce it byte-for-byte.
 */
export function traceScenario(scenario: Scenario): ScenarioTrace {
  const kernel = new SummonKernel();
  const gen = scenario.run(kernel);
  const beats: BeatTrace[] = [];
  let eventCursor = 0;
  while (true) {
    const step = gen.next();
    if (step.done) break;
    const events = kernel.getEvents().slice(eventCursor);
    eventCursor = kernel.getEvents().length;
    beats.push({
      beat: step.value,
      tick: kernel.tick,
      views: kernel.listViews(),
      quota: kernel.quota.all().sort((a, b) => a.key.localeCompare(b.key)),
      events,
    });
  }
  return { scenario: scenario.id, beats };
}

export const GOLDEN_DIR = join(__dirname, 'golden');

export function goldenPath(scenarioId: string): string {
  return join(GOLDEN_DIR, `${scenarioId}.json`);
}
