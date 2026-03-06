/* pensieri-miei.js — OFI (paginazione + commenti/reazioni/Lumina + video poster) */
// Usa l'app Firebase già inizializzata nell'HTML

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, where, orderBy, getDocs, getDoc, doc, limit,
  addDoc, serverTimestamp, updateDoc, setDoc, startAfter, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ===== Firebase ===== */
const app  = getApp();
const auth = getAuth(app);
const db   = getFirestore(app);

/* ===== Helpers UI ===== */
const $  = id => document.getElementById(id);
const qs = (sel,root=document)=>root.querySelector(sel);
const qsa= (sel,root=document)=>Array.from(root.querySelectorAll(sel));

const clamp100 = n => Math.max(0, Math.min(100, Math.round(Number(n)||0)));
const levelFromScore = s => (s<=15?0:s<=35?1:s<=55?2:s<=75?3:s<=90?4:5);
const OFI_W = { cuore:3, luce:2, colomba:5, rosa:4, commento:6 };
const OFI_K = 120;
const VIDEO_POSTER_FALLBACK = "../images/video-poster-generic.jpg";

function escapeHtml(str){ return (str||"").replace(/[&<>\"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;" }[m])); }
function fmtDate(d){
  const dd = new Date(d);
  const y = dd.getFullYear(), m = String(dd.getMonth()+1).padStart(2,"0"), day = String(dd.getDate()).padStart(2,"0");
  const hh = String(dd.getHours()).padStart(2,"0"), mm = String(dd.getMinutes()).padStart(2,"0");
  return `${day}/${m}/${y} ${hh}:${mm}`;
}
function smartMediaFit(imgEl, wrap){
  const img = new Image();
  img.onload = ()=>{
    const ratio = img.width / img.height;
    if(ratio >= 1.4){ wrap.classList.add('cover'); }
    else if(ratio <= 0.7){
      const url = imgEl.src;
      const bd = document.createElement('div');
      bd.className = 'backdrop';
      bd.style.backgroundImage = `url('${url}')`;
      wrap.prepend(bd);
    }
  };
  img.src = imgEl.src;
}

/* ===== Roots ===== */
const lista       = $("listaPensieri");
const skeletons   = $("skeletons");
const nomeUtente  = $("nomeUtente");
const uidInfo     = $("uidInfo");
const avatarHeader= $("avatarHeader");
const kpiTot      = $("kpiTot");
const kpiPub      = $("kpiPub");
const searchBox   = $("searchBox");
const filtraSel   = $("filtra");
const ordinaSel   = $("ordina");
const shareBtn    = $("shareBacheca");
const pillSug     = $("pillSuggerimento");

/* ===== Skeleton ===== */
function showSkeleton(n=4){
  skeletons.innerHTML = "";
  for(let i=0;i<n;i++){
    const sk = document.createElement("div");
    sk.className="skeleton";
    sk.innerHTML = `<div class="sk-line big"></div><div class="sk-line"></div><div class="sk-line"></div>`;
    skeletons.appendChild(sk);
  }
}
function hideSkeleton(){ skeletons.innerHTML=""; }

/* ===== Profilo header ===== */
async function loadUserHeader(user){
  try{
    const snap = await getDoc(doc(db, "utenti_cittadini", user.uid));
    if (snap.exists()) {
      const d = snap.data() || {};
      const fullName = [d?.nome, d?.cognome].filter(Boolean).join(" ").trim();
      const nome = d?.nome_utente || fullName || user.displayName || user.email || "Utente";
      nomeUtente && (nomeUtente.textContent = nome);
      let foto = d?.foto || d?.fotoProfiloURL || d?.avatarURL || "";
      if (!foto) foto = (d?.avatar==="donna") ? "../images/avatar-donna.png" : "../images/avatar-uomo.png";
      avatarHeader && (avatarHeader.onerror = ()=>{ avatarHeader.src="../images/avatar-uomo.png"; }, avatarHeader.src=foto);
    } else {
      nomeUtente && (nomeUtente.textContent = user.displayName || user.email || "Utente");
      avatarHeader && (avatarHeader.src = "../images/avatar-uomo.png");
    }
  }catch{
    nomeUtente && (nomeUtente.textContent = user.displayName || user.email || "Utente");
  }
}

