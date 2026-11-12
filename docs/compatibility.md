# 召唤模块组件边界与兼容记录

## 组件边界（接口约定）

| 组件 | 位置 | 职责 | 不做什么 |
| --- | --- | --- | --- |
| 归属遍历 `OwnershipGraph` | `src/kernel/ownership.ts` | 归属森林的挂接/摘除/防环/限深；`resolveChain`/`resolveRoot` 显式失效结果 | 不知道实体是否在场（那是注册表的问题）；无父边的 id 解析为其自身，绝不虚构归属 |
| 额度核算 `QuotaLedger` / `pickReplacementVictim` | `src/kernel/quota.ts` | 同步槽位账本（重复释放抛下溢）；池键推导；replace-oldest 纯函数选主 | 不执行回收，只选受害者 |
| 命令继承 `command-inheritance.ts` | 纯函数模块 | 生成继承（姿态/目标/命令权）、命令向下传播、可用性切换与转让后的命令来源 | 不触碰归属与额度 |
| 实体清理 `LifecycleService` | `src/kernel/lifecycle.ts` | 寿命衰减、离场宽限、终结回收；子级先于父级级联；每个槽位恰好释放一次 | 由显式 tick 驱动，无定时器、无渲染帧依赖 |
| 内核 `SummonKernel` | `src/kernel/kernel.ts` | 组合根：请求队列与 tick 管线、生成入口、离场回调委托、归属转让编排、视图与归因查询 | 不再直接实现上述四块逻辑 |

## 查询的显式失效契约

`explainEffect` 返回 `Resolution<EffectExplanation>`：效果 id 未知、或归属链
引用了不在当前场景（注册表无存活记录也无墓碑）的实体时，返回
`{ ok: false, why }`。合法来源绝不回退到占位实体或本地玩家。调用方
（场景、面板、测试）已迁移到显式解包。

## 兼容选择（原行为矛盾点与决定）

1. **查询失效语义（唯一有意的行为变更）**：旧 `explainEffect` 对注册表查不到的
   链上实体会伪造 `hostile/recycled` 占位记录，对未知效果 id 直接抛异常。这正是
   "通过存活状态反推业务归属" 的隐式依赖。改为显式失效结果；墓碑机制保证正常
   流程下链上 id 始终可解析，因此黄金轨迹不变。
2. **生成时的"不可用玩家→自主"分支**：旧 `spawnCompanion` 中
   `owner.kind === 'player' && !owner.available` 从内核路径不可达（玩家不可用
   时召唤请求已被拒绝；附属的 owner 是召唤物）。该规则保留在 `spawnInheritance`
   组件内，使组件脱离调用方预过滤仍自洽；行为不变。
3. **附属生成不检查玩家可用性**：只有召唤请求检查 `owner.available`，附属请求
   不检查（owner 是召唤物）。保留：玩家离线期间自主召唤物仍可产出附属。
4. **替换覆盖待定离场原因**：replace-oldest 强制终结 exiting 实体时，其待定原因
   （如寿命到期）被 `replaced` 覆盖。保留。
5. **`finalizeExits` 兜底原因**：`pendingRecycleReason ?? lifespan-expired` 中
   pending 必非空（beginExit 必设置），兜底为防御性死代码，原样保留。
6. **永久离场的级联原因**：玩家记 `owner-left`，其下整棵树记 `owner-recycled`
   （而非 owner-left）。保留。
7. **转让携带附属**：召唤物转让时附属池键仍按召唤物 id 计，附属经归属图随移。
   保留。
8. **事件顺序冻结**：生成路径 spawned → quota-changed → request-accepted；回收
   级联子先于父、每个实体的 quota-changed 先于其 recycled。由 `tests/golden/`
   基线逐字节锁定。

未顺便加入任何新召唤玩法；替换政策（replace-oldest / reject）行为完全不变。
