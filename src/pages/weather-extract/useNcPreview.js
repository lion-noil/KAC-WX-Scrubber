// src/pages/weather-extract/useNcPreview.js
import {useEffect, useMemo, useState} from "react";
import L from "leaflet";
import {destFromCenter, gridToDataUrl, parseHeaderAndFloat32, safeJson} from "./ncPreviewUtils";

// dBZ 구간(테스트 코드랑 동일)
const DBZ_LEVELS = [-10, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70];

// 간단 팔레트(원하면 나중에 “실제 KMA 팔레트”로 교체 가능)
const PALETTE = [
    [0, 0, 0, 0],          // below -10 -> transparent
    [40, 40, 80, 180],
    [0, 90, 255, 200],
    [0, 180, 255, 210],
    [0, 220, 160, 220],
    [0, 255, 0, 220],
    [160, 255, 0, 220],
    [255, 255, 0, 230],
    [255, 200, 0, 235],
    [255, 140, 0, 240],
    [255, 80, 0, 245],
    [255, 0, 0, 245],
    [220, 0, 120, 245],
    [180, 0, 180, 245],
    [140, 80, 255, 245],
    [220, 220, 220, 245], // top bucket fallback
];

function levelIndex(v) {
    if (!Number.isFinite(v)) return -1;

    let i = -1;
    for (let k = 0; k < DBZ_LEVELS.length - 1; k++) {
        if (v >= DBZ_LEVELS[k] && v < DBZ_LEVELS[k + 1]) {
            i = k + 1;
            break;
        }
    }
    if (v >= DBZ_LEVELS[DBZ_LEVELS.length - 1]) i = DBZ_LEVELS.length - 1;
    return i;
}

function gridToDataUrlColor({header, f32}) {
    const nx = header.nx;
    const ny = header.ny;

    const canvas = document.createElement("canvas");
    canvas.width = nx;
    canvas.height = ny;
    const ctx = canvas.getContext("2d", {willReadFrequently: false});
    const img = ctx.createImageData(nx, ny);

    for (let i = 0; i < nx * ny; i++) {
        const v = f32[i];
        const li = levelIndex(v);

        if (li < 0) {
            img.data[i * 4 + 3] = 0; // transparent
            continue;
        }

        const c = PALETTE[Math.min(li, PALETTE.length - 1)];
        img.data[i * 4 + 0] = c[0];
        img.data[i * 4 + 1] = c[1];
        img.data[i * 4 + 2] = c[2];
        img.data[i * 4 + 3] = c[3] ?? 255;
    }

    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/png");
}


export function useNcPreview({jobId, previewFile, enabled}) {
    const [metaLoading, setMetaLoading] = useState(false);
    const [gridLoading, setGridLoading] = useState(false);
    const [error, setError] = useState("");

    const [meta, setMeta] = useState(null);
    const [gridHeader, setGridHeader] = useState(null);
    const [dataUrl, setDataUrl] = useState("");

    // meta
    useEffect(() => {
        if (!enabled || !jobId || !previewFile) return;

        let cancelled = false;

        (async () => {
            setMetaLoading(true);
            setError("");
            setMeta(null);

            try {
                const url = `/api/ncday/py/meta?jobId=${encodeURIComponent(jobId)}&file=${encodeURIComponent(previewFile)}`;
                const res = await fetch(url);
                if (!res.ok) {
                    const t = await res.text().catch(() => "");
                    throw new Error(`py/meta 실패: HTTP ${res.status}\n${t}`);
                }
                const j = await res.json();
                if (cancelled) return;
                setMeta(j);
            } catch (e) {
                if (cancelled) return;
                setError(e?.message || String(e));
            } finally {
                if (!cancelled) setMetaLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [enabled, jobId, previewFile]);

    const center = useMemo(() => {
        const lat = meta?.lat ?? meta?.latitude;
        const lon = meta?.lon ?? meta?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return {lat, lon};
    }, [meta]);

    // grid -> dataUrl
      // grid -> dataUrl
  useEffect(() => {
    if (!enabled || !jobId || !previewFile) return;
    if (!center) return;

    let cancelled = false;

    (async () => {
      setGridLoading(true);
      setError("");

      try {
        const field = "CFZH";
        const composite = "max";
        const gridResKm = "1.0";
        const gridExtentKm = "240.0";
        const maskBelowDbz = "0.0";

        const reqUrl =
          `/api/ncday/py/grid?jobId=${encodeURIComponent(jobId)}&file=${encodeURIComponent(previewFile)}` +
          `&field=${encodeURIComponent(field)}` +
          `&composite=${encodeURIComponent(composite)}` +
          `&gridResKm=${encodeURIComponent(gridResKm)}` +
          `&gridExtentKm=${encodeURIComponent(gridExtentKm)}` +
          `&maskBelowDbz=${encodeURIComponent(maskBelowDbz)}`;

        const res = await fetch(reqUrl);
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`py/grid 실패: HTTP ${res.status}\n${t}`);
        }

        const buf = await res.arrayBuffer();
        if (cancelled) return;

        const parsed = parseHeaderAndFloat32(buf);
        const { header, f32 } = parsed;

        const nextDataUrl = gridToDataUrlColor({ header, f32 });
        if (cancelled) return;

        setGridHeader(header);
        setDataUrl(nextDataUrl);
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || String(e));
      } finally {
        if (!cancelled) setGridLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, jobId, previewFile, center?.lat, center?.lon]);


    const bounds = useMemo(() => {
        if (!center) return null;

        // gridExtentKm 기준 사각형 bounds 근사
        const extentKm = 240.0;
        const diagKm = Math.sqrt(2) * extentKm;
        const diagNm = diagKm / 1.852;

        const ne = destFromCenter(center.lat, center.lon, 45, diagNm);
        const sw = destFromCenter(center.lat, center.lon, 225, diagNm);

        return L.latLngBounds(L.latLng(sw.lat, sw.lon), L.latLng(ne.lat, ne.lon));
    }, [center]);

    return {
        meta,
        center,
        bounds,
        dataUrl,
        gridHeader,
        metaLoading,
        gridLoading,
        error,
        safeJson,
    };
}
