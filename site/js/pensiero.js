// site/js/pensiero.js
(function(){
  const CACHE_KEY = 'ofi_pensieri_2025_cache_v1';
  const ONE_DAY_MS = 24*60*60*1000;

  function dayOfYear(d=new Date()){
    const start = new Date(d.getFullYear(),0,0);
    return Math.floor((d - start) / 86400000); // 1..366
  }

  function parseQuote(raw){
    if (!raw || typeof raw!=='string') return {quote:'', author:''};
    const parts = raw.split(/\s+—\s+|\s+-\s+/);
    if (parts.length>=2){
      return { quote: parts.slice(0,-1).join(' — ').trim(), author: parts[parts.length-1].trim() };
    }
    return { quote: raw.trim(), author: '' };
  }

  async function loadJSONWithCache(url){
    try{
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY)||'null');
      const freshEnough = cached && (Date.now() - cached.ts < ONE_DAY_MS) && Array.isArray(cached.data) && cached.data.length>=300;
      if (freshEnough) return cached.data;
    }catch{}

    const res = await fetch(url, {cache:'no-store'});
    if (!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    try{ localStorage.setItem(CACHE_KEY, JSON.stringify({ts:Date.now(), data})); }catch{}
    return data;
  }

  async function pickToday(url){
    const arr = await loadJSONWithCache(url);
    const n = dayOfYear();
    const idx = (n-1) % arr.length; // 365→wrap sicuro anche anno bisestile
    const {quote, author} = parseQuote(arr[idx]);
    return {quote, author, index: idx, total: arr.length};
  }

  async function mountDailyThought(opts){
    const {
      jsonUrl = '/data/pensieri_2025.json',
      targetQuoteId = 'pensieroTxt',
      targetAuthorId = 'pensieroAutore',
      addFancyQuotes = true
    } = (opts||{});

    const elQ = document.getElementById(targetQuoteId);
    if (!elQ) return;

    try{
      const t = await pickToday(jsonUrl);
      const qText = (addFancyQuotes ? '“'+ t.quote.replace(/^“|”$/g,'') +'”' : t.quote);
      elQ.textContent = qText;

      if (t.author){
        let aEl = document.getElementById(targetAuthorId);
        if (!aEl){
          aEl = document.createElement('p');
          aEl.id = targetAuthorId;
          aEl.className = 'small';
          elQ.parentElement.insertBefore(aEl, elQ.nextSibling);
        }
        aEl.textContent = '— ' + t.author;
        aEl.setAttribute('aria-label','Autore citazione');
      }

      window.OFIThought = {
        ...window.OFIThought,
        getToday: ()=> ({...t, full: t.author ? `${t.quote} — ${t.author}` : t.quote})
      };
      document.dispatchEvent(new CustomEvent('ofi-thought-ready', {detail: t}));
    }catch(e){
      const fallback = "Nel ricordo, ogni assenza trova una forma gentile di presenza.";
      elQ.textContent = (addFancyQuotes ? '“'+fallback+'”' : fallback);
      window.OFIThought = {
        ...window.OFIThought,
        getToday: ()=> ({quote:fallback, author:'', full:fallback})
      };
      document.dispatchEvent(new CustomEvent('ofi-thought-ready', {detail: {quote:fallback, author:''}}));
    }
  }

  window.OFIThought = window.OFIThought || {};
  window.OFIThought.mountDailyThought = mountDailyThought;
  window.OFIThought.dayOfYear = dayOfYear;
})();

