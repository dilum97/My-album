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
  film: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>`,
  person: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="3.5"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`
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
    chip.innerHTML = ICONS.person;
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
  if (window._lbResetZoom) window._lbResetZoom();
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

// Swipe + natural pinch-zoom for lightbox (like native gallery)
(function enableTouchGestures() {
  const media = $("#lightboxMedia");

  // Current transform state stored as pan + scale
  var curScale = 1;
  var panX = 0, panY = 0;          // accumulated pan in CSS-px
  var startPanX = 0, startPanY = 0; // pan at the moment a new gesture starts

  // Pinch state
  var pinchStartScale = 1;
  var pinchStartDist = 0;
  var pinchMidX = 0, pinchMidY = 0; // midpoint of two fingers at pinch start (page coords)
  var pinchStartPanX = 0, pinchStartPanY = 0;

  // Swipe / pan state
  var t1x = 0, t1y = 0;            // touch-1 start position
  var gestureType = "none";         // "swipe" | "pan" | "pinch"
  var lastTap = 0;

  function getImg() { return media.querySelector("img"); }

  function commit(img) {
    if (!img) return;
    img.style.transform = "translate(" + panX + "px," + panY + "px) scale(" + curScale + ")";
    img.style.transformOrigin = "center center";
    img.style.transition = "none";
  }

  function resetZoom() {
    curScale = 1; panX = 0; panY = 0;
    var img = getImg();
    if (img) { img.style.transform = ""; img.style.transition = "transform .25s ease"; }
    gestureType = "none";
  }
  window._lbResetZoom = resetZoom;

  function dist2(ta) {
    var dx = ta[0].clientX - ta[1].clientX;
    var dy = ta[0].clientY - ta[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  media.addEventListener("touchstart", function(e) {
    var img = getImg();
    if (!img) return;

    if (e.touches.length === 2) {
      // Begin pinch
      gestureType = "pinch";
      pinchStartScale = curScale;
      pinchStartDist = dist2(e.touches);
      pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      pinchStartPanX = panX;
      pinchStartPanY = panY;
    } else if (e.touches.length === 1) {
      t1x = e.touches[0].clientX;
      t1y = e.touches[0].clientY;
      startPanX = panX;
      startPanY = panY;
      gestureType = curScale > 1 ? "pan" : "swipe";
    }
  }, { passive: true });

  media.addEventListener("touchmove", function(e) {
    var img = getImg();
    if (!img) return;

    if (e.touches.length === 2) {
      e.preventDefault();
      gestureType = "pinch";

      // Scale relative to pinch-start (smooth, no jumps)
      var newDist = dist2(e.touches);
      var ratio = newDist / pinchStartDist;
      curScale = Math.min(Math.max(pinchStartScale * ratio, 1), 6);

      // Keep the midpoint of the two fingers stationary as we scale
      var newMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      var newMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      panX = pinchStartPanX + (newMidX - pinchMidX);
      panY = pinchStartPanY + (newMidY - pinchMidY);

      commit(img);
    } else if (e.touches.length === 1 && gestureType === "pan") {
      e.preventDefault();
      panX = startPanX + (e.touches[0].clientX - t1x);
      panY = startPanY + (e.touches[0].clientY - t1y);
      commit(img);
    }
  }, { passive: false });

  media.addEventListener("touchend", function(e) {
    if (gestureType === "pinch") {
      if (curScale <= 1.05) resetZoom();
      gestureType = "none";
      return;
    }

    // Double-tap to reset zoom
    var now = Date.now();
    if (now - lastTap < 300) { resetZoom(); lastTap = 0; return; }
    lastTap = now;

    if (gestureType === "pan") { gestureType = "none"; return; }

    // Swipe to next/prev (only when not zoomed)
    if (curScale <= 1 && e.changedTouches.length) {
      var dx = e.changedTouches[0].clientX - t1x;
      var dy = e.changedTouches[0].clientY - t1y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) stepLightbox(dx > 0 ? -1 : 1);
    }
    gestureType = "none";
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
  const frame = $("#ssInner");
  if (!frame) return;
  if (!state.allPhotos.length) {
    frame.innerHTML = "";
    return;
  }
  // Use a good-quality thumbnail for slideshow — large but NOT original (saves bandwidth)
  state.slideshowOrder = shuffle(state.allPhotos).slice(0, Math.min(14, state.allPhotos.length));
  state.slideshowPos = 0;

  frame.innerHTML = state.slideshowOrder.map((p, i) =>
    `<img src="${cldThumb(p.imageUrl, 1200)}" alt="" loading="${i === 0 ? "eager" : "lazy"}">`).join("");
  $("#ssDots").innerHTML = state.slideshowOrder.map(() => `<span></span>`).join("");

  showSlide(0);
  clearInterval(state.slideshowTimer);
  state.slideshowTimer = setInterval(() => {
    state.slideshowPos = (state.slideshowPos + 1) % state.slideshowOrder.length;
    showSlide(state.slideshowPos);
  }, 3500);
}
function showSlide(pos) {
  $$("#ssInner img").forEach((img, i) => img.classList.toggle("active", i === pos));
  $$("#ssDots span").forEach((d, i) => d.classList.toggle("active", i === pos));
}

/* Search removed — categories browsed directly */

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
