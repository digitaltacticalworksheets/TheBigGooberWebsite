// Get an uploaded drawing ready for the gallery and its card: shrink it, put it on
// white (transparent PNGs), and trim away the empty paper around the Goober so the
// drawing fills the card's art box instead of floating in a sea of white.
const MAX_SIDE = 1600;
const PAD = 0.08;

// Pixels that count as blank paper: see-through, or nearly white.
function isBlank(data, i) {
  return data[i + 3] < 16 || (data[i] > 232 && data[i + 1] > 232 && data[i + 2] > 232);
}

// Bounding box of the drawing, scanning a small copy for speed.
function drawingBounds(bitmap) {
  const scan = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scan)), h = Math.max(1, Math.round(bitmap.height * scan));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isBlank(data, (y * w + x) * 4)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0 / scan, y: y0 / scan, w: (x1 - x0 + 1) / scan, h: (y1 - y0 + 1) / scan };
}

export async function prepareDrawing(file) {
  try {
    // Animated GIFs would lose their animation on a canvas: leave them alone.
    if (file.type === "image/gif" || typeof createImageBitmap !== "function") return file;
    const bitmap = await createImageBitmap(file);
    let crop = { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
    const box = drawingBounds(bitmap);
    // Only trim when there's a real margin to lose (and never down to a speck).
    if (box && box.w * box.h < bitmap.width * bitmap.height * 0.85 && box.w > 24 && box.h > 24) {
      const pad = Math.max(box.w, box.h) * PAD;
      const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
      crop = { x, y, w: Math.min(bitmap.width, box.x + box.w + pad) - x, h: Math.min(bitmap.height, box.y + box.h + pad) - y };
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(crop.w, crop.h));
    const untouched = crop.w === bitmap.width && crop.h === bitmap.height && scale === 1;
    if (untouched && file.size < 1.5 * 1024 * 1024 && file.type !== "image/png") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(crop.w * scale));
    canvas.height = Math.max(1, Math.round(crop.h * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}
