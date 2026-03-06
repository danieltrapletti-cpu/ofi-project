
/*! OFI Core — consolidated build (Agente OFI incluso) */
/* eslint-disable no-var, prefer-const */
(function(){
  'use strict';

  /* ===== Helpers ===== */
  const $  = (s, ctx=document)=>ctx.querySelector(s);
  const $$ = (s, ctx=document)=>Array.from(ctx.querySelectorAll(s));
  function ready(fn){ 
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once:true });
    else fn();
  }

  /* ===== Title helper (optional) ===== */
  function setDocTitle(suffix){
    try{
      const base = document.title.replace(/\s+—\s+OFI.*/, '');
      document.title = (suffix? (suffix+' — ') : '') + base.split(' — ')[0] + ' — OFI';
    }catch{ /* noop */}
  }
  window.OFI = Object.assign(window.OFI || {}, { setDocTitle });

  /* ===== Theme ===== */
  function initTheme(){
    const themeBtn = $('#themeToggle');
    const stored = localStorage.getItem('ofi-theme');
    if (stored) document.body.classList.toggle('theme-dark', stored === 'dark');
    if (themeBtn){
      themeBtn.addEventListener('click', ()=>{
        const dark = !document.body.classList.contains('theme-dark');
        document.body.classList.toggle('theme-dark', dark);
        localStorage.setItem('ofi-theme', dark ? 'dark' : 'light');
      });
    }
  }

  /* ===== Menu (desktop+mobile) ===== */
  function initMenu(){
    const menu = $('#menuPanel');
    if (!menu) return;
    const toggle = $('#menuToggle');
    const overlay = $('#menuOverlay');
    const closeBtn = $('#menuClose');

    function openMenu(){
      menu.classList.add('open');
      if (toggle){ toggle.classList.add('active'); toggle.setAttribute('aria-expanded','true'); }
      if (overlay){ overlay.hidden = false; overlay.addEventListener('click', closeMenu, { once:true }); }
      document.body.style.overflow='hidden';
    }
    function closeMenu(){
      menu.classList.remove('open');
      if (toggle){ toggle.classList.remove('active'); toggle.setAttribute('aria-expanded','false'); }
      if (overlay){ overlay.hidden = true; }
      document.body.style.overflow='';
    }
    toggle && toggle.addEventListener('click', (e)=>{
      e.preventDefault();
      menu.classList.contains('open') ? closeMenu() : openMenu();
    });
    closeBtn && closeBtn.addEventListener('click', closeMenu);
  }

  /* ===== Reveal on view ===== */
  function initReveal(){
    document.documentElement.classList.add('js');
    const els = $$('.reveal');
    if (!els.length || !('IntersectionObserver' in window)) return;
    const obs = new IntersectionObserver(entries=>{
      entries.forEach(e=>{
        if(e.isIntersecting){ e.target.classList.add('visible'); obs.unobserve(e.target); }
      });
    }, { threshold:.12 });
    els.forEach(el=>obs.observe(el));
  }

  /* ===== Back to top ===== */
  function initBackTop(){
    const backTop = $('#backTop');
    if(!backTop) return;
    function onScroll(){ backTop.classList.toggle('show', window.scrollY>600); }
    window.addEventListener('scroll', onScroll, { passive:true });
    backTop.addEventListener('click', ()=> window.scrollTo({top:0, behavior:'smooth'}));
    onScroll();
  }

  /* ===== Mapbox (only if present) ===== */
  function initMapbox(){
    const mapEl = $('#map');
    if (!mapEl || !window.mapboxgl) return;
    try{
      mapboxgl.accessToken = 'pk.eyJ1IjoiZHQ4MiIsImEiOiJjbWFtem4xN2Ewbmx4Mm1zZHgzaGRhbXZzIn0.RwNWi1alAkO61qgd3AjEsg';
      const map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [12.4964, 41.9028],
        zoom: 5.2
      });
      const geoBtn = $('#geoBtn');
      const toast  = $('#geoToast');
      function showToast(msg){
        if(!toast) return;
        toast.textContent = msg;
        toast.style.display = 'block';
        setTimeout(()=> toast.style.display='none', 2600);
      }
      function addMarker(lngLat, type='impresa'){
        const el = document.createElement('div');
        el.className = 'marker ' + (type==='supporto' ? 'supporto' : 'impresa');
        new mapboxgl.Marker(el).setLngLat(lngLat).addTo(map);
      }
      geoBtn && geoBtn.addEventListener('click', ()=>{
        if (!navigator.geolocation){ showToast('Geolocalizzazione non supportata.'); return; }
        navigator.geolocation.getCurrentPosition(pos=>{
          const { longitude, latitude } = pos.coords;
          map.flyTo({ center:[longitude, latitude], zoom:12 });
          addMarker([longitude, latitude], 'impresa');
          showToast('Posizione rilevata!');
        }, ()=> showToast('Impossibile rilevare la posizione.'));
      });
    }catch(e){ /* ignore map errors */ }
  }

  /* ===== Video tabs (mp4 + YT nocookie) ===== */
  function initVideoTabs(){
    const stage = $('.video-stage');
    const tabs  = $$('.video-tabs .tab');
    if(!stage || !tabs.length) return;

    const VIDEOS = {
      benvenuto: { type:'mp4', src:'videos/OFI.mp4', poster:'images/OFI-Social.png', label:'Video di Benvenuto OFI' },
      spot:      { type:'yt',  id:'iyKTbfzBgpw', label:'Spot di Onoranze Funebri Italia' } // aggiorna l'ID se serve
    };

    function tpl(v){
      if(v.type === 'mp4'){
        return [
          '<div class="ratio">',
          '<video controls playsinline poster="'+(v.poster||'')+'">',
          '<source src="'+v.src+'" type="video/mp4">',
          '</video>',
          '</div>',
          v.label ? '<p class="small" aria-live="polite" style="margin:.5rem 0 0; opacity:.9">'+v.label+'</p>' : ''
        ].join('');
      }else{
        const src = 'https://www.youtube-nocookie.com/embed/'+v.id+'?rel=0&modestbranding=1&playsinline=1&autohide=1&controls=1';
        return [
          '<div class="ratio">',
          '<iframe src="'+src+'" title="'+(v.label||'Video OFI')+'" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>',
          '</div>',
          v.label ? '<p class="small" aria-live="polite" style="margin:.5rem 0 0; opacity:.9">'+v.label+'</p>' : ''
        ].join('');
      }
    }

    function select(key){
      tabs.forEach(t=> t.classList.toggle('active', t.dataset.key===key));
      stage.innerHTML = tpl(VIDEOS[key] || VIDEOS.benvenuto);
    }

    tabs.forEach(t=> t.addEventListener('click', ()=> select(t.dataset.key)));
    select('benvenuto');
  }

  /* ===== Fix "Home" links (root) ===== */
  function initHomeLinksFix(){
    function toRootHref(href) {
      try {
        const a = document.createElement('a');
        a.href = href;
        const isIndex = /(^|\/)index\.html$/i.test(a.pathname);
        if (isIndex) return '/' + (a.hash ? a.hash.replace(/^#/, '') : '');
        return href;
      } catch { return href; }
    }
    function fixHomeLinks(root = '/'){
      const header = $('header.site-header, .site-header');
      if (!header) return;
      const brandLink = header.querySelector('.brand a[href]');
      if (brandLink) brandLink.setAttribute('href', root);
      const menuLinks = header.querySelectorAll('.menu a[href]');
      menuLinks.forEach(a => {
        const text = (a.textContent || '').trim().toLowerCase();
        const href = a.getAttribute('href') || '';
        if (text === 'home' || /(^|\/)index\.html(\#.*)?$/i.test(href)) {
          a.setAttribute('href', root);
        } else {
          const normalized = toRootHref(href);
          if (normalized !== href) a.setAttribute('href', normalized || '/');
        }
      });
    }
    fixHomeLinks('/');
    const header = $('header.site-header, .site-header');
    if (header && window.MutationObserver){
      const mo = new MutationObserver(()=> fixHomeLinks('/'));
      mo.observe(header, { childList:true, subtree:true });
    }
  }

  /* ===== Agente OFI (single authority) ===== */
  function initAgenteOFI(){
    const panel = $('#agentPanel');
    if(!panel) return;
    if (panel.__ofiReady) return; // idempotente
    panel.__ofiReady = true;

    const fab      = $('#agentFab');      // floating button (toggle)
    const openBtn  = $('#openAgent');     // open from section button
    const closeBtn = $('#agentClose');    // X inside panel
    const form     = $('#agentForm');
    const input    = $('#agentInput');
    const chat     = $('#agentChat') || $('.agent-chat');

    let lastFocus = null;
    function openAgent(){
      lastFocus = document.activeElement;
      panel.classList.add('open');
      panel.setAttribute('aria-hidden','false');
      panel.removeAttribute('inert');
      fab && fab.setAttribute('aria-expanded','true');
      if (input) setTimeout(()=>{ try{ input.focus(); }catch{} }, 20);
    }
    function closeAgent(){
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden','true');
      panel.setAttribute('inert','');
      fab && fab.setAttribute('aria-expanded','false');
      if (lastFocus && typeof lastFocus.focus === 'function') { try{ lastFocus.focus(); }catch{} }
    }
    function toggleAgent(){ panel.classList.contains('open') ? closeAgent() : openAgent(); }

    // Bind (avoid double-binding)
    function once(el, type, handler){
      if (!el) return;
      const key = '__ofiBound_'+type;
      if (el[key]) return;
      el.addEventListener(type, handler);
      el[key] = true;
    }

    once(fab, 'click', (e)=>{ e.preventDefault(); toggleAgent(); });
    once(openBtn, 'click', (e)=>{ e.preventDefault(); openAgent(); });
    once(closeBtn, 'click', (e)=>{ e.preventDefault(); closeAgent(); });

    // ESC to close (global – once)
    if (!window.__ofiAgentEsc){
      window.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeAgent(); }, { passive:true });
      window.__ofiAgentEsc = true;
    }

    // Click outside to close — but ignore clicks on the FAB or inside it
    if (!window.__ofiAgentOutside){
      document.addEventListener('click', (e)=>{
        if (!panel.classList.contains('open')) return;
        const clickedOnFab = fab && (e.target === fab || fab.contains(e.target));
        if (clickedOnFab) return;
        if (panel.contains(e.target)) return;
        closeAgent();
      });
      window.__ofiAgentOutside = true;
    }

    // Simple demo replies (optional)
    function addIn(text){
      if(!chat) return;
      chat.insertAdjacentHTML('beforeend', `<div class="msg msg-in"><p>${text}</p></div>`);
      chat.scrollTop = chat.scrollHeight;
    }
    function addOut(text){
      if(!chat) return;
      chat.insertAdjacentHTML('beforeend', `<div class="msg msg-out"><p>${text}</p></div>`);
      chat.scrollTop = chat.scrollHeight;
    }
    function replyTo(q){
      const t = (q||'').toLowerCase();
      const rules = [
        {k:['preventivo','preventivi'], a:`Per richiedere un preventivo vai in <strong>Richiedi Preventivo</strong>. Dopo l'invio, l'amministratore verifica e le imprese ricevono la richiesta; puoi seguire lo stato. <a href='faq.html#cittadini'>Apri la guida</a>.`},
        {k:['necrologio','necrologi','anniversario','anniversari'], a:`Dalla sezione <strong>Necrologi & Anniversari</strong> puoi pubblicare avvisi ufficiali. <a href='faq.html#necrologi'>Guida</a>.`},
        {k:['pensieri','pensiero'], a:`PENSIERI è la bacheca sociale di OFI: scrivi in privato o condividi. <a href='pensieri-pubblici.html'>Apri PENSIERI</a> · <a href='faq.html#pensieri'>Guida</a>.`},
        {k:['luogo della memoria','memoria'], a:`Il <strong>Luogo della Memoria</strong> fissa sulla mappa un posto simbolico. <a href='faq.html#ricordi'>Scopri di più</a>.`},
      ];
      const hit = rules.find(r => r.k.some(k => t.includes(k)));
      addOut(q);
      setTimeout(()=> addIn(hit ? hit.a : "Posso aprirti la guida o passarti ai contatti utili. Dimmi in che cosa ti aiuto."), 220);
    }
    
    // Chips: quick questions
    const chips = panel.querySelectorAll('.chip');
    chips.forEach(ch => {
      ch.addEventListener('click', () => {
        const q = ch.getAttribute('data-q') || (ch.textContent || '').trim();
        if(!q) return;
        if (input) input.value = q;
        // auto-submit
        replyTo(q);
        if (input) input.value = '';
      });
    });

  if(form && input){
      once(form, 'submit', (e)=>{
        e.preventDefault();
        const val = (input.value||'').trim();
        if(!val) return;
        replyTo(val);
        input.value='';
      });
    }
  }

  /* ===== Init all ===== */
  ready(()=>{
    initTheme();
    initReveal();
    initBackTop();
    initMapbox();
    initVideoTabs();
    initHomeLinksFix();
    initAgenteOFI(); // <-- unico gestore per l'Agente OFI
  });

})();

/* Agente OFI — bootstrap universale e idempotente (estratto da ofi.js, rimosse tag <script>/<style>) */
(function(){
  const fab   = document.getElementById('agentFab');
  const panel = document.getElementById('agentPanel');
  const btnX  = document.getElementById('agentClose');
  if (!fab || !panel) return; // la pagina non ha l’Agente

  function openAgent(){ panel.setAttribute('aria-hidden','false'); fab.setAttribute('aria-expanded','true'); }
  function closeAgent(){ panel.setAttribute('aria-hidden','true');  fab.setAttribute('aria-expanded','false'); }
  function toggleAgent(){ (panel.getAttribute('aria-hidden') === 'true') ? openAgent() : closeAgent(); }

  // Evita doppie bind se lo script gira più volte
  if (!fab.dataset.ofiAgentBound){
    fab.addEventListener('click', toggleAgent);
    if (btnX) btnX.addEventListener('click', closeAgent);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAgent(); });
    fab.dataset.ofiAgentBound = '1';
  }

 })();
