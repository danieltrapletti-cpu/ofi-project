/* storia-emozioni.js — builder “card capitolo” calcolata al volo (no write) */

/** Util: differenza giorni tra due timestamp (Firestore Timestamp o ISO) */
function _toDate(x){ if(!x) return null; if(typeof x.toDate === "function") return x.toDate(); return new Date(x); }
function _daysDiff(a,b){
  const da=_toDate(a), db=_toDate(b);
  if(!da||!db) return Infinity;
  return Math.floor(Math.abs(da - db) / (1000*60*60*24));
}

/** Estrae info minime normalizzate dal post */
function _norm(p){
  const hashtags = Array.isArray(p.hashtags) ? p.hashtags.map(h=>String(h).toLowerCase()) : [];
  return {
    id: p.id || p.postId || p.__id || null,
    createdAt: p.createdAt || p.data?.createdAt || p.timestamp || p.ts || null,
    luogo: (p.luogo?.comune || p.luogo?.citta || p.luogo || "").toString().trim(),
    mediaType: (p.mediaType || p.tipoMedia || (p.videoUrl?'video':(p.imageUrl?'image':'text'))),
    hashtags,
    reazioni: Number(p.reazioni_count ?? p.reazioniTot ?? p.reactions ?? 0) || 0,
    lumina: Number(p.lumina_totale ?? p.lumina ?? p.luminaScore ?? 0) || 0
  };
}

/**
 * Decide se inserire una “card emozione” tra prev e curr.
 * Ritorna {type, text} oppure null.
 */
export function decideEmotion(prevPost, currPost, opts={}){
  const o = { gapDays: 21, minReazioni: 12, minLuminaJump: 15, ...opts };
  const prev = prevPost ? _norm(prevPost) : null;
  const curr = _norm(currPost);

  // 1) Cambio periodo / silenzio lungo
  if(prev){
    const gap = _daysDiff(curr.createdAt, prev.createdAt);
    if(gap >= o.gapDays){
      return {
        type: "silenzio",
        text: `Un momento di silenzio ha accompagnato questo passaggio (${gap} giorni).`
      };
    }
  }

  // 2) Cambio luogo
  if(prev && prev.luogo && curr.luogo && prev.luogo !== curr.luogo){
    return { type: "luogo", text: `A ${curr.luogo} l’autore riapre un ricordo.` };
  }

  // 3) Tema ricorrente (intersezione hashtag "caldi")
  if(prev){
    const hot = ["mamma","papà","anniversario","amore","casa","cimitero","natale","compleanno"];
    const hasHot = curr.hashtags.some(h=>hot.includes(h));
    const wasHot = prev.hashtags.some(h=>hot.includes(h));
    if(hasHot && wasHot){
      const tema = curr.hashtags.find(h=>hot.includes(h));
      return { type:"tema", text: `Ritorna un pensiero su “#${tema}”.` };
    }
  }

  // 4) Picco di reazioni
  if(prev && curr.reazioni >= o.minReazioni && curr.reazioni > prev.reazioni){
    return { type:"reazioni", text: `Tanto affetto si è raccolto attorno a questo pensiero (+${curr.reazioni}).` };
  }

  // 5) Salto Lumina
  if(prev && (curr.lumina - prev.lumina) >= o.minLuminaJump){
    return { type:"lumina", text: `La luce di Lumina cresce e illumina il cammino (+${curr.lumina - prev.lumina}).` };
  }

  // 6) Svolta di media
  if(prev && prev.mediaType !== curr.mediaType){
    if(curr.mediaType === "video") return { type:"media", text: "Ora la memoria trova anche voce e movimento." };
    if(curr.mediaType === "image") return { type:"media", text: "Un’immagine aggiunge un dettaglio gentile al ricordo." };
    if(curr.mediaType === "text")  return { type:"media", text: "Le parole tornano al centro di questo passaggio." };
  }

  return null;
}

/** Crea DOM della card emozione (vanilla, senza dipendenze) */
export function createEmotionNode(payload){
  const wrap = document.createElement("div");
  wrap.className = "ofi-emozione";
  wrap.setAttribute("role","note");
  wrap.innerHTML = `
    <div class="ofi-emozione__inner">
      <div class="ofi-emozione__dot" aria-hidden="true"></div>
      <p class="ofi-emozione__text">${payload.text}</p>
    </div>`;
  return wrap;
}

/** Helper per inserire la card PRIMA del nodo corrente */
export function maybeInsertEmotion(prevPost, currPost, currDomNode, opts){
  const payload = decideEmotion(prevPost, currPost, opts);
  if(!payload) return;
  const node = createEmotionNode(payload);
  currDomNode.parentNode?.insertBefore(node, currDomNode);
}

/** Stili minimi consigliati (facoltativo: puoi spostarli nel tuo CSS) */
export function injectEmotionStyles(){
  if(document.getElementById("ofi-emozione-style")) return;
  const css = `
  .ofi-emozione{margin:14px 0 10px; padding:10px 14px; background:#fafafa; border:1px solid #eee; border-left:4px solid #caa35e; border-radius:12px}
  .ofi-emozione__inner{display:flex; align-items:center; gap:10px}
  .ofi-emozione__dot{width:8px;height:8px;border-radius:999px;background:#caa35e}
  .ofi-emozione__text{margin:0; font-size:.95rem; line-height:1.4; color:#333}
  `;
  const style = document.createElement("style");
  style.id = "ofi-emozione-style";
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);
}
