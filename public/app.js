const API_BASE = "";

const filterButtons = document.querySelectorAll(".filter-btn");
const gooberGrid = document.getElementById("gooberGrid");
const uploadForm = document.getElementById("gooberUploadForm");
const gooberNameInput = document.getElementById("gooberName");
const gooberCategoryInput = document.getElementById("gooberCategory");
const gooberDescriptionInput = document.getElementById("gooberDescription");
const gooberImageInput = document.getElementById("gooberImage");
const gooberUploadCodeInput = document.getElementById("gooberUploadCode");
const gooberSearchInput = document.getElementById("gooberSearch");
const gooberCountText = document.getElementById("gooberCountText");
const filePreview = document.getElementById("filePreview");
const uploadStatus = document.getElementById("uploadStatus");
const reloadCloudGoobersButton = document.getElementById("reloadCloudGoobers");
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

let activeFilter = "all";
let searchTerm = "";

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
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
    featuredGooberImage.alt = "Original Goober, a hand-drawn cartoon dog";
    featuredGooberTitle.textContent = "Original Goober";
    featuredGooberDescription.textContent =
      "The classic Goober. No gimmicks. No nonsense. Just pure goober geometry.";
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

function applyCurrentFilter() {
  let visibleCount = 0;
  let totalCount = 0;

  document.querySelectorAll(".goober-card").forEach((card) => {
    totalCount += 1;

    const category = card.dataset.category || "classic";
    const searchableText = normalizeText(`${card.dataset.name || ""} ${card.dataset.description || ""} ${category}`);
    const matchesFilter = activeFilter === "all" || category === activeFilter;
    const matchesSearch = !searchTerm || searchableText.includes(searchTerm);
    const shouldShow = matchesFilter && matchesSearch;

    card.style.display = shouldShow ? "block" : "none";
    if (shouldShow) visibleCount += 1;
  });

  if (gooberCountText) {
    gooberCountText.textContent = `${visibleCount} of ${totalCount} Goobers showing`;
  }
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;

    filterButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");

    applyCurrentFilter();
  });
});

gooberSearchInput?.addEventListener("input", () => {
  searchTerm = normalizeText(gooberSearchInput.value);
  applyCurrentFilter();
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

if (uploadForm) {
  uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const file = gooberImageInput.files[0];
    const uploadCode = gooberUploadCodeInput?.value.trim() || "";

    if (!uploadCode) {
      uploadStatus.textContent = "Enter the upload code first.";
      return;
    }

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
    formData.append("uploadCode", uploadCode);
    formData.append("name", name);
    formData.append("category", category);
    formData.append("description", description);
    formData.append("image", file);

    uploadStatus.textContent = "Uploading Goober...";

    try {
      const response = await fetch(`${API_BASE}/api/goobers`, {
        method: "POST",
        body: formData,
        cache: "no-store"
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || "Upload failed.");
      }

      const savedCode = uploadCode;
      uploadForm.reset();
      if (gooberUploadCodeInput) gooberUploadCodeInput.value = savedCode;
      filePreview.textContent = "Image preview will appear here.";
      uploadStatus.textContent = `${result.name || name} uploaded successfully.`;

      await loadCloudGoobers({ bustCache: true });

      document.getElementById("goobers").scrollIntoView({
        behavior: "smooth"
      });
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

loadCloudGoobers({ bustCache: true });
