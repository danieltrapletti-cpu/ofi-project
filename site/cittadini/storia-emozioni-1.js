/* OFI · Storia delle emozioni (modale scelta frasi)
   Unico file: inietta CSS+HTML e fornisce API globale window.StoriaEmozioni
   Dipendenze: Firebase già inizializzato nella pagina.
*/
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, where, orderBy, limit, getDocs, doc, updateDoc,
  setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const app  = getApp();
const db   = getFirestore(app);
const auth = getAuth(app);
let fns    = null;
try { fns = getFunctions(app); } catch(_) {}

/* ---------- CSS + HTML template (iniettati una sola volta) ---------- */
(function injectOnce(){
  if (document.getElementById('se-style')) return;
  const css = document.createElement('style');
  css.id = 'se-style';
  css.textContent = `
  .se-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.42);backdrop-filter:saturate(120%) blur(2px);display:flex;align-items:center;justify-content:center;z-index:2147483000}
  .se-panel{width:min(680px,96vw);max-height:86vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 20px 48px rgba(0,0,0,.28)}
  .se-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 10px;border-bottom:1px solid rgba(0,0,0,.06)}
  .se-title{display:flex;align-items:center;gap:8px;font:600 16px/1.2 'Noto Serif',serif;color:#0e2a4a}
  .se-title img{width:16px;height:16px;opacity:.95}
  .se-close{border:0;background:transparent;font-size:20px;line-height:1;cursor:pointer;padding:6px 8px;border-radius:10px}
  .se-close:hover{background:rgba(0,0,0,.06)}
  .se-body{padding:12px 16px}
  .se-note{margin:0 0 10px;color:#444;font-size:.95rem}
  .se-list{display:grid;gap:10px}
  .se-item{border:1px solid rgba(0,0,0,.08);border-radius:14px;padding:10px 12px;background:#fff}
  .se-text{margin:0 0 8px;font-style:italic;font-family:"EB Garamond",serif;font-size:1.02rem}
  .se-actions{display:flex;gap:8px;flex-wrap:wrap}
  .se-btn{cursor:pointer;border:1px solid rgba(0,0,0,.14);background:#fff;padding:.55rem .85rem;border-radius:10px}
  .se-btn.primary{background:#0e2a4a;color:#fff;border-color:#0e2a4a}
  .se-btn.destructive{border-color:#e0b3b3;background:#fff0f0}
  .se-row{display:flex;justify-content:space-between;align-items:center;margin-top:10px}
  .se-foot{display:flex;justify-content:space-between;align-items:center;padding:10px 16px 14px;border-top:1px solid rgba(0,0,0,.06)}
  .se-badge{display:inline-flex;align-items:center;gap:6px;border:1px dashed #caa85a;background:rgba(202,168,90,.08);padding:.35rem .6rem;border-radius:999px;font-size:.86rem}
  .se-mini{display:inline-flex;gap:6px;align-items:center;color:#0e2a4a}
  .se-mini img{width:14px;height:14px}
  /* bottone badge in card */
  .se-badge-btn{display:inline-flex;gap:6px;align-items:center;margin-top:.45rem;border:1px dashed #caa85a;background:#fffbea;color:#0e2a4a;border-radius:999px;padding:.35rem .6rem;font-size:.84rem;cursor:pointer}
  .se-badge-btn img{width:14px;height:14px}
  @media (prefers-color-scheme: dark){
    .se-panel{background:#fff} /* card chiara anche in dark per continuità tipografica */
  }`;
  document.head.appendChild(css);

  const tpl = document.createElement('template');
  tpl.id = 'se-modal-tpl';
  tpl.innerHTML = `
    <div class="se-backdrop" role="dialog" aria-modal="true" aria-label="Storia dell’autore">
      <div class="se-panel">
        <div class="se-head">
          <div class="se-title"><img src="../images/pensieri-logo.png" alt=""><span>Storia dell’autore</span></div>
          <button class="se-close" aria-label="Chiudi">×</button>
        </div>
        <div class="se-body">
          <p class="se-note">Scegli la riflessione che senti tua. La firma sarà solo la rosa di OFI.</p>
          <div class="se-list"></div>
        </div>
        <div class="se-foot">
          <span class="se-badge"><img src="../images/pensieri-logo.png" alt="" width="14" height="14"> Mostrata solo nella tua pagina Autore pubblico</span>
          <div>
            <button class="se-btn" data-act="reject-all">Rifiuta tutte</button>
            <button class="se-btn primary" data-act="regenerate">Rigenera</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(tpl);
})();

/* ---------- Utils ---------- */
const sleep = ms => new Promise(r=>setTimeout(r,ms));
function toast(msg){
  // mini-toast non invasivo
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style, {
    position:'fixed', bottom:'18px', left:'50%', transform:'translateX(-50%)',
    background:'rgba(14,42,74,.96)', color:'#fff', padding:'10px 14px',
    borderRadius:'10px', zIndex:2147483001, boxShadow:'0 8px 20px rgba(0,0,0,.25)'
  });
  document.body.appendChild(el);
  setTimeout(()=> el.remove(), 1500);
}

/* ---------- Data layer ---------- */
async function listDrafts(postId){
  const col = collection(db, `pensieri_utente/${postId}/emozioni_cronaca`);
  const s = await getDocs(query(col, where('status','==','draft'), orderBy('createdAt','desc'), limit(5)));
  return s.docs.map(d=>({ id:d.id, ...d.data() }));
}
async function listApproved(postId){
  const col = collection(db, `pensieri_utente/${postId}/emozioni_cronaca`);
  const s = await getDocs(query(col, where('status','==','approved'), orderBy('updatedAt','desc'), limit(1)));
  return s.empty ? null : { id:s.docs[0].id, ...s.docs[0].data() };
}

async function callOrFallback(name, payload, fallback){
  if (!fns) return fallback();
  try{
    const fn = httpsCallable(fns, name);
    await fn(payload);
  }catch(e){
    // se la callable non esiste, usa fallback locale
    await fallback();
  }
}

async function approve(postId, riflId){
  await callOrFallback('approveRiflessione', { postId, riflId }, async ()=>{
    // fallback: set approved e reject altre
    const col = collection(db, `pensieri_utente/${postId}/emozioni_cronaca`);
    const s = await getDocs(col);
    const updates = s.docs.map(async d=>{
      const status = (d.id===riflId) ? 'approved' : 'rejected';
      await updateDoc(doc(db, `pensieri_utente/${postId}/emozioni_cronaca/${d.id}`), {
        status, updatedAt: serverTimestamp()
      });
    });
    await Promise.all(updates);
  });
}

async function rejectAll(postId){
  await callOrFallback('rejectAllRiflessioni', { postId }, async ()=>{
    const col = collection(db, `pensieri_utente/${postId}/emozioni_cronaca`);
    const s = await getDocs(query(col, where('status','in',['draft','approved'])));
    await Promise.all(s.docs.map(d=> updateDoc(d.ref, { status:'rejected', updatedAt:serverTimestamp() })));
  });
}

async function regenerate(postId){
  await callOrFallback('regenerateRiflessioni', { postId }, async ()=>{
    // fallback "placeholder": duplica le prime 2 bozze variando poco
    const drafts = await listDrafts(postId);
    const base = drafts[0]?.text || "Una luce sottile attraversa queste parole, e tiene il filo.";
    const alt1 = base.replace("sottile","quieta");
    const alt2 = base.replace("parole","righe");
    const col = collection(db, `pensieri_utente/${postId}/emozioni_cronaca`);
    const payloads = [alt1, alt2].map((text,i)=> setDoc(doc(col), {
      text, status:'draft', variant_index:i, createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    }));
    await Promise.all(payloads);
  });
}

/* ---------- UI ---------- */
function buildItem(postId, record){
  const it = document.createElement('div');
  it.className = 'se-item';
  it.innerHTML = `
    <p class="se-text">${(record.text||'').replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]))}</p>
    <div class="se-actions">
      <button class="se-btn primary" data-approve="${record.id}">Accetta</button>
      <button class="se-btn" data-regenerate>Voglio altre proposte</button>
    </div>`;
  it.addEventListener('click', async (e)=>{
    const a = e.target.closest('[data-approve]');
    const r = e.target.closest('[data-regenerate]');
    if (a){
      await approve(postId, a.dataset.approve);
      toast('Riflessione approvata');
      closeModal(it.closest('.se-backdrop'));
    }else if (r){
      await regenerate(postId);
      toast('Nuove proposte in arrivo…');
      // refresh lista
      await sleep(500);
      const cont = it.closest('.se-backdrop').querySelector('.se-list');
      cont.replaceChildren(...await buildList(postId));
    }
  });
  return it;
}

async function buildList(postId){
  const out = [];
  const approved = await listApproved(postId);
  if (approved){
    const info = document.createElement('div');
    info.className = 'se-item';
    info.innerHTML = `
      <div class="se-row">
        <div class="se-mini"><img src="../images/pensieri-logo.png" alt=""> <strong>Riflessione attiva</strong></div>
        <button class="se-btn" data-change>Cambia</button>
      </div>
      <p class="se-text" style="margin-top:6px">${approved.text.replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]))}</p>`;
    info.addEventListener('click', async (e)=>{
      if (e.target.closest('[data-change]')){
        // mostra bozze disponibili
        const cont = info.parentElement;
        cont.replaceChildren(...await buildDrafts(postId));
      }
    });
    out.push(info);
  } else {
    const drafts = await buildDrafts(postId);
    if (drafts.length) out.push(...drafts);
    else {
      const empty = document.createElement('div');
      empty.className='se-item';
      empty.innerHTML = `<p class="se-text">Sto preparando le riflessioni… torna tra poco.</p>`;
      out.push(empty);
    }
  }
  return out;
}

async function buildDrafts(postId){
  const ds = await listDrafts(postId);
  return ds.map(d => buildItem(postId, d));
}

function openModal(postId){
  const tpl = document.getElementById('se-modal-tpl');
  const node = tpl.content.cloneNode(true);
  const modal = node.querySelector('.se-backdrop');
  const list  = node.querySelector('.se-list');

  // footer buttons
  modal.querySelector('.se-close').onclick = ()=> closeModal(modal);
  modal.querySelector('[data-act="reject-all"]').onclick = async ()=>{ await rejectAll(postId); toast('Nessuna riflessione verrà mostrata'); closeModal(modal); };
  modal.querySelector('[data-act="regenerate"]').onclick = async ()=>{ await regenerate(postId); toast('Nuove proposte in arrivo…'); list.replaceChildren(...await buildList(postId)); };

  // render items
  (async()=>{ list.replaceChildren(...await buildList(postId)); })();

  document.body.appendChild(node);
  // esc
  const esc = (e)=>{ if(e.key==='Escape') closeModal(modal); };
  setTimeout(()=> document.addEventListener('keydown', esc), 0);
  modal.addEventListener('remove', ()=> document.removeEventListener('keydown', esc), {once:true});
}
function closeModal(modal){
  if (!modal) return;
  modal.remove();
}

/* ---------- Public API ---------- */
window.StoriaEmozioni = {
  /** Apre la modale per il post indicato */
  async prompt(postId){
    // se non ci sono bozze né approved, prova a rigenerare (solo se pubblico)
    const drafts = await listDrafts(postId);
    const hasApproved = !!(await listApproved(postId));
    if (!drafts.length && !hasApproved){
      await regenerate(postId); // se callable non c'è, usa fallback
      await sleep(400);
    }
    openModal(postId);
  },

  /** Aggiunge un piccolo badge "Storia dell’autore" nella card del post pubblico */
  badgeFor(postBoxEl){
    if (!postBoxEl || postBoxEl.dataset.vis!=="pubblico") return;
    if (postBoxEl.querySelector('.se-badge-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'se-badge-btn';
    btn.innerHTML = `<img src="../images/pensieri-logo.png" alt=""> <span>Storia dell’autore</span>`;
    btn.addEventListener('click', ()=> this.prompt(postBoxEl.dataset.pid));
    // prova ad appendere vicino ad azioni o sotto testo
    const spot = postBoxEl.querySelector('.actions-row') || postBoxEl;
    spot.appendChild(btn);
  }
};
