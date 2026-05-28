const API_BASE = "";

const filterButtons = document.querySelectorAll(".filter-btn");
const gooberGrid = document.getElementById("gooberGrid");
const uploadForm = document.getElementById("gooberUploadForm");
const gooberNameInput = document.getElementById("gooberName");
const gooberCategoryInput = document.getElementById("gooberCategory");
const gooberDescriptionInput = document.getElementById("gooberDescription");
const gooberImageInput = document.getElementById("gooberImage");
const gooberUploadCodeInput = document.getElementById("gooberUploadCode");
const adminDeleteCodeInput = document.getElementById("adminDeleteCode");
const filePreview = document.getElementById("filePreview");
const uploadStatus = document.getElementById("uploadStatus");
const reloadCloudGoobersButton = document.getElementById("reloadCloudGoobers");
const featuredGooberCard = document.querySelector(".feature-card");
const featuredGooberImage = featuredGooberCard?.querySelector("img");
const featuredGooberTitle = featuredGooberCard?.querySelector("h2");
const featuredGooberDescription = featuredGooberCard?.querySelector("p");

let activeFilter = "all";

function isAdminDeleteUnlocked() {
  return Boolean(adminDeleteCodeInput?.value.trim());
}

function updateAdminDeleteVisibility() {
  const isUnlocked = isAdminDeleteUnlocked();

  document.querySelectorAll(".delete-goober").forEach((button) => {
    button.hidden = !isUnlocked;
  });
}

function createGooberCard(goober, isCloud = false) {
  const card = document.createElement("article");
  card.className = "goober-card";
  card.dataset.category = goober.category || "classic";

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

  if (isCloud) {
    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-goober";
    deleteButton.type = "button";
    deleteButton.textContent = "Admin delete";
    deleteButton.hidden = !isAdminDeleteUnlocked();
    deleteButton.addEventListener("click", () => deleteGoober(goober));
    info.appendChild(deleteButton);
  }

  card.appendChild(imageWrap);
  card.appendChild(info);

  return card;
}

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
  document.querySelectorAll(".goober-card").forEach((card) => {
    const shouldShow =
      activeFilter === "all" || card.dataset.category === activeFilter;

    card.style.display = shouldShow ? "block" : "none";
  });
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;

    filterButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");

    applyCurrentFilter();
  });
});

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image file."));

    reader.readAsDataURL(file);
  });
}

async function loadCloudGoobers() {
  if (!gooberGrid) return;

  try {
    document
      .querySelectorAll("[data-cloud-goober-id]")
      .forEach((card) => card.remove());

    const response = await fetch(`${API_BASE}/api/goobers`);

    if (!response.ok) {
      throw new Error("Could not load uploaded Goobers.");
    }

    const goobers = await response.json();

    goobers.forEach((goober) => {
      gooberGrid.appendChild(createGooberCard(goober, true));
    });

    randomizeFeaturedGoober(goobers);
    updateAdminDeleteVisibility();
    applyCurrentFilter();

    if (uploadStatus && goobers.length > 0) {
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

async function deleteGoober(goober) {
  const adminCode = adminDeleteCodeInput?.value.trim() || "";

  if (!adminCode) {
    uploadStatus.textContent = "Enter the admin delete code first.";
    updateAdminDeleteVisibility();
    return;
  }

  const confirmed = window.confirm(`Delete ${goober.name || "this Goober"}? This removes it from the gallery and games.`);

  if (!confirmed) {
    uploadStatus.textContent = "Admin delete canceled.";
    return;
  }

  uploadStatus.textContent = `Deleting ${goober.name || "Goober"}...`;

  try {
    const response = await fetch(`${API_BASE}/api/goobers/${encodeURIComponent(goober.id)}`, {
      method: "DELETE",
      headers: {
        "x-goober-admin-code": adminCode
      }
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || "Delete failed.");
    }

    uploadStatus.textContent = `${goober.name || "Goober"} deleted.`;
    await loadCloudGoobers();
  } catch (error) {
    console.error(error);
    uploadStatus.textContent = error.message || "Delete failed.";
  }
}

if (adminDeleteCodeInput) {
  adminDeleteCodeInput.addEventListener("input", updateAdminDeleteVisibility);
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
        body: formData
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

      await loadCloudGoobers();

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
  reloadCloudGoobersButton.addEventListener("click", loadCloudGoobers);
}

loadCloudGoobers();
