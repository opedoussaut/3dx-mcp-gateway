async function call(path, options={}) {
  const r = await fetch(path, options);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}
const out=(id,v)=>document.getElementById(id).textContent=JSON.stringify(v,null,2);
async function refresh(){ out("audit", await call("/api/audit")); }
out("status", await call("/api/status"));
document.querySelector('[data-action="discover"]').onclick=async()=>{try{out("discover",await call("/api/discover",{method:"POST"}));await refresh()}catch(e){out("discover",{error:e.message})}};
document.querySelector('[data-action="probe"]').onclick=async()=>{try{out("probe",await call("/api/read/roots-v4",{method:"POST"}));await refresh()}catch(e){out("probe",{error:e.message})}};
document.querySelector('[data-action="refresh"]').onclick=refresh;
await refresh();
