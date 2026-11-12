import type { SummonKernel } from '../kernel/kernel.js';

export interface Scenario {
  id: string;
  title: string;
  description: string;
  run: (kernel: SummonKernel) => Generator<string, void, void>;
}

function* scenarioSpawn(kernel: SummonKernel): Generator<string, void, void> {
  const akai = kernel.registerPlayer('阿凯');
  yield `玩家「阿凯」入场（${akai}），召唤物额度 ${kernel.quota.all()[0]?.cap ?? 0} 格`;

  kernel.requestSummon(akai, { name: '苍狼' });
  kernel.requestSummon(akai, { name: '猎鹰' });
  yield '同刻提交两个召唤请求：苍狼、猎鹰';

  kernel.advanceTick();
  yield 'tick 处理：两个请求都被接受，额度占用 2/3；两者继承阿凯的姿态与命令来源';

  kernel.issueCommand(akai, akai, { type: 'set-stance', stance: 'aggressive' });
  yield '阿凯切换为进攻姿态（自身指令）';

  kernel.requestSummon(akai, { name: '石卫' });
  kernel.advanceTick();
  yield '第三只「石卫」生成，继承当前进攻姿态；额度 3/3 占满';

  kernel.advanceTick();
  yield '推进 1 tick：所有召唤物寿命 -1（面板可见剩余寿命递减）';
}

function* scenarioCommand(kernel: SummonKernel): Generator<string, void, void> {
  const akai = kernel.registerPlayer('阿凯');
  const betty = kernel.registerPlayer('贝蒂');
  const boar = kernel.registerHostile('野猪王');
  kernel.requestSummon(akai, { name: '苍狼' });
  kernel.advanceTick();
  yield '阿凯携「苍狼」入场，场上出现敌对目标「野猪王」';

  kernel.issueCommand(akai, 'summon-1', { type: 'attack', targetId: boar });
  yield '阿凯命令苍狼攻击野猪王 → 接受（阿凯在苍狼的命令链上）';

  kernel.requestSubordinate('summon-1', { name: '哨戒炮台' });
  kernel.advanceTick();
  yield '苍狼产出附属对象「哨戒炮台」，自动继承苍狼的当前目标';

  const denied = kernel.issueCommand(akai, 'subordinate-1', { type: 'attack', targetId: boar });
  yield `阿凯让炮台攻击野猪王 → ${denied.ok ? '接受（与主人目标一致）' : '拒绝'}`;

  const boar2 = kernel.registerHostile('野狼');
  const restricted = kernel.issueCommand(akai, 'subordinate-1', { type: 'attack', targetId: boar2 });
  yield `阿凯让炮台改打「野狼」→ ${restricted.ok ? '接受' : `拒绝：${restricted.why}`}`;

  const outsider = kernel.issueCommand(betty, 'summon-1', { type: 'attack', targetId: boar2 });
  yield `无关玩家贝蒂试图指挥苍狼 → ${outsider.ok ? '接受' : `拒绝：${outsider.why}`}`;

  kernel.recordEffect('subordinate-1', 'damage', '炮台射击 42 点', boar);
  yield '炮台对野猪王造成伤害，效果来源记入归属日志（炮台 → 苍狼 → 阿凯）';
}

function* scenarioExit(kernel: SummonKernel): Generator<string, void, void> {
  const akai = kernel.registerPlayer('阿凯');
  kernel.requestSummon(akai, { name: '短命萤火' });
  kernel.requestSummon(akai, { name: '苍狼' });
  kernel.advanceTick();
  yield '阿凯召出「短命萤火」与「苍狼」';

  kernel.recordEffect('summon-1', 'damage', '萤火灼烧 18 点');
  yield '萤火造成一次伤害，效果来源已记录（稍后要验证死后仍可追溯）';

  kernel.dismiss('summon-2', akai);
  yield '阿凯手动遣散苍狼 → 进入 exiting 状态（宽限期内仍占额度）';

  for (let i = 0; i < 14; i++) kernel.advanceTick();
  yield '连续推进 tick：萤火寿命到期 → exiting → 回收；苍狼宽限期结束 → 回收';

  const explanation = kernel.explainEffect('fx-1');
  if (!explanation.ok) throw new Error(explanation.why);
  yield `查询 fx-1 的合法来源：${explanation.value.chain.map((c) => c.name).join(' → ')}（萤火已回收仍可定位）`;
}

function* scenarioReplace(kernel: SummonKernel): Generator<string, void, void> {
  const akai = kernel.registerPlayer('阿凯');
  yield '阿凯入场，本场景连续替换 8 次，验证额度恒不超上限';

  for (let i = 1; i <= 8; i++) {
    kernel.requestSummon(akai, { name: `战宠${i}号`, onFull: 'replace-oldest' });
    kernel.advanceTick();
    const used = kernel.quota.all().find((q) => q.key.startsWith('summon:'))?.used ?? 0;
    yield `第 ${i} 次召唤：额度 ${used}/3${i > 3 ? '，最老者被替换并写入回收原因' : ''}`;
  }
}

function* scenarioOwnerOffline(kernel: SummonKernel): Generator<string, void, void> {
  const akai = kernel.registerPlayer('阿凯');
  kernel.requestSummon(akai, { name: '苍狼' });
  kernel.requestSummon(akai, { name: '猎鹰' });
  kernel.advanceTick();
  yield '阿凯带两只召唤物，随后模拟断线';

  kernel.setPlayerAvailability(akai, false);
  yield '阿凯暂时不可用：召唤物转为自主模式，但归属与额度完全不变（不是销毁）';

  kernel.recordEffect('summon-1', 'damage', '自主攻击 25 点');
  yield '离线期间苍狼自主造成伤害，来源仍归属阿凯';

  const rejected = kernel.requestSummon(akai, { name: '第三者' });
  kernel.advanceTick();
  yield `离线期间的新召唤请求（${rejected}）被拒绝：owner is currently unavailable`;

  kernel.setPlayerAvailability(akai, true);
  yield '阿凯重连：命令来源恢复为「接受阿凯的命令」，全程无回收、无额度波动';
}

