// src/utils/analysis/extractLegendColors.js

export function extractLegendColors(imgData, rect, bins = 12) {
  if (!imgData) return null;
  const { width, height, data } = imgData;

  const x0 = Math.round(rect.x0 * width);
  const x1 = Math.round(rect.x1 * width);
  const y0 = Math.round(rect.y0 * height);
  const y1 = Math.round(rect.y1 * height);

  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);

  const colors = [];

  for (let i = 0; i < bins; i++) {
    const cy = y0 + Math.round(((i + 0.5) / bins) * h);

    let sumR = 0, sumG = 0, sumB = 0, cnt = 0;

    for (let x = x0; x < x0 + w; x++) {
      const idx = (cy * width + x) * 4;
      sumR += data[idx];
      sumG += data[idx + 1];
      sumB += data[idx + 2];
      cnt++;
    }

    colors.push({
      r: Math.round(sumR / cnt),
      g: Math.round(sumG / cnt),
      b: Math.round(sumB / cnt),
    });
  }

  return colors;
}

export function extractLegendPreviewImage(imgData, rect) {
  const { width, height, data } = imgData;

  const x0 = Math.round(rect.x0 * width);
  const x1 = Math.round(rect.x1 * width);
  const y0 = Math.round(rect.y0 * height);
  const y1 = Math.round(rect.y1 * height);

  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  const img = ctx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = ((y0 + y) * width + (x0 + x)) * 4;
      const dstIdx = (y * w + x) * 4;

      img.data[dstIdx] = data[srcIdx];
      img.data[dstIdx + 1] = data[srcIdx + 1];
      img.data[dstIdx + 2] = data[srcIdx + 2];
      img.data[dstIdx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
