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

      if (url.pathname.startsWith("/api/goobers/") && request.method === "DELETE") {
        return await deleteGoober(request, env);
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

const ALLOWED_CATEGORIES = new Set(["classic", "costume", "chaos"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function listGoobers(env) {
  const result = await env.DB.prepare(`
    SELECT id, name, category, description, image_key, image_type, created_at
    FROM goobers
    WHERE approved = 1
    ORDER BY created_at DESC
  `).all();

  const goobers = (result.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    imageUrl: `/api/goober-image/${row.image_key}`,
    createdAt: row.created_at
  }));

  return jsonResponse(goobers);
}

async function uploadGoober(request, env) {
  const formData = await request.formData();

  const uploadCode = cleanText(formData.get("uploadCode"), 120);
  const name = cleanText(formData.get("name"), 80);
  const category = cleanText(formData.get("category"), 30);
  const description = cleanText(formData.get("description"), 280);
  const image = formData.get("image");

  if (!hasValidUploadCode(uploadCode, env)) {
    return jsonResponse({ error: "Invalid upload code." }, 403);
  }

  if (!name) return jsonResponse({ error: "Goober name is required." }, 400);
  if (!description) return jsonResponse({ error: "Goober description is required." }, 400);
  if (!ALLOWED_CATEGORIES.has(category)) return jsonResponse({ error: "Invalid category." }, 400);
  if (!(image instanceof File)) return jsonResponse({ error: "Image file is required." }, 400);
  if (!image.type.startsWith("image/")) return jsonResponse({ error: "File must be an image." }, 400);
  if (image.size > MAX_IMAGE_BYTES) return jsonResponse({ error: "Image is too large. Max size is 5 MB." }, 400);

  const id = crypto.randomUUID();
  const extension = getExtension(image.name, image.type);
  const imageKey = `goobers/${id}.${extension}`;

  await env.GOOBER_IMAGES.put(imageKey, image.stream(), {
    httpMetadata: {
      contentType: image.type
    },
    customMetadata: {
      originalName: image.name || "goober-upload",
      gooberName: name
    }
  });

  await env.DB.prepare(`
    INSERT INTO goobers (
      id, name, category, description, image_key, image_type, approved, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `).bind(id, name, category, description, imageKey, image.type).run();

  return jsonResponse({
    id,
    name,
    category,
    description,
    imageUrl: `/api/goober-image/${imageKey}`
  }, 201);
}

async function deleteGoober(request, env) {
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.replace("/api/goobers/", "")).trim();

  if (!id || id.includes("/") || id.includes("..")) {
    return jsonResponse({ error: "Invalid goober id." }, 400);
  }

  const adminCode = await readAdminCode(request);

  if (!hasValidAdminCode(adminCode, env)) {
    return jsonResponse({ error: "Invalid admin delete code." }, 403);
  }

  const row = await env.DB.prepare(`
    SELECT id, image_key
    FROM goobers
    WHERE id = ?
  `).bind(id).first();

  if (!row) {
    return jsonResponse({ error: "Goober not found." }, 404);
  }

  await env.DB.prepare(`DELETE FROM goobers WHERE id = ?`).bind(id).run();

  if (row.image_key) {
    await env.GOOBER_IMAGES.delete(row.image_key);
  }

  return jsonResponse({ ok: true, id });
}

async function readAdminCode(request) {
  const headerCode = cleanText(request.headers.get("x-goober-admin-code"), 120);
  if (headerCode) return headerCode;

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return cleanText(body.adminCode, 120);
  }

  if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData().catch(() => null);
    return cleanText(formData?.get("adminCode"), 120);
  }

  return "";
}

function hasValidUploadCode(code, env) {
  const expected = cleanText(env.GOOBER_UPLOAD_CODE, 120);
  return Boolean(expected && code && safeEqual(code, expected));
}

function hasValidAdminCode(code, env) {
  const expected = cleanText(env.GOOBER_ADMIN_CODE || env.GOOBER_UPLOAD_CODE, 120);
  return Boolean(expected && code && safeEqual(code, expected));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

async function getGooberImage(request, env) {
  const url = new URL(request.url);
  const imageKey = decodeURIComponent(url.pathname.replace("/api/goober-image/", ""));

  if (!imageKey || imageKey.includes("..") || !imageKey.startsWith("goobers/")) {
    return jsonResponse({ error: "Invalid image key." }, 400);
  }

  const object = await env.GOOBER_IMAGES.get(imageKey);

  if (!object) {
    return jsonResponse({ error: "Image not found." }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function getExtension(filename = "", contentType = "") {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".webp")) return "webp";
  if (lower.endsWith(".gif")) return "gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";

  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";

  return "jpg";
}

function jsonResponse(data, status = 200) {
  return corsResponse(JSON.stringify(data), status, {
    "content-type": "application/json; charset=utf-8"
  });
}

function corsResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type, x-goober-admin-code",
      ...headers
    }
  });
}
