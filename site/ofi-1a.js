/* ===== OFI Core ===== */
(function(){
  const $ = (s, ctx=document)=>ctx.querySelector(s);
  const $$ = (s, ctx=document)=>Array.from(ctx.querySelectorAll(s));
  // --- Utility: document title ---
  function setDocTitle(suffix){
    try{
      const base = document.title.replace(/\s+—\s+OFI.*/, '');
      document.title = (suffix? (suffix+' — ') : '') + base.split(' — ')[0] + ' — OFI';
    }catch{}
  }


  // --- MENU (desktop+mobile) ---
  const menu = document.querySelector('#menuPanel');
  const toggle = document.querySelector('#menuToggle');
  const overlay = document.querySelector('#menuOverlay');
  const closeBtn = document.querySelector('#menuClose');

  function openMenu(){
    if(!menu) return;
    menu.classList.add('open');
    if (toggle){ toggle.classList.add('active'); toggle.setAttribute('aria-expanded','true'); }
    if (overlay){ overlay.hidden = false; overlay.addEventListener('click', closeMenu, { once:true }); }
    document.body.style.overflow='hidden';
  }
  function closeMenu(){
    if(!menu) return;
    menu.classList.remove('open');
    if (toggle){ toggle.classList.remove('active'); toggle.setAttribute('aria-expanded','false'); }
    if (overlay){ overlay.hidden = true; }
    document.body.style.overflow='';
  }
  if(toggle) toggle.addEventListener('click', e=>{
    e.preventDefault();
    (menu && menu.classList.contains('open')) ? closeMenu() : openMenu();
  });
  if(closeBtn) closeBtn.addEventListener('click', closeMenu);

  // --- THEME ---
  const themeBtn = document.querySelector('#themeToggle');
  const storedTheme = localStorage.getItem('ofi-theme');
  if (storedTheme){ document.body.classList.toggle('theme-dark', storedTheme==='dark'); }
  if (themeBtn){
    themeBtn.addEventListener('click', ()=>{
      const dark = !document.body.classList.contains('theme-dark');
      document.body.classList.toggle('theme-dark', dark);
      localStorage.setItem('ofi-theme', dark ? 'dark' : 'light');
    });
  }

  // --- REVEAL ---
  document.documentElement.classList.add('js');
  const obs = new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      if(e.isIntersecting){ e.target.classList.add('visible'); obs.unobserve(e.target); }
    });
  }, { threshold:.12 });
  Array.from(document.querySelectorAll('.reveal')).forEach(el=>obs.observe(el));

  // --- BACK TO TOP ---
  const backTop = document.querySelector('#backTop');
  function onScroll(){
    if(backTop) backTop.classList.toggle('show', window.scrollY>600);
  }
  window.addEventListener('scroll', onScroll, { passive:true });
  if(backTop) backTop.addEventListener('click', ()=> window.scrollTo({top:0, behavior:'smooth'}));

  // --- MAPBOX (only if present) ---
  const mapEl = document.querySelector('#map');
  if (mapEl && window.mapboxgl){
    mapboxgl.accessToken = 'pk.eyJ1IjoiZHQ4MiIsImEiOiJjbWFtem4xN2Ewbmx4Mm1zZHgzaGRhbXZzIn0.RwNWi1alAkO61qgd3AjEsg';
    const map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [12.4964, 41.9028],
      zoom: 5.2
    });
    const geoBtn = document.querySelector('#geoBtn');
    const toast = document.querySelector('#geoToast');
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
    if (geoBtn){
      geoBtn.addEventListener('click', ()=>{
        if (!navigator.geolocation){ showToast('Geolocalizzazione non supportata.'); return; }
        navigator.geolocation.getCurrentPosition(pos=>{
          const { longitude, latitude } = pos.coords;
          map.flyTo({ center:[longitude, latitude], zoom:12 });
          addMarker([longitude, latitude], 'impresa');
          showToast('Posizione rilevata!');
        }, ()=> showToast('Impossibile rilevare la posizione.'));
      });
    }
  }

  // --- AGENTE OFI (chat) ---
  const panel = document.querySelector('#agentPanel');
  const fab = document.querySelector('#agentFab');
  const openBtn = document.querySelector('#openAgent');
  const closeAgent = document.querySelector('#agentClose');
  const chat = document.querySelector('#agentChat');
  const form = document.querySelector('#agentForm');
  const input = document.querySelector('#agentInput');

  function openPanel(){
    if(panel){ panel.classList.add('open'); panel.setAttribute('aria-hidden','false'); }
  }
  function closePanel(){
    if(panel){ panel.classList.remove('open'); panel.setAttribute('aria-hidden','true'); }
  }
  if(fab) fab.addEventListener('click', openPanel);
  if(openBtn) openBtn.addEventListener('click', openPanel);
  if(closeAgent) closeAgent.addEventListener('click', closePanel);

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
      {k:['preventivo','preventivi'], a:`Per richiedere un preventivo accedi alla tua area e compila il modulo. Riceverai aggiornamenti sullo stato. <a href='faq.html#cittadini'>Apri la guida</a>.`},
      {k:['necrologio','necrologi','anniversario','anniversari'], a:`I necrologi e gli anniversari si pubblicano dall’Area Cittadini → “Necrologi &amp; Anniversari”. Dopo la verifica saranno visibili pubblicamente. <a href='faq.html#necrologi'>Guida</a>.`},
      {k:['pensieri','pensiero'], a:`PENSIERI è la bacheca sociale di OFI: puoi condividere parole pubbliche o private. <a href='cittadini/pensieri.html'>Apri PENSIERI</a> · <a href='faq.html#pensieri'>Guida</a>.`},
      {k:['luogo della memoria','memoria'], a:`Il Luogo della Memoria è uno spazio dedicato con foto, parole e un punto simbolico in mappa. Sarà disponibile nell’Area Cittadini.`},
      {k:['imprese','marchio','abbonamento'], a:`Le imprese ottengono profilo pubblico e Marchio di Affidabilità durante l’abbonamento (2 mesi gratuiti iniziali). <a href='faq.html#imprese'>Dettagli</a>.`}
    ];
    for(const r of rules){ if(r.k.some(w=>t.includes(w))) return r.a; }
    return `Non trovo una risposta immediata. Apri la guida completa qui: <a href='faq.html'>FAQ</a>.`;
  }

  Array.from(document.querySelectorAll('.chip[data-q]')).forEach(ch=>{
    ch.addEventListener('click', ()=>{ const v=ch.getAttribute('data-q'); if(!v) return; addOut(v); addIn(replyTo(v)); });
  });
  if(form && input){
    form.addEventListener('submit', e=>{
      e.preventDefault();
      const v = input.value.trim();
      if(!v) return;
      addOut(v);
      addIn(replyTo(v));
      input.value = '';
    });
  }

  // --- VIDEO TABS (nocookie) ---
  (function(){
    const stage = document.querySelector('.video-stage');
    const tabs = document.querySelectorAll('.video-tabs .tab');
    if(!stage || !tabs.length) return;
    const VIDEOS = {
      benvenuto: 'iyKTbfzBgpw',
      spot: 'iyKTbfzBgpw' // TODO: update with real spot ID
    };
    function iframeTpl(id){
      const src = `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;
      return `<div class="ratio"><iframe src="${src}" title="Video OFI" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" loading="lazy" ></iframe></div>`;
    }
    function select(key){
      tabs.forEach(t=>t.classList.toggle('active', t.dataset.key===key));
      stage.innerHTML = iframeTpl(VIDEOS[key] || VIDEOS.benvenuto);
    }
    tabs.forEach(t=> t.addEventListener('click', ()=> select(t.dataset.key)));
    select('benvenuto');
  })();
})();


