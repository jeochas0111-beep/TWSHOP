const { hashPassword } = require('../../src/utils/auth');

module.exports = function seedDefaultUsers(db) {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  if (!cols.length) return;

  const existing = db.prepare('SELECT COUNT(*) AS cnt FROM users').get();
  if (existing.cnt > 0) return;

  const now = new Date().toISOString();
  const insert = db.prepare('INSERT OR IGNORE INTO users(channel,username,password_hash,salt,display_name,role,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');

  const defaults = [
    { channel: 'management', username: 'admin', password: 'admin', display_name: '平台管理员', role: 'admin' },
    { channel: 'shopify', username: 'twshop', password: 'tw123', display_name: '独立站运营', role: 'operator' },
    { channel: 'amazon', username: 'twama', password: 'tw123', display_name: '亚马逊运营', role: 'operator' }
  ];

  for (const u of defaults) {
    const { hash, salt } = hashPassword(u.password);
    insert.run(u.channel, u.username, hash, salt, u.display_name, u.role, 1, now, now);
  }
};
