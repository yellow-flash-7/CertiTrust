const $=s=>document.querySelector(s);
function showResult(el,data){
  el.hidden=false;
  const bad=['NOT_FOUND','HASH_MISMATCH','REVOKED'].includes(data.status);
  el.className='result '+(data.status==='VERIFIED'?'good':bad?'bad':'');
  if(data.status==='VERIFIED'){
    const d=data.details;
    el.innerHTML=`<div class="verify-banner good"><span class="verify-icon">✓</span><div><strong>Certificate verified</strong><p>${esc(data.message||'This certificate is active and matches the trusted record.')}</p></div></div><dl><dt>Student</dt><dd>${esc(d.studentName)}</dd><dt>Register No.</dt><dd>${esc(d.registerNumber)}</dd><dt>Institution</dt><dd>${esc(d.institutionName)}</dd><dt>Course</dt><dd>${esc(d.course)}</dd><dt>Department</dt><dd>${esc(d.department)}</dd><dt>Academic Year</dt><dd>${esc(d.academicYear)}</dd><dt>Issue Date</dt><dd>${esc(d.issueDate)}</dd><dt>Grade / CGPA</dt><dd>${esc(d.grade||'-')} / ${esc(d.cgpa||'-')}</dd><dt>SHA-256</dt><dd style="word-break:break-all">${esc(data.integrity?.sha256||data.integrity?.storedHash||'Not supplied')}</dd></dl>`;
    return;
  }
  if(data.status==='NOT_FOUND'){
    el.innerHTML=`<div class="verify-banner bad"><span class="verify-icon">!</span><div><strong>Certificate not found</strong><p>No matching certificate exists in the trusted CertiTrust registry.</p></div></div>`;
    return;
  }
  const ai=data.ai||{};
  const aiHtml=ai.status==='OK'?`<div class="ai-card"><div class="ai-head"><span>🤖 AI-assisted tampering analysis</span><span class="pill ${ai.risk==='HIGH'?'bad':'good'}">${esc(ai.risk||'LOW')} RISK</span></div><p>${esc(ai.message||'Visual comparison completed.')}</p><div class="ai-metrics"><div><small>Confidence</small><strong>${esc(ai.confidence??'-')}%</strong></div><div><small>Changed regions</small><strong>${esc(ai.changedRegions?.length??0)}</strong></div></div>${ai.annotatedImage?`<div class="tamper-image-wrap"><img class="tamper-image" src="${ai.annotatedImage}" alt="Uploaded certificate with suspected changed regions highlighted in red"><span class="image-caption">Red boxes indicate areas that require review.</span></div>`:''}</div>`:`<div class="ai-card muted"><div class="ai-head"><span>🤖 AI-assisted analysis</span><span class="pill warn">${esc(ai.status||'UNAVAILABLE')}</span></div><p>${esc(ai.message||'Visual analysis was not available.')}</p></div>`;
  const integrity=data.integrity||{};
  el.innerHTML=`<div class="verify-banner bad"><span class="verify-icon">✕</span><div><strong>Certificate tampering / mismatch detected</strong><p>${esc(data.message||'The uploaded document does not match the trusted original.')}</p></div></div><div class="security-grid"><div><small>SHA-256 result</small><strong>❌ Mismatch</strong></div><div><small>Certificate details</small><strong>🔒 Hidden</strong></div></div><div class="hash-compare"><div><small>Trusted SHA-256</small><code>${esc(integrity.storedHash||'Not available')}</code></div><div><small>Uploaded SHA-256</small><code>${esc(integrity.sha256||'Not available')}</code></div></div>${aiHtml}`;
}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
const params=new URLSearchParams(location.search);if(params.get('verify'))$('#certificateId').value=params.get('verify');
$('#verifyForm')?.addEventListener('submit',async e=>{e.preventDefault();const id=$('#certificateId').value.trim();const el=$('#result');el.hidden=false;el.innerHTML='Checking…';try{const r=await fetch('/api/verify/'+encodeURIComponent(id));const j=await r.json();showResult(el,j.data)}catch{el.innerHTML='Unable to contact the server.'}});
$('#hashForm')?.addEventListener('submit',async e=>{e.preventDefault();const el=$('#hashResult');el.hidden=false;el.innerHTML='Calculating SHA-256 and comparing…';const fd=new FormData();fd.append('certificateId',$('#hashCertificateId').value.trim());fd.append('document',$('#document').files[0]);try{const r=await fetch('/api/verify/upload',{method:'POST',body:fd});const j=await r.json();showResult(el,j.data)}catch{el.innerHTML='Unable to contact the server.'}});
$('#menuBtn')?.addEventListener('click',()=>document.querySelector('.nav nav')?.classList.toggle('open'));
