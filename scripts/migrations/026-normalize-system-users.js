const { hashPassword } = require('../../src/utils/auth');

const TARGET_USERS = [
  { channel: 'management', username: 'admin', password: 'admin', display_name: '平台管理员', role: 'admin' },
  { channel: 'shopify', username: 'twshop', password: 'tw123', display_name: '独立站运营', role: 'operator' },
  { channel: 'amazon', username: 'twama', password: 'tw123', display_name: '亚马逊运营', role: 'operator' }
];

module.exports = function normalizeSystemUsers(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all();
  if (!cols.length) return;

  const rows = db.prepare('SELECT channel, username, role FROM users ORDER BY id').all();
  const alreadyNormalized = rows.length === TARGET_USERS.length
    && TARGET_USERS.every((target) => rows.some((row) => (
      row.channel === target.channel
      && row.username === target.username
      && row.role === target.role
    )));

  if (alreadyNormalized) return;

  const run = db.transaction(() => {
    db.prepare('DELETE FROM users').run();

    const insert = db.prepare('INSERT INTO users(channel,username,password_hash,salt,display_name,role,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
    const now = new Date().toISOString();

    for (const user of TARGET_USERS) {
      const { hash, salt } = hashPassword(user.password);
      insert.run(user.channel, user.username, hash, salt, user.display_name, user.role, 1, now, now);
    }
  });

  run();
};
