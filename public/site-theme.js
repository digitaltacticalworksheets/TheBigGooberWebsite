(() => {
  const storageKey = "gooberSiteTheme";

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.body.classList.toggle("dark-site", isDark);
    document.documentElement.classList.toggle("dark-site", isDark);
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.textContent = isDark ? "Light Mode" : "Dark Mode";
      button.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    });
  }

  function getInitialTheme() {
    const saved = localStorage.getItem(storageKey);
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function toggleTheme() {
    const next = document.body.classList.contains("dark-site") ? "light" : "dark";
    localStorage.setItem(storageKey, next);
    localStorage.setItem("gooberCardsTheme", next);
    applyTheme(next);
  }

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(getInitialTheme());

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", toggleTheme);
    });
  });
})();
