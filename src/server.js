'use strict';

const { createApp } = require('./app');
const { getDb } = require('./db');
const { seed } = require('./seed');

const PORT = Number(process.env.PORT) || 7138;

function main() {
  getDb();
  if (process.env.SEED_ON_START !== 'false') {
    const result = seed();
    // eslint-disable-next-line no-console
    console.log('种子数据:', result.skipped ? '已存在，跳过' : JSON.stringify(result));
  }
  const app = createApp();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`中蜂蜂场养殖运营管理平台 API 已启动: http://localhost:${PORT}`);
  });
}

main();
