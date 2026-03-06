<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Modifica Necrologio</title>
  <link rel="stylesheet" href="style-crea-necrologio.css" />
</head>
<body>
  <header>
    <img src="../images/logo-ofi.png" alt="Logo OFI" class="logo" />
    <nav class="navbar">
      <a href="../index.html">Home</a>
      <a href="../necrologi.html">Necrologi</a>
      <a href="../admin/dashboard-admin.html">Dashboard</a>
    </nav>
  </header>

  <main>
    <h1>Modifica Necrologio</h1>

    <form id="modulo-necrologio">
      <label for="croce"><input type="checkbox" id="croce"> Includi croce</label>

      <label for="frase">Frase iniziale:
        <input type="text" id="frase">
      </label>

      <label for="foto">Foto del defunto:
        <input type="file" id="foto">
      </label>

      <img id="foto-anteprima" src="../images/rosa.png" class="foto-defunto" alt="Anteprima" />

      <label for="nome">Nome e Cognome:
        <input type="text" id="nome">
      </label>

      <label for="vedIn">Ved./In:
        <input type="text" id="vedIn">
      </label>

      <label for="eta">Età:
        <input type="number" id="eta">
      </label>

      <label for="testo">Testo:
        <textarea id="testo"></textarea>
      </label>

      <label for="ringraziamenti">Ringraziamenti:
        <input type="text" id="ringraziamenti">
      </label>

      <label for="luogo">Luogo:
        <input type="text" id="luogo">
      </label>

      <label for="data">Data:
        <input type="date" id="data">
      </label>

      <label for="autore">Autore:
        <input type="text" id="autore">
      </label>

      <button type="submit">Salva Modifiche</button>
    </form>

    <div id="anteprima" class="necrologio"></div>
  </main>

  <script src="script-modifica-necrologio.js"></script>
</body>
</html>
