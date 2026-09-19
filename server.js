import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import pool from './server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 5 * 1024 * 1024);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
await fs.mkdir(UPLOAD_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowed = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/');
    cb(allowed ? null : new Error('Only PDF or image files are allowed.'), allowed);
  }
});

function makeToken(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }); }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function auth(req, res, next) {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: 'Please log in.' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' }); }
}
function role(...roles) { return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ success: false, message: 'You do not have permission for this action.' }); }
function publicUser(u) { return { id: u.id, name: u.name, email: u.email, role: u.role, institutionId: u.institutionId, institutionStatus: u.status }; }
function qrUrl(certificateId) { return `${PUBLIC_BASE_URL}/?verify=${encodeURIComponent(certificateId)}#verify`; }
async function certificateDetails(certificateId) {
  const q = await pool.query(`
    SELECT c.*, s.name student_name, s.register_number, s.email student_email, s.course, s.department, s.academic_year,
           i.name institution_name, i.code institution_code
    FROM certificates c
    JOIN students s ON s.id=c.student_id
    JOIN institutions i ON i.id=c.institution_id
    WHERE c.certificate_id=$1
  `, [certificateId]);
  return q.rows[0];
}
function publicCertificate(c) {
  return {
    certificateId: c.certificate_id,
    status: c.status === 'ACTIVE' ? 'VERIFIED' : 'REVOKED',
    details: {
      studentName: c.student_name,
      registerNumber: c.register_number,
      institutionName: c.institution_name,
      institutionCode: c.institution_code,
      course: c.course,
      department: c.department,
      academicYear: c.academic_year,
      issueDate: c.issue_date,
      grade: c.grade,
      cgpa: c.cgpa
    },
    integrity: { sha256: c.document_hash || null, hashMatch: null },
    qrUrl: c.qr_url || qrUrl(c.certificate_id)
  };
}
async function nextCertificateId() {
  const year = new Date().getFullYear();
  const r = await pool.query(`SELECT COUNT(*)::int count FROM certificates WHERE certificate_id LIKE $1`, [`CERT-${year}-%`]);
  return `CERT-${year}-${String(r.rows[0].count + 1).padStart(6, '0')}`;
}

async function runAIAnalysis(originalPath, uploadedFile) {
  if (!originalPath || !uploadedFile?.buffer) return { status: 'SKIPPED', message: 'Original certificate file is not available for visual comparison.' };
  try {
    const form = new FormData();
    form.append('original', new Blob([await fs.readFile(originalPath)], { type: 'application/octet-stream' }), path.basename(originalPath));
    form.append('uploaded', new Blob([uploadedFile.buffer], { type: uploadedFile.mimetype || 'application/octet-stream' }), uploadedFile.originalname || 'uploaded');
    const response = await fetch(`${AI_SERVICE_URL}/analyze`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `AI service returned ${response.status}`);
    return data;
  } catch (error) {
    console.warn('AI analysis unavailable:', error.message);
    return { status: 'UNAVAILABLE', message: 'AI visual analysis service is not running. SHA-256 verification was still completed.' };
  }
}

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'OK', database: 'PostgreSQL', time: new Date().toISOString() }); }
  catch { res.status(503).json({ status: 'ERROR', database: 'Disconnected' }); }
});

