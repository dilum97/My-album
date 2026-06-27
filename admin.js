// admin.js — Admin panel logic for the wedding album
// Only dilumhimesh34@gmail.com (created in the Firebase console) may manage data.

import { auth, db, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET, CLOUDINARY_FOLDER } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, query, orderBy, where, onSnapshot, getDocs,
  addDoc, updateDoc, deleteDoc, doc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ADMIN_EMAIL = "dilumhimesh34@gmail.com";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  categories: [],     // [{id,name,createdAt,count,isVideo}]
  allPhotos: [],
  allVideos: [],
  seeded: false,
  pendingConfirm: null,
  manageItems: []
};

/* ============================================================
   ICONS
   ============================================================ */
const ICONS = {
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 12.6A9 9 0 1 1 11.4 3a7 7 0 0 0 9.6 9.6z"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.6M12 19.4V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.6M19.4 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8"/></svg>`,
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3 17l5-5 4 4 5-6 4 5"/></svg>`,
  film: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l5 5L20 7"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`
};
$$("[data-icon]").forEach(el => { el.innerHTML = ICONS[el.dataset.icon] || ""; });

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("dt-theme", theme);
  $("#themeToggle").innerHTML = theme === "dark" ? ICONS.sun : ICONS.moon;
}
$("#themeToggle")?.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(cur);
});
applyTheme(localStorage.getItem("dt-theme") || "light");

/* ============================================================
   TOAST
   ============================================================ */
function toast(msg, ms = 2800) {
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

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============================================================
   MODALS (shared pattern with the public site)
   ============================================================ */
function openModal(sel) { $(sel).classList.add("open"); document.body.style.overflow = "hidden"; }
function closeModal(sel) { $(sel).classList.remove("open"); document.body.style.overflow = ""; }
$$(".modal-overlay").forEach(ov => {
  ov.addEventListener("click", (e) => { if (e.target === ov) closeModal("#" + ov.id); });
});
$$("[data-close-modal]").forEach(btn => btn.addEventListener("click", () => closeModal("#" + btn.closest(".modal-overlay").id)));

function openConfirm(title, text, onConfirm) {
  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;
  state.pendingConfirm = onConfirm;
  openModal("#confirmModal");
}
$("#confirmActionBtn").addEventListener("click", async () => {
  const action = state.pendingConfirm;
  state.pendingConfirm = null;
  closeModal("#confirmModal");
  if (action) await action();
});

/* ============================================================
   AUTH
   ============================================================ */
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#adminEmail").value.trim();
  const password = $("#adminPassword").value;
  const errEl = $("#loginError");
  errEl.textContent = "";
  $("#loginSubmitBtn").textContent = "Signing in…";
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged below handles the rest (including the admin-email check)
  } catch (err) {
    console.error(err);
    errEl.textContent = "Incorrect email or password.";
  } finally {
    $("#loginSubmitBtn").textContent = "Sign In";
  }
});

$("#signOutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    $("#adminLogin").style.display = "none";
    $("#adminShell").classList.add("active");
    initData();
  } else {
    if (user) {
      // Signed in, but not the admin account — kick them out immediately.
      signOut(auth);
      $("#loginError").textContent = "This account isn't authorised as admin.";
    }
    $("#adminShell").classList.remove("active");
    $("#adminLogin").style.display = "flex";
  }
});

/* ============================================================
   CATEGORIES
   ============================================================ */
const DEFAULT_CATEGORIES = ["Our preshoot", "Wedding day 1", "Wedding day 2", "Home coming", "All Videos"];

function isVideoCategory(cat) {
  return /all\s*videos/i.test(cat.name);
}

