const API_BASE = "";

function initializeSiteTheme() {
  document.querySelectorAll('a[href="/goober-cards/"]').forEach((link) => {
    if (link.textContent.trim().toLowerCase().includes("trading")) {
      link.textContent = "Goober Cards";
    }
  });

  const heroCopy = document.querySelector(".hero-copy");
  if (heroCopy && !document.getElementById("playGooberCardsHero")) {
    const actions = document.createElement("div");
    actions.className = "hero-actions";
    actions.innerHTML = `
      <a class="button primary" id="playGooberCardsHero" href="/goober-cards/">Play Goober Cards</a>
      <a class="button" href="#goobers">Browse Goobers</a>
    `;
    heroCopy.appendChild(actions);
  }
}

initializeSiteTheme();

const filterButtons = document.querySelectorAll(".filter-btn");
const gooberGrid = document.getElementById("gooberGrid");
const uploadForm = document.getElementById("gooberUploadForm");
const gooberNameInput = document.getElementById("gooberName");
const gooberCategoryInput = document.getElementById("gooberCategory");
const gooberDescriptionInput = document.getElementById("gooberDescription");
const gooberImageInput = document.getElementById("gooberImage");
const gooberSearchInput = document.getElementById("gooberSearch");
const gooberSearchButton = document.getElementById("gooberSearchButton");
const gooberClearSearchButton = document.getElementById("gooberClearSearch");
const gooberCountText = document.getElementById("gooberCountText");
let loadMoreGoobersButton = document.getElementById("loadMoreGoobers");
const filePreview = document.getElementById("filePreview");
const uploadStatus = document.getElementById("uploadStatus");
const reloadCloudGoobersButton = document.getElementById("reloadCloudGoobers");
const uploadGate = document.getElementById("uploadGate");
const uploadGateMessage = document.getElementById("uploadGateMessage");
const uploadAs = document.getElementById("uploadAs");
const featuredGooberCard = document.querySelector(".feature-card");
const featuredGooberImage = featuredGooberCard?.querySelector("img");
const featuredGooberTitle = featuredGooberCard?.querySelector("h2");
const featuredGooberDescription = featuredGooberCard?.querySelector("p");
const gooberViewer = document.getElementById("gooberViewer");
const viewerImage = document.getElementById("viewerImage");
const viewerTitle = document.getElementById("viewerTitle");
const viewerDescription = document.getElementById("viewerDescription");
const viewerCategory = document.getElementById("viewerCategory");
const viewerClose = document.getElementById("viewerClose");
const viewerBackdrop = document.querySelector(".viewer-backdrop");

const INITIAL_GALLERY_LIMIT = 24;
const GALLERY_INCREMENT = 24;

let activeFilter = "all";
let searchTerm = "";
let visibleLimit = INITIAL_GALLERY_LIMIT;

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function ensureLoadMoreButton() {
  if (loadMoreGoobersButton || !gooberGrid) return;

  const wrapper = document.createElement("div");
  wrapper.className = "gallery-load-more";
  wrapper.style.display = "flex";
  wrapper.style.justifyContent = "center";
  wrapper.style.margin = "24px 0 0";

  loadMoreGoobersButton = document.createElement("button");
  loadMoreGoobersButton.id = "loadMoreGoobers";
  loadMoreGoobersButton.type = "button";
  loadMoreGoobersButton.className = "gallery-search-button primary";
  loadMoreGoobersButton.hidden = true;
  loadMoreGoobersButton.textContent = "Load more Goobers";
  loadMoreGoobersButton.addEventListener("click", () => {
    visibleLimit += GALLERY_INCREMENT;
    applyCurrentFilter();
  });

  wrapper.appendChild(loadMoreGoobersButton);
  gooberGrid.insertAdjacentElement("afterend", wrapper);
}

function makeCardClickable(card, goober) {
  if (!card || card.dataset.viewerReady === "true") return;

  card.dataset.viewerReady = "true";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `View ${goober.name || "Goober"}`);

  card.addEventListener("click", () => openGooberViewer(goober));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openGooberViewer(goober);
    }
  });
}

function getGooberFromCard(card) {
  const image = card.querySelector(".goober-image img");
  const title = card.querySelector(".goober-info h3");
  const description = card.querySelector(".tagline");

  return {
    id: card.dataset.cloudGooberId || card.dataset.name || title?.textContent || "static-goober",
    name: card.dataset.name || title?.textContent || "Goober",
    category: card.dataset.category || "classic",
    description: card.dataset.description || description?.textContent || "A mysterious Goober with powerful Goober energy.",
    imageUrl: image?.getAttribute("src") || "/assets/original-goober.jpg"
  };
}