// Authentication: institution registration is always pending until admin approval.
app.post('/api/auth/institution-register', upload.single('authenticationDocument'), async (req, res, next) => {
  try {
    const { name, code, email, password } = req.body;
    if (!name?.trim() || !code?.trim() || !email?.trim() || !password || password.length < 8) return res.status(400).json({ success: false, message: 'Enter institution name, code, email and an 8+ character password.' });
    const exists = await pool.query('SELECT 1 FROM institutions WHERE email=$1 OR code=$2', [email.trim().toLowerCase(), code.trim().toUpperCase()]);
    if (exists.rowCount) return res.status(409).json({ success: false, message: 'Institution email or code already exists.' });
    const documentName = req.file ? `institution-${crypto.randomUUID()}${path.extname(req.file.originalname).toLowerCase() || '.bin'}` : null;
    await pool.query(`INSERT INTO institutions(name,code,email,password_hash,status,registration_document) VALUES($1,$2,$3,$4,'PENDING',$5)`, [name.trim(), code.trim().toUpperCase(), email.trim().toLowerCase(), await bcrypt.hash(password, 12), documentName]);
    if (req.file) await fs.writeFile(path.join(UPLOAD_DIR, documentName), req.file.buffer);
    res.status(201).json({ success: true, message: 'Registration submitted. Wait for admin approval before logging in.' });
  } catch (e) { next(e); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const admin = await pool.query('SELECT * FROM admins WHERE email=$1', [email]);
    if (admin.rowCount && await bcrypt.compare(password, admin.rows[0].password_hash)) {
      const a = admin.rows[0];
      return res.json({ success: true, data: { token: makeToken({ sub: a.id, role: 'ADMIN' }), user: { id: a.id, name: a.name, email: a.email, role: 'ADMIN' } } });
    }
    const inst = await pool.query('SELECT * FROM institutions WHERE email=$1', [email]);
    if (!inst.rowCount || !(await bcrypt.compare(password, inst.rows[0].password_hash))) return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    const i = inst.rows[0];
    if (i.status !== 'APPROVED') return res.status(403).json({ success: false, message: i.status === 'PENDING' ? 'Your institution registration is waiting for admin approval.' : `Registration rejected${i.rejection_reason ? `: ${i.rejection_reason}` : '.'}` });
    res.json({ success: true, data: { token: makeToken({ sub: i.id, role: 'INSTITUTION', institutionId: i.id }), user: publicUser({ ...i, institutionId: i.id, role: 'INSTITUTION', name: i.name }) } });
  } catch (e) { next(e); }
});

app.get('/api/auth/me', auth, async (req, res, next) => {
  try {
    if (req.user.role === 'ADMIN') {
      const r = await pool.query('SELECT id,name,email FROM admins WHERE id=$1', [req.user.sub]);
      return res.json({ success: true, data: { user: { ...r.rows[0], role: 'ADMIN' } } });
    }
    const r = await pool.query('SELECT id,name,email,status FROM institutions WHERE id=$1', [req.user.institutionId]);
    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Institution not found.' });
    res.json({ success: true, data: { user: publicUser({ ...r.rows[0], institutionId: r.rows[0].id, role: 'INSTITUTION' }) } });
  } catch (e) { next(e); }
});

// Public verification. QR links land here.
app.get('/api/verify/:certificateId', async (req, res, next) => {
  try {
    const id = decodeURIComponent(req.params.certificateId).trim().toUpperCase();
    const c = await certificateDetails(id);
    const result = c ? (c.status === 'ACTIVE' ? 'VERIFIED' : 'REVOKED') : 'NOT_FOUND';
    await pool.query('INSERT INTO verification_logs(certificate_id,method,result) VALUES($1,$2,$3)', [id, 'QR_OR_ID', result]);
    if (!c) return res.json({ success: true, data: { status: 'NOT_FOUND', certificateId: id, message: 'Certificate not found in CertiTrust.' } });
    res.json({ success: true, data: { ...publicCertificate(c), status: result, message: result === 'VERIFIED' ? 'Certificate is authentic and active.' : 'Certificate was revoked.' } });
  } catch (e) { next(e); }
});