let categoriesListenerStarted = false;
function listenCategories() {
  if (categoriesListenerStarted) return;
  categoriesListenerStarted = true;

  const q = query(collection(db, "categories"), orderBy("createdAt", "asc"));
  onSnapshot(q, async (snap) => {
    if (snap.empty && !state.seeded) {
      state.seeded = true;
      for (const name of DEFAULT_CATEGORIES) {
        await addDoc(collection(db, "categories"), { name, createdAt: serverTimestamp() });
      }
      toast("Starter categories created ✨");
      return; // the snapshot listener will fire again with the new docs
    }

    const cats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const enriched = await Promise.all(cats.map(async (cat) => {
      const vid = isVideoCategory(cat);
      try {
        if (vid) {
          const vs = await getDocs(collection(db, "videos"));
          return { ...cat, isVideo: true, count: vs.size };
        } else {
          const ps = await getDocs(query(collection(db, "photos"), where("categoryId", "==", cat.id)));
          return { ...cat, isVideo: false, count: ps.size };
        }
      } catch {
        return { ...cat, isVideo: vid, count: 0 };
      }
    }));
    state.categories = enriched;
    renderCategoryManageList();
    renderUploadCategoryOptions();
    renderManageCategoryOptions();
    renderStats();
  }, (err) => console.error("categories listener error", err));
}

function renderCategoryManageList() {
  const wrap = $("#catManageList");
  if (!state.categories.length) {
    wrap.innerHTML = `<p class="hint">No categories yet — add your first one above.</p>`;
    return;
  }
  wrap.innerHTML = state.categories.map(cat => `
    <div class="cat-manage-row" data-id="${cat.id}">
      <span class="cm-name" data-display>${escapeHtml(cat.name)}</span>
      <span class="cm-count">${cat.count} ${cat.isVideo ? "videos" : "photos"}</span>
      <div class="cm-actions">
        <button class="icon-btn icon-btn-sm" data-edit aria-label="Rename">${ICONS.edit}</button>
        ${cat.isVideo
          ? `<button class="icon-btn icon-btn-sm" disabled title="This category powers the video gallery and can't be deleted" aria-label="Locked">${ICONS.lock}</button>`
          : `<button class="icon-btn icon-btn-sm" data-delete aria-label="Delete">${ICONS.trash}</button>`}
      </div>
    </div>`).join("");

  $$(".cat-manage-row", wrap).forEach(row => {
    const id = row.dataset.id;
    const cat = state.categories.find(c => c.id === id);

    row.querySelector("[data-edit]").addEventListener("click", () => startEditCategory(row, cat));
    const delBtn = row.querySelector("[data-delete]");
    if (delBtn) delBtn.addEventListener("click", () => {
      openConfirm(
        `Delete "${cat.name}"?`,
        `This will permanently delete this category and its ${cat.count} ${cat.count === 1 ? "photo" : "photos"}. This can't be undone.`,
        () => deleteCategory(cat)
      );
    });
  });
}

function startEditCategory(row, cat) {
  const nameSpan = row.querySelector("[data-display]");
  const editBtn = row.querySelector("[data-edit]");
  nameSpan.innerHTML = `<input type="text" value="${escapeHtml(cat.name)}" maxlength="60">`;
  const input = nameSpan.querySelector("input");
  input.focus();
  input.select();
  editBtn.innerHTML = ICONS.check;

  const save = async () => {
    const newName = input.value.trim();
    if (newName && newName !== cat.name) {
      try {
        await updateDoc(doc(db, "categories", cat.id), { name: newName });
        toast("Category renamed");
      } catch (e) {
        console.error(e);
        toast("Couldn't rename — please try again");
      }
    } else {
      nameSpan.textContent = cat.name;
      editBtn.innerHTML = ICONS.edit;
    }
  };
  editBtn.onclick = save;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { nameSpan.textContent = cat.name; editBtn.innerHTML = ICONS.edit; editBtn.onclick = () => startEditCategory(row, cat); } });
  input.addEventListener("blur", () => setTimeout(save, 120));
}

async function deleteCategory(cat) {
  try {
    const ps = await getDocs(query(collection(db, "photos"), where("categoryId", "==", cat.id)));
    await Promise.all(ps.docs.map(d => deleteDoc(doc(db, "photos", d.id))));
    await deleteDoc(doc(db, "categories", cat.id));
    toast(`"${cat.name}" deleted`);
  } catch (e) {
    console.error(e);
    toast("Couldn't delete that category — please try again");
  }
}

