/* pensieri-miei.js — OFI
   Bacheca personale con:
   - paginazione
   - commenti/reazioni
   - Lumina
   - poster video
   - Storia delle Emozioni (lettura sola, NO write)

   Nota: l'app Firebase è già inizializzata nell'HTML (vedi <script type="module"> in pagina).
*/

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, where, orderBy, getDocs, getDoc, doc, limit,
  addDoc, serverTimestamp, updateDoc, setDoc, startAfter, getCountFromServer, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ➜ Storia-Emozioni (SOLO lettura/DOM)
import { maybeInsertEmotion, injectEmotionStyles } from "./storia-emozioni.js";

// Inietta gli stili della Storia-Emozioni una sola volta (safe/idempotente)
injectEmotionStyles();

/* ===== Helpers (no Firebase side-effects) ===== */
const $  = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const clamp100 = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const escapeHtml = (s) => (s ?? "").toString().replace(/[&<>"]/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
const levelFromScore = (s) => (s<=15?0:s<=35?1:s<=55?2:s<=75?3:s<=90?4:5);

function fmtDate(d){
  const dd = new Date(d);
  return new Intl.DateTimeFormat('it-IT',{dateStyle:'medium', timeStyle:'short'}).format(dd);
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

/* ===== Render card ===== */
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
    <div class="pensiero-box lv-${lvl}" data-pid="${p.id}" data-owner="${p.uid||''}" data-vis="${isPub?'pubblico':'privato'}">
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

      <div class="lumina-chips">
        ${isPub ? `<span class="lumina-chip">${(p.reazioni?.cuore||0)+(p.reazioni?.luce||0)+(p.reazioni?.colomba||0)+(p.reazioni?.rosa||0)} reazioni</span>` : ``}
        ${isPub ? `<span class="lumina-chip"><span class="cCount">${p.commenti_count||0}</span> commenti</span>` : ``}
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
          : `<button class="btn openComments onlyIfHasComments" data-toggle-comments style="display:none">Commenti (solo tu)</button>`
        }
        ${isPub ? `<button class="btn btn-outline sharePost" data-id="${p.id}">Condividi</button>` : ``}
        <a class="btn icon btn-outline" href="pensieri-scrivi.html?postId=${p.id}" aria-label="Modifica pensiero"><span class="ic">✎</span> Modifica</a>
      </div>

      <img class="social-watermark" src="../images/OFI-Social.png" alt="OFI Social">
    </div>
  `;

  // Media placeholder → immagine/video con poster
  if (p.media) {
    const ph = el.querySelector(".media.placeholder");
    if (ph) {
      const node = buildMediaNode(p);
      if (node) ph.replaceWith(node);
    }
  }

  // Lumina ring
  const ring = el.querySelector(".lumina-ring");
  if (ring) renderLuminaRing(ring, pct);

  // Espandi/Riduci testo
  el.querySelector(".expand-link")?.addEventListener("click",(e)=>{
    const t = el.querySelector(".testo");
    const expanded = t.classList.toggle("expanded");
    t.classList.toggle("clamp", !expanded);
    e.currentTarget.textContent = expanded ? "Riduci" : "Mostra tutto";
  });

  // Commenti (UI esterna)
  const box = el.querySelector(".pensiero-box");
  el.querySelector(".openComments")?.addEventListener("click", ()=>{
    const thread = box.querySelector(".cm-thread");
    const wrap = box.querySelector(".cm-thread-wrap") || thread?.parentElement;
    if (!thread) return;
    const willOpen = thread.hasAttribute("hidden");
    thread.hidden = !willOpen;
    box.classList.toggle("is-comments-open", willOpen);
    if (wrap) wrap.style.display = willOpen ? "block" : "none";
    if (willOpen && !thread.hasAttribute("data-opened")){
      thread.setAttribute("data-opened","1");
      if (window.Comments?.onOpen) window.Comments.onOpen(box);
    }
  });
  if (window.Comments?.mount) window.Comments.mount(box);

  // Reazioni
  if (isPub) { hookReactions(el, p).catch(console.warn); }

  // Storia delle Emozioni (SOLO per post pubblici)
  if (isPub) {
    try {
      await maybeInsertEmotion(box /* target dove inserire */, p, db);
    } catch (e) {
      console.warn("maybeInsertEmotion errore", e);
    }
  }

  // Toggle visibilità
  el.querySelector(".toggle-vis-min")?.addEventListener("click", async ()=>{
    try{
      const newVis = isPub ? "privato" : "pubblico";
      await updateDoc(doc(db,"pensieri_utente", p.id), { visibilita: newVis, ultimaModifica: serverTimestamp() });
      // Aggiorna modello locale e re-render
      p.visibilita = newVis;
      const fresh = await renderPostCard(p);
      el.replaceWith(fresh);
      // Aggiorna KPI
      refreshKpi();
    }catch(err){
      console.error(err);
      alert("Impossibile aggiornare la visibilità in questo momento.");
    }
  });

  // Share
  el.querySelector(".sharePost")?.addEventListener("click",(e)=>{
    const pid = p.id;
    const url = `${location.origin}/pensieri-pubblici.html?id=${encodeURIComponent(pid)}`;
    if (navigator.share){
      navigator.share({ title: p.titolo || "Un Pensiero su OFI", text: "Condividi questo Pensiero", url }).catch(()=>{});
    } else {
      navigator.clipboard.writeText(url).then(()=>{
        const btn=e.currentTarget; const old=btn.textContent; btn.textContent="Link copiato";
        setTimeout(()=>btn.textContent=old,1400);
      }).catch(()=>{ window.open(url,"_blank"); });
    }
  });

  return el;
}

/* ===== Hook reazioni ===== */
async function hookReactions(root, post){
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

  // Ini UI
  const selectBtn = (t) => qs(`.react-btn[data-react="${t}"], .react-btn[data-type="${t}"]`, root);
  ['cuore','luce','colomba','rosa'].forEach(k=>{
    const cnt = selectBtn(k)?.querySelector('.cnt');
    if (cnt) cnt.textContent = String(Number(counts[k]||0));
  });
  if(my){ selectBtn(my)?.classList.add("active"); }

  qsa(".react-btn", root).forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const u = auth.currentUser; if (!u) return;
      const type = btn.dataset.react || btn.dataset.type;
      const prev = my;
      my = (prev===type) ? null : type;

      // toggle UI
      qsa(".react-btn", root).forEach(b=> b.classList.toggle('active', (b.dataset.react||b.dataset.type)===my));

      // recalc counts locally
      const getCnt = (t)=> Number(selectBtn(t)?.querySelector('.cnt')?.textContent || 0);
      const setCnt = (t,v)=> { const cnt = selectBtn(t)?.querySelector('.cnt'); if(cnt) cnt.textContent=String(v); };

      let c = { cuore:getCnt("cuore"), luce:getCnt("luce"), colomba:getCnt("colomba"), rosa:getCnt("rosa") };
      if (prev) c[prev] = Math.max(0, (c[prev]||0)-1);
      if (my)   c[my]   = (c[my]||0)+1;
      ['cuore','luce','colomba','rosa'].forEach(k=> setCnt(k,c[k]));

      // persist
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
async function renderList(fullReplace=true){
  if (fullReplace) lista.innerHTML="";
  for (const p of visiblePosts){
    const card = await renderPostCard(p);
    lista.appendChild(card);
  }
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
  // clear
  mvContent.innerHTML=""; mvActions.innerHTML="";
  const media = postBox.querySelector('.media'); if (!media) return;
  // clone media
  const clone = media.cloneNode(true);
  // ensure video has controls
  const v = clone.querySelector('video'); if (v){ v.setAttribute('controls',''); v.removeAttribute('muted'); }
  mvContent.appendChild(clone);
  // mirror reactions row (if exists)
  const row = postBox.querySelector('.reactions-row');
  if (row){
    const wrap = document.createElement('div'); wrap.className='mv-reacts';
    qsa('.react-btn', row).forEach(btn => {
      const mbtn = btn.cloneNode(true);
      mbtn.addEventListener('click', ()=> btn.click());
      wrap.appendChild(mbtn);
    });
    mvActions.appendChild(wrap);
    // sync counts every 400ms while open
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
  mv.classList.remove('hidden'); mv.setAttribute('aria-hidden','false');
}
function closeMediaViewer(){
  if (!mv) return;
  const iv = Number(mv.dataset.syncInt||0); if (iv) clearInterval(iv);
  mv.removeAttribute('data-sync-int');
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

onAuthStateChanged(auth, async (user)=>{
  if(!user){
    lista.innerHTML = `<p>Devi accedere per vedere e gestire i tuoi pensieri.</p>`;
    hideSkeleton(); return;
  }
  await loadUserHeader(user);
  await loadFirst();
});
