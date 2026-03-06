/* pensieri-miei.actions-compact.js — OFI
   Compatta le azioni (icone + aria-label) e garantisce "Rispondi" anche nelle reply
   ------------------------------------------------------------------------------- */

(function(){
  const SCOPE = document.getElementById('listaPensieri') || document;

  // Mappa icone: puoi sostituire con SVG in futuro
  const ICONS = {
    reply: '↩︎',
    edit:  '✎',
    delete:'🗑️',
    report:'⚑'
  };

  function compactActions(root){
    root.querySelectorAll('.cm-actions').forEach(wrap => {
      wrap.querySelectorAll('.cm-link').forEach(link => {
        const act = link.getAttribute('data-act');
        const label = link.getAttribute('data-label') || link.textContent.trim();
        if (!act) return;

        // Evita doppie conversioni
        if (link.__ofiCompacted) return;
        link.__ofiCompacted = true;

        // Trasforma in icona con aria-label
        link.setAttribute('aria-label', label);
        link.title = label;
        link.textContent = ICONS[act] || label;
        link.classList.add('cm-ico');
      });

      // Garantisci "Rispondi" nelle risposte
      const item = wrap.closest('.cm-item');
      const repliesWrap = item?.parentElement?.querySelector?.('.cm-replies');
      if (repliesWrap){
        const hasReply = wrap.querySelector('[data-act="reply"]');
        if (!hasReply){
          const a = document.createElement('a');
          a.className = 'cm-link cm-ico';
          a.setAttribute('data-act','reply');
          a.setAttribute('data-label','Rispondi');
          a.setAttribute('aria-label','Rispondi');
          a.title = 'Rispondi';
          a.textContent = ICONS.reply;
          wrap.appendChild(a);
        }
      }
    });
  }

  function observe(){
    const target = document.getElementById('listaPensieri');
    if (!target) return;
    const obs = new MutationObserver(muts => {
      muts.forEach(m => {
        m.addedNodes.forEach(n => {
          if (!(n instanceof HTMLElement)) return;
          if (n.matches('.pensiero-box, .cm-thread, .cm-item')) compactActions(n);
          else compactActions(n);
        });
      });
    });
    obs.observe(target, { childList:true, subtree:true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    compactActions(SCOPE);
    observe();
  });
})();