$("#addCategoryBtn").addEventListener("click", () => {
  $("#newCategoryName").value = "";
  openModal("#addCategoryModal");
  setTimeout(() => $("#newCategoryName").focus(), 150);
});
$("#confirmAddCategoryBtn").addEventListener("click", async () => {
  const name = $("#newCategoryName").value.trim();
  if (!name) { toast("Please enter a category name"); return; }
  try {
    await addDoc(collection(db, "categories"), { name, createdAt: serverTimestamp() });
    closeModal("#addCategoryModal");
    toast("Category created");
  } catch (e) {
    console.error(e);
    toast("Couldn't create category — please try again");
  }
});
$("#newCategoryName").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#confirmAddCategoryBtn").click(); });

/* ============================================================
   STATS
   ============================================================ */
function renderStats() {
  $("#statCategories").textContent = state.categories.length;
  $("#statPhotos").textContent = state.allPhotos.length;
  $("#statVideos").textContent = state.allVideos.length;
  $("#statDownloads").textContent = state.allPhotos.reduce((sum, p) => sum + (p.downloads || 0), 0);
}

function listenGlobalMedia() {
  onSnapshot(collection(db, "photos"), (snap) => {
    state.allPhotos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStats();
    if ($("#manageCategorySelect").value && !state.manageItems.isVideo) refreshManageGridIfActive();
  });
  onSnapshot(collection(db, "videos"), (snap) => {
    state.allVideos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStats();
    refreshManageGridIfActive();
  });
}

/* ============================================================
   UPLOAD
   ============================================================ */
function renderUploadCategoryOptions() {
  const sel = $("#uploadCategorySelect");
  const current = sel.value;
  const photoCats = state.categories.filter(c => !c.isVideo);
  sel.innerHTML = `<option value="" disabled ${!current ? "selected" : ""}>Choose a category for photos…</option>` +
    photoCats.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  if (photoCats.some(c => c.id === current)) sel.value = current;
}

$("#dropzone").addEventListener("click", () => $("#fileInput").click());
["dragover", "dragenter"].forEach(evt =>
  $("#dropzone").addEventListener(evt, (e) => { e.preventDefault(); $("#dropzone").classList.add("dragover"); })
);
["dragleave", "drop"].forEach(evt =>
  $("#dropzone").addEventListener(evt, (e) => { e.preventDefault(); $("#dropzone").classList.remove("dragover"); })
);
$("#dropzone").addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));
$("#fileInput").addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });

async function ensureVideoCategoryExists() {
  if (state.categories.some(isVideoCategory)) return;
  await addDoc(collection(db, "categories"), { name: "All Videos", createdAt: serverTimestamp() });
}

function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const categoryId = $("#uploadCategorySelect").value;

  files.forEach(file => {
    const isVideo = file.type.startsWith("video/");
    if (!isVideo && !file.type.startsWith("image/")) return; // ignore unsupported types
    if (!isVideo && !categoryId) {
      addQueueRow(file, isVideo, "error", "Choose a category first");
      return;
    }
    uploadOneFile(file, isVideo, categoryId);
  });
}

function addQueueRow(file, isVideo, status, statusText) {
  const row = document.createElement("div");
  row.className = `upload-item ${status}`;
  const previewSrc = isVideo ? "" : URL.createObjectURL(file);
  row.innerHTML = `
    ${isVideo
      ? `<span style="width:38px;height:38px;border-radius:6px;background:var(--color-soft-pink);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${ICONS.film}</span>`
      : `<img src="${previewSrc}" alt="">`}
    <span class="ui-name">${escapeHtml(file.name)}</span>
    <div class="progress-bar"><span style="width:0%"></span></div>
    <span class="ui-status">${statusText}</span>`;
  $("#uploadQueue").prepend(row);
  return row;
}

async function uploadOneFile(file, isVideo, categoryId) {
  const row = addQueueRow(file, isVideo, "", "Uploading…");
  const bar = row.querySelector(".progress-bar > span");
  const statusEl = row.querySelector(".ui-status");

  try {
    if (isVideo) await ensureVideoCategoryExists();
    const result = await cloudinaryUpload(file, isVideo, (pct) => { bar.style.width = pct + "%"; });

    if (isVideo) {
      await addDoc(collection(db, "videos"), {
        videoUrl: result.secure_url,
        publicId: result.public_id,
        uploadedAt: serverTimestamp()
      });
    } else {
      await addDoc(collection(db, "photos"), {
        categoryId,
        imageUrl: result.secure_url,
        publicId: result.public_id,
        downloads: 0,
        uploadedAt: serverTimestamp()
      });
    }
    row.classList.add("done");
    statusEl.textContent = "Uploaded ✓";
    bar.style.width = "100%";
  } catch (e) {
    console.error(e);
    row.classList.add("error");
    statusEl.textContent = "Failed";
  }
}

function cloudinaryUpload(file, isVideo, onProgress) {
  return new Promise((resolve, reject) => {
    const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${isVideo ? "video" : "image"}/upload`;
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    form.append("folder", CLOUDINARY_FOLDER);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(new Error("Cloudinary upload failed: " + xhr.status));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(form);
  });
}