/* ===== Frase di copertina ===== */
async function loadCoverPhrase(user){
  const box      = document.getElementById('frase-autore-box');
  const fraseEl  = document.getElementById('frase-copertina');
  const autoreEl = document.getElementById('frase-autore');
  const btnEdit  = document.getElementById('btn-edit-frase');
  const editor   = document.getElementById('frase-editor');
  const inpFrase = document.getElementById('inp-frase');
  const inpAut   = document.getElementById('inp-autore');
  const btnSave  = document.getElementById('btn-save-frase');
  const btnCancel= document.getElementById('btn-cancel-frase');
  if(!box || !fraseEl || !autoreEl) return;

  let frase = "", autore = "";
  try{
    const snap = await getDoc(doc(db, "utenti_cittadini", user.uid));
    if (snap.exists()) {
      const d = snap.data() || {};
      frase  = (d.frase  || d.frase_copertina || d.fraseCopertina || "").trim();
      autore = (d.autore || d.frase_autore    || d.fraseAutore    || "").trim();
    }
  }catch(e){ console.warn("loadCoverPhrase()", e); }

  fraseEl.textContent  = frase || " ";
  autoreEl.textContent = autore ? `— ${autore}` : "";

  if (btnEdit && editor && inpFrase && inpAut && btnSave && btnCancel){
    const showEditor = (open)=>{ editor.hidden = !open; box.querySelector('.frase-inline').style.display = open ? 'none' : ''; };

    btnEdit.addEventListener('click', ()=>{
      inpFrase.value = frase;
      inpAut.value   = autore;
      showEditor(true);
      inpFrase.focus();
    });
    btnCancel.addEventListener('click', ()=>{ showEditor(false); });
    btnSave.addEventListener('click', async ()=>{
      const newFrase  = (inpFrase.value || "").trim();
      const newAutore = (inpAut.value   || "").trim();
      try{
        await setDoc(doc(db, "utenti_cittadini", user.uid), { frase: newFrase, autore: newAutore }, { merge:true });
        frase = newFrase; autore = newAutore;
        fraseEl.textContent  = frase || " ";
        autoreEl.textContent = autore ? `— ${autore}` : "";
        showEditor(false);
      }catch(e){
        console.error(e);
        alert("Non riesco a salvare ora. Riprova tra poco.");
      }
    });
  }
}

/* ===== Lumina ===== */
function computeCrescita(p){
  const r = p.reazioni || {};
  const hearts  = Number(r.cuore||0);
  const stars   = Number(r.luce||0);
  const doves   = Number(r.colomba||0);
  const roses   = Number(r.rosa||0);
  const comm    = Number(p.commenti_count || p.commenti_totali || 0);
  const eng = hearts*OFI_W.cuore + stars*OFI_W.luce + doves*OFI_W.colomba + roses*OFI_W.rosa + comm*OFI_W.commento;
  const score = 100 * (1 - Math.exp(-(eng)/(OFI_K)));
  return clamp100(score);
}
async function computeAndPersistLumina(p){
  const crescita = computeCrescita(p);
  const level = levelFromScore(crescita);
  try{
    await updateDoc(doc(db,"pensieri_utente", p.id), {
      lumina_score: crescita,
      fioritura_progress: crescita,
      lumina_level: level,
      lumina_livello: level,
      lumina_progress: crescita
    });
  } catch(_){}
  p.lumina_score = crescita;
  p.fioritura_progress = crescita;
  p.lumina_progress = crescita;
  p.lumina_level = level;
  return { score:crescita, level };
}
function renderLuminaRing(ringEl, pctRaw){
  const pct = clamp100(pctRaw);
  ringEl.style.setProperty('--p', pct);
  const lbl = ringEl.querySelector('.pct');
  if (lbl) lbl.textContent = Math.round(pct);
}

/* ===== Stato lista + paginazione ===== */
let allPosts = [];
let visiblePosts = [];
let __ofiLastDoc = null;
let __ofiHasMore = true;
let __ofiIsLoading = false;
const __PAGE_SIZE = 6;

