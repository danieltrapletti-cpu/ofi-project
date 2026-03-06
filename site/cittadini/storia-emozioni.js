/* storia-emozioni.js — OFI
   Card “Storia dell’autore” con nuovo modello + fallback estesi
   API:
     - injectEmotionStyles()
     - maybeInsertEmotion({ db, postId, into, opts })
       opts: { showAlsoPrivate?: boolean, label?: string }
     - refreshEmotionForPost({ db, postId, container, label? })  // NEW
     - (evento) document.dispatchEvent(new CustomEvent('ofi:emotion-updated', { detail:{ postId, text, label? } }))  // NEW
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
function makeCard(label, text, postId){
  const box = document.createElement('div');
  box.className = 'ofi-emozione';
  box.setAttribute('data-animate','in');
  if (postId) box.dataset.postId = postId;
  box.innerHTML = `
    <div class="ofi-emozione-h">
      <!-- NB: path corretto dalla pagina /cittadini/ -->
      <img src="../images/pensieri-logo.png" alt="" />
      <span>${esc(label||"Storia dell’autore")}</span>
    </div>
    <p>${esc(text)}</p>`;
  return box;
}
function resolveContainer(into){
  return (typeof into === 'string') ? document.querySelector(into) : into;
}
function findContainerByPostId(postId){
  return (
    document.querySelector(`[data-post-id="${postId}"] .pensiero-box`) ||
    document.querySelector(`.pensiero-box[data-post-id="${postId}"]`) ||
    null
  );
}
function upsertIntoContainer(container, card, { anchorSelector='.meta' } = {}){
  if (!container) return false;
  // rimuovi l'eventuale card esistente
  const old = container.querySelector('.ofi-emozione');
  if (old) old.remove();
  // inserisci prima dell'ancora (se c'è) o in coda
  const anchor = container.querySelector(anchorSelector) || container.lastElementChild;
  container.insertBefore(card, anchor);
  return true;
}

/* ————— fetch nuova/vecchia cronaca (tollerante) ————— */
async function fetchEmotionDoc(db, postId, { showAlsoPrivate=false } = {}){
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
    }catch{ /* next path */ }
  }

  // fallback: campo inline sul documento del post
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
    }catch{ /* continue */ }
  }

  return null;
}

/* ————— API: render iniziale con fetch ————— */
export async function maybeInsertEmotion({ db, postId, into, opts={} }){
  try{
    injectEmotionStyles();
    const container = resolveContainer(into);
    if (!container) return false;

    const label = opts.label || "Storia dell’autore";
    const showAlsoPrivate = !!opts.showAlsoPrivate;

    const rifl = await fetchEmotionDoc(db, postId, { showAlsoPrivate });
    if (!rifl?.text) return false;

    const card = makeCard(label, rifl.text, postId);
    upsertIntoContainer(container, card);
    return true;
  }catch{
    return false;
  }
}

/* ————— API: refresh live facendo la query ————— */
export async function refreshEmotionForPost({ db, postId, container, label }){
  try{
    injectEmotionStyles();
    const target = container || findContainerByPostId(postId);
    if (!target) return false;

    const rifl = await fetchEmotionDoc(db, postId, { showAlsoPrivate:true });
    if (!rifl?.text) return false;

    const card = makeCard(label || "Storia dell’autore", rifl.text, postId);
    upsertIntoContainer(target, card);
    return true;
  }catch{
    return false;
  }
}

/* ————— Listener globale: update immediato post-salvataggio —————
   Usa questo quando hai già il testo appena salvato e vuoi evitare una nuova query.
   Emetti: document.dispatchEvent(new CustomEvent('ofi:emotion-updated', { detail:{ postId, text, label } }))
*/
document.addEventListener('ofi:emotion-updated', (e) => {
  try{
    const { postId, text, label } = e.detail || {};
    if (!postId || !text) return;
    injectEmotionStyles();
    const container = findContainerByPostId(postId);
    if (!container) return;
    const card = makeCard(label || "Storia dell’autore", text, postId);
    upsertIntoContainer(container, card);
  }catch{ /* no-op */ }
});
