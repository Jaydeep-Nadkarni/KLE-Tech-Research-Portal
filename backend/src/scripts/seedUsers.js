// Creates a JWT secret (if missing) and one account per role/faculty with random passwords.
// Passwords are written to backend/.credentials.txt (gitignored) and never printed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { User, Faculty } from '../models/index.js';

const envPath = path.join(env.root, '.env');
let envText = fs.readFileSync(envPath, 'utf8');
if (!env.jwtSecret) {
  envText = envText.replace(/\n*$/, `\nJWT_SECRET=${crypto.randomBytes(48).toString('hex')}\n`);
  fs.writeFileSync(envPath, envText);
  console.log('Generated JWT_SECRET in backend/.env');
}

await connectDb();
const lines = [];
const pw = () => crypto.randomBytes(9).toString('base64url');
async function ensure(email, name, role, faculty) {
  if (await User.exists({ email })) return;
  const password = pw();
  await User.create({ email, name, role, faculty, passwordHash: await bcrypt.hash(password, 10) });
  lines.push(`${role.padEnd(11)} ${email}  ${password}`);
}
// HOD account: if HOD_PASSWORD is set in .env it is authoritative (created, or reset if it differs).
// Otherwise a random password is generated once. Only a bcrypt hash is ever stored in the database.
const hodEmail = (process.env.HOD_EMAIL || 'hod@kletech.ac.in').toLowerCase();
const hodPw = (process.env.HOD_PASSWORD || '').trim();
if (hodPw) {
  if (hodPw.length < 6) { console.error('HOD_PASSWORD must be at least 6 characters (10+ recommended).'); process.exit(2); }
  // Reuse the existing HOD account if the email was changed in .env, instead of creating a second one
  const existing = (await User.findOne({ email: hodEmail })) || (await User.findOne({ role: 'hod', name: 'Head of Department' }));
  if (!existing) {
    await User.create({ email: hodEmail, name: 'Head of Department', role: 'hod', passwordHash: await bcrypt.hash(hodPw, 10) });
    console.log('HOD account created from HOD_PASSWORD');
  } else {
    const changes = [];
    if (existing.email !== hodEmail) { existing.email = hodEmail; changes.push('email'); }
    if (!(await bcrypt.compare(hodPw, existing.passwordHash))) { existing.passwordHash = await bcrypt.hash(hodPw, 10); changes.push('password'); }
    if (changes.length) { await existing.save(); console.log(`HOD account updated: ${changes.join(' + ')}`); } else console.log('HOD account already matches .env');
  }
} else {
  await ensure(hodEmail, 'Head of Department', 'hod');
}
for (const f of await Faculty.find()) await ensure(f.email, f.name, 'faculty', f._id);
if (lines.length) {
  fs.appendFileSync(path.join(env.root, '.credentials.txt'), lines.join('\n') + '\n');
  console.log(`Created ${lines.length} users. Credentials saved to backend/.credentials.txt`);
} else console.log('All users already exist.');
await disconnectDb();
