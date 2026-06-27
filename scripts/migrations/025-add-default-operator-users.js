const { hashPassword } = require('../../src/utils/auth');

module.exports = function addDefaultOperatorUsers(db) {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  if (!cols.length) return;

  const now = new Date().toISOString();
  const insert = db.prepare('INSERT OR IGNORE INTO users(channel,username,password_hash,salt,display_name,role,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const defaults = [
    { channel: 'shopify', username: 'twshop', password: 'tw123', display_name: '独立站运营', role: 'operator' },
    { channel: 'amazon', username: 'twama', password: 'tw123', display_name: '亚马逊运营', role: 'operator' }
  ];

  for (const user of defaults) {
    const { hash, salt } = hashPassword(user.password);
    insert.run(user.channel, user.username, hash, salt, user.display_name, user.role, 1, now, now);
  }
};
