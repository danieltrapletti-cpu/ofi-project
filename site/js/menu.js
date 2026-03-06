// site/js/menu.js
(()=>{
  const $  = (s,sc=document)=>sc.querySelector(s);
  const $$ = (s,sc=document)=>Array.from(sc.querySelectorAll(s));

  const header    = $('.site-header') || $('header');
  const toggleBtn = $('#menuToggle');
  const closeBtn  = $('#menuClose');
  const panel     = $('#menuPanel');
  const overlay   = $('#menuOverlay');
  const mqDesktop = window.matchMedia('(min-width:901px)');

  if (!panel) return;

  // ---- Utils
  const setHeaderH = ()=>{
    const h = header?.offsetHeight || 64;
    document.documentElement.style.setProperty('--headerH', h + 'px');
  };

  const closeAllSubmenus = (scope=document)=>{
    $$('.has-sub.open', scope).forEach(li=>{
      li.classList.remove('open');
      li.querySelector('a[aria-haspopup="true"]')?.setAttribute('aria-expanded','false');
    });
  };

  const openDrawer = ()=>{
    document.documentElement.classList.add('menu-open');
    document.body.classList.add('menu-open');
    panel.classList.add('open');
    toggleBtn?.classList.add('active');
    toggleBtn?.setAttribute('aria-expanded','true');
    if (overlay){
      overlay.classList.add('show');     // richiede fix CSS sotto
      overlay.removeAttribute('hidden');
      overlay.style.display = 'block';
      overlay.style.pointerEvents = 'auto';
    }
  };

  const closeDrawer = ()=>{
    document.documentElement.classList.remove('menu-open');
    document.body.classList.remove('menu-open');
    panel.classList.remove('open');
    toggleBtn?.classList.remove('active');
    toggleBtn?.setAttribute('aria-expanded','false');
    if (overlay){
      overlay.classList.remove('show');
      overlay.setAttribute('hidden','');
      overlay.style.display = '';
      overlay.style.pointerEvents = '';
    }
    closeAllSubmenus(panel);
  };

  // ---- Toggler con anti-doppio evento
  let lastToggleAt = 0;
  const TOGGLE_DEBOUNCE = 280; // ms

  const toggleDrawer = (e)=>{
    e?.preventDefault?.(); e?.stopPropagation?.();
    const now = performance.now();
    if (now - lastToggleAt < TOGGLE_DEBOUNCE) return; // ignora doppio tap
    lastToggleAt = now;

    if (panel.classList.contains('open')) closeDrawer();
    else openDrawer();
  };

  // ---- Submenu (delegation)
  panel.addEventListener('click', (e)=>{
    const trigger = e.target.closest('.has-sub > a[aria-haspopup="true"]');
    if (!trigger) return;
    e.preventDefault(); e.stopPropagation();
    const li = trigger.closest('.has-sub');
    const isOpen = li.classList.toggle('open');
    trigger.setAttribute('aria-expanded', String(isOpen));

    $$('.has-sub.open', panel).forEach(other=>{
      if (other !== li){
        other.classList.remove('open');
        other.querySelector('a[aria-haspopup="true"]')?.setAttribute('aria-expanded','false');
      }
    });
  }, {passive:false});

  // Click “fuori” dal submenu nel drawer → chiudi solo i submenu (non il drawer)
  panel.addEventListener('click', (e)=>{
    if (e.target.closest('.has-sub.open')) return;
    if (e.target.closest('.has-sub > a[aria-haspopup="true"]')) return;
    closeAllSubmenus(panel);
  }, {capture:true, passive:true});

  // Desktop: click globale chiude dropdown aperti
  document.addEventListener('click', (e)=>{
    if (e.target.closest('.has-sub.open')) return;
    closeAllSubmenus(document);
  }, {capture:true, passive:true});

  // ---- Aperture/chiusure drawer
  // ✅ Un solo evento: pointerup (copre mouse, touch, pen). Niente touchend/click doppi.
  toggleBtn?.addEventListener('pointerup', toggleDrawer, {passive:false});
  closeBtn?.addEventListener('pointerup', (e)=>{ e.preventDefault(); closeDrawer(); }, {passive:false});
  overlay?.addEventListener('pointerup', closeDrawer, {passive:true});

  // Chiudi il drawer SOLO dopo la navigazione (mobile)
panel.addEventListener('click', (e)=>{
  const a = e.target.closest('a[href]');
  if (!a) return;

  // Non chiudere per trigger submenu o voci "finte"
  if (a.matches('a[aria-haspopup="true"], .no-close')) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  const href = (a.getAttribute('href')||'').trim();
  const isAnchor   = href.startsWith('#') || href === '' || href.startsWith('javascript:');

  // Chiudi solo se è una vera navigazione (non # ancora-pagina)
  if (!isAnchor && window.matchMedia('(max-width:900px)').matches){
    setTimeout(()=>{ /* lascia partire la navigazione, poi chiudi */
      try{ closeDrawer(); }catch(_){}
    }, 250);
  }
}, {passive:false});


  // ESC chiude
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape') closeDrawer();
  });

  // ---- Breakpoint reset
  const handleBP = ()=>{
    setHeaderH();
    if (mqDesktop.matches){
      closeDrawer();
    }
  };
  mqDesktop.addEventListener('change', handleBP);
  window.addEventListener('resize', setHeaderH);
  setHeaderH();
})();
