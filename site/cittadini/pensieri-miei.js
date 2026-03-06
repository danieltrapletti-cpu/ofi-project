/* pensieri-miei.js — OFI
   Bacheca personale con:
   - paginazione
   - commenti/reazioni
   - Lumina
   - poster video
   - Storia delle Emozioni (lettura; quick-add in publish + prompt su nuovo post)
   Nota: l'app Firebase è già inizializzata nell'HTML.
*/

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, where, orderBy, getDocs, getDoc, doc, limit,
  addDoc, serverTimestamp, updateDoc, setDoc, startAfter, getCountFromServer, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ➜ Storia-Emozioni (LETTURA + stile)
import { maybeInsertEmotion, injectEmotionStyles, refreshEmotionForPost } from "./storia-emozioni.js";
injectEmotionStyles(); // una sola volta
installFeedEmotionGuard(); // << AGGIUNGI QUESTA RIGA

function installFeedEmotionGuard(){
  if (document.getElementById('ofi-emo-feed-guard')) return;
  const st = document.createElement('style');
  st.id = 'ofi-emo-feed-guard';
  st.textContent = `
    /* Bacheca: mai mostrare la card emozione DENTRO la pensiero-box */
    .post .pensiero-box .ofi-emozione { display: none !important; }
  `;
  document.head.appendChild(st);
}

// Flag per non riaprire il dialogo alla seconda/terza volta sullo stesso post (prima pubblicazione)
const wasEmotionAsked  = (pid)=> localStorage.getItem(`ofi-emo-first:${pid}`) === '1';
const markEmotionAsked = (pid)=> localStorage.setItem(`ofi-emo-first:${pid}`, '1');

