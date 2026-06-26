// app.js — Public wedding album site logic
// "The most important moments of Dilum and Thilini's life"

import { auth, db, googleProvider } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, query, where, orderBy, limit,
  onSnapshot, getDocs, doc, updateDoc, increment,
  setDoc, arrayUnion, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ============================================================
   STATE
   ============================================================ */
const state = {
  categories: [],            // [{id,name,createdAt,count,coverUrl,isVideo}]
  allPhotos: [],             // flat cache of every photo, for search + slideshow
  allVideos: [],             // flat cache of every video
  galleryItems: [],          // items currently shown in the open gallery
  galleryUnsub: null,        // active onSnapshot unsubscribe for the open category
  currentCategory: null,
  lightboxIndex: -1,
  pendingDownload: null,     // item waiting on a login before it can download
  user: null,
  slideshowTimer: null,
  slideshowOrder: [],
  slideshowPos: 0
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ============================================================
   CLOUDINARY URL HELPERS
   ============================================================ */
function cldThumb(url, w = 420) {
  if (!url || !url.includes("/upload/")) return url;
  return url.replace("/upload/", `/upload/c_fill,w_${w},q_auto,f_auto/`);
}
function cldFull(url) {
  if (!url || !url.includes("/upload/")) return url;
  return url.replace("/upload/", "/upload/q_auto:best,f_auto/");
}
function cldDownload(url) {
  if (!url || !url.includes("/upload/")) return url;
  return url.replace("/upload/", "/upload/fl_attachment/");
}
function cldVideoPoster(url) {
  if (!url || !url.includes("/upload/")) return "";
  return url.replace("/upload/", "/upload/so_0,c_fill,w_420/").replace(/\.[a-zA-Z0-9]+$/, ".jpg");
}

/* ============================================================
   TOAST
   ============================================================ */
function toast(msg, ms = 2600) {
  const stack = $("#toast-stack");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(10px)";
    el.style.transition = "opacity .3s, transform .3s";
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/* ============================================================
   ICONS (inline SVG strings, currentColor so they theme correctly)
   ============================================================ */
const ICONS = {
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 12.6A9 9 0 1 1 11.4 3a7 7 0 0 0 9.6 9.6z"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.6M12 19.4V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.6M19.4 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  prev: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`,
  next: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 19h16"/></svg>`,
  share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="M8.1 10.7l7.8-4.4M8.1 13.3l7.8 4.4"/></svg>`,
  up: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`,
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3 17l5-5 4 4 5-6 4 5"/></svg>`,
  film: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>`
};
$$("[data-icon]").forEach(el => { el.innerHTML = ICONS[el.dataset.icon] || ""; });

/* ============================================================
   LOADER / TOPBAR / SCROLL-TOP / DARK MODE
   ============================================================ */
window.addEventListener("load", () => {
  setTimeout(() => $("#loader").classList.add("hidden"), 350);
});

window.addEventListener("scroll", () => {
  $("#topbar").classList.toggle("scrolled", window.scrollY > 30);
  $("#scrollTop").classList.toggle("show", window.scrollY > 500);
}, { passive: true });

$("#scrollTop").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
$("#scrollTop").innerHTML = ICONS.up;

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("dt-theme", theme);
  const icon = theme === "dark" ? "sun" : "moon";
  $("#themeToggle").innerHTML = ICONS[icon];
}
$("#themeToggle").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(cur);
});
applyTheme(localStorage.getItem("dt-theme") || "light");

/* ============================================================
   AUTH
   ============================================================ */
onAuthStateChanged(auth, async (user) => {
  state.user = user;
  const chip = $("#userChip");
  if (user) {
    chip.innerHTML = `
      <img src="${user.photoURL || ''}" alt="${user.displayName || 'You'}" referrerpolicy="no-referrer">
      <span>${(user.displayName || user.email || '').split(" ")[0]}</span>`;
    chip.classList.remove("icon-btn");
    chip.classList.add("user-chip");
    try {
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || ""
      }, { merge: true });
    } catch (e) { /* non-fatal */ }

    if (state.pendingDownload) {
      const item = state.pendingDownload;
      state.pendingDownload = null;
      closeModal("#loginModal");
      performDownload(item);
    }
  } else {
    chip.innerHTML = `<button class="icon-btn" id="loginIconBtn" aria-label="Sign in">${ICONS.image}</button>`;
    chip.classList.remove("user-chip");
    chip.classList.add("icon-btn");
  }
});

$("#userChip").addEventListener("click", (e) => {
  if (state.user) {
    if (confirm("Sign out of your Google account?")) signOut(auth).then(() => toast("Signed out"));
  } else {
    openModal("#loginModal");
  }
});

$("#googleSignInBtn").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, googleProvider);
    toast("Welcome! 🤍");
  } catch (err) {
    console.error(err);
    toast("Sign-in was cancelled or failed");
  }
});

/* ============================================================
   MODALS
   ============================================================ */
function openModal(sel) { $(sel).classList.add("open"); document.body.style.overflow = "hidden"; }
function closeModal(sel) { $(sel).classList.remove("open"); document.body.style.overflow = ""; }
$$(".modal-overlay").forEach(ov => {
  ov.addEventListener("click", (e) => { if (e.target === ov) closeModal("#" + ov.id); });
});
$$("[data-close-modal]").forEach(btn => btn.addEventListener("click", () => closeModal("#" + btn.closest(".modal-overlay").id)));

/* ============================================================
   CATEGORIES
   ============================================================ */
const DEFAULT_ICON = ICONS.image;

function renderCategories() {
  const grid = $("#categoryGrid");
  if (!state.categories.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="cat-empty-icon" style="position:static;opacity:1;display:inline-flex;">${ICONS.image}</div>
        <h4>The album is being prepared</h4>
        <p>Categories will appear here as soon as they're added.</p>
      </div>`;
    return;
  }
  grid.innerHTML = state.categories.map(cat => `
    <div class="cat-card" data-cat-id="${cat.id}" tabindex="0" role="button" aria-label="Open ${escapeHtml(cat.name)}">
      <div class="cat-bg" style="${cat.coverUrl ? `background-image:url('${cldThumb(cat.coverUrl, 500)}')` : ""}"></div>
      <div class="cat-card-body">
        <div class="cat-card-icon">${cat.isVideo ? ICONS.film : ICONS.image}</div>
        <h3>${escapeHtml(cat.name)}</h3>
        <span class="cat-count">${cat.count} ${cat.isVideo ? (cat.count === 1 ? "video" : "videos") : (cat.count === 1 ? "photo" : "photos")}</span>
      </div>
    </div>`).join("");

  $$(".cat-card", grid).forEach(card => {
    card.addEventListener("click", () => navigateToCategory(card.dataset.catId));
    card.addEventListener("keypress", (e) => { if (e.key === "Enter") navigateToCategory(card.dataset.catId); });
  });
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function isVideoCategory(cat) {
  return /all\s*videos/i.test(cat.name) || cat.isVideo === true;
}

function listenCategories() {
  const q = query(collection(db, "categories"), orderBy("createdAt", "asc"));
  onSnapshot(q, async (snap) => {
    const cats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // enrich each with a count + cover image
    const enriched = await Promise.all(cats.map(async (cat) => {
      const vid = isVideoCategory(cat);
      try {
        if (vid) {
          const vs = await getDocs(collection(db, "videos"));
          return { ...cat, isVideo: true, count: vs.size, coverUrl: null };
        } else {
          const ps = await getDocs(query(collection(db, "photos"), where("categoryId", "==", cat.id)));
          const first = ps.docs[0]?.data();
          return { ...cat, isVideo: false, count: ps.size, coverUrl: first?.imageUrl || null };
        }
      } catch (e) {
        return { ...cat, isVideo: vid, count: 0, coverUrl: null };
      }
    }));
    state.categories = enriched;
    renderCategories();
  }, (err) => console.error("categories listener error", err));
}

/* ============================================================
   ROUTING (hash-based, so categories are linkable + back/forward works)
   ============================================================ */
function navigateToCategory(catId) { location.hash = `cat=${catId}`; }
function navigateHome() { location.hash = ""; }

window.addEventListener("hashchange", route);
function route() {
  const m = location.hash.match(/cat=([^&]+)/);
  if (m) openGallery(decodeURIComponent(m[1]));
  else showHome();
}

function showHome() {
  $("#galleryView").classList.remove("active");
  $("#homeView").classList.add("active");
  detachGalleryListener();
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

$("#backToHome").addEventListener("click", navigateHome);

/* ============================================================
   GALLERY (category detail)
   ============================================================ */
function detachGalleryListener() {
  if (state.galleryUnsub) { state.galleryUnsub(); state.galleryUnsub = null; }
}

function openGallery(catId) {
  const cat = state.categories.find(c => c.id === catId);
  state.currentCategory = cat || { id: catId, name: "Gallery" };
  $("#homeView").classList.remove("active");
  $("#galleryView").classList.add("active");
  $("#galleryTitle").textContent = state.currentCategory.name;
  $("#galleryGrid").innerHTML = "";
  $("#galleryMeta").textContent = "Loading…";
  $("#gallerySkeleton").style.display = "grid";
  window.scrollTo({ top: 0, behavior: "auto" });

  detachGalleryListener();
  const vid = state.currentCategory.isVideo ?? isVideoCategory(state.currentCategory);

  if (vid) {
    const q = query(collection(db, "videos"), orderBy("uploadedAt", "desc"));
    state.galleryUnsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, type: "video", ...d.data() }));
      renderGallery(items);
    });
  } else {
    const q = query(collection(db, "photos"), where("categoryId", "==", catId), orderBy("uploadedAt", "desc"));
    state.galleryUnsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, type: "photo", ...d.data() }));
      renderGallery(items);
    }, (err) => {
      // orderBy may need an index on first run — fall back to unordered
      console.warn("Falling back to unordered query:", err.message);
      const q2 = query(collection(db, "photos"), where("categoryId", "==", catId));
      state.galleryUnsub = onSnapshot(q2, (snap) => {
        const items = snap.docs.map(d => ({ id: d.id, type: "photo", ...d.data() }));
        renderGallery(items);
      });
    });
  }
}

