/* storia-emozioni.js — OFI
   Card “Storia dell’autore” con nuovo modello + fallback estesi
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
      <!-- NB: path corretto dalla pagina /cittadini/ -->
      <img src="../images/pensieri-logo.png" alt="" />
      <span>${esc(label||"Storia dell’autore")}</span>
    </div>
    <p>${esc(text)}</p>`;
  return box;
}

/* ————— fetch nuova/vecchia cronaca (tollerante) ————— */
async function fetchEmotionDoc(db, postId, { showAlsoPrivate=false } = {}){
  // helper: prova una serie di query su una subcollection
  async function tryQueries(colRef){
    // Modello nuovo: pubblico/live
    let s = await getDocs(query(
      colRef,
      where('scope','==','public'),
      where('state','==','live'),
      orderBy('updatedAt','desc'),
      limit(1)
    ));
    if (!s.empty) return s.docs[0].data();

    // Opzionale privato (per bacheca personale)
    if (showAlsoPrivate){
      s = await getDocs(query(
        colRef,
        where('scope','==','private'),
        where('state','==','live'),
        orderBy('updatedAt','desc'),
        limit(1)
      ));
      if (!s.empty) return s.docs[0].data();
    }

    // Legacy con status
    s = await getDocs(query(
      colRef,
      where('status','in',['approved','live','published']),
      orderBy('updatedAt','desc'),
      limit(1)
    ));
    if (!s.empty) return s.docs[0].data();

    // Best-effort: ultimo per updatedAt
    s = await getDocs(query(colRef, orderBy('updatedAt','desc'), limit(1)));
    if (!s.empty) return s.docs[0].data();

    return null;
  }

  // 1) prova più path plausibili di subcollection
  const subPaths = [
    `pensieri_utente/${postId}/emozioni_cronaca`,
    `pensieri/${postId}/emozioni_cronaca`,
    `pensieri_pubblici/${postId}/emozioni_cronaca`
  ];

  for (const p of subPaths){
    try{
      const colRef = collection(db, p);
      const data = await tryQueries(colRef);
      if (data){
        const text = String(
          data.text ?? data.riflessione ?? data.note ?? ''
        ).trim();
        if (text) return { text };
      }
    }catch{ /* passa al prossimo path */ }
  }

  // 2) fallback: campo inline sul documento del post
  const docPaths = [
    `pensieri_utente/${postId}`,
    `pensieri/${postId}`,
    `pensieri_pubblici/${postId}`
  ];
  for (const dp of docPaths){
    try{
      const snap = await getDoc(doc(db, dp));
      if (snap.exists()){
        const d = snap.data();
        const text = String(
          d?.riflessione ?? d?.emotionText ?? d?.storia_emozioni ?? ''
        ).trim();
        if (text) return { text };
      }
    }catch{ /* continua */ }
  }

  return null;
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
    const anchor = target.querySelector('.meta') || target.lastElementChild;
    target.insertBefore(node, anchor);

    return true;
  }catch{
    return false;
  }
}