/* ===== Helpers ===== */
const $  = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const clamp100 = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const escapeHtml = (s) =>
  (s ?? "")
    .toString()
    .replace(/[&<>"]/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[m]));
const levelFromScore = (s) => (s<=15?0:s<=35?1:s<=55?2:s<=75?3:s<=90?4:5);

function fmtDate(d){
  const dd = new Date(d);
  return new Intl.DateTimeFormat('it-IT',{dateStyle:'medium', timeStyle:'short'}).format(dd);
}

// piccolo helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// URL params helpers
function getNewPostIdFromURL(){
  const p = new URLSearchParams(location.search);
  return p.get('newPostId') || null;
}
function removeQueryParam(key){
  const u = new URL(location.href);
  u.searchParams.delete(key);
  history.replaceState({}, '', u.toString());
}

// Attende che la card del post sia presente in DOM (max ~3s)
async function waitForPostBox(pid, timeoutMs = 3000){
  const start = Date.now();
  return new Promise(resolve=>{
    (function tryFind(){
      const box = document.querySelector(`.pensiero-box[data-pid="${pid}"], .pensiero-box[data-post-id="${pid}"]`);
      if (box) return resolve(box);
      if (Date.now() - start > timeoutMs) return resolve(null);
      requestAnimationFrame(tryFind);
    })();
  });
}

const OFI_W = { cuore:3, luce:2, colomba:5, rosa:4, commento:6 };
const OFI_K = 120;
const VIDEO_POSTER_FALLBACK = "../images/video-poster-generic.jpg";

/* ===== Firebase ===== */
const app  = getApp();
const auth = getAuth(app);
const db   = getFirestore(app);

/* ===== DOM Refs ===== */
const lista        = $("listaPensieri");
const skeletons    = $("skeletons");
const shTot        = $("shTot");
const shPub        = $("shPub");
const shLumina     = $("shLumina");
const kpiTot       = $("kpiTot");
const kpiPub       = $("kpiPub");
const shareBacheca = $("shareBacheca");
const copyPublicLinkBtn = $("copyPublicLinkBtn");

/* ===== State ===== */
let allPosts = [];
let visiblePosts = [];
let __ofiLastDoc = null;
let __ofiHasMore = false;
let __ofiIsLoading = false;
const __PAGE_SIZE = 8;

/* ===== Skeletons ===== */
function showSkeleton(n=3){
  skeletons.innerHTML = "";
  for (let i=0;i<n;i++){
    const sk = document.createElement("div");
    sk.className="skeleton";
    sk.innerHTML = `<div class="sk-line big"></div><div class="sk-line"></div><div class="sk-line"></div>`;
    skeletons.appendChild(sk);
  }
}
function hideSkeleton(){ skeletons.innerHTML=""; }

/* ===== KPI ===== */
function refreshKpi(){
  const tot = allPosts.length;
  const pub = allPosts.filter(p=> (p.visibilita||"") === "pubblico").length;
  const luminaSum = allPosts.reduce((acc,p)=> acc + (Number(p.lumina_score ?? p.lumina_progress ?? 0)), 0);
  const luminaAvg = tot ? Math.round(luminaSum / tot) : 0;
  if (kpiTot) kpiTot.textContent = String(tot);
  if (kpiPub) kpiPub.textContent = String(pub);
  if (shTot) shTot.textContent = String(tot);
  if (shPub) shPub.textContent = String(pub);
  if (shLumina) shLumina.textContent = String(luminaAvg);
}

// ➜ KPI reali via Firestore (indipendenti dalla paginazione)
async function fetchCountsForUser(uid){
  const base = collection(db, "pensieri_utente");
  const qTot = query(base, where('uid','==',uid));
  const qPub = query(base, where('uid','==',uid), where('visibilita','==','pubblico'));
  const [totSnap, pubSnap] = await Promise.all([
    getCountFromServer(qTot).catch(()=>null),
    getCountFromServer(qPub).catch(()=>null)
  ]);
  return {
    tot: totSnap ? totSnap.data().count : allPosts.length,
    pub: pubSnap ? pubSnap.data().count : allPosts.filter(p => (p.visibilita||'')==='pubblico').length
  };
}
async function refreshKpiFromServer(){
  try{
    const uid = auth.currentUser?.uid; if(!uid) return;
    const { tot, pub } = await fetchCountsForUser(uid);
    if (kpiTot) kpiTot.textContent = String(tot);
    if (kpiPub) kpiPub.textContent = String(pub);
    if (shTot)  shTot.textContent  = String(tot);
    if (shPub)  shPub.textContent  = String(pub);
  }catch{}
}

/* ===== LUMINA ===== */
function computeCrescita(p){
  const r=p.reazioni||{};
  const hearts=+ (r.cuore||0); const stars=+ (r.luce||0);
  const doves=+ (r.colomba||0); const roses=+ (r.rosa||0);
  const comm=+ (p.commenti_count || p.commenti_totali || 0);
  const eng = hearts*OFI_W.cuore + stars*OFI_W.luce + doves*OFI_W.colomba + roses*OFI_W.rosa + comm*OFI_W.commento;
  const score = 100 * (1 - Math.exp(-(eng)/OFI_K));
  return clamp100(score);
}
function renderLuminaRing(el, pctRaw){
  const pct=clamp100(pctRaw||0);
  el.style.setProperty('--p', pct);
  const pctEl = el.querySelector('.pct'); if (pctEl) pctEl.textContent = String(Math.round(pct));
}

/* ===== Media builder ===== */
function buildMediaNode(p){
  const url=p?.media||p?.cover_url||"";
  if(!url) return null;
  const type=(p?.mediaType||"").toLowerCase()||(/\.(mp4|webm|ogg)(\?|$)/i.test(url)?"video":"image");
  const poster=p?.poster_url||VIDEO_POSTER_FALLBACK;
  const wrap=document.createElement('div'); wrap.className='media'; wrap.dataset.media=type;
  if (type==='video'){
    wrap.innerHTML=`<video controls playsinline preload="metadata" poster="${poster}" src="${url}"><source src="${url}"></video>`;
  } else {
    wrap.innerHTML=`<img alt="" src="${url}">`;
  }
  return wrap;
}

/* ===== Modale “Storia dell’autore” (wow) ===== */
function openEmotionQuickDialog({ onSave, onSkip }){
  // CSS mobile-first + animazione
  const css = `
  .ofi-emo-overlay{position:fixed;inset:0;z-index:9999;display:grid;place-items:center}
  .ofi-emo-overlay .mv-backdrop{position:absolute;inset:0;background:rgba(10,14,22,.55);backdrop-filter:blur(3px);opacity:0;animation:emoFade .18s ease-out forwards}
  .ofi-emo-overlay .mv-dialog{
    position:relative;background:var(--card, #0f1422);color:#f6f7fb;border-radius:20px;
    border:1px solid rgba(255,255,255,.08);box-shadow:0 12px 44px rgba(0,0,0,.45);
    width:min(720px,96vw);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;
    transform:translateY(12px);opacity:.0;animation:emoRise .2s ease-out forwards
  }
  .ofi-emo-overlay .mv-scroll{padding:20px 18px 12px;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
  .ofi-emo-overlay .mv-footer{display:flex;gap:.6rem;justify-content:flex-end;padding:12px 16px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.18)}
  .ofi-emo-overlay .mv-close{position:absolute;top:8px;right:10px;border:0;background:transparent;width:40px;height:40px;border-radius:50%;font-size:22px;color:#fff;opacity:.85}
  .ofi-emo-overlay .mv-head{display:flex;align-items:center;gap:.75rem;margin-bottom:.25rem}
  .ofi-emo-overlay .mv-logo{width:30px;height:30px;object-fit:contain;filter:drop-shadow(0 0 6px rgba(255,215,0,.25))}
  .ofi-emo-overlay h3{margin:0;font-size:1.25rem;letter-spacing:.2px}
  .ofi-emo-overlay .sub{opacity:.85;margin:.35rem 0 .6rem}
  .ofi-emo-overlay .chips{display:flex;flex-wrap:wrap;gap:.45rem;margin:.5rem 0 .75rem}
  .ofi-emo-overlay .chip{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:.55rem .85rem;font-size:1rem}
  .ofi-emo-overlay .chip:active,.ofi-emo-overlay .chip:hover{transform:translateY(-1px);border-color:rgba(255,215,0,.55)}
  .ofi-emo-overlay textarea.input{width:100%;border-radius:14px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.28);color:inherit;padding:.8rem .9rem;min-height:120px;font-size:1rem}
  .ofi-emo-overlay label.small{font-size:1rem;opacity:.95;display:flex;gap:.6rem;align-items:flex-start;margin-top:.7rem}
  .ofi-emo-overlay .btn{border-radius:12px;border:1px solid rgba(255,255,255,.22);background:transparent;color:#fff;padding:.65rem 1rem;font-size:1rem}
  .ofi-emo-overlay .btn.primary{background:linear-gradient(180deg,#f6d26b,#d8b556);color:#1b2130;border:none}
  .ofi-emo-overlay .btn.outline{background:transparent;border-color:rgba(255,255,255,.3)}
  .ofi-emo-toast{position:fixed;right:16px;bottom:16px;z-index:10000;background:#0f1727;color:#fff;border:1px solid rgba(255,255,255,.12);padding:.7rem .9rem;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
  @keyframes emoRise{to{opacity:1;transform:translateY(0)}}
  @keyframes emoFade{to{opacity:1}}
  @media (max-height:700px){
    .ofi-emo-overlay .mv-dialog{width:100vw;max-height:100vh;border-radius:16px 16px 0 0}
  }`;
  const styleId = "ofi-emo-style";
  if (!document.getElementById(styleId)){
    const st = document.createElement('style'); st.id=styleId; st.textContent = css; document.head.appendChild(st);
  }

  // ---- blocco scroll senza "jump" (no reset top) ----
  let scrollY = window.scrollY;
  document.body.dataset.scrollY = String(scrollY);
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';

  const overlay = document.createElement('div');
  overlay.className = 'ofi-emo-overlay';
  overlay.innerHTML = `
    <div class="mv-backdrop"></div>
    <div class="mv-dialog" role="dialog" aria-modal="true">
      <button class="mv-close" type="button" title="Chiudi" aria-label="Chiudi">×</button>
      <div class="mv-scroll">
        <div class="mv-head">
          <img src="../images/pensieri-logo.png" class="mv-logo" alt="">
          <div>
            <h3>Aggiungi una riflessione?</h3>
            <div class="sub">Facoltativa. Può apparire nella tua pagina autore come <strong>Storia dell’autore</strong>.</div>
          </div>
        </div>

        <div class="chips">
          ${[
            "Vorrei ricordare…","In questo momento sento…","Se potessi parlare a me stesso di allora…",
            "Mi manca…","Oggi ho capito che…","Una cosa che non ho mai detto…",
            "Porto con me…","Un gesto che non dimentico…","Un pensiero di gratitudine…",
            "Una luce che mi accompagna…","Quando chiudo gli occhi rivedo…","Se potessi abbracciare quel momento…"
          ].map(t=>`<button type="button" class="chip" data-s="${t}">${t}</button>`).join('')}
        </div>

        <textarea id="emoTxt" class="input" rows="5" placeholder="Scrivi qui, se vuoi…"></textarea>

        <label class="small">
          <input type="checkbox" id="emoAsPublic" checked />
          <span>Mostra pubblicamente nella mia pagina autore</span>
        </label>
      </div>

      <div class="mv-footer">
        <button class="btn outline" id="emoSkip" type="button">Salta</button>
        <button class="btn primary" id="emoSave" type="button">Salva</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const close = ()=>{
    overlay.remove();
    const y = parseInt(document.body.dataset.scrollY||'0', 10);
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    delete document.body.dataset.scrollY;
    window.scrollTo(0, y);
  };

  overlay.querySelectorAll('.chip').forEach(b=>{
    b.addEventListener('click', ()=> {
      const ta = overlay.querySelector('#emoTxt');
      const t = b.getAttribute('data-s') || '';
      ta.value = t + (ta.value ? ' ' + ta.value : '');
      ta.focus();
    });
  });

  overlay.querySelector('.mv-close').addEventListener('click', ()=>{ close(); onSkip?.(); });
  overlay.querySelector('.mv-backdrop').addEventListener('click', ()=>{ close(); onSkip?.(); });
  overlay.querySelector('#emoSkip').addEventListener('click', ()=>{ close(); onSkip?.(); });
  overlay.querySelector('#emoSave').addEventListener('click', ()=> {
    const text = (overlay.querySelector('#emoTxt').value||"").trim();
    const makePublic = !!overlay.querySelector('#emoAsPublic').checked;
    close();
    onSave?.({ text, makePublic });
  });
}

// 1) Prende l'ultima emozione (tollerante, senza indici compositi)
async function fetchLatestEmotionDoc(postId){
  const colRef = collection(db, `pensieri_utente/${postId}/emozioni_cronaca`);

  try{
    const s = await getDocs(query(colRef,
      where('state','==','live'),
      orderBy('updatedAt','desc'),
      limit(1)
    ));
    if (!s.empty) {
      const d = s.docs[0];
      return { id: d.id, ...d.data(), _ref: d.ref };
    }
  }catch(e){
    console.debug('fetchLatestEmotionDoc: fallback senza indice', e?.code || e);
  }

  try{
    const s = await getDocs(query(colRef, orderBy('updatedAt','desc'), limit(1)));
    if (!s.empty) {
      const d = s.docs[0];
      return { id: d.id, ...d.data(), _ref: d.ref };
    }
  }catch{}

  try{
    const s = await getDocs(query(colRef, limit(1)));
    if (!s.empty) {
      const d = s.docs[0];
      return { id: d.id, ...d.data(), _ref: d.ref };
    }
  }catch{}

  return null;
}

// 2) Elimina (con fallback preview e UI sempre aggiornata)
async function deleteEmotionForPost(postId){
  try{
    const emo = await fetchLatestEmotionDoc(postId);
    if (emo){ await deleteDoc(emo._ref); }
  }catch(e){
    console.warn('deleteEmotionForPost: errore nel deleteDoc (ignoro e continuo)', e);
  }
  try{
    await updateDoc(doc(db,'pensieri_utente', postId), {
      riflessione_preview: '',
      updatedAt: serverTimestamp()
    });
  }catch(e){
    console.warn('deleteEmotionForPost: impossibile pulire preview (regole?)', e);
  }
  return true;
}

// Upsert dell'ultima emozione per un post (crea se manca, altrimenti aggiorna)
async function editEmotionForPost(postId, { text, makePublic }) {
  const scope = makePublic ? 'public' : 'private';
  const colRef = collection(db, `pensieri_utente/${postId}/emozioni_cronaca`);

  let current = null;
  try {
    const s = await getDocs(query(colRef, where('state','==','live'), orderBy('updatedAt','desc'), limit(1)));
    if (!s.empty) current = { id:s.docs[0].id, ref:s.docs[0].ref };
  } catch (_) {
    try {
      const s = await getDocs(query(colRef, orderBy('updatedAt','desc'), limit(1)));
      if (!s.empty) current = { id:s.docs[0].id, ref:s.docs[0].ref };
    } catch (_) {}
  }

  if (current?.ref) {
    await updateDoc(current.ref, {
      text: String(text || '').trim(),
      scope,
      state: 'live',
      updatedAt: serverTimestamp()
    });
  } else {
    await addDoc(colRef, {
      text: String(text || '').trim(),
      scope,
      state: 'live',
      uid: (auth?.currentUser?.uid || ''),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  try {
    await updateDoc(doc(db, 'pensieri_utente', postId), {
      riflessione_preview: String(text || '').trim().slice(0, 240),
      updatedAt: serverTimestamp()
    });
  } catch (e) {
    console.warn('editEmotionForPost: impossibile aggiornare preview (regole?)', e);
  }

  // Notifica istantanea al DOM
  document.dispatchEvent(new CustomEvent("ofi:emotion-updated", {
    detail: {
      postId,
      text: String(text || '').trim(),
      label: "Storia dell’autore"
    }
  }));

  return true;
}

/* ===== Bottoni azione sulla card Emozione (kebab menu) + chip add ===== */
function ensureEmotionActionStyles(){
  if (document.getElementById('ofi-emo-actions-style')) return;
  const css = `
  .ofi-emozione{ position: relative; }
  .ofi-emo-kebab{
    position:absolute; top:8px; right:8px; width:36px; height:36px; border-radius:50%;
    border:1px solid rgba(255,255,255,.18); background:rgba(16,20,32,.55); color:#fff;
    display:grid; place-items:center; cursor:pointer; backdrop-filter:blur(4px);
  }
  [data-theme="light"] .ofi-emo-kebab{ background:rgba(255,255,255,.85); color:#111; border-color:rgba(0,0,0,.1); }
  .ofi-emo-menu{
    position:absolute; top:46px; right:8px; min-width:160px; z-index:10;
    background:var(--card,#0f1422); color:#fff; border:1px solid rgba(255,255,255,.12);
    border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,.35); overflow:hidden;
  }
  [data-theme="light"] .ofi-emo-menu{ background:#fff; color:#111; border-color:rgba(0,0,0,.08); }
  .ofi-emo-menu button{
    display:block; width:100%; text-align:left; padding:.6rem .8rem; background:transparent; border:0; font-size:.95rem;
  }
  .ofi-emo-menu button:hover{ background:rgba(255,255,255,.08); }

  .emo-add-chip{
    border:1px dashed rgba(255,255,255,.25);
    background:transparent; color:inherit;
    padding:.35rem .55rem; border-radius:999px; font-size:.9rem; opacity:.85;
  }
  [data-theme="light"] .emo-add-chip{ border-color: rgba(0,0,0,.25); }

  @media (max-width:640px){
    .ofi-emo-kebab{ width:32px; height:32px; top:6px; right:6px; }
    .emo-add-chip{ font-size:.85rem; padding:.3rem .5rem; }
  }`;
  const st = document.createElement('style');
  st.id = 'ofi-emo-actions-style';
  st.textContent = css;
  document.head.appendChild(st);
}

// kebab actions (solo autore)
function attachEmotionActions(hostBox, postId, emoEl){
  ensureEmotionActionStyles();

  let emo = emoEl || hostBox?.parentElement?.querySelector('.ofi-emozione.feed-card');
  if (!emo){
    const post = hostBox?.closest?.('article.post');
    const prev = post?.previousElementSibling;
    if (prev?.classList?.contains('ofi-emozione')) emo = prev;
  }
  if (!emo) return;

  if ((hostBox?.dataset?.owner || '') !== (auth.currentUser?.uid || '')) return;
  if (emo.querySelector('.ofi-emo-kebab')) return;

  const keb = document.createElement('button');
  keb.type='button';
  keb.className='ofi-emo-kebab';
  keb.setAttribute('aria-label','Azioni');
  keb.textContent='⋮';
  emo.appendChild(keb);

  let menu = null;
  function openMenu(){
    if (menu){ menu.remove(); menu=null; }
    menu = document.createElement('div');
    menu.className = 'ofi-emo-menu';
    menu.innerHTML = `
      <button data-act="edit">✎ Modifica</button>
      <button data-act="del">🗑 Elimina</button>`;
    emo.appendChild(menu);

    const closeAll = (ev)=>{
      if (!menu) return;
      if (!menu.contains(ev.target) && ev.target!==keb){ menu.remove(); menu=null; document.removeEventListener('click', closeAll); }
    };
    setTimeout(()=> document.addEventListener('click', closeAll), 0);

    // EDIT
    menu.querySelector('[data-act="edit"]').addEventListener('click', async ()=>{
      const current = await fetchLatestEmotionDoc(postId);

      openEmotionQuickDialog({
        onSkip(){},
        async onSave({ text, makePublic }){
          const newText = (text || '').trim() || (current?.text || '');
          if (!newText) return;

          // anteprima immediata
          showEmotionOptimistic(postId, hostBox, newText, makePublic ? 'public' : 'private');

          // persisti + refresh
          await editEmotionForPost(postId, { text: newText, makePublic });
          await refreshEmotionUIRetry(postId, hostBox);
        }
      });

      // precompila i campi dopo l'apertura
      setTimeout(()=>{
        const ta  = document.getElementById('emoTxt');
        const chk = document.getElementById('emoAsPublic');
        if (ta && current?.text) ta.value = current.text;
        if (chk && current?.scope) chk.checked = (current.scope === 'public');
      }, 0);
    });

    // DELETE
    menu.querySelector('[data-act="del"]').addEventListener('click', async ()=>{
      if (!confirm('Eliminare la riflessione?')) return;

      // rimozione immediata in UI (senza refresh)
      const post = hostBox.closest('article.post');
      const prev = post?.previousElementSibling;
      if (prev?.classList?.contains('ofi-emozione')) prev.remove();
      hostBox.querySelectorAll('.ofi-emozione').forEach(n=>n.remove());

      // ripulisci eventuale chip duplicata, la reinseriremo dopo se serve
      hostBox.querySelector('.emo-add-chip')?.remove();

      await deleteEmotionForPost(postId);

      // dopo delete → reinserisci chip (non c'è più una riflessione)
      injectAddEmotionChip(hostBox, postId);

      // e prova un refresh robusto (opzionale)
      await refreshEmotionUIRetry(postId, hostBox);
    });
  }
  keb.addEventListener('click', openMenu);
}

/* Chip “Aggiungi riflessione” — inserito nella testata solo se NON esiste già una riflessione */
function injectAddEmotionChip(hostBox, postId){
  ensureEmotionActionStyles();
  if (!hostBox) return;

  // NON inserire se c’è già una card emozione SOPRA al post o DENTRO la card
  const post = hostBox.closest('article.post');
  const above = post?.previousElementSibling?.classList?.contains('ofi-emozione');
  const inside = !!hostBox.querySelector('.ofi-emozione');
  if (above || inside) return;

  // evita doppioni chip
  if (hostBox.querySelector('.emo-add-chip')) return;

  // solo autore
  if ((hostBox.dataset.owner || '') !== (auth.currentUser?.uid || '')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'emo-add-chip chip';
  btn.textContent = 'Aggiungi riflessione';

  const headLeft = hostBox.querySelector('.pensiero-head .head-left');
  if (headLeft){
    btn.style.position = 'static';
    btn.style.alignSelf = 'flex-start';
    headLeft.appendChild(btn);
  } else {
    // fallback per markup vecchi
    btn.style.position = 'absolute';
    btn.style.top = '56px';
    btn.style.right = '10px';
    hostBox.appendChild(btn);
  }

  btn.addEventListener('click', ()=>{
    openEmotionQuickDialog({
      onSkip(){},
      async onSave({ text, makePublic }){
        const t = (text || '').trim();
        if (!t) return;

        // 1) anteprima immediata (optimistic)
        showEmotionOptimistic(postId, hostBox, t, makePublic ? 'public' : 'private');

        // 2) persisti
        await editEmotionForPost(postId, { text: t, makePublic });

        // 3) attesa piccola per updatedAt
        await sleep(950);

        // 4) refresh robusto + UI safe
        try { await refreshEmotionForPost({ db, postId }); } catch {}
        await refreshEmotionUIRetry(postId, hostBox);

        // feedback + auto-scroll
        const postEl = hostBox.closest('article.post');
        if (postEl){
          postEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          postEl.classList.add('pulse');
          setTimeout(()=> postEl.classList.remove('pulse'), 1200);
        }
      }
    });
  });
}

/* ===== Reinserisce la card Emozione e la sposta sopra al post ===== */
async function refreshEmotionUI(postId, hostBox){
  try{
    const post = hostBox?.closest?.('article.post');
    if (!post) return;

    // 1) NON rimuovere ancora nulla: tieni riferimenti a ciò che c’è
    const wasAbove = post.previousElementSibling?.classList?.contains('ofi-emozione') ? post.previousElementSibling : null;
    const oldsInside = Array.from(hostBox?.querySelectorAll('.ofi-emozione') || []);

    // 2) prova a inserire dentro hostBox la nuova card (se i dati ci sono)
    const ok = await maybeInsertEmotion({ db, postId, into: hostBox, opts:{ showAlsoPrivate:true } });
    const inserted = hostBox.querySelector('.ofi-emozione');

    if (ok && inserted){
      // 3) sposta sopra il post
      inserted.classList.add('feed-card');
      post.parentElement.insertBefore(inserted, post);

      // 3b) elimina ogni duplicato dentro alla card
      oldsInside.forEach(n => { if (n !== inserted) n.remove(); });

      // 3c) elimina eventuale vecchia card sopra, se diversa
      if (wasAbove && wasAbove !== inserted) wasAbove.remove();

      // 3d) aggancia azioni e togli la chip
      attachEmotionActions(hostBox, postId, inserted);
      hostBox.querySelector('.emo-add-chip')?.remove();

    } else {
      // Nessun dato: se non ci sono già card sopra/dentro → mostra chip
      const hasAbove = post.previousElementSibling?.classList?.contains('ofi-emozione');
      const hasInside = !!hostBox.querySelector('.ofi-emozione');
      if (!hasAbove && !hasInside){
        injectAddEmotionChip(hostBox, postId);
      }
    }
  }catch{
    // fallback ultra-safe
    const post = hostBox?.closest?.('article.post');
    const hasAbove = post?.previousElementSibling?.classList?.contains('ofi-emozione');
    const hasInside = !!hostBox?.querySelector?.('.ofi-emozione');
    if (!hasAbove && !hasInside) injectAddEmotionChip(hostBox, postId);
  }
}

/* ===== Preview OTTIMISTICA della riflessione (no refresh) ===== */
function showEmotionOptimistic(postId, hostBox, text, scope='public'){
  if (!hostBox || !postId || !text) return;

  const post = hostBox.closest('article.post');
  if (!post || !post.parentElement) return;

  // pulizia: rimuovi eventuale card emozione subito sopra e interne
  const prev = post.previousElementSibling;
  if (prev?.classList?.contains('ofi-emozione')) prev.remove();
  hostBox.querySelectorAll('.ofi-emozione').forEach(n=>n.remove());

  // crea la preview
  const emo = document.createElement('article');
  emo.className = 'ofi-emozione ofi-emozione--optimistic feed-card';
  emo.dataset.pid = postId;
  emo.innerHTML = `
    <header class="ofi-emozione-h">
      ${scope === 'public' ? 'Storia dell’autore' : 'Riflessione (solo per te)'}
    </header>
    <p>${escapeHtml(String(text).trim())}</p>
  `;

  // inserisci sopra al post, aggancia azioni e rimuovi la chip
  post.parentElement.insertBefore(emo, post);
  attachEmotionActions(hostBox, postId, emo);
  hostBox.querySelector('.emo-add-chip')?.remove();
}


/* piccolo retry dopo i salvataggi per evitare "sparizioni" dovute alla latenza */
async function refreshEmotionUIRetry(postId, hostBox){
  await refreshEmotionUI(postId, hostBox);
  setTimeout(()=> refreshEmotionUI(postId, hostBox), 280);
}

/* ===== Listener globale: quando arriva ofi:emotion-updated aggiorna UI ===== */
document.addEventListener("ofi:emotion-updated", async (ev)=>{
  const { postId } = ev.detail || {};
  if (!postId) return;
  let box = document.querySelector(`.pensiero-box[data-pid="${postId}"], .pensiero-box[data-post-id="${postId}"]`);
  if (!box) box = await waitForPostBox(postId, 2500);
  if (box){
    // rimuovi chip se presente e fai un refresh safe
    box.querySelector('.emo-add-chip')?.remove();
    await refreshEmotionUIRetry(postId, box);
  }
});

/* ===== Quando un post diventa pubblico per la PRIMA volta ===== */
async function onPostBecamePublicFirstTime(pid){
  try{
    if (wasEmotionAsked(pid)) return;

    const col = collection(db, `pensieri_utente/${pid}/emozioni_cronaca`);
    const s = await getDocs(query(col, limit(1)));
    if (!s.empty){ markEmotionAsked(pid); return; }

    openEmotionQuickDialog({
      onSkip(){ markEmotionAsked(pid); },
      async onSave({ text, makePublic }){
        markEmotionAsked(pid);
        if (!text) return;
        const scope = makePublic ? 'public' : 'private';

        await addDoc(col, {
          text, scope, state:'live', uid:(auth?.currentUser?.uid||''),
          createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });

        try {
          const box = document.querySelector(`.pensiero-box[data-pid="${pid}"]`);
          if (box) await refreshEmotionUIRetry(pid, box);
          const toast = document.createElement('div');
          toast.className = 'ofi-emo-toast';
          toast.textContent = "Salvata. La tua riflessione illumina questo ricordo ✨";
          document.body.appendChild(toast);
          setTimeout(()=> toast.remove(), 2200);
        } catch {}
      }
    });
  }catch(e){ /* silenzioso */ }
}

/* ===== Prompt riflessione all’arrivo da pensieri-scrivi ===== */
async function maybePromptRiflessioneOnNewPost(){
  const pid = getNewPostIdFromURL();
  if (!pid) return;

  try {
    const ref = doc(db, "pensieri_utente", pid);
    const s   = await getDoc(ref);
    if (!s.exists()) { removeQueryParam("newPostId"); return; }

    const d = s.data() || {};
    if ((d.uid || "") !== (auth.currentUser?.uid || "")) { removeQueryParam("newPostId"); return; }

    const isPriv = (d.visibilita || "privato") === "privato";

    const emoCol  = collection(db, `pensieri_utente/${pid}/emozioni_cronaca`);
    const emoSnap = await getDocs(query(emoCol, limit(1)));
    const hasEmo  = !emoSnap.empty;

    if (isPriv && !hasEmo){
      openEmotionQuickDialog({
        onSkip(){
          removeQueryParam("newPostId");
        },
        async onSave({ text, makePublic }){
          removeQueryParam("newPostId");

          const t = (text || "").trim();
          if (!t) return;

          const scope = makePublic ? "public" : "private";

          // 1) assicurati che la card sia in DOM → anteprima immediata
          let box = document.querySelector(`.pensiero-box[data-pid="${pid}"], .pensiero-box[data-post-id="${pid}"]`);
          if (!box) box = await waitForPostBox(pid, 2500);
          if (box) showEmotionOptimistic(pid, box, t, scope);

          // 2) persisti su Firestore
          await addDoc(emoCol, {
            text: t,
            scope,
            state: "live",
            uid: (auth?.currentUser?.uid || ""),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });

          await updateDoc(ref, {
            riflessione_preview: t.slice(0, 240),
            updatedAt: serverTimestamp()
          });

          // notifica interna
          document.dispatchEvent(new CustomEvent("ofi:emotion-updated", {
            detail: { postId: pid, text: t, label: "Storia dell’autore" }
          }));

          // 2.5) piccolo delay + refresh dati
          await sleep(950);
          try { await refreshEmotionForPost({ db, postId: pid }); } catch(e){}

          // 3) refresh UI “safe”
          if (!box) box = await waitForPostBox(pid, 2500);
          if (box){
            try { await refreshEmotionUIRetry(pid, box); } catch(e){}
            const postEl = box.closest("article.post");
            if (postEl){
              postEl.scrollIntoView({ behavior: "smooth", block: "center" });
              postEl.classList.add("pulse");
              setTimeout(()=> postEl.classList.remove("pulse"), 1200);
            }
          }
        }
      });
    } else {
      removeQueryParam("newPostId");
    }
  } catch(e){
    removeQueryParam("newPostId");
  }
}

/* ===== Helpers UI: passaggio pubblico/privato ===== */
function closeMediaViewerIfBelongsTo(box){
  const mv = $("mediaViewer");
  if (!mv || mv.classList.contains("hidden")) return;
  const mvPid = mv.dataset.pid || "";
  const pid = box?.dataset?.pid || "";
  if (mvPid && pid && mvPid === pid){
    const closeBtn = qs("[data-mv-close]");
    if (closeBtn) closeBtn.click();
    else {
      mv.classList.add("hidden"); mv.setAttribute("aria-hidden","true");
      const iv = Number(mv.dataset.syncInt||0); if (iv) clearInterval(iv);
      mv.removeAttribute('data-sync-int');
    }
  }
}

function ensurePublicUI(box, p){
  if (!box) return;
  box.dataset.vis = "pubblico";
  box.classList.remove("is-private");
  box.classList.add("is-public");

  const badge = box.querySelector(".badge-vis");
  if (badge){ badge.textContent = "Pubblico"; badge.classList.add("pubblico"); badge.classList.remove("privato"); }

  const tgl = box.querySelector(".toggle-vis-min");
  if (tgl) tgl.textContent = "Rendi privato";

  const shareBtn = box.querySelector(".sharePost");
  if (shareBtn) shareBtn.style.display = "";

  let chips = box.querySelector(".lumina-chips");
  if (!chips){
    chips = document.createElement("div");
    chips.className = "lumina-chips";
    chips.innerHTML = `
      <span class="lumina-chip"><span class="rxTot">0</span> reazioni</span>
      <span class="lumina-chip"><span class="cCount">0</span> commenti</span>`;
    const metaAnchor = box.querySelector(".meta") || box.lastElementChild;
    box.insertBefore(chips, metaAnchor);
  } else {
    chips.style.display = "";
  }

  let reacts = box.querySelector(".reactions-row");
  if (!reacts || !reacts.querySelector(".react-btn")) {
    if (!reacts) {
      reacts = document.createElement("div");
      reacts.className = "reactions-row";
      const meta = box.querySelector(".meta");
      box.insertBefore(reacts, meta);
    }
    reacts.innerHTML = `
      <button class="react-btn" data-react="cuore"><span class="emo">❤️</span> <span class="cnt">0</span></button>
      <button class="react-btn" data-react="luce"><span class="emo">✨</span> <span class="cnt">0</span></button>
      <button class="react-btn" data-react="colomba"><span class="emo">🕊️</span> <span class="cnt">0</span></button>
      <button class="react-btn" data-react="rosa"><span class="emo">🌹</span> <span class="cnt">0</span></button>
    `;
  }
  reacts.style.display = "";

  let btnC = box.querySelector(".openComments");
  if (btnC){
    btnC.style.display = "";
    btnC.classList.remove("onlyIfHasComments");
    btnC.textContent = "Commenti";
  }

  const th = box.querySelector(".cm-thread");
  if (th){ th.classList.remove("readonly"); }

  hookReactions(box.closest(".post") || box, p).catch(console.warn);
}

function ensurePrivateUI(box, p){
  if (!box) return;
  box.dataset.vis = "privato";
  box.classList.remove("is-public");
  box.classList.add("is-private");

  closeMediaViewerIfBelongsTo(box);

  const badge = box.querySelector(".badge-vis");
  if (badge){ badge.textContent = "Privato"; badge.classList.add("privato"); badge.classList.remove("pubblico"); }
  const tgl = box.querySelector(".toggle-vis-min");
  if (tgl) tgl.textContent = "Rendi pubblico";

  const shareBtn = box.querySelector(".sharePost");
  if (shareBtn) shareBtn.style.display = "none";

  box.querySelectorAll(".reactions-row").forEach(row => row.remove());

  const chips = box.querySelector(".lumina-chips");
  if (chips) chips.style.display = "none";

  const btnC = box.querySelector(".openComments");
  if (btnC){
    btnC.style.display = "";
    btnC.classList.add("onlyIfHasComments");
    btnC.textContent = "Commenti (solo tu)";
  }
  const th = box.querySelector(".cm-thread");
  if (th){ th.classList.add("readonly"); }

  try {
    const mv = document.getElementById("mediaViewer");
    const mvPid = mv?.dataset?.pid || "";
    if (mvPid && mvPid === (box.dataset.pid || "")) {
      const mvActions = document.getElementById("mvActions");
      if (mvActions) mvActions.innerHTML = "";
    }
  } catch {}
}

/* ===== Eliminazione a cascata ===== */
async function deletePostCascade(p){
  if (!confirm("Eliminare definitivamente questo pensiero?")) return false;
  if (!confirm("Confermi di voler eliminare il post e i dati collegati (reazioni/emozioni)?")) return false;

  const pid = p.id;
  try{
    await deleteDoc(doc(db, "pensieri_utente", pid)).catch(()=>{});
    await deleteDoc(doc(db, "pensieri_reazioni", pid)).catch(()=>{});
    try{
      const emoCol = collection(db, `pensieri_utente/${pid}/emozioni_cronaca`);
      const emoSnap = await getDocs(emoCol);
      const del = emoSnap.docs.map(d => deleteDoc(d.ref).catch(()=>{}));
      await Promise.all(del);
    }catch{}

    const card = document.querySelector(`.pensiero-box[data-pid="${pid}"]`)?.closest(".post");
    if (card) card.remove();

    allPosts = allPosts.filter(x => x.id !== pid);
    visiblePosts = visiblePosts.filter(x => x.id !== pid);
    refreshKpiFromServer().catch(()=>{});

    const toast = document.createElement("div");
    toast.className = "ofi-emo-toast";
    toast.textContent = "Pensiero eliminato.";
    document.body.appendChild(toast);
    setTimeout(()=> toast.remove(), 1800);

    return true;
  }catch(e){
    console.error(e);
    alert("Non sono riuscito a eliminare il post ora. Riprova più tardi.");
    return false;
  }
}

/* ===== Render card (pulita) ===== */
async function renderPostCard(p){
  const el = document.createElement("article");
  el.className = "post";

  const dt = p.data?.toDate ? p.data.toDate() : (p.data || new Date());
  const luogo = p.luogo ? `📍 ${escapeHtml(p.luogo)}` : "";
  const hashtags = (p.hashtags||[]).map(h=>`<span class="hashtag">#${escapeHtml(h)}</span>`).join("");
  const isPub = (p.visibilita || (p.is_pubblico ? "pubblico" : "privato")) === "pubblico";
  const growth = computeCrescita(p);
  const pct = clamp100(p.lumina_score ?? p.lumina_progress ?? growth);
  const lvl = Number(p.lumina_level ?? p.lumina_livello ?? levelFromScore(pct));

  el.innerHTML = `
    <div class="pensiero-box lv-${lvl}" data-pid="${p.id}" data-post-id="${p.id}" data-owner="${p.uid||''}" data-vis="${isPub?'pubblico':'privato'}">
      <div class="pensiero-head">
        <div class="head-left">
          <span class="badge-vis ${isPub?'pubblico':'privato'}">${isPub?'Pubblico':'Privato'}</span>
          <button class="toggle-vis-min" type="button">${isPub?'Rendi privato':'Rendi pubblico'}</button>
        </div>
        <div class="lumina-top">
          <div class="lumina-badge"><span class="dot"></span> Lumina ${lvl}</div>
          <div class="lumina-ring" data-pct="${pct}">
            <svg viewBox="0 0 40 40"><circle class="ring-bg" cx="20" cy="20" r="18"></circle><circle class="ring-fg" cx="20" cy="20" r="18"></circle></svg>
            <span class="pct">${pct}</span>
          </div>
        </div>
      </div>

      ${p.titolo ? `<h3>${escapeHtml(p.titolo)}</h3>` : ``}
      ${p.media ? `<div class="media placeholder"></div>` : ``}

      <div class="testo clamp">${escapeHtml(p.testo||"")}</div>
      <a class="expand-link" role="button">Mostra tutto</a>

      <div class="lumina-chips" style="${isPub?'':'display:none'}">
        <span class="lumina-chip"><span class="rxTot">${(p.reazioni?.cuore||0)+(p.reazioni?.luce||0)+(p.reazioni?.colomba||0)+(p.reazioni?.rosa||0)}</span> reazioni</span>
        <span class="lumina-chip"><span class="cCount">${p.commenti_count||0}</span> commenti</span>
      </div>

      ${isPub ? `
      <div class="reactions-row">
        <button class="react-btn" data-react="cuore"><span class="emo">❤️</span> <span class="cnt">${p.reazioni?.cuore||0}</span></button>
        <button class="react-btn" data-react="luce"><span class="emo">✨</span> <span class="cnt">${p.reazioni?.luce||0}</span></button>
        <button class="react-btn" data-react="colomba"><span class="emo">🕊️</span> <span class="cnt">${p.reazioni?.colomba||0}</span></button>
        <button class="react-btn" data-react="rosa"><span class="emo">🌹</span> <span class="cnt">${p.reazioni?.rosa||0}</span></button>
      </div>` : ``}

      <div class="meta">
        <span>${luogo}</span>
        <div class="hashtag-row">${hashtags}</div>
        <div class="small">${fmtDate(dt)}</div>
      </div>

      <div class="actions-row">
        ${isPub
          ? `<button class="btn primary openComments" data-toggle-comments>Commenti</button>`
          : `<button class="btn openComments onlyIfHasComments" data-toggle-comments>Commenti (solo tu)</button>`
        }
        ${isPub ? `<button class="btn btn-outline sharePost" data-id="${p.id}">Condividi</button>` : ``}
        <a class="btn icon btn-outline" href="pensieri-scrivi.html?postId=${p.id}" aria-label="Modifica pensiero"><span class="ic">✎</span> Modifica</a>
        <button class="btn btn-outline danger deletePost" data-id="${p.id}" aria-label="Elimina">🗑️ Elimina</button>
      </div>

      <img class="social-watermark" src="../images/OFI-Social.png" alt="OFI Social">
    </div>
  `;

  if (p.media) {
    const ph = el.querySelector(".media.placeholder");
    if (ph) {
      const node = buildMediaNode(p);
      if (node) ph.replaceWith(node);
    }
  }

  const ring = el.querySelector(".lumina-ring");
  if (ring) renderLuminaRing(ring, pct);

  el.querySelector(".expand-link")?.addEventListener("click",(e)=>{
    const t = el.querySelector(".testo");
    const expanded = t.classList.toggle("expanded");
    t.classList.toggle("clamp", !expanded);
    e.currentTarget.textContent = expanded ? "Riduci" : "Mostra tutto";
  });

  const box = el.querySelector(".pensiero-box");
  el.querySelector(".openComments")?.addEventListener("click", ()=>{
    const thread = box.querySelector(".cm-thread");
    const wrap = box.querySelector(".cm-thread-wrap") || thread?.parentElement;
    if (!thread) return;
    const willOpen = thread.hasAttribute("hidden");
    thread.hidden = !willOpen;
    box.classList.toggle("is-comments-open", willOpen);
    if (willOpen && !thread.hasAttribute("data-opened")){
      thread.setAttribute("data-opened","1");
      if (window.Comments?.onOpen) window.Comments.onOpen(box);
    }
  });
  if (window.Comments?.mount) window.Comments.mount(box);

  if (isPub) { hookReactions(el, p).catch(console.warn); }

  el.querySelector(".sharePost")?.addEventListener("click", async (e)=>{
    const id = e.currentTarget?.dataset?.id || p.id;
    try{
      const shareData = {
        title: p.titolo || "Un Pensiero su OFI",
        text: p.testo?.slice(0,140) || "",
        url: `${location.origin}/cittadini/pensiero.html?id=${encodeURIComponent(id)}`
      };
      if (navigator.share) await navigator.share(shareData);
      else await navigator.clipboard.writeText(shareData.url);
    }catch(_){}
  });
  
  el.querySelector(".toggle-vis-min")?.addEventListener("click", async ()=>{
    if (!box) return;
    const isNowPub = box.dataset.vis === "pubblico";
    const nextVis  = isNowPub ? "privato" : "pubblico";

    try{
      await updateDoc(doc(db, "pensieri_utente", p.id), {
        visibilita: nextVis,
        is_pubblico: (nextVis === "pubblico"),
        updatedAt: serverTimestamp()
      });
    }catch(err){
      console.error("Errore toggle visibilità:", err);
      return;
    }

    if (nextVis === "pubblico"){
      ensurePublicUI(box, p);
      onPostBecamePublicFirstTime(p.id).catch(()=>{});
    } else {
      ensurePrivateUI(box, p);
    }

    refreshKpiFromServer().catch(()=>{});
  });

  el.querySelector(".deletePost")?.addEventListener("click", async () => {
    try {
      await deletePostCascade(p);
    } catch (e) {
      console.error("Errore eliminazione post:", e);
    }
  });

  return el;
}

/* ===== Hook reazioni ===== */
async function hookReactions(root, post){
  const box = root.querySelector?.(".pensiero-box") || root.closest?.(".pensiero-box");
  if (box && box.dataset.vis === "privato") return;

  const rDocRef = doc(db, "pensieri_reazioni", post.id);
  let my = null, utenti = {}, counts = {cuore:0, luce:0, colomba:0, rosa:0};

  try{
    const snap = await getDoc(rDocRef);
    if (snap.exists()){
      const rx = snap.data() || {};
      utenti = rx.utenti || {};
      counts = rx.conteggi || counts;
      my = utenti[auth.currentUser?.uid||""] || null;
    }
  }catch{}

  const selectBtn = (t) => qs(`.react-btn[data-react="${t}"], .react-btn[data-type="${t}"]`, root);
  ['cuore','luce','colomba','rosa'].forEach(k=>{
    const cnt = selectBtn(k)?.querySelector('.cnt');
    if (cnt) cnt.textContent = String(Number(counts[k]||0));
  });
  if(my){ selectBtn(my)?.classList.add("active"); }

  qsa(".react-btn", root).forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const host = btn.closest(".pensiero-box");
      if (host?.dataset?.vis === "privato") return;

      const u = auth.currentUser; if (!u) return;
      const type = btn.dataset.react || btn.dataset.type;
      const prev = my;
      my = (prev===type) ? null : type;

      qsa(".react-btn", root).forEach(b=> b.classList.toggle('active', (b.dataset.react||b.dataset.type)===my));

      const getCnt = (t)=> Number(selectBtn(t)?.querySelector('.cnt')?.textContent || 0);
      const setCnt = (t,v)=> { const cnt = selectBtn(t)?.querySelector('.cnt'); if(cnt) cnt.textContent=String(v); };

      let c = { cuore:getCnt("cuore"), luce:getCnt("luce"), colomba:getCnt("colomba"), rosa:getCnt("rosa") };
      if (prev) c[prev] = Math.max(0, (c[prev]||0)-1);
      if (my)   c[my]   = (c[my]||0)+1;
      ['cuore','luce','colomba','rosa'].forEach(k=> setCnt(k,c[k]));

      try{
        const snapshot = await getDoc(rDocRef);
        const ut = (snapshot.exists() && snapshot.data().utenti) ? {...snapshot.data().utenti} : {};
        if (my){ ut[u.uid] = my; } else { delete ut[u.uid]; }
        await setDoc(rDocRef, { utenti: ut, conteggi: c, ultimaModifica: serverTimestamp() }, { merge:true });
        await updateDoc(doc(db,"pensieri_utente",post.id), { reazioni: c, ultimaModifica: serverTimestamp() });
      }catch(e){ console.error(e); }
    });
  });
}

