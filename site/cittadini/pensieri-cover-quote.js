// pensieri-cover-quote.js — OFI (v2.2 profilo-sync, autore invariato)
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
const $ = (id)=>document.getElementById(id);
const elPhrase = $("cqPhrase");
const elAuthor = $("cqAuthor");
const btnEdit  = $("cqEdit");
const btnShare = $("cqShare");
const menu     = $("cqMenu");
const modal    = $("cqModal");
const mFrase   = $("cqmFrase");
const mAutore  = $("cqmAutore");
const mSave    = $("cqmSave");
const mCancel  = $("cqmCancel");

let UID = null;
let PROFILE = null;

onAuthStateChanged(auth, async (user)=>{
  if(!user){ paint({}); return; }
  UID = user.uid;
  const snap = await getDoc(doc(db,"utenti_cittadini", UID));
  PROFILE = snap.exists() ? snap.data() : {};
  paint(PROFILE);
});

// ===== Paint: usa SEMPRE i campi del profilo (frase, autore, vis_*). Niente override col nome.
function paint(p){
  const frase  = (p?.frase || "Sii l’autore di te stesso.").trim();
  const autore = (p?.autore || "").trim();
  const visF   = !!p?.vis_frase;
  const visA   = !!p?.vis_autore;

  if (elPhrase) elPhrase.textContent = frase;

  // Autore visibile SOLO se flag vis_autore è attivo e c'è testo autore
  const authorText = (visA && autore) ? autore : "";
  if (elAuthor) elAuthor.textContent = authorText;
}

// Modifica (modale)
btnEdit?.addEventListener("click", ()=>{
  mFrase.value  = PROFILE?.frase  || "";
  mAutore.value = PROFILE?.autore || "";
  modal.removeAttribute("hidden");
});
mCancel?.addEventListener("click", ()=> modal.setAttribute("hidden",""));

mSave?.addEventListener("click", async ()=>{
  const frase  = mFrase.value.trim();
  const autore = mAutore.value.trim();
  await setDoc(doc(db,"utenti_cittadini", UID), { frase, autore }, { merge:true });
  PROFILE = { ...(PROFILE||{}), frase, autore };
  paint(PROFILE);
  window.dispatchEvent(new CustomEvent("ofi:profile-updated", { detail:{
    frase, autore,
    vis_frase: !!PROFILE?.vis_frase,
    vis_autore: !!PROFILE?.vis_autore,
    nome: PROFILE?.nome||"", cognome: PROFILE?.cognome||""
  }}));
  modal.setAttribute("hidden","");
});

// Condivisione
btnShare?.addEventListener("click", ()=> menu?.toggleAttribute("hidden"));
menu?.addEventListener("click", (e)=>{
  const act = e.target?.getAttribute?.("data-act");
  if(!act) return;
  if(act==="share-quote"){
    const txt = `“${elPhrase?.textContent||""}”${elAuthor?.textContent ? " — "+elAuthor.textContent : ""}`;
    navigator.share?.({ text: txt }).catch(()=> navigator.clipboard?.writeText(txt));
  }else if(act==="share-board"){
    const url = `${location.origin}/cittadini/autore-pubblico.html?id=${UID}`;
    navigator.share?.({ url }).catch(()=> navigator.clipboard?.writeText(url));
  }else if(act==="copy-quote"){
    const txt = `“${elPhrase?.textContent||""}”${elAuthor?.textContent ? " — "+elAuthor.textContent : ""}`;
    navigator.clipboard?.writeText(txt);
  }
  menu?.setAttribute("hidden","");
});

// Aggiornamenti dalla barra
window.addEventListener("ofi:profile-updated", (ev)=>{
  PROFILE = { ...(PROFILE||{}), ...(ev.detail||{}) };
  paint(PROFILE);
});
window.addEventListener("ofi:open-cover-editor", ()=> btnEdit?.click());
