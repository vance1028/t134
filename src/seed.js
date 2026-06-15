'use strict';

const store = require('./data/store');

/**
 * 写入初始种子数据：管理员 / 养蜂员 / 观察员各一个账号，
 * 外加若干蜂场、蜂箱、检查记录与采收批次，方便本地起步与「功能迭代」类任务直接有数据可用。
 * 幂等：若库中已存在用户则跳过，避免重复播种。
 */
function seed() {
  if (store.countUsers() > 0) {
    return { skipped: true };
  }

  store.createUser({ username: 'admin', password: 'admin123', name: '系统管理员', role: 'admin' });
  const keeper = store.createUser({ username: 'keeper', password: 'keeper123', name: '王养蜂', role: 'operator' });
  store.createUser({ username: 'viewer', password: 'viewer123', name: '李观察', role: 'viewer' });

  const a1 = store.createApiary({
    code: 'FC-ABA-001', name: '阿坝高山中蜂场', location: '阿坝州黑水县色尔古寨',
    district: '阿坝州', keeper: '王养蜂', status: 'active',
  });
  const a2 = store.createApiary({
    code: 'FC-YA-002', name: '雅安林下中蜂场', location: '雅安市宝兴县蜂桶寨',
    district: '雅安市', keeper: '赵蜂农', status: 'active',
  });
  store.createApiary({
    code: 'FC-LS-003', name: '凉山转场越冬点', location: '凉山州西昌邛海边',
    district: '凉山州', keeper: '王养蜂', status: 'dormant',
  });

  const hives = [
    { code: 'XF-001', apiaryId: a1.id, queenYear: 2025, frameCount: 6, strength: 'strong', status: 'active', installedAt: '2025-04-10' },
    { code: 'XF-002', apiaryId: a1.id, queenYear: 2024, frameCount: 4, strength: 'medium', status: 'active', installedAt: '2024-05-01' },
    { code: 'XF-003', apiaryId: a1.id, queenYear: 2025, frameCount: 2, strength: 'weak', status: 'queenless', installedAt: '2025-06-20' },
    { code: 'YA-001', apiaryId: a2.id, queenYear: 2025, frameCount: 7, strength: 'strong', status: 'active', installedAt: '2025-03-15' },
    { code: 'YA-002', apiaryId: a2.id, queenYear: 2024, frameCount: 5, strength: 'medium', status: 'active', installedAt: '2024-04-22' },
  ];
  const hiveRecs = hives.map((h) => store.createHive(h));

  store.createInspection({
    hiveId: hiveRecs[0].id, inspectorId: keeper.id, inspectDate: '2026-05-18',
    hasQueen: true, broodFrames: 3.5, honeyFrames: 2, disease: 'none', note: '群势旺，已加继箱',
  });
  store.createInspection({
    hiveId: hiveRecs[2].id, inspectorId: keeper.id, inspectDate: '2026-05-18',
    hasQueen: false, broodFrames: 0, honeyFrames: 1, disease: 'none', note: '失王，需诱入新王或合并',
  });
  store.createInspection({
    hiveId: hiveRecs[3].id, inspectorId: keeper.id, inspectDate: '2026-05-20',
    hasQueen: true, broodFrames: 4, honeyFrames: 3, disease: 'varroa', note: '发现少量蜂螨，已挂螨扑',
  });

  store.createHarvest({
    batchNo: 'HV-2026-0001', apiaryId: a1.id, harvestDate: '2026-05-25',
    product: 'honey', quantityKg: 28.5, note: '高山百花蜜，波美度合格',
  });
  store.createHarvest({
    batchNo: 'HV-2026-0002', apiaryId: a2.id, harvestDate: '2026-05-28',
    product: 'royal_jelly', quantityKg: 1.2, note: '蜂王浆，冷链暂存',
  });

  return {
    skipped: false,
    users: 3,
    apiaries: 3,
    hives: hiveRecs.length,
    inspections: 3,
    harvests: 2,
  };
}

if (require.main === module) {
  const { getDb, close } = require('./db');
  getDb();
  const result = seed();
  // eslint-disable-next-line no-console
  console.log('种子数据写入结果:', JSON.stringify(result, null, 2));
  close();
}

module.exports = { seed };