/* ===== KPI veloci ===== */
async function ofiUpdateKpiCounts(uid){
  try{
    const baseCol = collection(db, 'pensieri_utente');
    const qAll = query(baseCol, where('uid','==',uid));
    const qPub = query(baseCol, where('uid','==',uid), where('visibilita','==','pubblico'));
    const [cAll, cPub] = await Promise.all([ getCountFromServer(qAll), getCountFromServer(qPub) ]);
    kpiTot && (kpiTot.textContent = String(cAll.data().count||0));
    kpiPub && (kpiPub.textContent = String(cPub.data().count||0));
  } catch(e){ console.warn('KPI count error', e); }
}

/* ===== Media renderer (aggiornato: usa poster_url) ===== */
function buildMediaNode(p){
  const url = p?.media || p?.cover_url || "";
  const type = (p?.mediaType || "").toLowerCase() || (/\.(mp4|webm|ogg)(\?|$)/i.test(url) ? "video" : "image");
  const poster = p?.poster_url || VIDEO_POSTER_FALLBACK;

  const wrap = document.createElement('div');
  wrap.className = 'media';
  wrap.dataset.media = type;
  wrap.dataset.type = type;
  if (url) wrap.dataset.src = url;
  if (type === "video") wrap.dataset.poster = poster;

  if (url && type === 'video'){
    // Nota: source type generico va bene; Safari usa l'estensione
    wrap.innerHTML = `
      <video controls playsinline preload="metadata" poster="${poster}" src="${url}">
        <source src="${url}">
      </video>`;
  } else if (url) {
    wrap.innerHTML = `<img alt="" src="${url}">`;
  }
  return wrap;
}

/* ===== Render card ===== */
function renderPostCard(p){
  const el = document.createElement("article");
  el.className = "post";
  const dt = p.data?.toDate ? p.data.toDate() : (p.data||new Date());
  const luogo = p.luogo ? `📍 ${p.luogo}` : "";
  const hashtags = (p.hashtags||[]).map(h=>`<span class="hashtag">#${escapeHtml(h)}</span>`).join("");
  const isPub = p.visibilita === "pubblico";
  const pct = clamp100(p.lumina_score ?? p.lumina_progress ?? 0);
  const lvl = Number(p.lumina_level ?? p.lumina_livello ?? 0);

  el.innerHTML = `
    <div class="pensiero-box lv-${p.lumina_level||0}" data-pid="${p.id}" data-owner="${p.uid||''}" data-vis="${isPub?'pubblico':'privato'}">
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
        ${(isPub?`<span class="lumina-chip">${(p.reazioni?.cuore||0)+(p.reazioni?.luce||0)+(p.reazioni?.colomba||0)+(p.reazioni?.rosa||0)} reazioni</span>`:"")}
        ${(isPub?`<span class="lumina-chip"><span class="cCount">${p.commenti_count||0}</span> commenti</span>`:"")}
      </div>
      ${isPub ? `
        <div class="reactions-row">
          <button class="react-btn" data-react="cuore"><span class="emo">❤️</span> <span class="cnt">${p.reazioni?.cuore||0}</span></button>
          <button class="react-btn" data-react="luce"><span class="emo">✨</span> <span class="cnt">${p.reazioni?.luce||0}</span></button>
          <button class="react-btn" data-react="colomba"><span class="emo">🕊️</span> <span class="cnt">${p.reazioni?.colomba||0}</span></button>
          <button class="react-btn" data-react="rosa"><span class="emo">🌹</span> <span class="cnt">${p.reazioni?.rosa||0}</span></button>
        </div>` : ``}
      <div class="meta"><span>${luogo}</span><div class="hashtag-row">${hashtags}</div><div class="small">${fmtDate(dt)}</div></div>
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

  // media placeholder -> nodo reale
  const mediaPh = qs(".media.placeholder", el);
  if (mediaPh) {
    const node = buildMediaNode(p);
    mediaPh.replaceWith(node);
    const img = node.querySelector("img");
    if (img) img.addEventListener("load", ()=> smartMediaFit(img, node));
  }

  const ring = qs(".lumina-ring", el);
  if (ring) renderLuminaRing(ring, pct);

  qs(".expand-link", el)?.addEventListener("click", (e)=>{
    const t = qs(".testo", el);
    const isExp = t.classList.toggle("expanded");
    e.currentTarget.textContent = isExp ? "Riduci" : "Mostra tutto";
    t.classList.toggle("clamp", !isExp);
  });

  const box = qs(".pensiero-box", el);
  const isPubBox = box?.dataset?.vis === "pubblico";

  qs(".toggle-vis-min", el)?.addEventListener("click", async ()=>{
    try{
      const newVis = isPubBox ? "privato" : "pubblico";
      await updateDoc(doc(db,"pensieri_utente", box.dataset.pid), { visibilita: newVis });
      location.reload();
    } catch(e){ console.error(e); alert("Non riesco a cambiare la visibilità ora."); }
  });

  qs(".openComments", el)?.addEventListener("click", ()=>{
    const thread = box.querySelector(".cm-thread");
    const wrap   = box.querySelector(".cm-thread-wrap") || thread?.parentElement;
    if (!thread) return;
    const willOpen = thread.hasAttribute('hidden');
    thread.hidden = !willOpen;
    box.classList.toggle('is-comments-open', willOpen);
    if (wrap) wrap.style.display = willOpen ? 'block' : 'none';
    if (willOpen && !thread.hasAttribute('data-opened')) {
      thread.setAttribute('data-opened','1');
      if (window.Comments && window.Comments.onOpen) window.Comments.onOpen(box);
    }
  });

  if (isPub) hookReactions(el, { id: box.dataset.pid });

  const share = qs(".sharePost", el);
  if (share) {
    share.addEventListener("click", async ()=>{
      const url = `https://www.onoranzefunebritalia.it/pensieri-pubblici.html?id=${box.dataset.pid}`;
      try { await navigator.clipboard.writeText(url); share.textContent = "Link copiato"; setTimeout(()=> share.textContent="Condividi", 1400); }
      catch { window.open(url, "_blank"); }
    });
  }

  if (window.Comments && window.Comments.mount) window.Comments.mount(box);
  return el;
}

