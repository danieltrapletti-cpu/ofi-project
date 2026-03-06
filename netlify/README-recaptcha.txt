# reCAPTCHA v3 — Netlify setup

1) **Imposta le chiavi**
   - Vai su Netlify → Site settings → Environment variables.
   - Aggiungi `RECAPTCHA_SECRET` (server key della tua proprietà reCAPTCHA v3).
   - Nel client **usa la chiave `site key`** (già nei tuoi HTML).

2) **Struttura delle funzioni**
```
netlify/
  functions/
    recaptcha-verify.js   ← questo file
```

3) **Deploy**
```
netlify deploy --prod --dir=site --functions=netlify/functions --no-build
```

4) **Uso lato client**
Negli HTML (login/registrazione) chiama:
- `grecaptcha.execute(SITE_KEY, { action: 'citizen_login' })`
- POST a `/.netlify/functions/recaptcha-verify` con `{ token, action }`.
- Procedi solo se la risposta è `{ ok: true }`.

Suggerimento: mantieni azioni diverse per ogni evento (es. `citizen_login`, `citizen_register`, `citizen_google_login`) per avere metriche separabili in Google reCAPTCHA admin.
