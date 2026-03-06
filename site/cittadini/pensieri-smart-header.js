// pensieri-smart-header.js — OFI (v3.3: eye link + fix)
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc,
  collection, query, where, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function ensureApp(){
  if (getApps().length) return getApp();
  const cfg = (window.OFI && window.OFI.firebaseConfig) || {
    apiKey:"AIzaSyAy0UMiRscG-F1B9YxT7gHHyxLBOwOo2vs",
    authDomain:"ofi2025-51ba9.firebaseapp.com",
    projectId:"ofi2025-51ba9",
    storageBucket:"ofi2025-51ba9.firebasestorage.app",
    messagingSenderId:"345581339212",
    appId:"1:345581339212:web:f0b8bc241945691c876ae9"
  };
  return initializeApp(cfg);
}

const app  = ensureApp();
const auth = getAuth(app);
const db   = getFirestore(app);

// DOM
const $ = (id) => document.getElementById(id);
const elAvatar = $("shAvatar");
const elName   = $("shName");
const kTot     = $("shTot");
const kPub     = $("shPub");
const kLumina  = $("shLumina");
const badge    = $("shAuthorBadge");
const btnSearch= $("shSearchBtn");
const btnShare = $("shShareBtn");
const btnEdit  = $("shEditBtn");
const btnAdd   = $("shAddBtn");

// Crea/aggancia il bottone "occhio" (accanto alle azioni, vicino al badge)
let viewBtn = document.getElementById("shViewBtn");
if(!viewBtn){
  viewBtn = document.createElement("button");
  viewBtn.id = "shViewBtn";
  viewBtn.className = "ico-btn";
  viewBtn.title = "Vedi pagina pubblica autore";
  viewBtn.setAttribute("aria-label","Vedi pagina pubblica autore");
  const span = document.createElement("span");
  span.className = "ico";
  span.textContent = "👁️";
  viewBtn.appendChild(span);
  const actions = document.querySelector(".sh-actions");
  // lo metto tra Share e Edit (se non c’è lo aggiungo in coda)
  (actions?.children?.length)
    ? actions.insertBefore(viewBtn, btnEdit || null)
    : actions?.appendChild(viewBtn);
}

let CURRENT_UID = null;
let PROFILE = null;

onAuthStateChanged(auth, async (user) => {
  if (!user){ paintLoggedOut(); return; }
  CURRENT_UID = user.uid;
  await loadProfile();
  paintHeader();
  hydrateCounters().catch(()=>{});
  wireActions();
});

async function loadProfile(){
  const ref  = doc(db, "utenti_cittadini", CURRENT_UID);
  const snap = await getDoc(ref);
  PROFILE = snap.exists() ? snap.data() : {};
}

async function hydrateCounters(){
  try{
    const q1 = query(collection(db,"pensieri_utente"), where("uid","==", CURRENT_UID));
    const c1 = await getCountFromServer(q1);
    kTot.textContent = c1.data().count || 0;
  }catch{}
  try{
    const q2 = query(collection(db,"pensieri_utente"),
                     where("uid","==", CURRENT_UID), where("visibilita","==","pubblico"));
    const c2 = await getCountFromServer(q2);
    kPub.textContent = c2.data().count || 0;
  }catch{}
  kLumina.textContent = PROFILE?.lumina || 0;
}

function fullName(x){
  const n = (x?.nome||"").trim();
  const c = (x?.cognome||"").trim();
  return (n||c) ? `${n}${n&&c?" ":""}${c}` : "—";
}

function paintHeader(){
  const src = PROFILE?.foto || "../images/avatar-uomo.png";
  if (elAvatar) elAvatar.src = src;
  if (elName)   elName.textContent = fullName(PROFILE);

  const on = !!PROFILE?.is_autore_pubblico;
  badge?.classList.toggle("on", on);

  // Occhio: visibile solo se Autore pubblico è attivo
  if (viewBtn){
    viewBtn.style.display = on ? "inline-flex" : "none";
  }

  dispatchCoverSync();
}

function dispatchCoverSync(){
  const ev = new CustomEvent("ofi:profile-updated", {
    detail: {
      frase : PROFILE?.frase || "",
      autore: PROFILE?.autore || "",
      vis_frase : !!PROFILE?.vis_frase,
      vis_autore: !!PROFILE?.vis_autore,
      is_autore_pubblico: !!PROFILE?.is_autore_pubblico,
      nome: PROFILE?.nome || "",
      cognome: PROFILE?.cognome || ""
    }
  });
  window.dispatchEvent(ev);
}

function wireActions(){
  btnSearch?.addEventListener("click", ()=>{
    const header = document.getElementById("smartHeader");
    header?.classList.add("is-search");
    document.getElementById("searchBox")?.focus();
  });
  document.getElementById("shSearchClose")?.addEventListener("click", ()=>{
    document.getElementById("smartHeader")?.classList.remove("is-search");
  });

  btnShare?.addEventListener("click", ()=>{
    const url = `${location.origin}/cittadini/autore-pubblico.html?id=${CURRENT_UID}`;
    navigator.clipboard?.writeText(url);
    btnShare.classList.add("primary");
    setTimeout(()=>btnShare.classList.remove("primary"), 900);
  });

  btnEdit?.addEventListener("click", ()=>{
    window.dispatchEvent(new CustomEvent("ofi:open-cover-editor", {
      detail: { frase: PROFILE?.frase||"", autore: PROFILE?.autore||"" }
    }));
  });

  // Pulsante "occhio" → pagina pubblica autore
  viewBtn?.addEventListener("click", ()=>{
    const url = `${location.origin}/cittadini/autore-pubblico.html?id=${CURRENT_UID}`;
    window.location.href = url;
  });

  btnAdd?.addEventListener("click", ()=>{ location.href = "pensieri-scrivi.html"; });

  // Toggle Autore pubblico (non tocca più l'autore della cover)
  badge?.addEventListener("click", async ()=>{
    const next = !badge.classList.contains("on");
    badge.classList.toggle("on", next);
    await setDoc(doc(db,"utenti_cittadini", CURRENT_UID), { is_autore_pubblico: next }, { merge:true });
    PROFILE.is_autore_pubblico = next;

    // mostra/nascondi occhio
    if (viewBtn) viewBtn.style.display = next ? "inline-flex" : "none";

    dispatchCoverSync();
  });
}

function paintLoggedOut(){
  if (elAvatar) elAvatar.src = "../images/avatar-uomo.png";
  if (elName)   elName.textContent = "—";
  kTot.textContent = "0"; kPub.textContent = "0"; kLumina.textContent = "0";
  if (viewBtn) viewBtn.style.display = "none";
}
