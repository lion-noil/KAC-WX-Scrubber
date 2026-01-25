// src/pages/weather-extract/ncPreviewUtils.js

export const NM_TO_M = 1852.0;

export function destFromCenter(lat0Deg, lon0Deg, bearingDeg, distNm) {
  const R = 6371000.0;
  const distM = distNm * NM_TO_M;

  const lat0 = (lat0Deg * Math.PI) / 180;
  const lon0 = (lon0Deg * Math.PI) / 180;
  const brg = (bearingDeg * Math.PI) / 180;

  const d = distM / R;

  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);
  const sinD = Math.sin(d);
  const cosD = Math.cos(d);

  const sinLat2 = sinLat0 * cosD + cosLat0 * sinD * Math.cos(brg);
  const lat2 = Math.asin(sinLat2);

  const y = Math.sin(brg) * sinD * cosLat0;
  const x = cosD - sinLat0 * sinLat2;
  let lon2 = lon0 + Math.atan2(y, x);

  lon2 = ((lon2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;

  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

// /py/grid: 첫 줄 JSON header + '\n' + float32 raw
export function parseHeaderAndFloat32(buf) {
  const u8 = new Uint8Array(buf);

  const scanLen = Math.min(u8.length, 64 * 1024);
  let nl = -1;
  for (let i = 0; i < scanLen; i++) {
    if (u8[i] === 10) {
      nl = i;
      break;
    }
  }

  if (nl < 0) {
    const headText = new TextDecoder("utf-8").decode(u8.slice(0, Math.min(u8.length, 2000)));
    throw new Error(
      "Invalid grid stream: no header newline.\n" +
        "First bytes as text:\n" +
        headText
    );
  }

  const headerText = new TextDecoder("utf-8").decode(u8.slice(0, nl)).trim();
  const header = JSON.parse(headerText);

  const body = u8.slice(nl + 1);
  const f32 = new Float32Array(body.buffer, body.byteOffset, Math.floor(body.byteLength / 4));
  return { header, f32 };
}

// grid -> dataURL (지금은 grayscale)
export function gridToDataUrl({ header, f32 }, { vmin = -10, vmax = 70, alpha = 200 } = {}) {
  const nx = header.nx;
  const ny = header.ny;

  const canvas = document.createElement("canvas");
  canvas.width = nx;
  canvas.height = ny;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(nx, ny);

  for (let i = 0; i < nx * ny; i++) {
    const v = f32[i];

    if (!Number.isFinite(v)) {
      img.data[i * 4 + 3] = 0;
      continue;
    }

    const t = Math.max(0, Math.min(1, (v - vmin) / (vmax - vmin)));
    const g = Math.round(t * 255);

    img.data[i * 4 + 0] = g;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = alpha;
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

export function safeJson(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
