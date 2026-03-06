/* pensieri-miei-comments-ui.js — FIXED & COMPACT
   - Thread commenti per ogni .pensiero-box
   - Mini-reazioni (commenti & risposte) con refresh immediato
   - Conteggio coerente (.cm-count e .cCount nella card)
   - Paginazione locale (2 iniziali +4) con “Mostra altri …”
*/

import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, serverTimestamp,
  query, where, orderBy, onSnapshot, doc, setDoc, deleteDoc, getDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const auth = getAuth();
const db   = getFirestore();
const $$ = (s,ctx=document)=>Array.from(ctx.querySelectorAll(s));
const $  = (s,ctx=document)=>ctx.querySelector(s);

// ---------- Utils ----------
function cleanText(s){
  let t = (s||"").trim();
  t = t.replace(/<[^>]+>/g, "");
  if (/https?:\/\//i.test(t) && t.length < 15) return "";
  if (t.length < 2) return "";
  const bad = /(cazzo|merda|vaff|troia|stronzo)/i;
  if (bad.test(t)) return "";
  return t.slice(0, 500);
}
function tpl(id){ return (document.getElementById(id)?.content?.firstElementChild)?.cloneNode(true); }
function fmtTime(ts){
  try{
    const d = ts?.toDate ? ts.toDate() : (ts || new Date());
    return new Intl.DateTimeFormat('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(d);
  }catch{ return ""; }
}
async function getUserMiniProfile(uid){
  if(!uid) return { nome:"Utente", avatar:"../images/avatar-uomo.png" };
  try{
    const s = await getDoc(doc(db,"utenti_cittadini",uid));
    const d = s.exists() ? s.data() : {};
    const nome = d?.nome_utente || [d?.nome,d?.cognome].filter(Boolean).join(" ") || "Utente";
    let avatar = d?.foto || d?.fotoProfiloURL || d?.avatarURL || "";
    if(!avatar) avatar = (d?.avatar==="donna") ? "../images/avatar-donna.png" : "../images/avatar-uomo.png";
    return { nome, avatar };
  }catch{
    return { nome:"Utente", avatar:"../images/avatar-uomo.png" };
  }
}

// ---------- Mini-reazioni ----------
async function toggleMiniReaction(cRef, uid, emoji){
  const snap = await getDoc(cRef);
  let reactions = {}, counts = {};
  if (snap.exists()){
    reactions = snap.data().reactions || {};
    counts    = snap.data().counts    || {};
  }
  const prev = reactions[uid] || null;
  if (prev === emoji){
    delete reactions[uid];
    counts[emoji] = Math.max(0, (counts[emoji]||0)-1);
  } else {
    if (prev){ counts[prev] = Math.max(0, (counts[prev]||0)-1); }
    reactions[uid] = emoji;
    counts[emoji] = (counts[emoji]||0) + 1;
  }
  await updateDoc(cRef, { reactions, counts, editTime: serverTimestamp() });
}

function initMiniReactionRow(rowEl, data, currentUid, btnContainer=null){
  const counts = data?.counts || {};
  const mine   = data?.reactions ? data.reactions[currentUid||""] : null;
  $$(".cm-react", btnContainer || rowEl).forEach(b=>{
    const e = $(".emo", b)?.textContent;
    $(".cnt", b).textContent = counts[e] || 0;
    const isMine = (mine === e);
    b.classList.toggle("active", isMine);
    b.setAttribute("aria-pressed", isMine ? "true" : "false");
  });
}

function wireMiniReactions(btnGroup, cRef){
  $$(".cm-react", btnGroup).forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const u = auth.currentUser; if(!u) return;
      const emo = $(".emo", btn)?.textContent || "👍";
      try{
        await toggleMiniReaction(cRef, u.uid, emo);
        const snap = await getDoc(cRef);
        if(snap.exists()){
          initMiniReactionRow(btnGroup, snap.data(), u.uid, btnGroup);
        }
      }catch(e){ console.warn("mini react err", e); }
    });
  });
}

// ---------- Permessi ----------
function updateActionVisibility(row, currentUid, commentUid, ownerUid){
  const canEdit = currentUid && (currentUid === commentUid);
  const canDelete = currentUid && (currentUid === commentUid || currentUid === ownerUid);
  const edit = $('[data-act="edit"]', row);
  const del  = $('[data-act="delete"]', row);
  if (edit) edit.hidden = !canEdit;
  if (del)  del.hidden  = !canDelete;
}

