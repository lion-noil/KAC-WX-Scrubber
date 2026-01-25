// src/utils/analysis/colorLegend.js

import { rgbToHsv } from "./cloudGridUtils"; // 아래에서 같이 뽑을 예정

// HSV 거리
function hsvDistance(a, b) {
  const dh = Math.min(Math.abs(a.h - b.h), 1 - Math.abs(a.h - b.h));
  const ds = Math.abs(a.s - b.s);
  const dv = Math.abs(a.v - b.v);
  return 3 * dh + ds + dv;
}

/**
 * 한 프레임에서 컬러바(범례) 영역만 잘라서 단계별 대표 색상 리스트를 생성.
 *
 * @param {ImageData} imgData  전체 프레임
 * @param {object} rect        범례 영역 (비율, 0~1)
 *   - x0, x1, y0, y1 : width/height 에 대한 비율
 * @param {number} nBins       몇 단계로 나눌지 (예: 10~15)
 * @returns [{label, rgb, hsv}]  위에서부터 아래까지 순서대로
 */
export function extractLegendPalette(imgData, rect, nBins = 12) {
  const { width, height, data } = imgData;
  const x0 = Math.round(rect.x0 * width);
  const x1 = Math.round(rect.x1 * width);
  const y0 = Math.round(rect.y0 * height);
  const y1 = Math.round(rect.y1 * height);

  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);

  const satTh = 0.4;
  const minV = 0.15;
  const maxV = 0.98;

  const bins = [];
  for (let i = 0; i < nBins; i++) {
    const cy = y0 + Math.round(((i + 0.5) / nBins) * h); // 각 bin 중앙 y
    let sumR = 0, sumG = 0, sumB = 0, cnt = 0;

    for (let x = x0; x < x0 + w; x++) {
      const idx = (cy * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const hsv = rgbToHsv(r / 255, g / 255, b / 255);
      if (hsv.s < satTh || hsv.v < minV || hsv.v > maxV) continue;
      sumR += r; sumG += g; sumB += b; cnt++;
    }

    if (cnt === 0) {
      bins.push(null);
      continue;
    }

    const rgb = {
      r: Math.round(sumR / cnt),
      g: Math.round(sumG / cnt),
      b: Math.round(sumB / cnt),
    };
    const hsv = rgbToHsv(rgb.r / 255, rgb.g / 255, rgb.b / 255);
    bins.push({ rgb, hsv });
  }

  // 빈 bin 제거
  return bins.filter(Boolean);
}

/**
 * 팔레트 기반으로 "이 픽셀이 비인지" 판단하는 함수 생성.
 */
export function makeRainColorPredicate(palette, distThreshold = 0.6) {
  if (!palette || palette.length === 0) {
    return () => false;
  }
  return (hsv) => {
    let minD = Infinity;
    for (const p of palette) {
      const d = hsvDistance(hsv, p.hsv);
      if (d < minD) minD = d;
    }
    return minD < distThreshold;
  };
}