function* scenarioSubordinateFirst(kernel: SummonKernel): Generator<string, void, void> {
  const akai = kernel.registerPlayer('阿凯');
  kernel.requestSummon(akai, { name: '工程师魔像' });
  kernel.advanceTick();
  kernel.requestSubordinate('summon-1', { name: '炮台甲' });
  kernel.requestSubordinate('summon-1', { name: '炮台乙' });
  kernel.advanceTick();
  yield '魔像产出炮台甲、炮台乙：附属额度 2/2，归属链 阿凯→魔像→炮台';

  for (let i = 0; i < 8; i++) kernel.advanceTick();
  yield '推进 tick：两座炮台寿命短先回收（原因：寿命到期），魔像仍在场';

  kernel.requestSubordinate('summon-1', { name: '炮台丙' });
  kernel.advanceTick();
  yield '附属额度已释放，补召「炮台丙」成功；魔像本身额度未受连带影响';

  kernel.dismiss('summon-1', akai);
  for (let i = 0; i < 3; i++) kernel.advanceTick();
  yield '遣散魔像 → 炮台丙被级联回收，回收原因标注「归属对象被回收」';
}

function* scenarioContention(kernel: SummonKernel): Generator<string, void, void> {
  const akai = kernel.registerPlayer('阿凯');
  kernel.requestSummon(akai, { name: '苍狼' });
  kernel.requestSummon(akai, { name: '猎鹰' });
  kernel.advanceTick();
  yield '阿凯已有 2/3 只召唤物，仅剩 1 个空位';

  kernel.requestSummon(akai, { name: '甲', onFull: 'reject' });
  kernel.requestSummon(akai, { name: '乙', onFull: 'reject' });
  kernel.requestSummon(akai, { name: '丙', onFull: 'reject' });
  yield '同一 tick 内到达 3 个召唤请求（策略：满员即拒）';

  kernel.advanceTick();
  yield 'tick 仲裁：按提交顺序仅「甲」被接受，乙、丙以 quota full 拒绝；额度恰好 3/3';
}

function* scenarioTransfer(kernel: SummonKernel): Generator<string, void, void> {
  const akai = kernel.registerPlayer('阿凯');
  const betty = kernel.registerPlayer('贝蒂');
  kernel.requestSummon(akai, { name: '苍狼' });
  kernel.advanceTick();
  kernel.recordEffect('summon-1', 'damage', '转让前撕咬 30 点');
  yield '阿凯的苍狼先造成一次伤害（fx-1，归属阿凯）';

  kernel.transferOwnership('summon-1', betty);
  yield '苍狼转让给贝蒂：身份不变、不是销毁；额度从阿凯池迁移到贝蒂池';

  kernel.recordEffect('summon-1', 'damage', '转让后撕咬 33 点');
  yield '转让后再次伤害（fx-2）：新效果归属贝蒂，旧效果 fx-1 仍归属阿凯';

  const cycle = kernel.transferOwnership('summon-1', 'summon-1');
  yield `尝试把苍狼挂到自己名下 → ${cycle.ok ? '接受' : `拒绝：${cycle.why}`}`;

  const fx1 = kernel.explainEffect('fx-1');
  const fx2 = kernel.explainEffect('fx-2');
  if (!fx1.ok || !fx2.ok) throw new Error(!fx1.ok ? fx1.why : !fx2.ok ? fx2.why : '');
  yield `fx-1 合法来源：${fx1.value.legalSourceName}；fx-2 合法来源：${fx2.value.legalSourceName}`;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'spawn',
    title: '场景 1 · 真实生成',
    description: '玩家生成有寿命、有数量上限的战斗伙伴，命令来源与姿态随生成继承。',
    run: scenarioSpawn,
  },
  {
    id: 'command',
    title: '场景 2 · 指令执行',
    description: '命令链鉴权、附属对象目标受限、无关人员拒止，效果来源入账。',
    run: scenarioCommand,
  },
  {
    id: 'exit',
    title: '场景 3 · 离场与追溯',
    description: '寿命到期与手动遣散两条离场路径；回收后效果来源仍可定位。',
    run: scenarioExit,
  },
  {
    id: 'replace',
    title: '场景 4 · 连续替换',
    description: '满员后连续替换 8 次，额度恒不超上限，被替换者带原因入墓碑。',
    run: scenarioReplace,
  },
  {
    id: 'offline',
    title: '场景 5 · 所有者暂时不可用',
    description: '断线只切换命令来源为自主，不销毁、不释放额度；重连后恢复。',
    run: scenarioOwnerOffline,
  },
  {
    id: 'sub-first',
    title: '场景 6 · 附属对象先退出',
    description: '附属先到期释放子额度，主人仍在；主人被遣散时附属级联回收。',
    run: scenarioSubordinateFirst,
  },
  {
    id: 'contention',
    title: '场景 7 · 同刻竞争',
    description: '仅剩 1 格时同刻 3 个请求，按序仲裁，额度绝不超占。',
    run: scenarioContention,
  },
  {
    id: 'transfer',
    title: '场景 8 · 归属变更 ≠ 销毁',
    description: '转让保留身份与历史归属；自属成环被防环检查拒绝。',
    run: scenarioTransfer,
  },
];