/* ===== LISTA ===== */
async function renderList(fullReplace = true){
  if (fullReplace) lista.innerHTML = "";

  const frag = document.createDocumentFragment();

  for (const p of visiblePosts){
    // 1) crea la card del post
    const card = await renderPostCard(p);
    frag.appendChild(card);

    // 2) inserisci la "Storia dell’autore" e poi spostala FUORI (sopra al post)
    let hadEmotion = false;
    try {
      await maybeInsertEmotion({
        db,
        postId: p.id,
        into: card.querySelector('.pensiero-box'),
        opts: { showAlsoPrivate: true }
      });

      let emo = card.querySelector('.ofi-emozione');
      if (emo) {
        hadEmotion = true;
        emo.classList.add('feed-card');
        frag.insertBefore(emo, card);               // sposta sopra il post
        // elimina eventuali duplicati rimasti dentro la card
        card.querySelectorAll('.ofi-emozione').forEach(n=>{ if(n!==emo) n.remove(); });
        attachEmotionActions(card.querySelector('.pensiero-box'), p.id, emo);
        // niente chip quando c'è la card
        card.querySelector('.pensiero-box .emo-add-chip')?.remove();
      } else if ((p.riflessione_preview || "").trim()) {
        hadEmotion = true;
        emo = document.createElement('article');
        emo.className = 'ofi-emozione ofi-emozione--preview feed-card';
        emo.innerHTML = `
          <header class="ofi-emozione-h">Storia dell’autore</header>
          <p>${escapeHtml(p.riflessione_preview)}</p>
        `;
        frag.insertBefore(emo, card);
        attachEmotionActions(card.querySelector('.pensiero-box'), p.id, emo);
        card.querySelector('.pensiero-box .emo-add-chip')?.remove();
      }
    } catch (e) {
      console.warn('maybeInsertEmotion error:', e);
      const prev = (p.riflessione_preview || "").trim();
      if (prev){
        hadEmotion = true;
        const emo = document.createElement('article');
        emo.className = 'ofi-emozione ofi-emozione--preview feed-card';
        emo.innerHTML = `
          <header class="ofi-emozione-h">Storia dell’autore</header>
          <p>${escapeHtml(prev)}</p>
        `;
        frag.insertBefore(emo, card);
        attachEmotionActions(card.querySelector('.pensiero-box'), p.id, emo);
        card.querySelector('.pensiero-box .emo-add-chip')?.remove();
      }
    }

    // 2b) se non c'è nessuna card, mostra il chip "Aggiungi riflessione"
    if (!hadEmotion){
      const hostBox = card.querySelector('.pensiero-box');
      injectAddEmotionChip(hostBox, p.id);
    }

    // 3) separatore centrato (evita doppioni consecutivi nel fragment)
    const last = frag.lastElementChild;
    if (!last || !last.classList || !last.classList.contains('post-sep')) {
      const sep = document.createElement('div');
      sep.className = 'post-sep minimal';
      sep.innerHTML = `
        <span class="line" aria-hidden="true"></span>
        <img class="rose" src="../images/pensieri-logo.png" alt="" aria-hidden="true" />
        <span class="line" aria-hidden="true"></span>`;
      frag.appendChild(sep);
    }
  }

  lista.appendChild(frag);
  refreshKpi();
  ensureLoadMoreButton();
}

