<script>
    const API_BASE = "";

    const filterButtons = document.querySelectorAll(".filter-btn");
    const gooberGrid = document.getElementById("gooberGrid");
    const uploadForm = document.getElementById("gooberUploadForm");
    const gooberNameInput = document.getElementById("gooberName");
    const gooberCategoryInput = document.getElementById("gooberCategory");
    const gooberDescriptionInput = document.getElementById("gooberDescription");
    const gooberImageInput = document.getElementById("gooberImage");
    const filePreview = document.getElementById("filePreview");
    const uploadStatus = document.getElementById("uploadStatus");
    const reloadCloudGoobersButton = document.getElementById("reloadCloudGoobers");

    let activeFilter = "all";

    function createGooberCard(goober, isCloud = false) {
      const card = document.createElement("article");
      card.className = "goober-card";
      card.dataset.category = goober.category || "classic";
      if (isCloud) card.dataset.cloudGooberId = goober.id;

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

    function applyCurrentFilter() {
      document.querySelectorAll(".goober-card").forEach((card) => {
        const shouldShow = activeFilter === "all" || card.dataset.category === activeFilter;
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
      try {
        document.querySelectorAll("[data-cloud-goober-id]").forEach((card) => card.remove());

        const response = await fetch(`${API_BASE}/api/goobers`);
        if (!response.ok) throw new Error("Could not load uploaded Goobers.");

        const goobers = await response.json();

        goobers.forEach((goober) => {
          gooberGrid.appendChild(createGooberCard(goober, true));
        });

        applyCurrentFilter();

        if (goobers.length > 0) {
          uploadStatus.textContent = `${goobers.length} uploaded Goober${goobers.length === 1 ? "" : "s"} loaded.`;
        }
      } catch (error) {
        console.error(error);
        uploadStatus.textContent = "Uploaded Goobers could not be loaded. Check the Worker API setup.";
      }
    }

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

    uploadForm.addEventListener("submit", async (event) => {
      event.preventDefault();

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

        uploadForm.reset();
        filePreview.textContent = "Image preview will appear here.";
        uploadStatus.textContent = `${result.name || name} uploaded successfully.`;

        await loadCloudGoobers();

        document.getElementById("goobers").scrollIntoView({ behavior: "smooth" });
      } catch (error) {
        console.error(error);
        uploadStatus.textContent = error.message || "Upload failed. Check the Worker API setup.";
      }
    });

    reloadCloudGoobersButton.addEventListener("click", loadCloudGoobers);

    loadCloudGoobers();
  </script>