// ---------- Renderer risposta ----------
async function renderReply(replyDoc, ownerUid){
  const el = tpl("tpl-reply-item");
  const d = replyDoc.data();
  const prof = await getUserMiniProfile(d.uid);
  $(".cm-avatar img", el).src = prof.avatar;
  $(".cm-name", el).textContent = prof.nome;
  $(".cm-time", el).textContent = fmtTime(d.data || d.createdAt);
  $(".cm-text", el).textContent = d.testo || "";

  updateActionVisibility(el, auth.currentUser?.uid, d.uid, ownerUid);

  const btnGroupR = el.querySelector('.cm-actions .cm-reactions');
  initMiniReactionRow(el, d, auth.currentUser?.uid, btnGroupR);

  const cRef = replyDoc.ref;
  $('[data-act="delete"]', el)?.addEventListener("click", async ()=>{
    const ok = confirm("Eliminare questa risposta?"); if(!ok) return;
    try{ await deleteDoc(cRef); }catch(e){ alert("Non riesco a eliminarla ora."); }
  });
  $('[data-act="edit"]', el)?.addEventListener("click", async ()=>{
    const txt = prompt("Modifica risposta:", d.testo || ""); 
    const clean = cleanText(txt);
    if (!clean) return;
    try{ await updateDoc(cRef, { testo: clean, editato:true, editTime: serverTimestamp() }); }catch(e){}
  });

  wireMiniReactions(btnGroupR, cRef);
  return el;
}

// ---------- Renderer commento ----------
async function renderComment(docSnap, ownerUid){
  const el = tpl("tpl-comment-item");
  const d = docSnap.data();
  const prof = await getUserMiniProfile(d.uid);
  $(".cm-avatar img", el).src = prof.avatar;
  $(".cm-name", el).textContent = prof.nome;
  $(".cm-time", el).textContent = fmtTime(d.data || d.createdAt);
  $(".cm-text", el).textContent = d.testo || "";

  updateActionVisibility(el, auth.currentUser?.uid, d.uid, ownerUid);

  const btnGroup = el.querySelector('.cm-actions .cm-reactions');
  initMiniReactionRow(el, d, auth.currentUser?.uid, btnGroup);

  // risposte
  const repWrap = $('[data-role="replies"]', el);
  const repForm = $('[data-role="reply-form"]', el);

  $('[data-act="reply"]', el)?.addEventListener("click", ()=>{
    repForm.hidden = !repForm.hidden;
    $('.cm-reply-input', el)?.focus();
  });
  repForm?.addEventListener("submit", async (ev)=>{
    ev.preventDefault();
    const u = auth.currentUser; if(!u) return alert("Accedi per rispondere.");
    const input = $(".cm-reply-input", repForm);
    const clean = cleanText(input.value);
    if(!clean) return;
    try{
      await addDoc(collection(db, "pensieri_commenti"), {
        pid: d.pid, parentId: docSnap.id, uid: u.uid, testo: clean, data: serverTimestamp()
      });
      input.value = "";
      repForm.hidden = true;
    }catch(e){ alert("Non riesco a inviare la risposta ora."); }
  });

  // Modifica/Elimina commento
  $('[data-act="delete"]', el)?.addEventListener("click", async ()=>{
    const ok = confirm("Eliminare questo commento e le relative risposte?"); if(!ok) return;
    try{
      const repQ = query(collection(db,"pensieri_commenti"), where("parentId","==", docSnap.id));
      const unsub = onSnapshot(repQ, async (ss)=>{
        unsub();
        const dels = ss.docs.map(s=> deleteDoc(s.ref));
        await Promise.allSettled(dels);
        await deleteDoc(docSnap.ref);
      });
    }catch(e){ alert("Non riesco a eliminarlo ora."); }
  });
  $('[data-act="edit"]', el)?.addEventListener("click", async ()=>{
    const txt = prompt("Modifica commento:", d.testo || ""); 
    const clean = cleanText(txt);
    if (!clean) return;
    try{ await updateDoc(docSnap.ref, { testo: clean, editato:true, editTime: serverTimestamp() }); }catch(e){}
  });

  wireMiniReactions(btnGroup, docSnap.ref);

  // stream risposte
  const qRep = query(
    collection(db,"pensieri_commenti"),
    where("pid","==", d.pid),
    where("parentId","==", docSnap.id),
    orderBy("data","asc")
  );
  const repMap = new Map();
  onSnapshot(qRep, async (ss)=>{
    const docs = ss.docs;
    const active = new Set(docs.map(x=> x.id));
    for (const r of docs){
      const id = r.id;
      if (!repMap.has(id)){
        const node = await renderReply(r, ownerUid);
        repMap.set(id, node);
        repWrap.appendChild(node);
      } else {
        const node = repMap.get(id);
        initMiniReactionRow(node, r.data(), auth.currentUser?.uid, node.querySelector('.cm-actions .cm-reactions'));
      }
    }
    for (const [id, node] of Array.from(repMap.entries())){
      if (!active.has(id)){
        node.remove();
        repMap.delete(id);
      }
    }
  });

  return el;
}