app.post('/api/verify/upload', upload.single('document'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Select a PDF or image certificate.' });
    const id = String(req.body.certificateId || '').trim().toUpperCase();
    if (!id) return res.status(400).json({ success: false, message: 'Enter the certificate ID.' });
    const c = await certificateDetails(id);
    if (!c) return res.json({ success: true, data: { status: 'NOT_FOUND', certificateId: id, message: 'Certificate not found in CertiTrust.' } });
    const uploadedHash = sha256(req.file.buffer);
    const match = Boolean(c.document_hash) && uploadedHash === c.document_hash;
    let ai = { status: 'SKIPPED', message: 'No visual comparison required because the hash matches.' };
    if (c.status === 'ACTIVE' && !match && c.document_path) {
      ai = await runAIAnalysis(path.join(UPLOAD_DIR, c.document_path), req.file);
    }
    const result = c.status !== 'ACTIVE' ? 'REVOKED' : match ? 'VERIFIED' : 'HASH_MISMATCH';
    await pool.query('INSERT INTO verification_logs(certificate_id,method,result) VALUES($1,$2,$3)', [id, 'DOCUMENT_HASH_AI', result]);
    const base = { certificateId: id, status: result, message: match ? 'Uploaded document matches the trusted original.' : c.status !== 'ACTIVE' ? 'This certificate has been revoked.' : 'The uploaded document does not match the trusted original. Possible tampering detected.' };
    if (result === 'VERIFIED') {
      return res.json({ success: true, data: { ...publicCertificate(c), ...base, integrity: { sha256: uploadedHash, storedHash: c.document_hash, hashMatch: true }, ai } });
    }
    return res.json({ success: true, data: { ...base, integrity: { sha256: uploadedHash, storedHash: c.document_hash, hashMatch: false }, ai, security: { detailsHidden: true } } });
  } catch (e) { next(e); }
});

// Institution dashboard and certificate issuing.
app.get('/api/institution/dashboard', auth, role('INSTITUTION'), async (req, res, next) => {
  try {
    const id = req.user.institutionId;
    const [stats, years, departments, recent] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int total, COUNT(*) FILTER(WHERE c.status='ACTIVE')::int active, COUNT(*) FILTER(WHERE c.status='REVOKED')::int revoked FROM certificates c WHERE c.institution_id=$1`, [id]),
      pool.query(`SELECT s.academic_year AS academic_year, COUNT(*)::int AS members, COUNT(c.id)::int AS certificates
FROM students s
LEFT JOIN certificates c ON c.student_id = s.id
WHERE s.institution_id = $1
GROUP BY s.academic_year
ORDER BY s.academic_year DESC`, [id]),
      pool.query(`SELECT s.department, COUNT(*)::int members, COUNT(c.id)::int certificates FROM students s LEFT JOIN certificates c ON c.student_id=s.id WHERE s.institution_id=$1 GROUP BY s.department ORDER BY members DESC`, [id]),
      pool.query(`SELECT c.certificate_id,s.name student_name,s.register_number,s.academic_year,s.department,c.issue_date,c.status FROM certificates c JOIN students s ON s.id=c.student_id WHERE c.institution_id=$1 ORDER BY c.created_at DESC LIMIT 20`, [id])
    ]);
    const verifications = await pool.query(`SELECT COUNT(*)::int count FROM verification_logs v JOIN certificates c ON c.certificate_id=v.certificate_id WHERE c.institution_id=$1`, [id]);
    res.json({ success: true, data: { stats: { ...stats.rows[0], verifications: verifications.rows[0].count }, byYear: years.rows, byDepartment: departments.rows, recent: recent.rows } });
  } catch (e) { next(e); }
});

app.post('/api/certificates', auth, role('INSTITUTION'), upload.single('document'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { studentName, registerNumber, email, course, department, academicYear, issueDate, grade, cgpa } = req.body;
    if (![studentName, registerNumber, course, department, academicYear, issueDate].every(v => String(v || '').trim())) return res.status(400).json({ success: false, message: 'Please fill all required student and certificate fields.' });
    const year = Number(academicYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ success: false, message: 'Enter a valid academic year.' });
    await client.query('BEGIN');
    const student = await client.query(`INSERT INTO students(institution_id,name,register_number,email,course,department,academic_year) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(institution_id,register_number) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,course=EXCLUDED.course,department=EXCLUDED.department,academic_year=EXCLUDED.academic_year RETURNING id`, [req.user.institutionId, studentName.trim(), registerNumber.trim(), email?.trim() || null, course.trim(), department.trim(), year]);
    const certificateId = await nextCertificateId();
    const hash = req.file ? sha256(req.file.buffer) : null;
    const qr = qrUrl(certificateId);
    const storedFilename = req.file ? `${certificateId}-${crypto.randomUUID()}${path.extname(req.file.originalname).toLowerCase() || '.bin'}` : null;
    const cert = await client.query(`INSERT INTO certificates(certificate_id,student_id,institution_id,issue_date,grade,cgpa,document_hash,document_name,document_path,qr_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [certificateId, student.rows[0].id, req.user.institutionId, issueDate, grade?.trim() || null, cgpa ? Number(cgpa) : null, hash, req.file?.originalname || null, storedFilename, qr]);
    if (req.file) await fs.writeFile(path.join(UPLOAD_DIR, storedFilename), req.file.buffer);
    await client.query('COMMIT');
    const qrCode = await QRCode.toDataURL(qr, { width: 360, margin: 2, errorCorrectionLevel: 'H' });
    res.status(201).json({ success: true, data: { certificate: cert.rows[0], qrCode, verificationUrl: qr } });
  } catch (e) { await client.query('ROLLBACK'); next(e); } finally { client.release(); }
});

