/* storia-emozioni.js — OFI
   Card “Storia dell’autore” con nuovo modello + fallback legacy
   API:
     - injectEmotionStyles()
     - maybeInsertEmotion({ db, postId, into, opts })
       opts: { showAlsoPrivate?: boolean, label?: string }
*/

import {
  getFirestore, collection, query, where, orderBy, limit, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ————— stile minimale della card (idempotente) ————— */
export function injectEmotionStyles(){
  if (document.getElementById('ofi-emozioni-style')) return;
  const css = `
  .ofi-emozione{margin:1.25rem 0;padding:1rem;border:1px solid var(--divider,#e6e6e6);border-radius:14px;background:var(--surface,#fff);box-shadow:0 1px 0 rgba(0,0,0,.02)}
  .ofi-emozione-h{display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem;font-weight:700}
  .ofi-emozione-h img{width:22px;height:22px;object-fit:contain;opacity:.9}
  .ofi-emozione p{margin:0;line-height:1.55}
  .ofi-emozione[data-animate="in"]{animation:ofiFadeSlide .35s ease-out both}
  @keyframes ofiFadeSlide{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  `;
  const tag = document.createElement('style');
  tag.id = 'ofi-emozioni-style';
  tag.textContent = css;
  document.head.appendChild(tag);
}

/* ————— util ————— */
function esc(s){ return String(s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])); }
function h(label, text){
  const box = document.createElement('div');
  box.className = 'ofi-emozione';
  box.setAttribute('data-animate','in');
  box.innerHTML = `
    <div class="ofi-emozione-h">
      <img src="./images/pensieri-logo.png" alt="" />
      <span>${esc(label||"Storia dell’autore")}</span>
    </div>
    <p>${esc(text)}</p>`;
  return box;
}

/* ————— fetch nuova/vecchia cronaca ————— */
async function fetchEmotionDoc(db, postId, { showAlsoPrivate=false }={}){
  const col = collection(db, `pensieri_utente/${postId}/emozioni_cronaca`);

  // 1) nuovo modello (public/live) — per viste pubbliche
  const qNew = query(col, where('scope','==','public'), where('state','==','live'),
                     orderBy('updatedAt','desc'), limit(1));
  let s = await getDocs(qNew);

  // 2) opzionale: anche private (solo quando siamo in bacheca personale)
  if (showAlsoPrivate && s.empty){
    const qPriv = query(col, where('scope','==','private'), where('state','==','live'),
                        orderBy('updatedAt','desc'), limit(1));
    s = await getDocs(qPriv);
  }

  // 3) fallback legacy
  if (s.empty){
    const qOld = query(col, where('status','==','approved'),
                       orderBy('updatedAt','desc'), limit(1));
    s = await getDocs(qOld);
  }

  if (s.empty) return null;
  const data = s.docs[0].data();
  const text = String(data.text||"").trim();
  return text ? { text } : null;
}

/* ————— API principale —————
   - into può essere un Element o un selector string
*/
export async function maybeInsertEmotion({ db, postId, into, opts={} }){
  try{
    injectEmotionStyles();
    const target = (typeof into === 'string') ? document.querySelector(into) : into;
    if (!target) return false;

    const label = opts.label || "Storia dell’autore";
    const showAlsoPrivate = !!opts.showAlsoPrivate;

    const rifl = await fetchEmotionDoc(db, postId, { showAlsoPrivate });
    if (!rifl?.text) return false;

    const node = h(label, rifl.text);
    target.appendChild(node);
    return true;
  }catch{ return false; }
}