// ---------- Thread container ----------
function injectThread(box){
  if (box.querySelector(".cm-thread")) return box.querySelector(".cm-thread");
  const wrap = document.createElement("div");
  wrap.className = "cm-thread-wrap";
  const t = tpl("tpl-comment-thread");
  wrap.appendChild(t);
  box.appendChild(wrap);
  const thread = $(".cm-thread", wrap);
  thread.hidden = true;
  return thread;
}

// ---------- Mount per ogni post ----------
async function mount(box){
  if (box.__cmMounted) return;
  box.__cmMounted = true;

  const pid = box.dataset.pid;
  const ownerUid = box.dataset.owner || "";
  const isPub = (box.dataset.vis === "pubblico");
  const thread = injectThread(box);

  const list = $('[data-role="comment-list"]', thread);
  const form = $('[data-role="comment-form"]', thread);
  const headCount = $(".cm-count", thread);
  const bottomToggle = $('[data-role="load-more"]', thread);

  if (!isPub){
    thread.classList.add("readonly");
    let note = $(".cm-readonly-note", thread);
    if (!note){
      note = document.createElement("div");
      note.className = "cm-readonly-note";
      note.textContent = "Questo post è privato: i commenti (se presenti) sono visibili solo a te.";
      form.insertAdjacentElement("afterend", note);
    }
  }

  form?.addEventListener("submit", async (ev)=>{
    ev.preventDefault();
    const u = auth.currentUser; if(!u) return alert("Accedi per commentare.");
    const input = $(".cm-input", form);
    const clean = cleanText(input.value);
    if(!clean) return;
    try{
      await addDoc(collection(db, "pensieri_commenti"), {
        pid, parentId: "", uid: u.uid, testo: clean, data: serverTimestamp()
      });
      input.value = "";
    }catch(e){ alert("Non riesco a inviare il commento ora."); }
  });

  // --- stream commenti top-level (incrementale, anti-flicker) ---
  let showN = 2;
  const qTop = query(
    collection(db,"pensieri_commenti"),
    where("pid","==", pid),
    where("parentId","in", ["", null]),
    orderBy("data","asc")
  );

  const rowsMap = new Map();
  let latestDocs = [];

  async function renderFromState(){
    const total = latestDocs.length;
    headCount.textContent = String(total);
    const chip = box.querySelector(".cCount");
    if (chip) chip.textContent = String(total);

    const toShow = latestDocs.slice(0, showN);
    const activeIds = new Set(toShow.map(d=> d.id));

    for (const d of toShow){
      const id = d.id;
      const data = d.data();
      if (!rowsMap.has(id)){
        const row = await renderComment(d, ownerUid);
        rowsMap.set(id, row);
        list.appendChild(row);
      } else {
        const row = rowsMap.get(id);
        initMiniReactionRow(row, data, auth.currentUser?.uid, row.querySelector('.cm-actions .cm-reactions'));
      }
    }
    for (const [id, el] of Array.from(rowsMap.entries())){
      if (!activeIds.has(id)){
        el.remove();
        rowsMap.delete(id);
      }
    }

    const remain = Math.max(0, total - showN);
    if (remain > 0){
      bottomToggle.hidden = false;
      bottomToggle.textContent = `Mostra altri ${remain}`;
    } else {
      bottomToggle.hidden = true;
    }
  }

  onSnapshot(qTop, async (ss)=>{
    latestDocs = ss.docs;
    renderFromState();
  });

  bottomToggle.addEventListener("click", ()=>{
    const remain = Math.max(0, (latestDocs.length - showN));
    if (remain <= 0) return;
    showN += Math.min(4, remain);
    renderFromState();
  });

  thread.addEventListener("manual-refresh", ()=>{});
}

// API pubblica minimale
window.Comments = { mount };

// chiamato dopo che le card sono nel DOM
window.OFI_commentsSetup = ()=>{
  $$(".pensiero-box").forEach(box=> mount(box));
};

// opzionale
window.Comments.onOpen = (/*box*/)=>{};