/* ============================================================
   MANAGE MEDIA
   ============================================================ */
function renderManageCategoryOptions() {
  const sel = $("#manageCategorySelect");
  const current = sel.value;
  sel.innerHTML = state.categories.map(c =>
    `<option value="${c.id}">${escapeHtml(c.name)} (${c.count})</option>`).join("");
  if (state.categories.some(c => c.id === current)) sel.value = current;
  else if (state.categories.length) sel.value = state.categories[0].id;
  loadManageGrid();
}
$("#manageCategorySelect").addEventListener("change", loadManageGrid);

function loadManageGrid() {
  const catId = $("#manageCategorySelect").value;
  const cat = state.categories.find(c => c.id === catId);
  if (!cat) { $("#mediaGrid").innerHTML = ""; $("#manageMeta").textContent = ""; return; }

  const items = cat.isVideo
    ? state.allVideos.map(v => ({ ...v, type: "video" }))
    : state.allPhotos.filter(p => p.categoryId === catId).map(p => ({ ...p, type: "photo" }));

  state.manageItems = { catId, isVideo: cat.isVideo, items };
  renderManageGrid();
}

function refreshManageGridIfActive() {
  if ($("#manageCategorySelect").value) loadManageGrid();
}

function cldThumb(url, w = 220) {
  if (!url || !url.includes("/upload/")) return url;
  return url.replace("/upload/", `/upload/c_fill,w_${w},q_auto,f_auto/`);
}
function cldVideoPoster(url) {
  if (!url || !url.includes("/upload/")) return "";
  return url.replace("/upload/", "/upload/so_0,c_fill,w_220/").replace(/\.[a-zA-Z0-9]+$/, ".jpg");
}

function renderManageGrid() {
  const { items, isVideo } = state.manageItems;
  $("#manageMeta").textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;

  if (!items.length) {
    $("#mediaGrid").innerHTML = `<p class="hint">Nothing uploaded to this category yet.</p>`;
    return;
  }

  $("#mediaGrid").innerHTML = items.map(item => `
    <div class="media-item" data-id="${item.id}">
      <img src="${isVideo ? cldVideoPoster(item.videoUrl) : cldThumb(item.imageUrl)}" alt="" loading="lazy">
      ${!isVideo && item.downloads ? `<span class="mi-dl">${item.downloads} dl</span>` : ""}
      <button class="mi-del" aria-label="Delete" data-id="${item.id}">${ICONS.close}</button>
    </div>`).join("");

  $$(".mi-del", $("#mediaGrid")).forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      openConfirm(
        "Delete this item?",
        "It will be removed from the album immediately. This can't be undone.",
        () => deleteMediaItem(id, isVideo)
      );
    });
  });
}

async function deleteMediaItem(id, isVideo) {
  try {
    await deleteDoc(doc(db, isVideo ? "videos" : "photos", id));
    toast("Deleted");
  } catch (e) {
    console.error(e);
    toast("Couldn't delete — please try again");
  }
}

/* ============================================================
   INIT (only after admin auth succeeds)
   ============================================================ */
let dataInitialised = false;
function initData() {
  if (dataInitialised) return;
  dataInitialised = true;
  listenCategories();
  listenGlobalMedia();
}