/* ===== Paginazione ===== */
function ensureLoadMoreButton(){
  let btn = $("loadMoreBtn");
  if (!btn){
    btn = document.createElement('button');
    btn.id='loadMoreBtn'; btn.className='btn btn-outline';
    btn.style.display = 'block'; btn.style.margin = '16px auto';
    btn.textContent = "Carica altri";
    btn.addEventListener('click', loadMore);
    lista.parentElement?.appendChild(btn);
  }
  btn.hidden = !__ofiHasMore;
}
async function tryQueryPosts(user, after, pageSize){
  const base = collection(db,"pensieri_utente");
  const condUid = where('uid','==',user.uid);
  const orders = [['data','desc'], ['ts','desc'], ['createdAt','desc']];
  for (const [field,dir] of orders){
    try{
      let qBase = query(base, condUid, orderBy(field,dir), limit(pageSize));
      if (after) qBase = query(qBase, startAfter(after));
      const snap = await getDocs(qBase);
      return {snap, field};
    }catch(_){ /* tenta con il prossimo campo */ }
  }
  return {snap:null, field:null};
}
async function loadFirst(){
  if (__ofiIsLoading) return;
  __ofiIsLoading = true; __ofiHasMore=false; __ofiLastDoc=null;
  showSkeleton(3);
  try{
    const user = auth.currentUser; if (!user) return;
    const {snap} = await tryQueryPosts(user, null, __PAGE_SIZE);
    hideSkeleton();
    if (!snap){ lista.innerHTML = `<p>Impossibile caricare i tuoi pensieri ora.</p>`; return; }
    if (snap.empty){ lista.innerHTML = `<p>Non hai ancora scritto alcun Pensiero.</p>`; __ofiHasMore=false; return; }
    allPosts = []; visiblePosts = [];
    const batch = [];
    for (const d of snap.docs){
      const p = { id: d.id, ...d.data() };
      const growth = computeCrescita(p);
      p.lumina_score = growth; p.lumina_progress = growth; p.lumina_level = levelFromScore(growth);
      batch.push(p);
    }
    allPosts.push(...batch); visiblePosts = [...allPosts];
    await renderList(true);
    __ofiLastDoc = snap.docs[snap.docs.length-1] || null;
    __ofiHasMore = snap.size === __PAGE_SIZE;
  } finally {
    __ofiIsLoading = false;
    ensureLoadMoreButton();
  }
}
async function loadMore(){
  if (!__ofiHasMore || __ofiIsLoading) return;
  __ofiIsLoading = true; ensureLoadMoreButton();
  try{
    const user = auth.currentUser; if (!user) return;
    const {snap} = await tryQueryPosts(user, __ofiLastDoc, __PAGE_SIZE);
    if (!snap){ __ofiHasMore=false; ensureLoadMoreButton(); return; }
    const batch = [];
    for (const d of snap.docs){
      const p = { id: d.id, ...d.data() };
      const growth = computeCrescita(p);
      p.lumina_score = growth; p.lumina_progress = growth; p.lumina_level = levelFromScore(growth);
      batch.push(p);
    }
    allPosts.push(...batch);
    visiblePosts = [...allPosts];
    await renderList(true);
    __ofiLastDoc = snap.docs[snap.docs.length-1] || __ofiLastDoc;
    __ofiHasMore = snap.size === __PAGE_SIZE;
  } finally {
    __ofiIsLoading = false;
    ensureLoadMoreButton();
  }
}

