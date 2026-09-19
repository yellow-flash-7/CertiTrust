const token = localStorage.getItem('ct_token');
const user = JSON.parse(localStorage.getItem('ct_user') || 'null');
if (!token || !user) location.href = '/pages/login.html';

const $ = (s, root = document) => root.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));

async function api(url, opt = {}) {
  opt.headers = { ...(opt.headers || {}), Authorization: `Bearer ${token}` };
  const r = await fetch(url, opt);
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { j = { message: text }; }
  if (!r.ok) throw new Error(j.message || `Request failed (${r.status})`);
  return j;
}

function shell(title, sub, body) {
  $('#dashboard').innerHTML = `<div class="dash-title"><div><span class="eyebrow">${user.role === 'ADMIN' ? 'ADMIN CONTROL CENTER' : 'INSTITUTION DASHBOARD'}</span><h1>${title}</h1><p class="muted">${sub}</p></div></div>${body}`;
}

function toast(message, type = 'good') {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.className = `toast ${type}`;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

$('#logout').onclick = () => { localStorage.clear(); location.href = '/pages/login.html'; };

async function institution() {
  shell('Institution dashboard', 'Track certificate uploads, academic years, departments and approval requests.', `<div id="content">Loading…</div>`);
  try {
    const [d, c, r] = await Promise.all([
      api('/api/institution/dashboard'),
      api('/api/institution/certificates'),
      api('/api/change-requests/mine')
    ]);
    const s = d.data.stats;
    $('#content').innerHTML = `
      <div class="stats">
        <div class="stat"><small>Total certificates</small><strong>${s.total}</strong></div>
        <div class="stat"><small>Active</small><strong>${s.active}</strong></div>
        <div class="stat"><small>Revoked</small><strong>${s.revoked}</strong></div>
        <div class="stat"><small>Public verifications</small><strong>${s.verifications}</strong></div>
      </div>
      <div class="two">
        <section class="panel"><h2>Upload certificate</h2>
          <form id="issue" class="form-grid">
            <label>Student name<input name="studentName" required></label>
            <label>Register number<input name="registerNumber" required></label>
            <label>Email<input name="email" type="email"></label>
            <label>Course<input name="course" required value="B.E Computer Science"></label>
            <label>Department<input name="department" required value="Computer Science and Engineering"></label>
            <label>Academic year<input name="academicYear" type="number" value="2026" required></label>
            <label>Issue date<input name="issueDate" type="date" required></label>
            <label>Grade<input name="grade"></label>
            <label>CGPA<input name="cgpa" type="number" step="0.01" min="0" max="10"></label>
            <label class="wide">Original certificate (PDF/image)<input name="document" type="file" accept=".pdf,image/*"></label>
            <button class="btn wide" type="submit">Create certificate + QR</button>
          </form><div id="issueMsg" class="message" hidden></div>
        </section>
        <section class="panel"><h2>Members by academic year</h2>
          ${d.data.byYear.map(x => `<div class="bar"><span>${esc(x.academic_year)}</span><i style="width:${Math.max(8, Math.min(100, x.members * 18))}%"></i><b>${x.members}</b></div>`).join('')}
          <h2>Departments</h2>${d.data.byDepartment.map(x => `<button class="bar department-link js-dept" data-department="${esc(x.department)}" title="Open ${esc(x.department)}"><span>${esc(x.department)}</span><i style="width:${Math.max(8, Math.min(100, x.members * 18))}%"></i><b>${x.members} students →</b></button>`).join('')}
        </section>
      </div>
      <section class="panel" style="margin-top:18px"><h2>Certificates</h2><div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>Student</th><th>Year</th><th>Department</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>
        ${c.data.certificates.map(x => `<tr><td>${esc(x.certificate_id)}</td><td>${esc(x.student_name)}<br><small>${esc(x.register_number)}</small></td><td>${x.academic_year}</td><td>${esc(x.department)}</td><td>${esc(x.issue_date)}</td><td><span class="pill ${x.status === 'ACTIVE' ? 'good' : 'bad'}">${x.status}</span></td><td>${x.status === 'ACTIVE' ? `<button class="btn small ghost js-change" data-id="${esc(x.certificate_id)}">Request change</button> <button class="btn small ghost js-revoke" data-id="${esc(x.certificate_id)}">Revoke</button>` : '-'}</td></tr>`).join('')}
      </tbody></table></div></section>
      <section class="panel" style="margin-top:18px"><h2>My change requests</h2>${r.data.requests.length ? r.data.requests.map(x => `<div class="request"><b>${esc(x.certificate_id)}</b> · <span class="pill ${x.status === 'APPROVED' ? 'good' : x.status === 'REJECTED' ? 'bad' : 'warn'}">${x.status}</span><p>${esc(x.reason)}</p>${x.admin_note ? `<p><b>Admin:</b> ${esc(x.admin_note)}</p>` : ''}</div>`).join('') : '<div class="empty">No requests.</div>'}</section>`;

    $('#issue').onsubmit = async e => {
      e.preventDefault();
      const m = $('#issueMsg'); m.hidden = false; m.textContent = 'Creating certificate…';
      try {
        const j = await api('/api/certificates', { method: 'POST', body: new FormData(e.target) });
        m.innerHTML = `Certificate <b>${esc(j.data.certificate.certificate_id)}</b> created successfully.`;
        m.className = 'message success';
        const w = window.open('', '_blank', 'width=520,height=760');
        if (w) w.document.write(`<title>CertiTrust QR</title><body style="font-family:system-ui;text-align:center;padding:30px"><h2>Certificate QR</h2><img src="${j.data.qrCode}" style="width:360px;max-width:90%"><p><b>Verification URL</b></p><p style="word-break:break-all">${esc(j.data.verificationUrl)}</p><p>Scan with Google Lens or any QR scanner.</p></body>`);
        e.target.reset();
      } catch (err) { m.textContent = err.message; m.className = 'message error'; }
    };

    $('#content').addEventListener('click', async e => {
      const dept = e.target.closest('.js-dept');
      const change = e.target.closest('.js-change');
      if (dept) {
        try {
          const j = await api(`/api/institution/departments/${encodeURIComponent(dept.dataset.department)}/students`);
          const rows = j.data.students.map(x => `<tr><td><b>${esc(x.name)}</b><br><small>${esc(x.register_number)}</small></td><td>${esc(x.course)}</td><td>${esc(x.academic_year)}</td><td>${x.certificates}</td><td>${esc(x.email||'-')}</td></tr>`).join('');
          $('#content').innerHTML = `<button class="btn small ghost js-back-inst">← Back to dashboard</button><section class="panel" style="margin-top:18px"><div class="breadcrumb"><span>Institution</span><span>›</span><b>${esc(j.data.department)}</b></div><h2>${esc(j.data.department)}</h2><p class="muted">Students and certificate count for your institution only.</p><div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Course</th><th>Academic year</th><th>Certificates</th><th>Email</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">No students in this department.</td></tr>'}</tbody></table></div></section>`;
          $('.js-back-inst').onclick = institution;
        } catch(err){ toast(err.message,'bad'); }
        return;
      }

      const revoke = e.target.closest('.js-revoke');
      if (change) {
        const name = prompt('New student name (leave blank to keep current):', '');
        const reason = prompt('Why should this detail be changed?');
        if (!reason) return;
        try { await api('/api/change-requests', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ certificateId:change.dataset.id, reason, newData:{ studentName:name || undefined } }) }); toast('Change request sent to admin.'); await institution(); }
        catch (err) { toast(err.message, 'bad'); }
      }
      if (revoke) {
        if (!confirm('Revoke this certificate? This will make public verification show REVOKED.')) return;
        try { await api(`/api/certificates/${encodeURIComponent(revoke.dataset.id)}/revoke`, { method:'PATCH' }); toast('Certificate revoked.'); await institution(); }
        catch (err) { toast(err.message, 'bad'); }
      }
    });
  } catch (err) { $('#content').innerHTML = `<div class="result bad"><h3>Unable to load dashboard</h3><p>${esc(err.message)}</p><button class="btn small" onclick="location.reload()">Try again</button></div>`; }
}

