import 'dotenv/config';
import fs from 'node:fs/promises';
import pool from '../server/db.js';

const schema = await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8');
await pool.query(schema);

// Safe upgrades for databases created from an older CertiTrust schema.
const upgrades = [
  `ALTER TABLE institutions ADD COLUMN IF NOT EXISTS code VARCHAR(50)`,
  `ALTER TABLE institutions ADD COLUMN IF NOT EXISTS rejection_reason TEXT`,
  `ALTER TABLE institutions ADD COLUMN IF NOT EXISTS registration_document VARCHAR(255)`,
  `ALTER TABLE institutions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`,
  `ALTER TABLE certificates ADD COLUMN IF NOT EXISTS qr_url TEXT`,
  `ALTER TABLE certificates ADD COLUMN IF NOT EXISTS document_hash CHAR(64)`,
  `ALTER TABLE certificates ADD COLUMN IF NOT EXISTS document_name VARCHAR(255)`,
  `ALTER TABLE certificates ADD COLUMN IF NOT EXISTS document_path VARCHAR(500)`
];
for (const sql of upgrades) await pool.query(sql);
console.log('CertiTrust PostgreSQL schema is ready.');
await pool.end();
