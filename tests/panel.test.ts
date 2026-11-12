// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { SummonKernel } from '../src/kernel/kernel.js';
import { SCENARIOS } from '../src/scenes/scenarios.js';
import { renderPanel } from '../src/ui/panel.js';

function runScenario(id: string) {
  const scenario = SCENARIOS.find((s) => s.id === id)!;
  const kernel = new SummonKernel();
  const gen = scenario.run(kernel);
  const beats: string[] = [];
  while (true) {
    const r = gen.next();
    if (r.done) break;
    beats.push(r.value);
  }
  return { kernel, scenario, beats };
}

describe('panel rendering', () => {
  it('shows per-object commander, why, and recycle reason', () => {
    const { kernel, scenario, beats } = runScenario('exit');
    const root = document.createElement('div');
    renderPanel(root, kernel, { title: scenario.title, description: scenario.description }, beats);
    document.body.append(root);

    const header = [...root.querySelectorAll('th')].map((th) => th.textContent);
    expect(header).toContain('接受谁的命令');
    expect(header).toContain('回收原因');

    const text = root.textContent ?? '';
    expect(text).toContain('寿命到期');
    expect(text).toContain('手动遣散');
    expect(text).toContain('已回收');
    expect(text).toContain('阿凯');
    // effect journal resolves the legal source after recycling
    expect(text).toContain('合法来源：阿凯');
    expect(text).toContain('（已回收）');
  });

  it('renders quota chips and offline command-source changes', () => {
    const { kernel, scenario, beats } = runScenario('offline');
    const root = document.createElement('div');
    renderPanel(root, kernel, { title: scenario.title, description: scenario.description }, beats);

    const text = root.textContent ?? '';
    expect(text).toContain('summon:player-1 2/3');
    expect(text).toContain('接受阿凯的命令');
    expect(text).toContain('恢复可用');
    expect(root.querySelectorAll('.quota').length).toBeGreaterThan(0);
  });

  it('marks replacement reasons on tombstoned companions', () => {
    const { kernel, scenario, beats } = runScenario('replace');
    const root = document.createElement('div');
    renderPanel(root, kernel, { title: scenario.title, description: scenario.description }, beats);

    const text = root.textContent ?? '';
    expect(text).toContain('被新对象');
    expect(text).toContain('替换');
    expect(root.querySelectorAll('tr.status-recycled').length).toBe(5);
  });
});
