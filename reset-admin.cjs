// 一次性脚本：把默认 admin 用户重置为 admin/admin
// 执行后可删除
const bcrypt = require('bcryptjs');
const fs = require('fs');

// 找 sqlite 驱动（项目里 typeorm 用的）
const SQLite = require('better-sqlite3');

const dbPath = './data/rustdesk-console.db';
const db = new SQLite(dbPath);

console.log('=== 当前用户 ===');
const rows = db.prepare('SELECT id, username, role, isAdmin FROM users').all();
console.log(rows);

const target = rows.find(r => r.username === 'databk' || r.isAdmin) || rows[0];
console.log('\n目标:', target.username);

const hash = bcrypt.hashSync('admin', 10);
console.log('新密码哈希 (admin):', hash.substring(0, 32) + '...');

const info = db
  .prepare('UPDATE users SET username = ?, password = ? WHERE id = ?')
  .run('admin', hash, target.id);
console.log('更新行数:', info.changes);

const verify = db.prepare('SELECT id, username FROM users WHERE username = ?').get('admin');
console.log('\n✅ 验证:', verify);

const ok = bcrypt.compareSync('admin', db.prepare('SELECT password FROM users WHERE id = ?').get(verify.id).password);
console.log('密码校验通过:', ok);

db.close();
