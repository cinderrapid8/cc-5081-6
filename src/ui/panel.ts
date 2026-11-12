import type { EntityView, SummonKernel } from '../kernel/kernel.js';
import { recycleReasonText, type KernelEvent } from '../kernel/types.js';

const KIND_LABEL: Record<EntityView['kind'], string> = {
  player: '玩家',
  summon: '召唤物',
  subordinate: '附属对象',
  hostile: '敌对目标',
};

const STATUS_LABEL: Record<EntityView['status'], string> = {
  active: '在场',
  exiting: '离场中',
  recycled: '已回收',
};

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function eventText(kernel: SummonKernel, event: KernelEvent): string {
  const name = (id: string) => kernel.nameOf(id);
  switch (event.type) {
    case 'spawned':
      return `生成 ${KIND_LABEL[event.kind]}「${event.name}」(${event.id})`;
    case 'exit-began':
      return `${name(event.id)} 开始离场，tick ${event.finalizeTick} 完成回收`;
    case 'recycled':
      return `${name(event.id)} 被回收：${recycleReasonText(event.reason, (id) => name(id))}`;
    case 'request-accepted':
      return `请求 ${event.requestId} 被接受 → ${name(event.entityId)}`;
    case 'request-rejected':
      return `请求 ${event.requestId} 被拒绝：${event.why}`;
    case 'command-issued':
      return `${name(event.commanderId)} 向 ${name(event.targetId)} 下达 ${event.command.type}`;
    case 'command-rejected':
      return `${name(event.commanderId)} 对 ${name(event.targetId)} 的指令被拒：${event.why}`;
    case 'command-source-changed':
      return `${name(event.id)} 命令来源变更：${event.source.why}`;
    case 'ownership-transferred':
      return `${name(event.id)} 归属变更：${name(event.fromOwnerId)} → ${name(event.toOwnerId)}`;
    case 'availability-changed':
      return `${name(event.id)} ${event.available ? '恢复可用' : '暂时不可用'}`;
    case 'effect-recorded':
      return `效果 ${event.effectId} 入账：来源 ${name(event.sourceId)}，归属 ${name(event.rootId)}`;
    case 'quota-changed':
      return `额度 ${event.key}：${event.used}/${event.cap}`;
  }
}

function renderEntityTable(kernel: SummonKernel, container: HTMLElement): void {
  const views = kernel.listViews();
  const table = el('table', 'entities');
  const head = el('tr');
  for (const label of ['ID', '名称', '类型', '归属', '接受谁的命令', '为何', '目标', '寿命', '状态', '回收原因']) {
    head.append(el('th', undefined, label));
  }
  table.append(head);
  for (const view of views) {
    const row = el('tr', `status-${view.status}`);
    const cells = [
      view.id,
      view.name,
      KIND_LABEL[view.kind],
      view.ownerName ?? '—',
      view.commanderName ?? '—',
      view.commandWhy,
      view.currentTargetId ? kernel.nameOf(view.currentTargetId) : '—',
      view.lifespanRemaining === null ? '∞' : String(view.lifespanRemaining),
      STATUS_LABEL[view.status] + (view.kind === 'player' && !view.available ? '（离线）' : ''),
      recycleReasonText(view.recycleReason, (id) => kernel.nameOf(id)),
    ];
    for (const text of cells) row.append(el('td', undefined, text));
    table.append(row);
  }
  container.append(table);
}

function renderQuotas(kernel: SummonKernel, container: HTMLElement): void {
  const wrap = el('div', 'quotas');
  for (const usage of kernel.quota.all()) {
    const chip = el('span', usage.used >= usage.cap ? 'quota quota-full' : 'quota');
    chip.textContent = `${usage.key} ${usage.used}/${usage.cap}`;
    wrap.append(chip);
  }
  container.append(wrap);
}

function renderEffects(kernel: SummonKernel, container: HTMLElement): void {
  const effects = kernel.journal.list();
  if (effects.length === 0) return;
  const list = el('ul', 'effects');
  for (const effect of effects) {
    const resolved = kernel.explainEffect(effect.effectId);
    if (!resolved.ok) {
      list.append(el('li', undefined, `${effect.effectId} 归属无法解析：${resolved.why}`));
      continue;
    }
    const explanation = resolved.value;
    const chainText = explanation.chain
      .map((c) => `${c.name}${c.status === 'recycled' ? '（已回收）' : ''}`)
      .join(' → ');
    list.append(
      el(
        'li',
        undefined,
        `${effect.effectId} [tick ${effect.tick}] ${effect.detail}｜归属链：${chainText}｜合法来源：${explanation.legalSourceName}`,
      ),
    );
  }
  container.append(el('h3', undefined, '效果归属日志'));
  container.append(list);
}

export function renderPanel(
  root: HTMLElement,
  kernel: SummonKernel,
  meta: { title: string; description: string },
  beats: string[],
): void {
  root.replaceChildren();

  const header = el('div', 'panel-header');
  header.append(el('h2', undefined, meta.title));
  header.append(el('p', 'desc', meta.description));
  header.append(el('p', 'tick', `当前 tick：${kernel.tick}`));
  root.append(header);

  root.append(el('h3', undefined, '额度占用'));
  renderQuotas(kernel, root);

  root.append(el('h3', undefined, '对象清单（含墓碑）'));
  renderEntityTable(kernel, root);

  renderEffects(kernel, root);

  if (beats.length > 0) {
    const beatList = el('ol', 'beats');
    for (const beat of beats) beatList.append(el('li', undefined, beat));
    root.append(el('h3', undefined, '场景节拍'));
    root.append(beatList);
  }

  const events = kernel.getEvents().slice(-40);
  const eventList = el('ul', 'events');
  for (const event of events) {
    eventList.append(el('li', undefined, `[t${event.tick}] ${eventText(kernel, event)}`));
  }
  root.append(el('h3', undefined, '内核事件'));
  root.append(eventList);
}
