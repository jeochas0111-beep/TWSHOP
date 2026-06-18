const { hashPassword } = require('../../src/utils/auth');

module.exports = function updateDefaultUsers(db) {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  if (!cols.length) return;

  const users = db.prepare('SELECT username FROM users').all();
  const usernames = users.map(u => u.username);

  const hasNewDefaults = usernames.includes('twshop') && usernames.includes('twamazon');
  if (hasNewDefaults) return;

  const now = new Date().toISOString();
  const insert = db.prepare('INSERT OR IGNORE INTO users(channel,username,password_hash,salt,display_name,role,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');

  const defaults = [
    { channel: 'shopify', username: 'twshop', password: 'twodrapes123', display_name: '独立站运营', role: 'admin' },
    { channel: 'amazon', username: 'twamazon', password: 'twodrapes123', display_name: '亚马逊运营', role: 'admin' },
  ];

  for (const u of defaults) {
    if (usernames.includes(u.username)) continue;
    const { hash, salt } = hashPassword(u.password);
    insert.run(u.channel, u.username, hash, salt, u.display_name, u.role, 1, now, now);
  }
};
