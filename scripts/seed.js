import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pool from '../server/db.js';

const adminPassword = await bcrypt.hash('admin@360', 12);
const institutionPassword = await bcrypt.hash('Inst@123', 12);

await pool.query(`
  INSERT INTO institutions (name, code, email, password_hash, status, approved_at)
  VALUES ('ABC University', 'ABCU', 'institution@abcuniversity.edu.in', $1, 'APPROVED', NOW())
  ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status='APPROVED', approved_at=NOW()
`, [institutionPassword]);

await pool.query(`
  CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  )
`);
await pool.query(`
  INSERT INTO admins (name,email,password_hash)
  VALUES ('CertiTrust Admin','admin@certitrust.com',$1)
  ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash
`, [adminPassword]);

const inst = await pool.query(`SELECT id FROM institutions WHERE email='institution@abcuniversity.edu.in'`);
const institutionId = inst.rows[0].id;
const student = await pool.query(`
  INSERT INTO students (institution_id,name,register_number,email,course,department,academic_year)
  VALUES ($1,'Karthick V','DEMO2026','student@example.com','B.E Computer Science','Computer Science and Engineering',2026)
  ON CONFLICT (institution_id,register_number) DO UPDATE SET name=EXCLUDED.name
  RETURNING id
`, [institutionId]);
await pool.query(`
  INSERT INTO certificates (certificate_id,student_id,institution_id,issue_date,grade,cgpa,status)
  VALUES ('CERT-2026-000001',$1,$2,'2026-08-01','A+',9.20,'ACTIVE')
  ON CONFLICT (certificate_id) DO NOTHING
`, [student.rows[0].id, institutionId]);
console.log('Seed complete. Admin: admin@certitrust.com / admin@360');
await pool.end();
