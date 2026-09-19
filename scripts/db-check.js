import 'dotenv/config';
import pool from '../server/db.js';
const r = await pool.query('SELECT current_database() AS database, NOW() AS time');
console.log('PostgreSQL connected:', r.rows[0]);
await pool.end();
