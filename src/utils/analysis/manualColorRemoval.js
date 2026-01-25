// src/utils/analysis/manualColorRemoval.js
import { COLOR_REMOVE_RULES } from "./colorRemovalConfig";

// 간단한 RGB 거리
function colorDist(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 지정한 색(들)과 비슷한 픽셀은 전부 "지워버리는" 전처리
 *
 * @param {ImageData} imgData   원본 or crop된 프레임
 * @param {Array} rules         COLOR_REMOVE_RULES 형식 배열 (옵션)
 * @returns {ImageData}         수정된 새 ImageData (원본은 그대로)
 */
export function applyManualColorRemoval(
  imgData,
  rules = COLOR_REMOVE_RULES
) {
  if (!imgData) return null;
  const { width, height, data } = imgData;
  const out = new ImageData(width, height);

  // 먼저 복사
  out.data.set(data);

  const n = width * height;
  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    let shouldRemove = false;

    for (let j = 0; j < rules.length && !shouldRemove; j++) {
      const rule = rules[j];
      const d = colorDist(r, g, b, rule.r, rule.g, rule.b);
      if (d <= rule.dist) {
        shouldRemove = true;
      }
    }

    if (shouldRemove) {
      // 완전 검정으로 지우기 (배경)
      out.data[idx] = 0;
      out.data[idx + 1] = 0;
      out.data[idx + 2] = 0;
      // 필요하면 알파도 255 유지 or 0 으로
      // out.data[idx + 3] = 255;
    }
  }

  return out;
}