function initializeExistingGalleryCards() {
  document.querySelectorAll(".goober-card").forEach((card) => {
    makeCardClickable(card, getGooberFromCard(card));
  });
}

function createGooberCard(goober, isCloud = false) {
  const card = document.createElement("article");
  card.className = "goober-card";
  card.dataset.category = goober.category || "classic";
  card.dataset.name = goober.name || "";
  card.dataset.description = goober.description || "";

  if (isCloud) {
    card.dataset.cloudGooberId = goober.id;
  }

  const imageWrap = document.createElement("div");
  imageWrap.className = "goober-image";

  const img = document.createElement("img");
  img.src = goober.imageUrl;
  img.alt = goober.name;
  img.loading = "lazy";
  imageWrap.appendChild(img);

  const info = document.createElement("div");
  info.className = "goober-info";

  const title = document.createElement("h3");
  title.textContent = goober.name;

  const description = document.createElement("p");
  description.className = "tagline";
  description.textContent = goober.description;

  const tags = document.createElement("div");
  tags.className = "goober-tags";

  const categoryTag = document.createElement("span");
  categoryTag.className = "tag";
  categoryTag.textContent = goober.category || "classic";

  const sourceTag = document.createElement("span");
  sourceTag.className = "tag";
  sourceTag.textContent = isCloud ? "uploaded" : "original";

  tags.appendChild(categoryTag);
  tags.appendChild(sourceTag);

  info.appendChild(title);
  info.appendChild(description);
  info.appendChild(tags);

  card.appendChild(imageWrap);
  card.appendChild(info);
  makeCardClickable(card, goober);

  return card;
}

function openGooberViewer(goober) {
  if (!gooberViewer || !viewerImage || !viewerTitle || !viewerDescription || !viewerCategory) return;

  viewerImage.src = goober.imageUrl;
  viewerImage.alt = goober.name || "Selected Goober";
  viewerTitle.textContent = goober.name || "Goober";
  viewerDescription.textContent = goober.description || "A mysterious Goober with powerful Goober energy.";
  viewerCategory.textContent = `${goober.category || "classic"} Goober`;
  gooberViewer.hidden = false;
  document.body.classList.add("viewer-open");
  viewerClose?.focus();
}

function closeGooberViewer() {
  if (!gooberViewer) return;

  gooberViewer.hidden = true;
  document.body.classList.remove("viewer-open");
}

viewerClose?.addEventListener("click", closeGooberViewer);
viewerBackdrop?.addEventListener("click", closeGooberViewer);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && gooberViewer && !gooberViewer.hidden) {
    closeGooberViewer();
  }
});

function setFeaturedGoober(goober) {
  if (!featuredGooberCard || !featuredGooberImage || !featuredGooberTitle || !featuredGooberDescription) {
    return;
  }

  if (!goober || !goober.imageUrl) {
    featuredGooberImage.src = "/assets/original-goober.jpg";
    featuredGooberImage.alt = "Original Goober, a hand-drawn loaf-shaped cartoon dog with no legs";
    featuredGooberTitle.textContent = "Original Goober";
    featuredGooberDescription.textContent =
      "The classic Goober. One loaf, zero legs, big snoot, pure goober geometry.";
    return;
  }

  featuredGooberImage.src = goober.imageUrl;
  featuredGooberImage.alt = goober.name || "Featured uploaded Goober";
  featuredGooberTitle.textContent = goober.name || "Featured Goober";
  featuredGooberDescription.textContent =
    goober.description || "A randomly featured uploaded Goober from the gallery.";
}

function randomizeFeaturedGoober(goobers) {
  if (!Array.isArray(goobers) || goobers.length === 0) {
    setFeaturedGoober(null);
    return;
  }

  const randomGoober = goobers[Math.floor(Math.random() * goobers.length)];
  setFeaturedGoober(randomGoober);
}

function getMatchingCards() {
  return [...document.querySelectorAll(".goober-card")].filter((card) => {
    const category = card.dataset.category || "classic";
    const gooberName = normalizeText(card.dataset.name || "");
    const matchesFilter = activeFilter === "all" || category === activeFilter;
    const matchesSearch = !searchTerm || gooberName.includes(searchTerm);

    return matchesFilter && matchesSearch;
  });
}

