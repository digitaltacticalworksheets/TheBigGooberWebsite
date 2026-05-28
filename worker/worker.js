export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return corsResponse(null, 204);
      }

      if (url.pathname === "/api/goobers" && request.method === "GET") {
        return await listGoobers(env);
      }

      if (url.pathname === "/api/goobers" && request.method === "POST") {
        return await uploadGoober(request, env);
      }

      if (url.pathname.startsWith("/api/goober-image/") && request.method === "GET") {
        return await getGooberImage(request, env);
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error(error);
      return jsonResponse({ error: error.message || "Server error" }, 500);
    }
  }
};