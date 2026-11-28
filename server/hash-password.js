// 生成部署用的管理员口令哈希：node server/hash-password.js '<密码>'
// 输出格式 scrypt:<salt>:<hash>，可直接赋给 ADMIN_PASSWORD_HASH。
import crypto from 'node:crypto';

const password = process.argv[2] || process.env.ADMIN_PASSWORD || '';
if (!password) {
  console.error("用法：node server/hash-password.js '<密码>'");
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
console.log(`scrypt:${salt}:${hash}`);
