import { SummonKernel } from '../kernel/kernel.js';
import { SCENARIOS, type Scenario } from '../scenes/scenarios.js';
import { renderPanel } from './panel.js';

const controls = document.getElementById('controls')!;
const panel = document.getElementById('panel')!;

let kernel = new SummonKernel();
let scenario: Scenario = SCENARIOS[0]!;
let generator: Generator<string, void, void> | null = null;
let beats: string[] = [];
let timer: number | null = null;

function render(): void {
  renderPanel(panel, kernel, { title: scenario.title, description: scenario.description }, beats);
}

function stopPlayback(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function stepOnce(): boolean {
  if (!generator) return false;
  const result = generator.next();
  if (result.done) {
    stopPlayback();
    render();
    return false;
  }
  beats.push(result.value);
  render();
  return true;
}

function play(): void {
  if (timer !== null) return;
  timer = window.setInterval(() => {
    if (!stepOnce()) stopPlayback();
  }, 700);
}

function selectScenario(id: string): void {
  stopPlayback();
  const next = SCENARIOS.find((s) => s.id === id);
  if (!next) return;
  scenario = next;
  kernel = new SummonKernel();
  beats = [];
  generator = scenario.run(kernel);
  render();
}

function buildControls(): void {
  for (const s of SCENARIOS) {
    const button = document.createElement('button');
    button.textContent = s.title;
    button.addEventListener('click', () => selectScenario(s.id));
    controls.append(button);
  }
  const step = document.createElement('button');
  step.textContent = '单步';
  step.className = 'action';
  step.addEventListener('click', () => {
    stopPlayback();
    stepOnce();
  });
  const auto = document.createElement('button');
  auto.textContent = '自动播放';
  auto.className = 'action';
  auto.addEventListener('click', play);
  const reset = document.createElement('button');
  reset.textContent = '重置';
  reset.className = 'action';
  reset.addEventListener('click', () => selectScenario(scenario.id));
  controls.append(step, auto, reset);
}

buildControls();
selectScenario(scenario.id);
