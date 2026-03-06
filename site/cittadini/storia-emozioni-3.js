/* storia-emozioni.js — OFI
   Lettura “cronache/emozioni” per ogni post (NO write). Inserisce una card elegante se trova 1 doc approved.
   API:
     - injectEmotionStyles()
     - maybeInsertEmotion(rootEl, post, db, opts?)
*/

import {
  getFirestore, collection, query, where, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------- Utils ---------- */
function _toDate(x){
  if (!x) return null;
  if (typeof x.toDate === "function") return x.toDate();
  const d = new Date(x);
  return isNaN(d.getTime()) ? null : d;
}
function _escape(s){
  return (s ?? "").toString().replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
}

/* ---------- Styles (iniettati una sola volta) ---------- */
export function injectEmotionStyles(){
  if (document.getElementById("ofi-emozione-style")) return;
  const css = `
  .ofi-emozione{
    margin: 18px 0 14px; padding: 12px 14px;
    border-left: 4px solid var(--gold, #caa85a);
    border-radius: 12px;
    background: color-mix(in oklab, var(--surface, #fff), #caa85a 6%);
    box-shadow: 0 4px 14px rgba(0,0,0,.06);
  }
  .ofi-emozione__h{
    display:flex; align-items:center; gap:8px;
    font-family: "Noto Serif", serif; font-weight:700; color: var(--ofi-blue,#0e2a4a);
    margin-bottom: 6px; letter-spacing:.2px;
  }
  .ofi-emozione__h img{ width:16px; height:16px; }
  .ofi-emozione__txt{
    margin:0; line-height:1.6; font-size:1.02rem;
    font-family:"EB Garamond", serif; color: color-mix(in oklab, #111, #999 12%);
    white-space:pre-wrap; overflow-wrap:anywhere;
  }
  @media (prefers-color-scheme: dark){
    .ofi-emozione{
      background: color-mix(in oklab, #0a1730 70%, white 30%);
      border-left-color:#caa85a;
    }
    .ofi-emozione__txt{ color:rgba(255,255,255,.92) }
  }`;
  const style = document.createElement("style");
  style.id = "ofi-emozione-style";
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);
}

/* ---------- DOM builder ---------- */
function _buildEmotionCard(text){
  const box = document.createElement("section");
  box.className = "ofi-emozione";
  box.setAttribute("role", "note");
  box.innerHTML = `
    <div class="ofi-emozione__h">
      <img src="../images/pensieri-logo.png" alt="">
      <span>Storia delle emozioni</span>
    </div>
    <p class="ofi-emozione__txt">${_escape(text)}</p>`;
  return box;
}

/* ---------- Loader della “cronaca approvata” ---------- */
async function _fetchApprovedEmotion(db, postId){
  try{
    const col = collection(db, `pensieri_utente/${postId}/emozioni_cronaca`);
    const q  = query(col,
      where('status','==','approved'),
      orderBy('updatedAt','desc'),
      limit(1)
    );
    const s = await getDocs(q);
    if (s.empty) return null;
    const d = s.docs[0].data();
    const text = (d?.text || "").toString().trim();
    return text || null;
  }catch(_){
    return null;
  }
}

/* ---------- Public API: monta la card se serve ---------- */
export async function maybeInsertEmotion(rootEl, post, db, opts = {}){
  try{
    if (!rootEl || !post || !db) return;
    // Evita duplicazioni
    if (rootEl.querySelector?.('.ofi-emozione')) return;

    // Solo post PUBBLICI
    const vis = (post.visibilita || (post.is_pubblico ? 'pubblico' : 'privato') || '').toLowerCase();
    if (vis !== 'pubblico') return;

    // Carica 1 testo approvato
    const text = await _fetchApprovedEmotion(db, post.id || post.postId || post.__id);
    if (!text) return;

    // Decide dove inserirla:
    // 1) se c'è la actions-row dei bottoni, mettiamo subito PRIMA (più coerente col flusso)
    // 2) altrimenti dopo il testo
    const target =
      rootEl.querySelector?.('.actions-row') ||
      rootEl.querySelector?.('.testo') ||
      rootEl;

    const card = _buildEmotionCard(text);
    target.parentElement?.insertBefore(card, target.nextSibling);
  }catch(e){
    // Non bloccare il resto della pagina
    console.warn('maybeInsertEmotion error', e);
  }
}
