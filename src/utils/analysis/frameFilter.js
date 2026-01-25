// src/utils/analysis/frameFilter.js

/**
 * legendColors 에 가까운 색만 남기고 나머지를 투명 처리한 PNG dataURL 생성
 */
export function makeFilteredFrameDataUrl(imgData, legendColors, threshold = 30) {
  if (!imgData || !legendColors || legendColors.length === 0) return null;

  const { width, height, data } = imgData;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const out = ctx.createImageData(width, height);

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    let ok = false;
    for (let c of legendColors) {
      const dr = r - c.r;
      const dg = g - c.g;
      const db = b - c.b;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist < threshold) {
        ok = true;
        break;
      }
    }

    if (ok) {
      out.data[idx] = r;
      out.data[idx + 1] = g;
      out.data[idx + 2] = b;
      out.data[idx + 3] = 255;
    } else {
      out.data[idx] = 0;
      out.data[idx + 1] = 0;
      out.data[idx + 2] = 0;
      out.data[idx + 3] = 0;
    }
  }

  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL("image/png");
}