/* ===== Reazioni ===== */
async function hookReactions(root, post){
  const rDocRef = doc(db, "pensieri_reazioni", post.id);
  const snap = await getDoc(rDocRef);
  let my = null, utenti = {}, counts = null;
  if(snap.exists()){
    const rx = snap.data();
    utenti = rx.utenti || {};
    my = utenti[auth.currentUser?.uid||""] || null;
    counts = rx.conteggi || null;
  }
  // supporta sia data-react che data-type
  const selectBtn = (t) => qs(`.react-btn[data-react="${t}"], .react-btn[data-type="${t}"]`, root);
  if(my){ selectBtn(my)?.classList.add("active"); }

  qsa(".react-btn", root).forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      if (!auth.currentUser) return;
      const type = btn.dataset.react || btn.dataset.type; // compat
      const prev = my;
      my = (prev === type) ? null : type;

      qsa(".react-btn", root).forEach(b=> b.classList.toggle("active", (b.dataset.react||b.dataset.type)===my));

      // leggi contatori (compat .cnt/.count)
      const getCnt = (t)=> + (qs(`.react-btn[data-react="${t}"] .cnt, .react-btn[data-type="${t}"] .cnt, .react-btn[data-react="${t}"] .count, .react-btn[data-type="${t}"] .count`, root)?.textContent || 0);
      const setCnt = (t,v)=> {
        qsa(`.react-btn[data-react="${t}"] .cnt, .react-btn[data-type="${t}"] .cnt, .react-btn[data-react="${t}"] .count, .react-btn[data-type="${t}"] .count`, root).forEach(n=> n.textContent = v);
      };

      const c = { cuore:getCnt("cuore"), luce:getCnt("luce"), colomba:getCnt("colomba"), rosa:getCnt("rosa") };
      if(prev){ c[prev] = Math.max(0, c[prev]-1); }
      if(my){ c[my] = (c[my]||0)+1; }
      for (const k of Object.keys(c)) setCnt(k, c[k]);

      try{
        if(my){ utenti[auth.currentUser.uid] = my; } else { delete utenti[auth.currentUser.uid]; }
        await setDoc(rDocRef, { utenti, conteggi: c, ultimaModifica: serverTimestamp() }, { merge:true });
        await updateDoc(doc(db,"pensieri_utente", post.id), { reazioni: c });
      } catch(e){ console.error(e); }
    });
  });
}

