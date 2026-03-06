<script>
// OFI Shell: header/footer + CSS unificati
(function () {
  const cssCore = `
    <link rel="stylesheet" href="/ofi.css">
    <link rel="stylesheet" href="/ofi-contrast-hotfix.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  `;

  const headerHTML = `
    <header class="ofi-header" style="background:#002c5d; color:#fff;">
      <div style="max-width:1200px;margin:auto;display:flex;align-items:center;gap:20px;padding:.7rem 1rem;">
        <a href="/index.html" style="display:inline-flex;align-items:center;gap:12px;color:#fff;text-decoration:none">
          <img src="/images/logo-ofi.png" alt="Onoranze Funebri Italia" style="height:46px">
          <strong style="font-size:18px;letter-spacing:.3px;">Onoranze Funebri Italia</strong>
        </a>
        <nav style="margin-left:auto;display:flex;gap:18px;flex-wrap:wrap">
          <a href="/index.html#servizi" style="color:#fff;text-decoration:none">Servizi</a>
          <a href="/cittadini/dashboard-cittadino.html" style="color:#fff;text-decoration:none">Area Cittadini</a>
          <a href="/imprese/imprese-dashboard.html" style="color:#fff;text-decoration:none">Area Imprese</a>
          <a href="/faq.html" style="color:#fff;text-decoration:none">FAQ</a>
        </nav>
      </div>
    </header>
  `;

  const footerHTML = `
    <footer class="ofi-footer" style="background:#002c5d;color:#fff;margin-top:3rem">
      <div style="max-width:1200px;margin:auto;text-align:center;padding:1.2rem 1rem">
        © 2025 Onoranze Funebri Italia – Tutti i diritti riservati
        <div style="margin-top:.4rem;font-size:13px;color:#ddd">Portale nazionale per il supporto al cittadino e la valorizzazione delle imprese funebri</div>
        <div style="margin-top:.5rem">
          <a href="/privacy.html" style="color:#fff;text-decoration:underline;margin:0 .6rem">Privacy</a>
          <a href="/contatti.html" style="color:#fff;text-decoration:underline;margin:0 .6rem">Contatti</a>
          <a href="/faq.html" style="color:#fff;text-decoration:underline;margin:0 .6rem">FAQ</a>
        </div>
      </div>
    </footer>
  `;

  // inject CSS core
  document.write(cssCore);

  // mount helpers
  window.OFI_SHELL = {
    header: () => {
      const el = document.createElement('div');
      el.innerHTML = headerHTML;
      document.body.prepend(el.firstElementChild);
    },
    footer: () => {
      const el = document.createElement('div');
      el.innerHTML = footerHTML;
      document.body.append(el.firstElementChild);
    }
  };
})();
</script>
