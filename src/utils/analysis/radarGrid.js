// src/utils/analysis/radarGrid.js

const NM_TO_KM = 1.852;

const DETECT_RANGE_NM = 60;
const DETECT_RANGE_KM = DETECT_RANGE_NM * NM_TO_KM;

// 대충 km 변환 (제주 근처면 이 근사로 충분)
function latLonDeltaKm(lat0, lon0, lat1, lon1) {
  const dLat = lat1 - lat0;
  const dLon = lon1 - lon0;
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos((lat0 * Math.PI) / 180);

  const northKm = dLat * kmPerDegLat;     // +면 북쪽
  const eastKm = dLon * kmPerDegLon;      // +면 동쪽
  return { eastKm, northKm };
}

export function buildRadarBinaryGrid({
  segments,
  meta,
  maxRangeKm = 350,
  gridSize = 32,
  ciThreshold = 0,

  // ✅ 추가: “비교 기준”이 되는 중심(성산 레이더 등)
  // 안 주면 기존처럼 meta가 중심(오프셋 0)
  refCenterLat = null,
  refCenterLon = null,
}) {
  const size = (gridSize | 0) || 32;
  const grid = Array.from({ length: size }, () => Array(size).fill(0));
  if (!segments || !segments.length) return grid;

  const maxRKm = Number(maxRangeKm) || 350;

  const rasterSize = 256;
  const temp = Array.from({ length: rasterSize }, () => Array(rasterSize).fill(0));

  const centerR = (rasterSize - 1) / 2;
  const radiusCellsR = centerR;
  const deg2rad = (d) => (d * Math.PI) / 180;

  // ✅ 기준 중심(ref) 대비 우리 레이더(meta)의 위치 차이를 km로 계산
  const refLat = (refCenterLat ?? meta?.lat);
  const refLon = (refCenterLon ?? meta?.lon);

  // (meta - ref) : ref 기준으로 meta가 얼마나 동/북에 있나
  const { eastKm: deltaEastKm, northKm: deltaNorthKm } =
    (refLat != null && refLon != null && meta?.lat != null && meta?.lon != null)
      ? latLonDeltaKm(refLat, refLon, meta.lat, meta.lon)
      : { eastKm: 0, northKm: 0 };

  // ✅ 이 delta를 “정규화 좌표”로 바꿔서 polar에 더할 것
  // (grid는 refCenter 기준으로 찍고 싶으니까)
  const deltaNx = deltaEastKm / maxRKm;   // +면 오른쪽
  const deltaNy = deltaNorthKm / maxRKm;  // +면 위(북)

  function polarToRaster(rKm, angleDeg) {
    const norm = rKm / maxRKm;
    if (!isFinite(norm) || norm < 0) return null;

    const rad = deg2rad(angleDeg);

    // 우리 레이더 기준 polar 벡터
    const nx = norm * Math.sin(rad); // 동(+)
    const ny = norm * Math.cos(rad); // 북(+)

    // ✅ refCenter 기준으로 옮기기: (meta-ref) + polar
    const nx2 = nx + deltaNx;
    const ny2 = ny + deltaNy;

    // 화면 밖이면 버림 (클램프 금지)
    if (nx2 < -1 || nx2 > 1 || ny2 < -1 || ny2 > 1) return null;

    const rx = Math.round(centerR + nx2 * radiusCellsR);
    const ry = Math.round(centerR - ny2 * radiusCellsR);

    if (rx < 0 || rx >= rasterSize || ry < 0 || ry >= rasterSize) return null;
    return { rx, ry };
  }

  const kmPerPixel = maxRKm / radiusCellsR;
  const stepKm = Math.max(0.5, kmPerPixel * 0.8);
  const BRUSH = 1;

  for (const s of segments) {
    if (!s || s.length < 5) continue;

    const ci = s[1];
    const angleDeg = s[2];
    const startNm = s[3];
    const endNm = s[4];

    if (ci == null || angleDeg == null || startNm == null || endNm == null) continue;
    if (!isFinite(angleDeg) || !isFinite(startNm) || !isFinite(endNm)) continue;
    if (ci < ciThreshold) continue;

    let rStartKm = startNm * NM_TO_KM;
    let rEndKm = endNm * NM_TO_KM;

    if (rEndKm < rStartKm) [rStartKm, rEndKm] = [rEndKm, rStartKm];

    if (rStartKm >= maxRKm) continue;
    if (rEndKm > maxRKm) rEndKm = maxRKm;
    if (rEndKm <= rStartKm) continue;

    // 60NM 밖 버림
    if (rStartKm > DETECT_RANGE_KM) continue;
    if (rEndKm > DETECT_RANGE_KM) rEndKm = DETECT_RANGE_KM;

    const value = 1;

    for (let rKm = rStartKm; rKm <= rEndKm; rKm += stepKm) {
      const p = polarToRaster(rKm, angleDeg);
      if (!p) continue;

      const offsets = BRUSH <= 0
        ? [[0, 0]]
        : [
            [-1,-1],[0,-1],[1,-1],
            [-1, 0],[0, 0],[1, 0],
            [-1, 1],[0, 1],[1, 1],
          ];

      for (const [dx, dy] of offsets) {
        const xx = p.rx + dx;
        const yy = p.ry + dy;
        if (xx < 0 || xx >= rasterSize || yy < 0 || yy >= rasterSize) continue;
        if (value > temp[yy][xx]) temp[yy][xx] = value;
      }
    }
  }

  // 다운샘플 (max)
  for (let y = 0; y < rasterSize; y++) {
    const gy = Math.min(size - 1, Math.floor((y / rasterSize) * size));
    for (let x = 0; x < rasterSize; x++) {
      const v = temp[y][x];
      if (v <= 0) continue;
      const gx = Math.min(size - 1, Math.floor((x / rasterSize) * size));
      grid[gy][gx] = 1;
    }
  }

  return grid;
}