/* ===== Search (overlay smart-header) ===== */
const searchLayer = $("shSearch");
const searchBox   = $("searchBox");
$("shSearchBtn")?.addEventListener('click', ()=>{ if (searchLayer){ searchLayer.style.display='block'; searchBox?.focus(); } });
$("shSearchClose")?.addEventListener('click', ()=>{ if (searchLayer){ searchLayer.style.display='none'; searchBox.value=''; applyFilters(); } });

function applyFilters(){
  const q = (searchBox?.value || "").toLowerCase().trim();
  if (!q){ visiblePosts = [...allPosts]; renderList(true); return; }
  visiblePosts = allPosts.filter(p=>{
    const t1 = (p.titolo||"").toLowerCase();
    const t2 = (p.testo||"").toLowerCase();
    const t3 = (Array.isArray(p.hashtags)?p.hashtags.join(" "):String(p.hashtags||"")).toLowerCase();
    return t1.includes(q) || t2.includes(q) || t3.includes(q);
  });
  renderList(true);
}
searchBox?.addEventListener('input', ()=>{ applyFilters(); });

/* ===== Share bacheca ===== */
shareBacheca?.addEventListener('click', ()=>{
  const url = `${location.origin}/autore-pubblico.html?id=${encodeURIComponent(auth.currentUser?.uid||"")}`;
  if (navigator.share){
    navigator.share({ title:"La mia bacheca PENSIERI — OFI", text:"Ti condivido la mia bacheca pubblica su OFI.", url }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(url).then(()=>{
      shareBacheca.textContent="Link copiato"; setTimeout(()=> shareBacheca.textContent="Condividi bacheca", 1400);
    }).catch(()=>{ window.open(url,"_blank"); });
  }
});
copyPublicLinkBtn?.addEventListener('click', ()=>{
  const url = `${location.origin}/autore-pubblico.html?id=${encodeURIComponent(auth.currentUser?.uid||"")}`;
  navigator.clipboard.writeText(url).then(()=>{
    copyPublicLinkBtn.textContent="Copiato"; setTimeout(()=> copyPublicLinkBtn.textContent="Copia link pubblico", 1400);
  }).catch(()=>{ window.open(url,"_blank"); });
});

/* ===== MEDIA VIEWER minimal ===== */
const mv = $("mediaViewer");
const mvContent = $("mvContent");
const mvActions = $("mvActions");
function openMediaViewer(postBox){
  if (!mv || !postBox) return;
  mvContent.innerHTML=""; mvActions.innerHTML="";
  const media = postBox.querySelector('.media'); if (!media) return;
  const clone = media.cloneNode(true);
  const v = clone.querySelector('video'); if (v){ v.setAttribute('controls',''); v.removeAttribute('muted'); }
  mvContent.appendChild(clone);
  const row = postBox.querySelector('.reactions-row');
  if (row){
    const wrap = document.createElement('div'); wrap.className='mv-reacts';
    qsa('.react-btn', row).forEach(btn => {
      const mbtn = btn.cloneNode(true);
      mbtn.addEventListener('click', ()=> btn.click());
      wrap.appendChild(mbtn);
    });
    mvActions.appendChild(wrap);
    const sync = ()=>{
      const srcBtns = qsa('.react-btn', row);
      const dstBtns = qsa('.react-btn', wrap);
      for (let i=0;i<Math.min(srcBtns.length,dstBtns.length);i++){
        const c1 = srcBtns[i].querySelector('.cnt'); const c2 = dstBtns[i].querySelector('.cnt');
        if (c1 && c2) c2.textContent = c1.textContent;
        dstBtns[i].classList.toggle('active', srcBtns[i].classList.contains('active'));
      }
    };
    let iv = setInterval(sync, 400);
    mv.dataset.syncInt = String(iv);
  }
  mv.dataset.pid = postBox.dataset.pid || "";
  mv.classList.remove('hidden'); mv.setAttribute('aria-hidden','false');
}
function closeMediaViewer(){
  if (!mv) return;
  const iv = Number(mv.dataset.syncInt||0); if (iv) clearInterval(iv);
  mv.removeAttribute('data-sync-int');
  mv.removeAttribute('data-pid');
  mv.classList.add('hidden'); mv.setAttribute('aria-hidden','true');
}
document.addEventListener('click', (e)=>{
  const media = e.target.closest?.('.pensiero-box .media img, .pensiero-box .media video, .pensiero-box img, .pensiero-box video');
  if (media){
    const post = media.closest('.pensiero-box');
    openMediaViewer(post);
  }
  if (e.target.matches?.('[data-mv-close]')) closeMediaViewer();
});
document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closeMediaViewer(); });