async function admin() {
  shell('Admin control center', 'Drill down from institution → department → students. Admin can view every registered institution.', `<div id="content">Loading…</div>`);
  try {
    const [o, r] = await Promise.all([api('/api/admin/overview'), api('/api/admin/change-requests')]);
    const s=o.data.stats;
    $('#content').innerHTML=`
      <div class="stats">
        <div class="stat"><small>Total institutions</small><strong>${s.total}</strong></div>
        <div class="stat"><small>Pending approvals</small><strong>${s.pending}</strong></div>
        <div class="stat"><small>Certificates</small><strong>${s.certificates}</strong></div>
        <div class="stat"><small>Pending changes</small><strong>${s.pendingChanges}</strong></div>
      </div>
      <section class="panel" style="margin-top:18px">
        <div class="section-title-row"><div><h2>Institutions</h2><p class="muted">Select an institution to see its departments, then select a department to see its students.</p></div></div>
        <div class="drill-grid" id="institutionGrid">
          ${o.data.institutions.map(i=>`<article class="drill-card js-institution" data-id="${esc(i.id)}"><div style="display:flex;justify-content:space-between;gap:8px"><strong>${esc(i.name)}</strong><span class="pill ${i.status==='APPROVED'?'good':i.status==='REJECTED'?'bad':'warn'}">${esc(i.status)}</span></div><small>${esc(i.code)} · ${esc(i.email)}</small><div class="actions-row" style="margin-top:12px">${i.registration_document?`<button class="btn small ghost js-proof" data-id="${esc(i.id)}">View proof</button>`:''}${i.status==='PENDING'?`<button class="btn small js-approve" data-id="${esc(i.id)}">Approve</button><button class="btn small ghost js-reject" data-id="${esc(i.id)}">Reject</button>`:''}</div><p class="muted" style="margin:12px 0 0">Click card → departments → students</p></article>`).join('') || '<div class="empty">No institutions registered.</div>'}
        </div>
      </section>
      <section class="panel" style="margin-top:18px"><h2>Student / certificate change requests</h2>
        ${r.data.requests.length ? r.data.requests.map(x=>`<div class="request"><b>${esc(x.certificate_id)}</b> · ${esc(x.institution_name)} · <span class="pill ${x.status==='APPROVED'?'good':x.status==='REJECTED'?'bad':'warn'}">${x.status}</span><p><b>Reason:</b> ${esc(x.reason)}</p><pre>Old: ${esc(JSON.stringify(x.old_data,null,2))}\nNew: ${esc(JSON.stringify(x.new_data,null,2))}</pre>${x.status==='PENDING'?`<button class="btn small js-change-approve" data-id="${esc(x.id)}">Approve</button> <button class="btn small ghost js-change-reject" data-id="${esc(x.id)}">Reject</button>`:`<p><b>Admin note:</b> ${esc(x.admin_note||'-')}</p>`}</div>`).join(''):'<div class="empty">No requests.</div>'}
      </section>`;

    $('#content').addEventListener('click', async e=>{
      const card=e.target.closest('.js-institution');
      const proof=e.target.closest('.js-proof');
      const approve=e.target.closest('.js-approve');
      const reject=e.target.closest('.js-reject');
      const ca=e.target.closest('.js-change-approve');
      const cr=e.target.closest('.js-change-reject');
      if(proof){e.stopPropagation();try{const r=await fetch(`/api/admin/institutions/${encodeURIComponent(proof.dataset.id)}/document`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error('Unable to open proof document.');const b=await r.blob();const u=URL.createObjectURL(b);window.open(u,'_blank');setTimeout(()=>URL.revokeObjectURL(u),60000)}catch(err){toast(err.message,'bad')}return;}
      if(approve){e.stopPropagation();if(!confirm('Approve this institution? They will be allowed to log in.'))return;approve.disabled=true;approve.textContent='Approving…';try{await api(`/api/admin/institutions/${encodeURIComponent(approve.dataset.id)}/approve`,{method:'POST'});toast('Institution approved.');await admin()}catch(err){approve.disabled=false;approve.textContent='Approve';toast(err.message,'bad')}return;}
      if(reject){e.stopPropagation();const note=prompt('Reason for rejection:');if(!note?.trim())return;reject.disabled=true;reject.textContent='Rejecting…';try{await api(`/api/admin/institutions/${encodeURIComponent(reject.dataset.id)}/reject`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note})});toast('Institution rejected.');await admin()}catch(err){reject.disabled=false;reject.textContent='Reject';toast(err.message,'bad')}return;}
      if(card){
        const id=card.dataset.id;
        try{
          const j=await api(`/api/admin/institutions/${encodeURIComponent(id)}/departments`);
          const instName=card.querySelector('strong')?.textContent||'Institution';
          $('#content').innerHTML=`<button class="btn small ghost js-back-admin">← All institutions</button><section class="panel" style="margin-top:18px"><div class="breadcrumb"><span>Institutions</span><span>›</span><b>${esc(instName)}</b></div><h2>${esc(instName)} — Departments</h2><p class="muted">Select a department to view only that institution's student records.</p><div class="drill-grid">${j.data.departments.map(d=>`<article class="drill-card js-admin-dept" data-id="${esc(id)}" data-department="${esc(d.department)}"><strong>${esc(d.department)}</strong><small>${d.students} students · ${d.certificates} certificates</small><p class="muted">View students →</p></article>`).join('')||'<div class="empty">No student departments found.</div>'}</div></section>`;
          $('.js-back-admin').onclick=admin;
          $('#content').addEventListener('click',async ev=>{
            const dept=ev.target.closest('.js-admin-dept'); if(!dept)return;
            try{
              const j2=await api(`/api/admin/institutions/${encodeURIComponent(dept.dataset.id)}/departments/${encodeURIComponent(dept.dataset.department)}/students`);
              const rows=j2.data.students.map(st=>`<tr><td><b>${esc(st.name)}</b><br><small>${esc(st.register_number)}</small></td><td>${esc(st.course)}</td><td>${esc(st.academic_year)}</td><td>${esc(st.email||'-')}</td><td>${st.certificates}</td><td>${(st.certificate_list||[]).map(c=>`<span class="pill ${c.status==='ACTIVE'?'good':'bad'}">${esc(c.certificateId)}</span>`).join(' ')||'-'}</td></tr>`).join('');
              $('#content').innerHTML=`<button class="btn small ghost js-back-dept">← Departments</button><section class="panel" style="margin-top:18px"><div class="breadcrumb"><span>Institutions</span><span>›</span><span>${esc(instName)}</span><span>›</span><b>${esc(j2.data.department)}</b></div><h2>Students — ${esc(j2.data.department)}</h2><p class="muted">Admin view of student details for the selected institution and department.</p><div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Course</th><th>Year</th><th>Email</th><th>Certificates</th><th>Certificate IDs</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">No students found.</td></tr>'}</tbody></table></div></section>`;
              $('.js-back-dept').onclick=()=>showAdminDepartments(id,instName);
            }catch(err){toast(err.message,'bad')}
          },{once:true});
        }catch(err){toast(err.message,'bad')}
        return;
      }
      if(ca||cr){const status=ca?'APPROVED':'REJECTED';let note='';if(status==='REJECTED'){note=prompt('Why is this change not approved?')||'';if(!note.trim())return}const btn=ca||cr;btn.disabled=true;try{await api(`/api/admin/change-requests/${encodeURIComponent(btn.dataset.id)}/review`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,note})});toast(status==='APPROVED'?'Change approved.':'Change rejected.');await admin()}catch(err){btn.disabled=false;toast(err.message,'bad')}}
    });
  } catch(err){$('#content').innerHTML=`<div class="result bad"><h3>Unable to load admin dashboard</h3><p>${esc(err.message)}</p><button class="btn small" onclick="location.reload()">Try again</button></div>`}
}

