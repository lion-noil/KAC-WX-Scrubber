// src/utils/analysis/cloudGrid.js
import { rgbToHsv } from "./cloudGridUtils";

/**
 * RGB 공간에서 가장 가까운 컬러바 색을 찾는다.
 * @returns {{index:number, dist:number}}
 */
function closestLegendColor(r255, g255, b255, legendColors) {
  let bestIdx = -1;
  let bestDist = Infinity;

  for (let i = 0; i < legendColors.length; i++) {
    const c = legendColors[i];
    const dr = r255 - c.r;
    const dg = g255 - c.g;
    const db = b255 - c.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return { index: bestIdx, dist: bestDist };
}

// ★ 컬러바 기본 값(위 → 아래 순서). 필요하면 나중에 네가 수정해도 됨.
const DEFAULT_LEGEND_VALUES = [
  150, 110, 90, 70, 60, 50, 40, 30, 25, 20, 15, 10,
  9, 8, 7, 6, 5, 4, 3, 2, 1, 0.5, 0.1, 0.0,
];

/**
 * 레이더 이미지에서 "강수량(mm/h)" 값 그리드를 만든다.
 * 각 셀에는 해당 영역의 최대 강수량이 들어감.
 *
 * @param {ImageData} imgData video.captureImage() 로 얻은 RGBA
 * @param {number} gridSize   격자 한 변 길이 (예: 32)
 * @param {number} radarRadiusPx 레이더 원 반지름(픽셀). 없으면 자동 추정.
 * @param {object} opts
 *   - legendColors: 컬러바에서 추출한 색 배열 [{r,g,b}, ...]
 *   - legendValues: 각 색에 대응하는 mm/h 배열 (위→아래). 없으면 DEFAULT_LEGEND_VALUES 사용.
 *   - colorDistThreshold: 컬러바 색과 얼마나 가까워야 강수로 볼지 (기본 30)
 *   - defaultValue: 아무것도 없을 때 값 (기본 0)
 *   - satThreshold, minV, maxV: legendColors 없을 때 쓰는 HSV fallback 용
 */
export function buildCloudValueGrid(
  imgData,
  gridSize = 32,
  radarRadiusPx,
  opts = {}
) {
  if (!imgData) return null;
  const { width, height, data } = imgData;

  const N = gridSize;
  const grid = Array.from({ length: N }, () => Array(N).fill(opts.defaultValue ?? 0));

  const cx = width / 2;
  const cy = height / 2;
  const R = radarRadiusPx || Math.min(cx, cy) * 0.95;

  const legendColors = opts.legendColors || null;
  const colorDistThreshold = opts.colorDistThreshold ?? 30;

  const satTh = opts.satThreshold ?? 0.25;
  const minV = opts.minV ?? 0.15;
  const maxV = opts.maxV ?? 0.98;

  // ★ legendValues: 길이가 legendColors 이상이면 필요 부분만 사용
  let legendValues = opts.legendValues || null;
  if (legendColors && legendColors.length) {
    const base = legendValues || DEFAULT_LEGEND_VALUES;
    legendValues = base.slice(0, legendColors.length);
  }

  // 픽셀 단위 임시 버퍼 (최대 강수량 저장)
  const temp = Array.from({ length: height }, () =>
    Array(width).fill(opts.defaultValue ?? 0)
  );

  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > R * R) continue; // 레이더 원 밖은 무시

      const idx = (y * width + x) * 4;
      const r255 = data[idx];
      const g255 = data[idx + 1];
      const b255 = data[idx + 2];

      const r = r255 / 255;
      const g = g255 / 255;
      const b = b255 / 255;

      let value = 0;

      if (legendColors && legendColors.length && legendValues) {
        // ★ 1순위: 컬러바 기반 강수량(mm/h)
        const { index, dist } = closestLegendColor(
          r255,
          g255,
          b255,
          legendColors
        );
        if (index >= 0 && dist < colorDistThreshold) {
          value = legendValues[index] ?? 0;
        } else {
          value = 0;
        }
      } else {
        // 2순위: HSV 기반 fallback (강수 있으면 1, 없으면 0 정도로)
        const hsv = rgbToHsv(r, g, b);
        value = hsv.s > satTh && hsv.v > minV && hsv.v < maxV ? 1 : 0;
      }

      if (value > 0) {
        // 해당 픽셀의 강수량 기록 (최댓값 유지)
        if (value > temp[y][x]) temp[y][x] = value;
      }
    }
  }

  // temp[y][x] → grid[gy][gx] 로 다운샘플 (최댓값 사용)
  for (let y = 0; y < height; y++) {
    const gy = Math.floor((y / height) * N);
    for (let x = 0; x < width; x++) {
      const v = temp[y][x];
      if (v <= 0) continue;
      const gx = Math.floor((x / width) * N);
      if (v > grid[gy][gx]) {
        grid[gy][gx] = v;
      }
    }
  }

  return grid;
}

/**
 * 기존처럼 0/1 이진 그리드로 쓰고 싶을 때 사용하는 래퍼.
 * 내부적으로 buildCloudValueGrid를 호출하고,
 * mmThreshold 이상이면 1, 아니면 0으로 변환.
 *
 * opts.mmThreshold: 몇 mm/h 이상을 "구름/강수"로 볼지 (기본 0.1)
 */
export function buildCloudBinaryGrid(
  imgData,
  gridSize = 32,
  radarRadiusPx,
  opts = {}
) {
  const valueGrid = buildCloudValueGrid(imgData, gridSize, radarRadiusPx, opts);
  if (!valueGrid) return null;

  const N = valueGrid.length;
  const mmThreshold = opts.mmThreshold ?? 0.1;

  const binGrid = Array.from({ length: N }, () => Array(N).fill(0));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (valueGrid[y][x] >= mmThreshold) {
        binGrid[y][x] = 1;
      }
    }
  }
  return binGrid;
}