/* ===== Auth ===== */
async function loadUserHeader(user){
  try{
    const snap = await getDoc(doc(db, "utenti_cittadini", user.uid));
    if (snap.exists()) {
      const d = snap.data() || {};
      const fullName = [d?.nome, d?.cognome].filter(Boolean).join(" ").trim();
      const nome = d?.nome_utente || fullName || user.displayName || user.email || "Utente";
      const nomeUtente = $("nomeUtente"); if (nomeUtente) nomeUtente.textContent = nome;
      let foto = d?.foto || d?.fotoProfiloURL || d?.avatarURL || "";
      if (!foto) foto = (d?.avatar==="donna") ? "../images/avatar-donna.png" : "../images/avatar-uomo.png";
      const avatarHeader = $("avatarHeader");
      if (avatarHeader){
        avatarHeader.onerror = ()=>{ avatarHeader.src="../images/avatar-uomo.png"; };
        avatarHeader.src=foto;
      }
    } else {
      const nomeUtente = $("nomeUtente"); if (nomeUtente) nomeUtente.textContent = user.displayName || user.email || "Utente";
      const avatarHeader = $("avatarHeader"); if (avatarHeader) avatarHeader.src = "../images/avatar-uomo.png";
    }
  }catch{}
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    lista.innerHTML = `<p>Devi accedere per vedere e gestire i tuoi pensieri.</p>`;
    hideSkeleton();
    return;
  }
  await loadUserHeader(user);
  await loadFirst();
  // NUOVO: prompt riflessione se arrivo da pensieri-scrivi con newPostId
  await maybePromptRiflessioneOnNewPost();
});