app.get('/api/institution/departments/:department/students', auth, role('INSTITUTION'), async (req, res, next) => {
  try {
    const department = String(req.params.department || '').trim();
    const r = await pool.query(`
      SELECT s.id,s.name,s.register_number,s.email,s.course,s.department,s.academic_year,
             COUNT(c.id)::int AS certificates,
             MAX(c.issue_date) AS latest_certificate_date
      FROM students s
      LEFT JOIN certificates c ON c.student_id=s.id
      WHERE s.institution_id=$1 AND LOWER(s.department)=LOWER($2)
      GROUP BY s.id ORDER BY s.academic_year DESC,s.name ASC`, [req.user.institutionId, department]);
    res.json({ success:true, data:{ department, students:r.rows } });
  } catch(e){ next(e); }
});

app.get('/api/institution/certificates', auth, role('INSTITUTION'), async (req, res, next) => {
  try {
    const r = await pool.query(`SELECT c.*,s.name student_name,s.register_number,s.email student_email,s.course,s.department,s.academic_year FROM certificates c JOIN students s ON s.id=c.student_id WHERE c.institution_id=$1 ORDER BY c.created_at DESC`, [req.user.institutionId]);
    res.json({ success: true, data: { certificates: r.rows } });
  } catch (e) { next(e); }
});

app.patch('/api/certificates/:certificateId/revoke', auth, role('INSTITUTION'), async (req, res, next) => {
  try {
    const r = await pool.query(`UPDATE certificates SET status='REVOKED',revoked_at=NOW() WHERE certificate_id=$1 AND institution_id=$2 AND status='ACTIVE' RETURNING certificate_id`, [req.params.certificateId, req.user.institutionId]);
    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Certificate not found or already revoked.' });
    res.json({ success: true, message: 'Certificate revoked.' });
  } catch (e) { next(e); }
});

// Institution requests a student/certificate detail change. Admin is the only approver.
app.post('/api/change-requests', auth, role('INSTITUTION'), async (req, res, next) => {
  try {
    const { certificateId, reason, newData } = req.body;
    const c = await certificateDetails(String(certificateId || '').trim().toUpperCase());
    if (!c || c.institution_id !== req.user.institutionId) return res.status(404).json({ success: false, message: 'Certificate not found.' });
    if (!reason?.trim() || !newData || typeof newData !== 'object') return res.status(400).json({ success: false, message: 'Give the reason and the new details.' });
    const oldData = { studentName: c.student_name, registerNumber: c.register_number, email: c.student_email, course: c.course, department: c.department, academicYear: c.academic_year, grade: c.grade, cgpa: c.cgpa };
    await pool.query(`INSERT INTO change_requests(certificate_id,institution_id,requested_by,old_data,new_data,reason) VALUES($1,$2,$2,$3,$4,$5)`, [c.id, req.user.institutionId, oldData, newData, reason.trim()]);
    res.status(201).json({ success: true, message: 'Change request sent to admin for approval.' });
  } catch (e) { next(e); }
});

