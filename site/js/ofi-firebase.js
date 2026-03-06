<script type="module">
// OFI Firebase (v10 modular) – single source of truth
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, addDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAy0UMiRscG-F1B9YxT7gHHyxLBOwOo2vs",
  authDomain: "ofi2025-51ba9.firebaseapp.com",
  projectId: "ofi2025-51ba9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// Espongo in window per usare anche su pagine non-module in modo semplice
window.OFI = {
  app, auth, db,
  fba: { onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut },
  fbd: { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, addDoc, serverTimestamp, Timestamp }
};
</script>
