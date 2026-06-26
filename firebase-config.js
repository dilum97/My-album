// firebase-config.js
// Firebase v10 Modular SDK initialization
// Shared by app.js (public site) and admin.js (admin panel)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDfqUtGDsRtR0GePfpZv-kqHP_dhZ3FodI",
  authDomain: "my-album-922ba.firebaseapp.com",
  projectId: "my-album-922ba",
  storageBucket: "my-album-922ba.firebasestorage.app",
  messagingSenderId: "629534378102",
  appId: "1:629534378102:web:b51b665878c67da3fbf757"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Keep visitors signed in across visits so they only have to log in once to download
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Auth persistence could not be set:", err);
});

// Cloudinary configuration (used by app.js for transformation URLs,
// and later by admin.js for uploads)
export const CLOUDINARY_CLOUD_NAME = "dzta29win";
export const CLOUDINARY_UPLOAD_PRESET = "Myalbum";
export const CLOUDINARY_FOLDER = "Myalbum";