app.get('/api/change-requests/mine', auth, role('INSTITUTION'), async (req, res, next) => {
  try { const r = await pool.query(`SELECT cr.id,cr.status,cr.reason,cr.old_data,cr.new_data,cr.admin_note,cr.created_at,cr.reviewed_at,c.certificate_id FROM change_requests cr JOIN certificates c ON c.id=cr.certificate_id WHERE cr.institution_id=$1 ORDER BY cr.created_at DESC`, [req.user.institutionId]); res.json({ success: true, data: { requests: r.rows } }); }
  catch (e) { next(e); }
});

// Admin APIs.
// Admin-only access to institution authentication documents.
app.get('/api/admin/institutions/:id/document', auth, role('ADMIN'), async (req, res, next) => {
  try { const r=await pool.query('SELECT registration_document FROM institutions WHERE id=$1',[req.params.id]); if(!r.rowCount || !r.rows[0].registration_document) return res.status(404).send('No document.'); const file=path.join(UPLOAD_DIR,r.rows[0].registration_document); res.sendFile(file); } catch(e){ next(e); }
});

app.get('/api/admin/overview', auth, role('ADMIN'), async (_req, res, next) => {
  try {
    const [institutions, certificates, requests, verifications, pending] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int total, COUNT(*) FILTER(WHERE status='PENDING')::int pending, COUNT(*) FILTER(WHERE status='APPROVED')::int approved, COUNT(*) FILTER(WHERE status='REJECTED')::int rejected FROM institutions`),
      pool.query(`SELECT COUNT(*)::int total FROM certificates`),
      pool.query(`SELECT COUNT(*)::int pending FROM change_requests WHERE status='PENDING'`),
      pool.query(`SELECT COUNT(*)::int total FROM verification_logs`),
      pool.query(`SELECT id,name,code,email,status,registration_document,created_at FROM institutions ORDER BY created_at DESC`)
    ]);
    res.json({ success: true, data: { stats: { ...institutions.rows[0], certificates: certificates.rows[0].total, pendingChanges: requests.rows[0].pending, verifications: verifications.rows[0].total }, institutions: pending.rows } });
  } catch (e) { next(e); }
});

async function reviewInstitution(req, res, next) {
  try {
    const status = String(req.body.status || '').trim().toUpperCase();
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be APPROVED or REJECTED.' });
    }
    const note = String(req.body.note || '').trim() || null;
    if (status === 'REJECTED' && !note) {
      return res.status(400).json({ success: false, message: 'Please enter a rejection reason.' });
    }

    // Keep approval/rejection in one transaction so the UI and database never disagree.
   let r;

if (status === 'APPROVED') {
  r = await pool.query(
    `UPDATE institutions
     SET status = 'APPROVED',
         rejection_reason = NULL,
         approved_at = COALESCE(approved_at, NOW())
     WHERE id = $1::uuid
     RETURNING id, name, code, email, status, rejection_reason, approved_at`,
    [req.params.id]
  );
} else {
  r = await pool.query(
    `UPDATE institutions
     SET status = 'REJECTED',
         rejection_reason = $2::text,
         approved_at = NULL
     WHERE id = $1::uuid
     RETURNING id, name, code, email, status, rejection_reason, approved_at`,
    [req.params.id, note]
  );
}

    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Institution not found.' });
    return res.json({
      success: true,
      message: status === 'APPROVED' ? 'Institution approved successfully.' : 'Institution rejected successfully.',
      data: { institution: r.rows[0] }
    });
  } catch (e) {
    return next(e);
  }
}

// PATCH is kept for compatibility with older frontend versions.
app.patch('/api/admin/institutions/:id/review', auth, role('ADMIN'), reviewInstitution);
// POST endpoints are easier to call from the admin UI and are explicit actions.
app.post('/api/admin/institutions/:id/approve', auth, role('ADMIN'), (req, res, next) => {
  req.body = { status: 'APPROVED' };
  return reviewInstitution(req, res, next);
});
app.post('/api/admin/institutions/:id/reject', auth, role('ADMIN'), (req, res, next) => {
  req.body = { status: 'REJECTED', note: req.body.note };
  return reviewInstitution(req, res, next);
});

app.get('/api/admin/institutions/:id/departments', auth, role('ADMIN'), async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT s.department, COUNT(DISTINCT s.id)::int AS students, COUNT(c.id)::int AS certificates
      FROM students s LEFT JOIN certificates c ON c.student_id=s.id
      WHERE s.institution_id=$1 GROUP BY s.department ORDER BY s.department ASC`, [req.params.id]);
    res.json({ success:true, data:{ departments:r.rows } });
  } catch(e){ next(e); }
});

