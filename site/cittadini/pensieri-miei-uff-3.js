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
import { maybeInsertEmotion, injectEmotionStyles } from "./storia-emozioni.js";
injectEmotionStyles(); // una sola volta

// Flag per non riaprire il dialogo alla seconda/terza volta sullo stesso post (prima pubblicazione)
const wasEmotionAsked  = (pid)=> localStorage.getItem(`ofi-emo-first:${pid}`) === '1';
const markEmotionAsked = (pid)=> localStorage.setItem(`ofi-emo-first:${pid}`, '1');

/* ===== Helpers ===== */
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

  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';

  const SUGG = [
    "Vorrei ricordare…","In questo momento sento…","Se potessi parlare a me stesso di allora…",
    "Mi manca…","Oggi ho capito che…","Una cosa che non ho mai detto…",
    "Porto con me…","Un gesto che non dimentico…","Un pensiero di gratitudine…",
    "Una luce che mi accompagna…","Quando chiudo gli occhi rivedo…","Se potessi abbracciare quel momento…"
  ];

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
          ${SUGG.map(t=>`<button type="button" class="chip" data-s="${t}">${t}</button>`).join('')}
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
  const close = ()=>{ overlay.remove(); document.documentElement.style.overflow = prevOverflow; };

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

/* ===== Quando un post diventa pubblico per la PRIMA volta ===== */
async function onPostBecamePublicFirstTime(pid){
  try{
    if (wasEmotionAsked(pid)) return; // già chiesto in passato per questo post

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

        // aggiorna UI card
        try {
          const box = document.querySelector(`.pensiero-box[data-pid="${pid}"]`);
          if (box) {
            await maybeInsertEmotion({ db, postId: pid, into: box, opts:{ showAlsoPrivate:true } });
          }
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

/* ===== NUOVO: Prompt riflessione all’arrivo da pensieri-scrivi ===== */
async function maybePromptRiflessioneOnNewPost(){
  const pid = getNewPostIdFromURL();
  if (!pid) return;

  try{
    const s = await getDoc(doc(db, 'pensieri_utente', pid));
    if (!s.exists()) { removeQueryParam('newPostId'); return; }
    const d = s.data() || {};
    // sicurezza: solo autore
    if ((d.uid||'') !== (auth.currentUser?.uid||'')) { removeQueryParam('newPostId'); return; }

    // se è già pubblico, non forziamo qui (la prima volta farà il suo flusso onPostBecamePublicFirstTime)
    const isPriv = (d.visibilita || 'privato') === 'privato';

    // controlla se esiste già almeno una emozione_cronaca
    const emoCol = collection(db, `pensieri_utente/${pid}/emozioni_cronaca`);
    const emoSnap = await getDocs(query(emoCol, limit(1)));
    const hasEmo = !emoSnap.empty;

    if (isPriv && !hasEmo){
      openEmotionQuickDialog({
        onSkip(){
          removeQueryParam('newPostId');
        },
        async onSave({ text, makePublic }){
          removeQueryParam('newPostId');
          if (!text) return;

          const scope = makePublic ? 'public' : 'private';
          await addDoc(emoCol, {
            text, scope, state:'live', uid:(auth?.currentUser?.uid||''),
            createdAt: serverTimestamp(), updatedAt: serverTimestamp()
          });

          // salva preview per render veloce
          await updateDoc(doc(db,'pensieri_utente', pid), { riflessione_preview: text.slice(0,240), updatedAt: serverTimestamp() });

          // prova a innestare subito nella card se già renderizzata
          const box = document.querySelector(`.pensiero-box[data-pid="${pid}"]`);
          if (box){
            try { await maybeInsertEmotion({ db, postId: pid, into: box, opts:{ showAlsoPrivate:true } }); } catch {}
            const toast = document.createElement('div');
            toast.className = 'ofi-emo-toast';
            toast.textContent = "Riflessione salvata. Puoi renderlo pubblico quando vuoi ✨";
            document.body.appendChild(toast);
            setTimeout(()=> toast.remove(), 2200);
          }
        }
      });
    } else {
      // niente prompt → pulisci param
      removeQueryParam('newPostId');
    }
  }catch{
    removeQueryParam('newPostId');
  }
}

/* ===== Helpers UI: passaggio pubblico/privato ===== */
function closeMediaViewerIfBelongsTo(box){
  const mv = $("mediaViewer");
  if (!mv || mv.classList.contains("hidden")) return;
  // se il MV è aperto e proviene da questa card, chiudilo (così non mostra reazioni clonate)
  // Nota: salviamo il pid nel dataset quando apriamo
  const mvPid = mv.dataset.pid || "";
  const pid = box?.dataset?.pid || "";
  if (mvPid && pid && mvPid === pid){
    // trigger close
    const closeBtn = qs("[data-mv-close]");
    if (closeBtn) closeBtn.click();
    else {
      mv.classList.add("hidden"); mv.setAttribute("aria-hidden","true");
      const iv = Number(mv.dataset.syncInt||0); if (iv) clearInterval(iv);
      mv.removeAttribute('data-sync-int');
    }
  }
}

function detachNodeEvents(node){
  // cloning trick per rimuovere tutti i listener
  if (!node) return null;
  const clone = node.cloneNode(true);
  node.replaceWith(clone);
  return clone;
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

  // chips reazioni/commenti
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

  // reactions row
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

  // bottone Commenti
  let btnC = box.querySelector(".openComments");
  if (btnC){
    btnC.style.display = "";
    btnC.classList.remove("onlyIfHasComments");
    btnC.textContent = "Commenti";
  }

  // commenti: sblocca
  const th = box.querySelector(".cm-thread");
  if (th){ th.classList.remove("readonly"); }

  // (ri)aggancia reazioni
  hookReactions(box.closest(".post") || box, p).catch(console.warn);
}

function ensurePrivateUI(box, p){
  if (!box) return;
  box.dataset.vis = "privato";
  box.classList.remove("is-public");
  box.classList.add("is-private");

  // 1) Chiudi il Media Viewer se sta mostrando questo post
  closeMediaViewerIfBelongsTo(box);

  // 2) Badge + toggle
  const badge = box.querySelector(".badge-vis");
  if (badge){ badge.textContent = "Privato"; badge.classList.add("privato"); badge.classList.remove("pubblico"); }
  const tgl = box.querySelector(".toggle-vis-min");
  if (tgl) tgl.textContent = "Rendi pubblico";

  // 3) Nascondi condivisione
  const shareBtn = box.querySelector(".sharePost");
  if (shareBtn) shareBtn.style.display = "none";

  // 4) RIMUOVI dal DOM la row delle reazioni (non solo hide)
  //    (così non può "riapparire" da sync/clone o da stili)
  const reacts = box.querySelectorAll(".reactions-row");
  reacts.forEach(row => row.remove());

  // 5) Chips reazioni/commenti → nascondi
  const chips = box.querySelector(".lumina-chips");
  if (chips) chips.style.display = "none";

  // 6) Commenti: mantieni pulsante ma indica "solo tu" e thread in sola lettura
  const btnC = box.querySelector(".openComments");
  if (btnC){
    btnC.style.display = ""; // resta visibile
    btnC.classList.add("onlyIfHasComments");
    btnC.textContent = "Commenti (solo tu)";
  }
  const th = box.querySelector(".cm-thread");
  if (th){ th.classList.add("readonly"); }

  // 7) BONIFICA eventuali cloni nel Media Viewer (se rimasti per qualunque motivo)
  //    (mvActions è vuotato in closeMediaViewer, ma per sicurezza puliamo ancora)
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
    refreshKpi();

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

  // Reazioni (solo se pubblico)
  if (isPub) { hookReactions(el, p).catch(console.warn); }

  // Storia delle Emozioni — in bacheca mostriamo anche per PRIVATI
  try {
    await maybeInsertEmotion({ db, postId: p.id, into: box, opts: { showAlsoPrivate: true }});
  } catch (e) {
    console.warn("maybeInsertEmotion errore", e);
  }

  // Toggle visibilità — UI ottimistica + refresh live
  el.querySelector(".toggle-vis-min")?.addEventListener("click", async (ev)=>{
    const btn = ev.currentTarget;
    const box = el.querySelector(".pensiero-box");

    const wasPub = (p.visibilita === 'pubblico' || p.is_pubblico === true);
    const newVis  = wasPub ? "privato" : "pubblico";

    // UI ottimistica immediata
    p.visibilita = newVis;
    p.is_pubblico = (newVis === 'pubblico');
    if (newVis === "pubblico") ensurePublicUI(box, p); else ensurePrivateUI(box, p);
    btn.disabled = true;

    try{
      await updateDoc(doc(db,"pensieri_utente", p.id), {
        visibilita: newVis,
        is_pubblico: (newVis === 'pubblico'),
        updatedAt: serverTimestamp()
      });

      // se appena reso pubblico → chiedi “Storia dell’autore” solo la primissima volta
      if (!wasPub && newVis === 'pubblico') {
        await onPostBecamePublicFirstTime(p.id);
      }

      refreshKpi();
    }catch(err){
      console.error(err);
      // rollback
      const rollbackVis = wasPub ? 'pubblico' : 'privato';
      p.visibilita = rollbackVis;
      p.is_pubblico = (rollbackVis === 'pubblico');
      if (rollbackVis === "pubblico") ensurePublicUI(box, p); else ensurePrivateUI(box, p);
      alert("Impossibile aggiornare la visibilità in questo momento.");
    } finally {
      btn.disabled = false;
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

  // Elimina
  el.querySelector(".deletePost")?.addEventListener("click", async () => {
    try {
      await deletePostCascade(p);
    } catch (e) {
      console.error("Errore eliminazione post:", e);
      // opzionale: toast error
    }
  });

  return el;
}

/* ===== Hook reazioni ===== */
async function hookReactions(root, post){
  // se la card è privata, non agganciare nulla
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
      // se nel frattempo è diventato privato, ignora
      const host = btn.closest(".pensiero-box");
      if (host?.dataset?.vis === "privato") return;

      const u = auth.currentUser; if (!u) return;
      const type = btn.dataset.react || btn.dataset.type;
      const prev = my;
      my = (prev===type) ? null : type;

      // toggle UI
      qsa(".react-btn", root).forEach(b=> b.classList.toggle('active', (b.dataset.react||b.dataset.type)===my));

      // recalc counts localmente
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
      // sincronizza sulla card (click sul clone → click sull'originale)
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

onAuthStateChanged(auth, async (user)=>{
  if(!user){
    lista.innerHTML = `<p>Devi accedere per vedere e gestire i tuoi pensieri.</p>`;
    hideSkeleton(); return;
  }
  await loadUserHeader(user);
  await loadFirst();
  // NUOVO: prompt riflessione se arrivo da pensieri-scrivi con newPostId
  await maybePromptRiflessioneOnNewPost();
});