function applyCurrentFilter() {
  ensureLoadMoreButton();

  const allCards = [...document.querySelectorAll(".goober-card")];
  const matchingCards = getMatchingCards();
  const visibleCards = new Set(matchingCards.slice(0, visibleLimit));

  allCards.forEach((card) => {
    card.style.display = visibleCards.has(card) ? "block" : "none";
  });

  if (gooberCountText) {
    const shown = Math.min(visibleLimit, matchingCards.length);
    const searchNote = searchTerm ? ` matching “${gooberSearchInput?.value.trim() || searchTerm}” by name` : "";
    gooberCountText.textContent = `${shown} of ${matchingCards.length} Goobers showing${searchNote}`;
  }

  if (loadMoreGoobersButton) {
    const hasMore = matchingCards.length > visibleLimit;
    loadMoreGoobersButton.hidden = !hasMore;
    loadMoreGoobersButton.textContent = hasMore
      ? `Load ${Math.min(GALLERY_INCREMENT, matchingCards.length - visibleLimit)} more Goobers`
      : "All matching Goobers shown";
  }
}

function resetGalleryLimit() {
  visibleLimit = INITIAL_GALLERY_LIMIT;
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    resetGalleryLimit();

    filterButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");

    applyCurrentFilter();
  });
});

function runNameSearch() {
  searchTerm = normalizeText(gooberSearchInput?.value || "");
  resetGalleryLimit();
  applyCurrentFilter();
}

gooberSearchInput?.addEventListener("input", runNameSearch);
gooberSearchInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runNameSearch();
  }
});
gooberSearchButton?.addEventListener("click", runNameSearch);
gooberClearSearchButton?.addEventListener("click", () => {
  if (gooberSearchInput) {
    gooberSearchInput.value = "";
  }

  runNameSearch();
  gooberSearchInput?.focus();
});

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image file."));

    reader.readAsDataURL(file);
  });
}

async function loadCloudGoobers(options = {}) {
  if (!gooberGrid) return;

  try {
    document
      .querySelectorAll("[data-cloud-goober-id]")
      .forEach((card) => card.remove());

    const cacheBust = options.bustCache ? `?t=${Date.now()}` : "";
    const response = await fetch(`${API_BASE}/api/goobers${cacheBust}`, {
      cache: options.bustCache ? "no-store" : "default"
    });

    if (!response.ok) {
      throw new Error("Could not load uploaded Goobers.");
    }

    const goobers = await response.json();

    goobers.forEach((goober) => {
      gooberGrid.appendChild(createGooberCard(goober, true));
    });

    randomizeFeaturedGoober(goobers);
    resetGalleryLimit();
    applyCurrentFilter();

    if (uploadStatus) {
      uploadStatus.textContent = `${goobers.length} uploaded Goober${
        goobers.length === 1 ? "" : "s"
      } loaded.`;
    }
  } catch (error) {
    console.error(error);
    setFeaturedGoober(null);

    if (uploadStatus) {
      uploadStatus.textContent =
        "Uploaded Goobers could not be loaded. Check the Worker API setup.";
    }
  }
}

if (gooberImageInput) {
  gooberImageInput.addEventListener("change", async () => {
    const file = gooberImageInput.files[0];

    if (!file) {
      filePreview.textContent = "Image preview will appear here.";
      return;
    }

    if (!file.type.startsWith("image/")) {
      filePreview.textContent = "Please choose an image file.";
      gooberImageInput.value = "";
      return;
    }

    const imageData = await readImageFile(file);

    filePreview.innerHTML = "";

    const previewImage = document.createElement("img");
    previewImage.src = imageData;
    previewImage.alt = "Goober preview";

    filePreview.appendChild(previewImage);
  });
}

// Downscale big photos before upload so they stay under the auto-mod's size limit.
// Trim the empty paper around the drawing (shared with Goober Cards' upload screen);
// falls back to a plain shrink if that module can't load.
async function prepareUpload(file) {
  try {
    const { prepareDrawing } = await import("/goober-cards/image.js");
    return await prepareDrawing(file);
  } catch {
    return shrinkImage(file);
  }
}