app.get('/api/admin/institutions/:id/departments/:department/students', auth, role('ADMIN'), async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT s.id,s.name,s.register_number,s.email,s.course,s.department,s.academic_year,
             COUNT(c.id)::int AS certificates,
             COALESCE(json_agg(json_build_object('certificateId',c.certificate_id,'issueDate',c.issue_date,'status',c.status,'grade',c.grade,'cgpa',c.cgpa) ORDER BY c.created_at DESC) FILTER (WHERE c.id IS NOT NULL),'[]'::json) AS certificate_list
      FROM students s LEFT JOIN certificates c ON c.student_id=s.id
      WHERE s.institution_id=$1 AND LOWER(s.department)=LOWER($2)
      GROUP BY s.id ORDER BY s.academic_year DESC,s.name ASC`, [req.params.id, req.params.department]);
    res.json({ success:true, data:{ institutionId:req.params.id, department:req.params.department, students:r.rows } });
  } catch(e){ next(e); }
});

app.get('/api/admin/change-requests', auth, role('ADMIN'), async (_req, res, next) => {
  try {
    const r = await pool.query(`SELECT cr.id,cr.status,cr.reason,cr.old_data,cr.new_data,cr.admin_note,cr.created_at,cr.reviewed_at,c.certificate_id,i.name institution_name FROM change_requests cr JOIN certificates c ON c.id=cr.certificate_id JOIN institutions i ON i.id=cr.institution_id ORDER BY CASE WHEN cr.status='PENDING' THEN 0 ELSE 1 END,cr.created_at DESC`);
    res.json({ success: true, data: { requests: r.rows } });
  } catch (e) { next(e); }
});

app.patch('/api/admin/change-requests/:id/review', auth, role('ADMIN'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const status = String(req.body.status || '').toUpperCase();
    if (!['APPROVED','REJECTED'].includes(status)) return res.status(400).json({ success: false, message: 'Choose OK/Approve or Reject.' });
    const note = String(req.body.note || '').trim() || null;
    await client.query('BEGIN');
    const rq = await client.query(`SELECT * FROM change_requests WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!rq.rowCount) return res.status(404).json({ success: false, message: 'Request not found.' });
    if (rq.rows[0].status !== 'PENDING') return res.status(409).json({ success: false, message: 'This request was already reviewed.' });
    if (status === 'APPROVED') {
      const n = rq.rows[0].new_data;
      await client.query(`UPDATE students s SET name=COALESCE($1,s.name),register_number=COALESCE($2,s.register_number),email=COALESCE($3,s.email),course=COALESCE($4,s.course),department=COALESCE($5,s.department),academic_year=COALESCE($6,s.academic_year) FROM certificates c WHERE c.id=$7 AND s.id=c.student_id`, [n.studentName, n.registerNumber, n.email, n.course, n.department, n.academicYear ? Number(n.academicYear) : null, rq.rows[0].certificate_id]);
      await client.query(`UPDATE certificates SET grade=COALESCE($1,grade),cgpa=COALESCE($2,cgpa) WHERE id=$3`, [n.grade || null, n.cgpa ? Number(n.cgpa) : null, rq.rows[0].certificate_id]);
    }
    await client.query(`UPDATE change_requests SET status=$1,admin_note=$2,reviewed_at=NOW() WHERE id=$3`, [status, note, req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true, message: status === 'APPROVED' ? 'Change approved and student details updated.' : 'Change rejected. Institution will see the rejection.' });
  } catch (e) { await client.query('ROLLBACK'); next(e); } finally { client.release(); }
});

app.use((err, _req, res, _next) => { console.error(err); res.status(err instanceof multer.MulterError ? 400 : 500).json({ success: false, message: err.message || 'Server error.' }); });
app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`CertiTrust running: http://localhost:${PORT}`));