/* ===== Filtri / Ordina ===== */
function applyFilters(){
  const term = (searchBox?.value || "").toLowerCase().trim();
  const filtro = filtraSel?.value || "tutti";
  const ord = ordinaSel?.value || "data";
  visiblePosts = allPosts.filter(p=>{
    let ok = true;
    if(filtro==="pubblici") ok = p.visibilita==="pubblico";
    if(filtro==="privati") ok = p.visibilita!=="pubblico";
    if(filtro==="media")   ok = !!p.media;
    if(filtro==="ultimi30"){
      const now = new Date();
      const dt = p.data?.toDate ? p.data.toDate() : (p.data||new Date());
      ok = ((now - dt)/(1000*60*60*24)) <= 30;
    }
    if(ok && term){
      const t = (p.titolo||"") + " " + (p.testo||"");
      ok = t.toLowerCase().includes(term);
    }
    return ok;
  });
  if(ord==="lumina"){
    visiblePosts.sort((a,b)=>(b.lumina_progress||0)-(a.lumina_progress||0));
  }else if(ord==="popolari"){
    const pop = (p)=> (p.reazioni?.cuore||0)+(p.reazioni?.luce||0)+(p.reazioni?.colomba||0)+(p.reazioni?.rosa||0)+(p.commenti_count||0);
    visiblePosts.sort((a,b)=> pop(b)-pop(a));
  }else{
    visiblePosts.sort((a,b)=> (b.data?.toMillis?.()||b.data) - (a.data?.toMillis?.()||a.data));
  }
  renderList(false);
}

/* ===== Render list ===== */
function renderList(append){
  if (!append) lista.innerHTML = "";
  const source = append ? visiblePosts.slice(-__PAGE_SIZE) : visiblePosts;
  for (const p of source){ lista.appendChild(renderPostCard(p)); }
  setTimeout(()=> window.OFI_commentsSetup && window.OFI_commentsSetup(), 0);
}

/* ===== Bottone Carica altri ===== */
function ensureLoadMoreButton(){
  let btn = $("loadMoreBtn");
  if(!btn){
    btn = document.createElement('button');
    btn.id='loadMoreBtn'; btn.className='btn btn-outline';
    btn.style.display='none'; btn.style.margin='1rem auto 2rem';
    btn.textContent='Carica altri';
    btn.addEventListener('click', loadMore);
    ( $("listaWrap") || document.body ).appendChild(btn);
  }
  btn.style.display = __ofiHasMore ? '' : 'none';
  btn.disabled = !__ofiHasMore || __ofiIsLoading;
  btn.textContent = __ofiIsLoading ? 'Carico…' : 'Carica altri';
}

/* ===== Page loaders ===== */
async function loadInitialPosts(uid){
  __ofiIsLoading = true; ensureLoadMoreButton();
  showSkeleton(4);
  allPosts = []; visiblePosts = [];
  __ofiLastDoc = null; __ofiHasMore = true;
  try{
    const baseQ = query(collection(db,"pensieri_utente"), where("uid","==",uid), orderBy("data","desc"), limit(__PAGE_SIZE));
    const snap = await getDocs(baseQ);
    hideSkeleton();
    const batch = [];
    for (const d of snap.docs){
      const p = { id: d.id, ...d.data() };
      const growth = computeCrescita(p);
      p.lumina_score = growth; p.lumina_progress = growth; p.lumina_level = levelFromScore(growth);
      batch.push(p);
    }
    Promise.allSettled(batch.map(p=>computeAndPersistLumina(p)));
    allPosts.push(...batch); visiblePosts = [...allPosts];
    renderList(false);
    __ofiLastDoc = snap.docs[snap.docs.length-1] || null;
    __ofiHasMore = snap.size === __PAGE_SIZE;
    pillSug && (pillSug.hidden = allPosts.length>0);
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
    const baseQ = query(collection(db,"pensieri_utente"), where("uid","==",user.uid), orderBy("data","desc"), startAfter(__ofiLastDoc), limit(__PAGE_SIZE));
    const snap = await getDocs(baseQ);
    const batch = [];
    for (const d of snap.docs){
      const p = { id: d.id, ...d.data() };
      const growth = computeCrescita(p);
      p.lumina_score = growth; p.lumina_progress = growth; p.lumina_level = levelFromScore(growth);
      batch.push(p);
    }
    Promise.allSettled(batch.map(p=>computeAndPersistLumina(p)));
    allPosts.push(...batch);
    applyFilters();
    __ofiLastDoc = snap.docs[snap.docs.length-1] || __ofiLastDoc;
    __ofiHasMore = snap.size === __PAGE_SIZE;
  } finally {
    __ofiIsLoading = false;
    ensureLoadMoreButton();
  }
}