async function shrinkImage(file, maxSide = 1600) {
  try {
    if (file.type === "image/gif" || typeof createImageBitmap !== "function") return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

// Uploading needs a Goober Cards account. Goober Cards (same site) keeps the login in localStorage.
const GOOBER_CARDS_SESSION = "gooberCardsSession";
const GOOBER_CARDS_USER = "gooberCardsUser";

function gooberCardsLogin() {
  try {
    const token = localStorage.getItem(GOOBER_CARDS_SESSION);
    const user = JSON.parse(localStorage.getItem(GOOBER_CARDS_USER) || "null");
    return token && user?.username ? { token, username: user.username } : null;
  } catch {
    return null;
  }
}

function forgetGooberCardsLogin() {
  try {
    localStorage.removeItem(GOOBER_CARDS_SESSION);
    localStorage.removeItem(GOOBER_CARDS_USER);
  } catch { /* storage blocked */ }
}

function renderUploadGate(message = "") {
  renderAccountButton();
  if (!uploadForm || !uploadGate) return;
  const login = gooberCardsLogin();
  uploadGate.hidden = Boolean(login);
  uploadForm.hidden = !login;
  if (message && uploadGateMessage) uploadGateMessage.textContent = message;
  if (login && uploadAs) {
    uploadAs.hidden = false;
    uploadAs.textContent = `Uploading as ${login.username}`;
  }
}

// --- Goober Cards account on the main site ------------------------------------
// Logging in here uses Goober Cards' own account code, so it's the same login
// (and the same saved cards) as the game.
const accountButton = document.getElementById("accountButton");
let accountModule = null;
const loadAccount = () => (accountModule ??= import("/goober-cards/account.js"));

function renderAccountButton() {
  if (!accountButton) return;
  const login = gooberCardsLogin();
  accountButton.textContent = login ? `👤 ${login.username}` : "Log in";
  accountButton.classList.toggle("logged-in", Boolean(login));
}

function closeAccountModal() {
  document.querySelector(".account-modal")?.remove();
}

function openAccountModal(mode = "login") {
  closeAccountModal();
  const login = gooberCardsLogin();
  const modal = document.createElement("div");
  modal.className = "account-modal";
  const signingUp = mode === "signup";
  modal.innerHTML = login
    ? `<div class="account-sheet" role="dialog" aria-modal="true" aria-labelledby="accountTitle">
        <h3 id="accountTitle">👤 ${escapeHtml(login.username)}</h3>
        <p>You're logged in to Goober Cards. You can add Goobers here and play with the same account.</p>
        <div class="upload-actions"><a class="upload-button primary" href="/goober-cards/">Open Goober Cards</a><button class="upload-button" type="button" data-logout>Log out</button><button class="upload-button" type="button" data-close>Close</button></div>
      </div>`
    : `<form class="account-sheet" role="dialog" aria-modal="true" aria-labelledby="accountTitle">
        <h3 id="accountTitle">${signingUp ? "Make a Goober Cards account" : "Log in to Goober Cards"}</h3>
        <div class="account-tabs"><button type="button" class="${signingUp ? "" : "on"}" data-mode="login">Log in</button><button type="button" class="${signingUp ? "on" : ""}" data-mode="signup">Sign up</button></div>
        <label>Username<input name="username" maxlength="20" autocomplete="username" autocapitalize="off" spellcheck="false" required placeholder="3-20 letters, numbers, _"></label>
        <label>Password<input name="password" type="password" maxlength="200" autocomplete="${signingUp ? "new-password" : "current-password"}" required placeholder="At least 6 characters"></label>
        ${signingUp ? `<label>Password again<input name="password2" type="password" maxlength="200" autocomplete="new-password" required></label><p class="account-note">No email, so write your password down somewhere safe.</p>` : `<p class="account-note">Same account as the game: your cards and coins come with you.</p>`}
        <p class="account-error" data-error hidden></p>
        <div class="upload-actions"><button class="upload-button" type="button" data-close>Cancel</button><button class="upload-button primary" type="submit">${signingUp ? "Create account" : "Log in"}</button></div>
      </form>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", event => {
    if (event.target === modal || event.target.closest("[data-close]")) closeAccountModal();
    const switchTo = event.target.closest("[data-mode]")?.dataset.mode;
    if (switchTo && switchTo !== mode) openAccountModal(switchTo);
  });
  const logout = modal.querySelector("[data-logout]");
  if (logout) logout.onclick = async () => {
    logout.disabled = true;
    try { await (await loadAccount()).logout(); } catch { forgetGooberCardsLogin(); }
    closeAccountModal();
    renderUploadGate();
  };
  const form = modal.querySelector("form");
  if (!form) return;
  setTimeout(() => form.username.focus(), 30);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const error = form.querySelector("[data-error]");
    const submit = form.querySelector("[type=submit]");
    if (signingUp && form.password.value !== form.password2.value) { error.hidden = false; error.textContent = "Those passwords don't match."; return; }
    submit.disabled = true;
    error.hidden = true;
    try {
      const account = await loadAccount();
      const user = signingUp ? await account.signup(form.username.value.trim(), form.password.value) : await account.login(form.username.value.trim(), form.password.value);
      closeAccountModal();
      renderUploadGate();
      if (uploadStatus) uploadStatus.textContent = `Welcome${signingUp ? "" : " back"}, ${user.username}! You can add Goobers now.`;
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message || "Something went wrong.";
      submit.disabled = false;
    }
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

accountButton?.addEventListener("click", () => openAccountModal("login"));
document.addEventListener("click", event => {
  const mode = event.target.closest("[data-open-account]")?.dataset.openAccount;
  if (mode) openAccountModal(mode);
});
document.addEventListener("keydown", event => { if (event.key === "Escape") closeAccountModal(); });

renderUploadGate();
// Pick up a login from another tab, or from coming back after logging in.
window.addEventListener("storage", event => {
  if (event.key === GOOBER_CARDS_SESSION || event.key === GOOBER_CARDS_USER) renderUploadGate();
});
window.addEventListener("pageshow", () => renderUploadGate());

if (uploadForm) {
  uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const login = gooberCardsLogin();
    if (!login) {
      renderUploadGate();
      return;
    }

    const file = gooberImageInput.files[0];
    if (!file) {
      uploadStatus.textContent = "Choose a Goober image first.";
      return;
    }

    if (!file.type.startsWith("image/")) {
      uploadStatus.textContent = "That file does not look like an image.";
      return;
    }

    const name = gooberNameInput.value.trim();
    const description = gooberDescriptionInput.value.trim();
    const category = gooberCategoryInput.value;

    if (!name || !description) {
      uploadStatus.textContent = "Give the Goober a name and description.";
      return;
    }

    const formData = new FormData();
    formData.append("name", name);
    formData.append("category", category);
    formData.append("description", description);
    uploadStatus.textContent = "Getting your Goober ready...";
    formData.append("image", await prepareUpload(file));

    uploadStatus.textContent = "Uploading Goober... the auto-mod is taking a look.";

    try {
      const response = await fetch(`${API_BASE}/api/goobers`, {
        method: "POST",
        headers: { authorization: `Bearer ${login.token}` },
        body: formData,
        cache: "no-store"
      });

      const result = await response.json().catch(() => ({}));

      if (response.status === 401) {
        forgetGooberCardsLogin();
        uploadStatus.textContent = "";
        renderUploadGate("Your login expired. Log in again to add your Goober (you'll need to pick the image again).");
        return;
      }

      if (!response.ok) {
        if (result.moderation === "blocked") {
          uploadStatus.textContent = `🚫 Auto-mod said no: ${result.reason || "that Goober isn't allowed here"}. Try a different drawing or description.`;
          return;
        }
        throw new Error(result.error || "Upload failed.");
      }

      uploadForm.reset();
      filePreview.textContent = "Image preview will appear here.";
      if (result.moderation === "pending") {
        uploadStatus.textContent = `⏳ ${result.name || name} is waiting for a mod to approve it. Once it's approved it becomes a card you can craft at the creator price${result.card ? ` (${result.card.creatorCost} coins)` : ""}.`;
        return;
      }
      // Refresh the gallery first: it writes its own status line, which would hide this one.
      await loadCloudGoobers({ bustCache: true });

      uploadStatus.textContent = result.card
        ? `✅ ${result.name || name} is live in the gallery and it's ${/^[aeiou]/.test(result.card.rarity) ? "an" : "a"} ${result.card.rarity} card now! Craft it in Goober Cards for ${result.card.creatorCost} coins (creator price, normally ${result.card.craftCost}) or pull it from a pack.`
        : `✅ ${result.name || name} passed the auto-mod and is live (and it's a card now).`;
    } catch (error) {
      console.error(error);

      uploadStatus.textContent =
        error.message || "Upload failed. Check the Worker API setup.";
    }
  });
}

if (reloadCloudGoobersButton) {
  reloadCloudGoobersButton.addEventListener("click", () => loadCloudGoobers({ bustCache: true }));
}

ensureLoadMoreButton();
initializeExistingGalleryCards();
loadCloudGoobers({ bustCache: true });