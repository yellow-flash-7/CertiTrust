# CertiTrust — AI + PostgreSQL Academic Certificate Authenticity Validator

CertiTrust is a local academic certificate verification platform. It combines PostgreSQL, SHA-256 file integrity checking, QR verification, role-based access, and an optional AI-assisted visual tampering analysis service.

## Main workflow

1. An approved institution issues a certificate and uploads the trusted original PDF/image.
2. CertiTrust stores the certificate record in PostgreSQL and calculates SHA-256 for the original file.
3. A verifier enters a Certificate ID or scans the QR code.
4. For document verification, the uploaded file is hashed and compared with the trusted hash.
5. If the hash differs, the Python AI-assisted document analysis service compares the trusted original with the uploaded document and highlights suspicious changed regions in red.
6. Failed verification hides student details from the public result.

> AI note: the included service is an explainable document-forensics prototype using OpenCV feature alignment and visual difference localization. It is not a trained universal fraud classifier and should be presented as AI-assisted tampering analysis, not an absolute legal determination of fraud.

## Technology

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js + Express
- Database: PostgreSQL
- Authentication: JWT + bcrypt
- Integrity: SHA-256
- QR: qrcode
- AI-assisted document analysis: Python, Flask, OpenCV, NumPy, Pillow, PyMuPDF
- Optional blockchain/Web3 layer: can be added after the database/verification flow is stable

## Requirements

- Windows 10/11
- Node.js 20 LTS or newer
- PostgreSQL 15+ recommended
- pgAdmin 4 (optional but useful)
- Python 3.10–3.12 for the AI service

## 1. Install dependencies

### Node.js
Install from https://nodejs.org/ and verify:

```powershell
node --version
npm --version
```

### PostgreSQL
Install from https://www.postgresql.org/download/windows/.
Remember the `postgres` password and keep the default port `5432` unless you intentionally changed it.

### Python (AI service)
Install Python 3.10–3.12. Verify:

```powershell
python --version
```

## 2. Create the PostgreSQL database

Open pgAdmin → Databases → Create → Database and create:

```text
certitrust
```

Or from `psql`:

```sql
CREATE DATABASE certitrust;
```

## 3. Configure `.env`

Copy `.env.example` to `.env` and edit the PostgreSQL password:

```env
PORT=5000
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/certitrust
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d
PUBLIC_BASE_URL=http://localhost:5000
MAX_FILE_SIZE=5242880
AI_SERVICE_URL=http://127.0.0.1:8000
```

## 4. Install Node packages

From the project root:

```powershell
npm install
```

## 5. Create/update the database schema

Run:

```powershell
npm run db:setup
```

This is safe to run against an older CertiTrust database because the setup script includes `ADD COLUMN IF NOT EXISTS` upgrades, including `document_path`.

Check the connection:

```powershell
npm run db:check
```

Optional demo seed:

```powershell
npm run db:seed
```

Demo accounts created by the seed script:

```text
Admin
Email: admin@certitrust.com
Password: admin@360

Institution
Email: institution@abcuniversity.edu.in
Password: Inst@123
```

## 6. Start the Node server

```powershell
npm run dev
```

Open:

```text
http://localhost:5000
```

## 7. Start the AI service

Open a second VS Code terminal:

```powershell
cd ai_service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

The AI service runs at:

```text
http://127.0.0.1:8000
```

Check it:

```text
http://127.0.0.1:8000/health
```

If PowerShell blocks activation, you can run the venv Python directly:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

## 8. Role-based hierarchy

### Admin

Admin login has global visibility:

```text
Admin
  ↓
Institutions
  ↓ click institution
Departments
  ↓ click department
Students
  ↓
Certificate IDs / certificate status
```

Admin can also approve/reject institution registrations and review certificate/student change requests.

### Institution

An institution is restricted to its own data:

```text
Institution login
  ↓
Own institution
  ↓
Own departments
  ↓
Own students
  ↓
Own certificates
```

The backend enforces this using the authenticated `institutionId`; changing a URL cannot expose another institution's records.

## 9. AI tampering test

Use a trusted original certificate when issuing the certificate. Later upload a modified copy with the same Certificate ID.

Expected flow:

```text
Trusted original
       ↓
SHA-256 stored
       ↓
Modified certificate uploaded
       ↓
SHA-256 mismatch
       ↓
AI-assisted visual comparison
       ↓
Red bounding box around suspicious area
```

The public result should show:

- Tampering/mismatch status
- Trusted SHA-256
- Uploaded SHA-256
- AI risk/confidence
- Number of changed regions
- Annotated certificate image
- Student details hidden when verification fails

### Test example from the supplied mark-sheet pair

The first supplied PDF visibly contains a `100` in the affected mark column; the file parser also extracted `100`. The second supplied PDF is the reference/original for this test. fileciteturn0file0L1-L1

For this type of test, the AI service is intended to localize the changed mark region rather than relying on SHA-256 alone.

## 10. Troubleshooting

### `column "document_path" does not exist`

Run:

```powershell
npm run db:setup
```

If needed, manually run:

```sql
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS document_path VARCHAR(500);
```

### PostgreSQL password error

Check `.env`:

```env
DB_USER=postgres
DB_PASSWORD=YOUR_PASSWORD
DB_HOST=localhost
DB_PORT=5432
DB_NAME=certitrust
```

This project also accepts `DATABASE_URL` through the PostgreSQL pool configuration.

### AI says `UNAVAILABLE`

Make sure the second terminal is running:

```powershell
python ai_service/app.py
```

and check:

```text
http://127.0.0.1:8000/health
```

SHA-256 verification continues to work even if the AI service is unavailable.

## Security assumptions

- PostgreSQL is local development storage.
- JWT is used for local authentication.
- `.env` must never be committed to Git.
- Uploaded documents are stored locally under `uploads/`.
- Public failed verification intentionally hides student details.
- AI output is advisory evidence and should be reviewed by an authorized institution/admin.

## Production notes

For production, move uploads to private object storage, use HTTPS, rotate JWT secrets, add audit trails, implement stronger document identity matching, and use a trained/validated document-forensics model if AI decisions will affect high-stakes employment or academic decisions.

### Existing certificates created before `document_path`

If your database already contains certificates and their uploaded files are still inside `uploads/`, run:

```powershell
npm run db:backfill-documents
```

This links files whose names start with the certificate ID to the corresponding database record, so AI comparison can use the trusted original.