/* ===== Eventi UI ===== */
[searchBox, filtraSel].forEach(el=> el?.addEventListener("input", applyFilters));
ordinaSel?.addEventListener("change", applyFilters);
shareBtn?.addEventListener("click", async ()=>{
  try{
    await navigator.clipboard.writeText(location.href);
    shareBtn.textContent = "Link copiato";
    setTimeout(()=> shareBtn.textContent="Condividi bacheca", 1400);
  } catch(_){}
});

/* ===== Auth ===== */
onAuthStateChanged(auth, async (user)=>{
  if(!user){
    lista.innerHTML = `<p>Devi accedere per vedere e gestire i tuoi pensieri.</p>`;
    return;
  }
  await loadUserHeader(user);
  await loadCoverPhrase(user);
  await ofiUpdateKpiCounts(user.uid);
  showSkeleton(4);
  await loadInitialPosts(user.uid);
});

/* ===== Agente OFI ===== */
(()=>{
  const fab   = $("agentFab");
  const panel = $("agentPanel");
  const close = $("agentClose");
  if (!fab || !panel || !close) return;
  const open = () => {
    panel.classList.add('open'); panel.removeAttribute('inert');
    panel.setAttribute('aria-hidden','false'); fab.setAttribute('aria-expanded','true');
  };
  const hide = () => {
    panel.classList.remove('open'); panel.setAttribute('inert','');
    panel.setAttribute('aria-hidden','true'); fab.setAttribute('aria-expanded','false');
  };
  fab.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); open(); });
  close.addEventListener('click', hide);
  window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') hide(); });
  document.addEventListener('click', (e)=>{
    if (!panel.classList.contains('open')) return;
    if (panel.contains(e.target) || (fab && fab.contains(e.target))) return;
    hide();
  });
})();

/* ===============================
   OFI — Media Viewer v3 + Fix video iOS
   =============================== */

// Se in qualche markup fosse rimasto <img src="...mp4">, convertilo in <video>
function upgradeVideoImgs(root = document){
  const items = root.querySelectorAll('.pensiero-box img, .pensiero-box .media img');
  items.forEach(img => {
    const url = img.currentSrc || img.src || '';
    if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(url)) {
      const wrap = img.closest('.media') || img.parentElement;
      const poster = wrap?.dataset?.poster || VIDEO_POSTER_FALLBACK;
      const v = document.createElement('video');
      v.src = url;
      v.controls = true;
      v.playsInline = true;
      v.preload = 'metadata';
      v.poster = poster;
      v.style.display   = 'block';
      v.style.width     = '100%';
      v.style.maxHeight = '420px';
      v.style.objectFit = 'contain';
      img.replaceWith(v);
    }
  });
}
document.addEventListener('DOMContentLoaded', () => upgradeVideoImgs());
const list = document.getElementById('listaPensieri');
if (list) new MutationObserver(m => m.forEach(x => x.addedNodes.length && upgradeVideoImgs(list)))
  .observe(list, { childList:true, subtree:true });

function q(el, sel){ return el ? el.querySelector(sel) : null; }