// Video tabs loader — Benvenuto MP4 locale, Spot (YouTube-nocookie)
(function(){
  const stage = document.querySelector('.video-stage');
  const tabs = document.querySelectorAll('.video-tabs .tab');
  if(!stage || !tabs.length) return;

  const VIDEOS = {
    benvenuto: { type:'mp4', src:'videos/OFI.mp4', poster:'images/OFI-Social.png', label: 'Video di Benvenuto OFI' },
    spot:      { type:'yt',  id:'iyKTbfzBgpw', label: 'Spot di Onoranze Funebri Italia' } // cambia ID se necessario
  };

  function tpl(v){
    if(v.type==='mp4'){
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
  // initial: Benvenuto
  select('benvenuto');
})();


// Inject 'Home' in nav on all pages except homepage
(function(){
  const isHome = /(^|\/)index\.html?$/.test(location.pathname) || location.pathname==='/' ;
  const menu = document.getElementById('menuPanel');
  if(!isHome && menu && !menu.querySelector('[data-home-link]')){
    const li = document.createElement('li');
    li.setAttribute('role','none');
    const a = document.createElement('a');
    a.setAttribute('role','menuitem');
    a.href = 'index.html';
    a.textContent = 'Home';
    a.setAttribute('data-home-link','1');
    li.appendChild(a);
    // Insert as first item after mobile head/divider
    const firstDivider = menu.querySelector('.menu-divider');
    if(firstDivider && firstDivider.parentElement===menu){
      menu.insertBefore(li, firstDivider.nextElementSibling);
    }else{
      menu.insertBefore(li, menu.firstChild);
    }
  }
})();


/* === OFI · Fix globale voci "Home" su tutte le pagine === */
(function () {
  function toRootHref(href) {
    try {
      // Normalizza eventuali ".../index.html#ancora" -> "/#ancora"
      const a = document.createElement('a');
      a.href = href;
      const isIndex = /(^|\/)index\.html$/i.test(a.pathname);
      if (isIndex) return '/' + (a.hash ? a.hash.replace(/^#/, '') : '');
      return href;
    } catch { return href; }
  }

  function fixHomeLinks(root = '/') {
    const header = document.querySelector('header.site-header, .site-header');
    if (!header) return;

    // 1) Logo → sempre alla root
    const brandLink = header.querySelector('.brand a[href]');
    if (brandLink) brandLink.setAttribute('href', root);

    // 2) Voce "Home" nel menù → sempre alla root
    const menuLinks = header.querySelectorAll('.menu a[href]');
    menuLinks.forEach(a => {
      const text = (a.textContent || '').trim().toLowerCase();
      const href = a.getAttribute('href') || '';
      // Se è proprio "home" oppure è un link a index.html → forza root
      if (text === 'home' || /(^|\/)index\.html(\#.*)?$/i.test(href)) {
        a.setAttribute('href', root);
      } else {
        // Normalizza eventuali index.html residui in altri punti del menù
        const normalized = toRootHref(href);
        if (normalized !== href) a.setAttribute('href', normalized || '/');
      }
    });
  }

  function ready(fn){ 
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  // Esegui all’avvio
  ready(() => {
    fixHomeLinks('/');

    // Se il menù viene rigenerato/iniettato da JS, ri‑applica il fix
    const header = document.querySelector('header.site-header, .site-header');
    if (!header || !window.MutationObserver) return;
    const mo = new MutationObserver(() => fixHomeLinks('/'));
    mo.observe(header, { childList: true, subtree: true });
  });
})();

