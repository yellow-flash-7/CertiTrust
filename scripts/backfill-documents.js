import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import pool from '../server/db.js';

const uploadDir = path.join(process.cwd(), 'uploads');
const files = await fs.readdir(uploadDir).catch(() => []);
const certs = await pool.query(`SELECT id, certificate_id FROM certificates WHERE document_path IS NULL`);
let updated = 0;
for (const c of certs.rows) {
  const prefix = `${c.certificate_id}-`;
  const match = files.find(f => f.startsWith(prefix));
  if (match) {
    await pool.query('UPDATE certificates SET document_path=$1 WHERE id=$2', [match, c.id]);
    updated++;
  }
}
console.log(`Document path backfill complete. Updated ${updated} certificate(s).`);
await pool.end();