function openMediaViewer(fromPost){
  const mv = document.getElementById('mediaViewer');
  const mvContent = document.getElementById('mvContent');
  const mvActions = document.getElementById('mvActions');
  if (!mv || !fromPost) return;

  mvContent.innerHTML = '';
  mvActions.innerHTML = '';

  // preferisci video
  const mediaWrap = fromPost.querySelector('.media');
  const type   = mediaWrap?.dataset?.type || mediaWrap?.dataset?.media || '';
  const src    = mediaWrap?.dataset?.src  || q(fromPost, 'video')?.src || q(fromPost, 'img')?.src || '';
  const poster = mediaWrap?.dataset?.poster || VIDEO_POSTER_FALLBACK;

  let node = null;
  if (type === 'video' || /\.(mp4|webm|ogg)(\?|$)/i.test(src)){
    node = document.createElement('video');
    node.src = src;
    node.controls = true;
    node.playsInline = true;
    node.preload = 'metadata';
    node.poster = poster;
  } else if (src){
    node = new Image();
    node.src = src;
    node.alt = 'Immagine';
  } else {
    return;
  }
  mvContent.appendChild(node);

  // forza la (ri)preparazione del buffer su iOS per evitare doppio tap
  if (node.tagName === 'VIDEO') {
    try { node.load(); } catch(e){}
  }

  // Reazioni: clona/collega
  const EMO_SET = ['❤️','✨','🕊','🕊️','🌹'];
  function findReactionButtons(scope){
    const btns = Array.from(scope.querySelectorAll('.react-btn, button, [role="button"]'));
    return btns
      .map(b=>{
        const key = b.getAttribute('data-react') || b.getAttribute('data-type') || '';
        const emo = (b.querySelector('.emo')?.textContent || b.textContent || '').trim();
        const cntEl = b.querySelector('.cnt') || b.querySelector('.count') || null;
        return { btn:b, key, emo, cntEl };
      })
      .filter(x => x.key || EMO_SET.includes(x.emo));
  }

  const postReacts = findReactionButtons(fromPost);
  if (postReacts.length){
    const wrap = document.createElement('div');
    wrap.className = 'mv-reacts';
    postReacts.forEach(({btn, key, emo})=>{
      const mirror = btn.cloneNode(true);
      mirror.removeAttribute('id');
      mirror.addEventListener('click', ()=>{
        const target = findReactionButtons(fromPost).find(x=> (x.key && x.key===key) || (!x.key && x.emo===emo) )?.btn;
        if (target) target.dispatchEvent(new MouseEvent('click', {bubbles:true}));
        setTimeout(()=>{
          const fresh = findReactionButtons(fromPost).find(x=> (x.key && x.key===key) || (!x.key && x.emo===emo) )?.cntEl?.textContent;
          const mine  = mirror.querySelector('.cnt') || mirror.querySelector('.count');
          if (fresh && mine) mine.textContent = fresh;
        }, 60);
      });
      wrap.appendChild(mirror);
    });
    mvActions.appendChild(wrap);
  }

  // Commenti: clone sicuro
  let origCmnt = fromPost.querySelector('[data-toggle-comments]');
  if (!origCmnt){
    origCmnt = Array.from(fromPost.querySelectorAll('button, [role="button"]')).find(b => /comment/i.test(b.textContent || ''));
  }
  if (origCmnt){
    const cmBtn = origCmnt.cloneNode(true);
    cmBtn.removeAttribute('id');
    cmBtn.addEventListener('click', ()=>{
      origCmnt.dispatchEvent(new MouseEvent('click', {bubbles:true}));
      setTimeout(()=>{
        const open = !!fromPost.querySelector('.cm-thread-wrap, .cm-thread');
        fromPost.classList.toggle('is-comments-open', open);
      },50);
    });
    mvActions.appendChild(cmBtn);
  }

  mv.classList.remove('hidden');
  mv.setAttribute('aria-hidden','false');
}

function closeMediaViewer(){
  const mv = document.getElementById('mediaViewer');
  if (!mv) return;
  document.getElementById('mvContent').innerHTML = '';
  document.getElementById('mvActions').innerHTML = '';
  mv.classList.add('hidden');
  mv.setAttribute('aria-hidden','true');
}

// Deleghe apertura/chiusura
document.addEventListener('click', (e)=>{
  const media = e.target.closest('.pensiero-box .media img, .pensiero-box .media video, .pensiero-box img, .pensiero-box video');
  if (media){
    const post = media.closest('.pensiero-box');
    openMediaViewer(post);
  }
  if (e.target.matches('[data-mv-close]')) closeMediaViewer();
});
document.addEventListener('keydown', (e)=>{ if (e.key==='Escape') closeMediaViewer(); });
