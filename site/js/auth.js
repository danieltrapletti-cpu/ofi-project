
// auth.js - compatibile con HTML semplice (senza import/export)

if (!window.auth) {
  const firebaseConfig = {
    apiKey: "AIzaSyAy0UMiRscG-F1B9YxT7gHHyxLBOwOo2vs",
    authDomain: "ofi2025-51ba9.firebaseapp.com",
    projectId: "ofi2025-51ba9",
    storageBucket: "ofi2025-51ba9.firebasestorage.app",
    messagingSenderId: "345581339212",
    appId: "1:345581339212:web:f0b8bc241945691c876ae9"
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  window.auth = firebase.auth();
}