async function showAdminDepartments(id, instName){
  try{
    const j=await api(`/api/admin/institutions/${encodeURIComponent(id)}/departments`);
    $('#content').innerHTML=`<button class="btn small ghost js-back-admin">← All institutions</button><section class="panel" style="margin-top:18px"><div class="breadcrumb"><span>Institutions</span><span>›</span><b>${esc(instName)}</b></div><h2>${esc(instName)} — Departments</h2><p class="muted">Select a department to view students.</p><div class="drill-grid">${j.data.departments.map(d=>`<article class="drill-card js-admin-dept" data-id="${esc(id)}" data-department="${esc(d.department)}"><strong>${esc(d.department)}</strong><small>${d.students} students · ${d.certificates} certificates</small><p class="muted">View students →</p></article>`).join('')||'<div class="empty">No departments found.</div>'}</div></section>`;
    $('.js-back-admin').onclick=admin;
    document.querySelectorAll('.js-admin-dept').forEach(el=>el.onclick=async()=>{
      try{const j2=await api(`/api/admin/institutions/${encodeURIComponent(id)}/departments/${encodeURIComponent(el.dataset.department)}/students`);const rows=j2.data.students.map(st=>`<tr><td><b>${esc(st.name)}</b><br><small>${esc(st.register_number)}</small></td><td>${esc(st.course)}</td><td>${esc(st.academic_year)}</td><td>${esc(st.email||'-')}</td><td>${st.certificates}</td><td>${(st.certificate_list||[]).map(c=>`<span class="pill ${c.status==='ACTIVE'?'good':'bad'}">${esc(c.certificateId)}</span>`).join(' ')||'-'}</td></tr>`).join('');$('#content').innerHTML=`<button class="btn small ghost js-back-dept">← Departments</button><section class="panel" style="margin-top:18px"><div class="breadcrumb"><span>Institutions</span><span>›</span><span>${esc(instName)}</span><span>›</span><b>${esc(j2.data.department)}</b></div><h2>Students — ${esc(j2.data.department)}</h2><div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Course</th><th>Year</th><th>Email</th><th>Certificates</th><th>Certificate IDs</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">No students found.</td></tr>'}</tbody></table></div></section>`;$('.js-back-dept').onclick=()=>showAdminDepartments(id,instName)}catch(err){toast(err.message,'bad')}});
  }catch(err){toast(err.message,'bad')}
}

(user.role === 'ADMIN' ? admin : institution)();
