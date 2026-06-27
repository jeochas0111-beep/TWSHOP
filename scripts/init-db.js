const { initDb, seedIfEmpty, dbPath } = require('../src/db');
initDb();
seedIfEmpty();
console.log(`SQLite 数据库已初始化: ${dbPath}`);