function renderGallery(items) {
  state.galleryItems = items;
  $("#gallerySkeleton").style.display = "none";
  $("#galleryMeta").textContent = `${items.length} ${items.length === 1 ? "memory" : "memories"}`;

  const grid = $("#galleryGrid");
  if (!items.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        ${ICONS.image}
        <h4>Nothing here yet</h4>
        <p>Check back soon — this part of the story is still being written.</p>
      </div>`;
    return;
  }

  grid.innerHTML = items.map((item, i) => {
    const isVid = item.type === "video";
    const thumbSrc = isVid ? cldVideoPoster(item.videoUrl) : cldThumb(item.imageUrl, 300);
    return `
    <div class="thumb ${isVid ? "is-video" : ""}" data-index="${i}">
      <img src="${thumbSrc}" alt="" loading="lazy" decoding="async" onload="this.classList.add('loaded')">
      ${!isVid && item.downloads ? `<span class="dl-badge">${ICONS.download.replace('viewBox="0 0 24 24"','viewBox="0 0 24 24" style="width:10px;height:10px"')} ${item.downloads}</span>` : ""}
    </div>`;
  }).join("");

  $$(".thumb", grid).forEach(el => el.addEventListener("click", () => openLightbox(Number(el.dataset.index))));
}

/* ============================================================
   LIGHTBOX
   ============================================================ */
function openLightbox(index) {
  state.lightboxIndex = index;
  renderLightbox();
  openModalRaw("#lightbox");
}
function openModalRaw(sel) { $(sel).classList.add("open"); document.body.style.overflow = "hidden"; }
function closeLightbox() {
  $("#lightbox").classList.remove("open");
  document.body.style.overflow = "";
  $("#lightboxMedia").innerHTML = "";
}
$("#lightboxClose").addEventListener("click", closeLightbox);
$("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
$("#lightboxPrev").addEventListener("click", () => stepLightbox(-1));
$("#lightboxNext").addEventListener("click", () => stepLightbox(1));
document.addEventListener("keydown", (e) => {
  if (!$("#lightbox").classList.contains("open")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") stepLightbox(-1);
  if (e.key === "ArrowRight") stepLightbox(1);
});

function stepLightbox(dir) {
  const len = state.galleryItems.length;
  if (!len) return;
  state.lightboxIndex = (state.lightboxIndex + dir + len) % len;
  renderLightbox();
}

function renderLightbox() {
  const item = state.galleryItems[state.lightboxIndex];
  if (!item) return;
  const isVid = item.type === "video";
  $("#lightboxMedia").innerHTML = isVid
    ? `<video src="${item.videoUrl}" controls autoplay playsinline></video>`
    : `<img src="${cldFull(item.imageUrl)}" alt="">`;
  $("#lightboxCounter").textContent = `${state.lightboxIndex + 1} / ${state.galleryItems.length}`;
}

// basic swipe support on mobile
(function enableSwipe() {
  let startX = 0;
  const media = $("#lightboxMedia");
  media.addEventListener("touchstart", (e) => startX = e.touches[0].clientX, { passive: true });
  media.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) stepLightbox(dx > 0 ? -1 : 1);
  }, { passive: true });
})();

/* ============================================================
   DOWNLOAD (requires Google sign-in)
   ============================================================ */
$("#lightboxDownload").addEventListener("click", () => {
  const item = state.galleryItems[state.lightboxIndex];
  if (!item) return;
  if (!state.user) {
    state.pendingDownload = item;
    openModal("#loginModal");
    return;
  }
  performDownload(item);
});

async function performDownload(item) {
  try {
    const isVid = item.type === "video";
    const url = isVid ? item.videoUrl : cldDownload(item.imageUrl);
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();

    if (!isVid) {
      await updateDoc(doc(db, "photos", item.id), { downloads: increment(1) });
      if (state.user) {
        await setDoc(doc(db, "users", state.user.uid), {
          downloadedPhotos: arrayUnion(item.id)
        }, { merge: true });
      }
    }
    toast("Download started ♡");
  } catch (e) {
    console.error(e);
    toast("Couldn't start the download — please try again");
  }
}

/* ============================================================
   RANDOM SLIDESHOW
   ============================================================ */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startSlideshow() {
  const frame = $("#memoryFrameInner");
  if (!state.allPhotos.length) {
    frame.innerHTML = `<div class="placeholder">Your memories<br>will glow here soon</div>`;
    $("#memoryDots").innerHTML = "";
    return;
  }
  state.slideshowOrder = shuffle(state.allPhotos).slice(0, Math.min(10, state.allPhotos.length));
  state.slideshowPos = 0;

  frame.innerHTML = state.slideshowOrder.map((p, i) =>
    `<img src="${cldThumb(p.imageUrl, 600)}" alt="" loading="${i === 0 ? "eager" : "lazy"}">`).join("");
  $("#memoryDots").innerHTML = state.slideshowOrder.map((_, i) => `<span></span>`).join("");

  showSlide(0);
  clearInterval(state.slideshowTimer);
  state.slideshowTimer = setInterval(() => {
    state.slideshowPos = (state.slideshowPos + 1) % state.slideshowOrder.length;
    showSlide(state.slideshowPos);
  }, 3000);
}
function showSlide(pos) {
  $$("#memoryFrameInner img").forEach((img, i) => img.classList.toggle("active", i === pos));
  $$("#memoryDots span").forEach((d, i) => d.classList.toggle("active", i === pos));
}

/* ============================================================
   SEARCH (across category names + photo filenames)
   ============================================================ */
let searchTimer = null;
$("#searchInput").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value.trim();
  searchTimer = setTimeout(() => runSearch(v), 220);
});

function runSearch(term) {
  if (!term) { renderCategories(); return; }
  const low = term.toLowerCase();

  const matchedCatIds = new Set(
    state.allPhotos.filter(p => (p.publicId || "").toLowerCase().includes(low)).map(p => p.categoryId)
  );
  const filtered = state.categories.filter(c =>
    c.name.toLowerCase().includes(low) || matchedCatIds.has(c.id)
  );

  const grid = $("#categoryGrid");
  if (!filtered.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        ${ICONS.search}
        <h4>No moments found</h4>
        <p>Try a different word, or browse all categories below.</p>
      </div>`;
    return;
  }
  const original = state.categories;
  state.categories = filtered;
  renderCategories();
  state.categories = original;
}

/* ============================================================
   GLOBAL DATA CACHE (search index + slideshow source)
   ============================================================ */
function listenAllPhotos() {
  onSnapshot(collection(db, "photos"), (snap) => {
    state.allPhotos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!state.slideshowTimer) startSlideshow();
  }, (err) => console.error("photo cache listener error", err));
}

/* ============================================================
   SHARE
   ============================================================ */
$$("[data-share]").forEach(btn => btn.addEventListener("click", async () => {
  const shareData = {
    title: "Dilum & Thilini — Our Wedding Album",
    text: "Take a look at the most important moments of our life together 🤍",
    url: location.origin + location.pathname
  };
  if (navigator.share) {
    try { await navigator.share(shareData); } catch (e) { /* cancelled */ }
  } else {
    await navigator.clipboard.writeText(shareData.url);
    toast("Link copied to clipboard");
  }
}));

/* ============================================================
   PWA
   ============================================================ */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

/* ============================================================
   INIT
   ============================================================ */
listenCategories();
listenAllPhotos();
route();
