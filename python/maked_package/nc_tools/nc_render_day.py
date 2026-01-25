# python/maked_package/nc_render_day.py
from __future__ import annotations

import os
import re
import json
from datetime import datetime, timezone
import sys
import numpy as np
import xarray as xr
from PIL import Image
import subprocess

V_MIN_DBZ = -10.0
V_MAX_DBZ = 70.0
NODATA = 255

DBZ_LEVELS = [-10, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70]
PALETTE = [
    (0, 0, 0, 0),
    (70, 120, 255, 220),
    (40, 170, 255, 220),
    (40, 220, 200, 220),
    (60, 255, 120, 220),
    (120, 255, 60, 220),
    (180, 255, 40, 220),
    (255, 240, 60, 230),
    (255, 200, 40, 230),
    (255, 150, 40, 235),
    (255, 90, 40, 235),
    (255, 40, 40, 240),
    (220, 0, 80, 240),
    (180, 0, 140, 240),
    (140, 0, 200, 240),
    (100, 0, 240, 240),
]


def parse_iso_z(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


def floor_to_minute_z(iso_z: str) -> str:
    dt = parse_iso_z(iso_z)
    dt = dt.replace(second=0, microsecond=0)
    return dt.isoformat().replace("+00:00", "Z")


def safe_time_label(ds: xr.Dataset) -> str | None:
    t0 = ds.attrs.get("time_coverage_start")
    if t0:
        return floor_to_minute_z(t0)
    if "time" in ds.coords and ds["time"].size > 0:
        t = ds["time"].values[0]
        s = str(np.datetime_as_string(t, unit="s")) + "Z"
        return floor_to_minute_z(s)
    return None


def list_nc_files_sorted(input_dir: str) -> list[str]:
    files = []
    for name in os.listdir(input_dir):
        if name.lower().endswith(".nc"):
            files.append(os.path.join(input_dir, name))

    def key(p: str):
        base = os.path.basename(p)
        m = re.search(r"(\d{12,14})", base)
        return m.group(1) if m else base

    files.sort(key=key)
    return files


def run_ffmpeg_make_mp4(out_dir: str, date_ymd: str, fps: int = 10, save_ext: str = "webp") -> str:
    # ✅ ffmpeg 작업 디렉토리를 out_dir로 고정하고, 입력 패턴은 상대경로로
    in_pat = os.path.join("frames", f"%04d.{save_ext}")
    out_mp4_name = f"{date_ymd}.mp4"
    out_mp4_abs = os.path.join(out_dir, out_mp4_name)

    cmd = [
        "ffmpeg",
        "-y",
        "-framerate", str(fps),
        "-i", in_pat,

        # ✅ 입력 가능한 mp4 옵션
        "-c:v", "libx264",
        "-profile:v", "high",
        "-pix_fmt", "yuv420p",
        "-an",
        "-movflags", "+faststart",

        out_mp4_name,  # ✅ cwd=out_dir 이므로 파일명만
    ]

    print("[ffmpeg] " + " ".join(cmd))
    p = subprocess.run(cmd, cwd=out_dir, capture_output=True, text=True)

    if p.returncode != 0:
        raise RuntimeError("ffmpeg failed:\n" + (p.stderr or p.stdout or ""))

    # ✅ 파일이 진짜 생성됐는지 확인
    if not os.path.exists(out_mp4_abs):
        raise RuntimeError(f"ffmpeg succeeded but mp4 not found: {out_mp4_abs}")

    return out_mp4_abs


def infer_ymd_from_path(p: str) -> str:
    m = re.search(r"(20\d{6})", p)  # 20000101~20991231 정도
    return m.group(1) if m else "out"


def extract_dbzh_time_range(ds: xr.Dataset) -> np.ndarray:
    if "DBZH" not in ds.data_vars:
        raise KeyError("DBZH 변수가 없습니다.")

    dbz = ds["DBZH"]

    if "time" in dbz.dims and "range" in dbz.dims:
        return dbz.transpose("time", "range").values.astype(np.float32, copy=False)

    if "n_points" in dbz.dims:
        if "ray_start_index" not in ds.data_vars or "ray_n_gates" not in ds.data_vars:
            raise KeyError("n_points인데 ray_start_index/ray_n_gates가 없어 언팩 불가")

        n_time = int(ds.sizes.get("time", 0))
        n_range = int(ds.sizes.get("range", 0))

        start_idx = ds["ray_start_index"].values.astype(np.int64, copy=False)
        n_gates = ds["ray_n_gates"].values.astype(np.int64, copy=False)
        flat = dbz.values.astype(np.float32, copy=False)

        out = np.full((n_time, n_range), np.nan, dtype=np.float32)
        for i in range(n_time):
            si = int(start_idx[i])
            ng = int(n_gates[i])
            if ng <= 0:
                continue
            ng2 = min(ng, n_range)
            out[i, :ng2] = flat[si:si + ng2]
        return out

    raise ValueError(f"지원하지 않는 DBZH dims: {dbz.dims}")


def quantize_dbz_to_u8(dbz: np.ndarray, weak_cut_dbz: float) -> np.ndarray:
    out = np.empty(dbz.shape, dtype=np.uint8)
    m = np.isfinite(dbz)
    out[~m] = np.uint8(NODATA)

    mm = m & (dbz >= weak_cut_dbz)
    out[m & ~mm] = np.uint8(NODATA)

    clipped = np.clip(dbz[mm], V_MIN_DBZ, V_MAX_DBZ)
    scaled = (clipped - V_MIN_DBZ) / (V_MAX_DBZ - V_MIN_DBZ) * 254.0
    out[mm] = np.round(scaled).astype(np.uint8)
    return out


def u8_to_dbz(u8: np.ndarray) -> np.ndarray:
    dbz = np.full(u8.shape, np.nan, dtype=np.float32)
    m = (u8 != NODATA)
    dbz[m] = V_MIN_DBZ + (u8[m].astype(np.float32) / 254.0) * (V_MAX_DBZ - V_MIN_DBZ)
    return dbz


def dbz_to_rgba_binned(dbz: np.ndarray) -> np.ndarray:
    h, w = dbz.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    m = np.isfinite(dbz)
    rgba[~m, 3] = 0

    idx = np.zeros(dbz.shape, dtype=np.int32)
    idx[m] = np.digitize(dbz[m], DBZ_LEVELS, right=False)
    idx = np.clip(idx, 0, len(PALETTE) - 1)

    for k, (r, g, b, a) in enumerate(PALETTE):
        sel = m & (idx == k)
        rgba[sel, 0] = r
        rgba[sel, 1] = g
        rgba[sel, 2] = b
        rgba[sel, 3] = a

    return rgba


def polar_to_grid_fill(u8_ray_range: np.ndarray, az_deg: np.ndarray, r_m: np.ndarray,
                       grid_size: int, max_range_m: float) -> np.ndarray:
    H = W = int(grid_size)
    cx = (W - 1) / 2.0
    cy = (H - 1) / 2.0
    meters_per_px = (2 * float(max_range_m)) / (grid_size - 1)

    yy, xx = np.indices((H, W), dtype=np.float32)
    x_m = (xx - cx) * meters_per_px
    y_m = -(yy - cy) * meters_per_px

    rr = np.sqrt(x_m * x_m + y_m * y_m)
    theta = (np.degrees(np.arctan2(x_m, y_m)) + 360.0) % 360.0

    grid = np.full((H, W), np.uint8(NODATA), dtype=np.uint8)
    in_range = rr <= float(max_range_m)
    if not np.any(in_range):
        return grid

    az = az_deg.astype(np.float32, copy=False)
    order = np.argsort(az)
    azs = az[order]

    th = theta[in_range].reshape(-1)
    pos = np.searchsorted(azs, th, side="left")
    pos = np.clip(pos, 0, len(azs) - 1)

    left = np.clip(pos - 1, 0, len(azs) - 1)
    right = pos
    d_left = np.abs(azs[left] - th)
    d_right = np.abs(azs[right] - th)
    use_left = d_left <= d_right
    ray_idx_sorted = np.where(use_left, left, right)
    ray_idx = order[ray_idx_sorted]

    r0 = float(r_m[0])
    dr = float(r_m[1] - r_m[0]) if len(r_m) > 1 else 1.0
    ridx = np.rint((rr[in_range].reshape(-1) - r0) / dr).astype(np.int32)
    ridx = np.clip(ridx, 0, len(r_m) - 1)

    vals = u8_ray_range[ray_idx, ridx]
    grid[in_range] = vals.reshape(grid[in_range].shape)
    return grid


def low_elev_priority_composite(final: np.ndarray, add: np.ndarray) -> np.ndarray:
    fill = (final == NODATA) & (add != NODATA)
    final[fill] = add[fill]
    return final


def make_composite_u8_for_file(nc_path: str, grid_size: int, weak_cut_dbz: float) -> tuple[np.ndarray, dict]:
    try:
        ds = xr.open_dataset(nc_path, engine="h5netcdf")
    except Exception:
        ds = xr.open_dataset(nc_path)  # fallback

    sweep_count = int(ds.sizes.get("sweep", 0))
    if sweep_count <= 0:
        raise ValueError("sweep 차원을 찾지 못했습니다.")

    s_start = ds["sweep_start_ray_index"].values.astype(int)
    s_end = ds["sweep_end_ray_index"].values.astype(int)

    r_m = ds["range"].values.astype(np.float32, copy=False)
    max_range_m = float(r_m[-1])

    dbz_tr = extract_dbzh_time_range(ds)

    final = np.full((grid_size, grid_size), np.uint8(NODATA), dtype=np.uint8)

    for s in range(sweep_count):
        i0 = int(s_start[s])
        i1 = int(s_end[s]) + 1
        sl = slice(i0, i1)

        az = ds["azimuth"].values[sl].astype(np.float32, copy=False)
        dbz = dbz_tr[sl, :].astype(np.float32, copy=False)

        u8 = quantize_dbz_to_u8(dbz, weak_cut_dbz=weak_cut_dbz)
        grid = polar_to_grid_fill(u8, az, r_m, grid_size, max_range_m)

        final = low_elev_priority_composite(final, grid)

    meta = {
        "time_label": safe_time_label(ds),
        "radar_lat": float(ds["latitude"].values) if "latitude" in ds.data_vars else float(ds.attrs.get("latitude")),
        "radar_lon": float(ds["longitude"].values) if "longitude" in ds.data_vars else float(ds.attrs.get("longitude")),
        "sweep_count": sweep_count,
        "max_range_m": max_range_m,
    }
    return final, meta


def ensure_dirs(out_dir: str):
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(os.path.join(out_dir, "frames"), exist_ok=True)


def rgba_to_rgb_black_bg(rgba: np.ndarray) -> np.ndarray:
    # rgba: (H,W,4) uint8
    rgb = rgba[..., :3].astype(np.float32)
    a = rgba[..., 3:4].astype(np.float32) / 255.0  # (H,W,1)

    out = rgb * a  # 검정 배경 위에 알파합성
    return np.round(out).astype(np.uint8)  # (H,W,3) uint8


def nc_render_day_main(argv: list[str]):
    """
    argv:
      [input_dir, out_dir, grid_size?, weak_cut_dbz?, format?]
    """
    if len(argv) < 2:
        print("nc_render_day_main: need input_dir out_dir", file=sys.stderr)
        return 2

    input_dir = argv[0]
    out_dir = argv[1]
    grid_size = int(argv[2]) if len(argv) >= 3 else 768
    weak_cut_dbz = float(argv[3]) if len(argv) >= 4 else 7
    save_ext = argv[4] if len(argv) >= 5 else "webp"
    save_ext = save_ext.lower()

    ensure_dirs(out_dir)

    nc_files = list_nc_files_sorted(input_dir)
    if not nc_files:
        raise RuntimeError(f"nc 파일이 없습니다: {input_dir}")

    frames = []
    radar_lat = radar_lon = None
    sweep_count = None
    max_range_m = None

    for idx, nc_path in enumerate(nc_files):
        try:
            final_u8, meta = make_composite_u8_for_file(nc_path, grid_size=grid_size, weak_cut_dbz=weak_cut_dbz)

            dbz = u8_to_dbz(final_u8)
            rgba = dbz_to_rgba_binned(dbz)

            # ✅ 핵심: mp4용으로 알파 제거(검정 배경 합성)
            rgb = rgba_to_rgb_black_bg(rgba)
            im = Image.fromarray(rgb, mode="RGB")

            fname = f"{idx:04d}.{save_ext}"
            out_path = os.path.join(out_dir, "frames", fname)

            if save_ext == "png":
                im.save(out_path)  # PNG RGB
            else:
                # webp면 RGB webp로 저장됨(알파 없음)
                im.save(out_path, quality=90, method=6)

            frames.append({
                "t": meta["time_label"],
                "img": f"frames/{fname}",
                "src": os.path.basename(nc_path),
            })

            if radar_lat is None:
                radar_lat = meta["radar_lat"]
                radar_lon = meta["radar_lon"]
                sweep_count = meta["sweep_count"]
                max_range_m = meta["max_range_m"]

            print(f"[{idx + 1}/{len(nc_files)}] saved {out_path}")

        except Exception as e:
            print(f"[{idx + 1}/{len(nc_files)}] FAIL {os.path.basename(nc_path)}: {e}")

    manifest = {
        "field": "DBZH",
        "product": "2D_composite_like_KMA",
        "method": {
            "composite": "low_elev_priority (fill blanks only)",
            "polar_to_grid": "inverse-mapping nearest (reduces radial streaks)",
            "weak_cut_dbz": weak_cut_dbz,
            "palette": "binned (approx KMA style)"
        },
        "radar": {"lat": radar_lat, "lon": radar_lon},
        "grid": {"size": grid_size, "range_m": max_range_m},
        "frames": frames
    }
    ymd = infer_ymd_from_path(out_dir)  # 이미 아래에서 쓰고 있음
    out_manifest = os.path.join(out_dir, f"{ymd}.json")  # ✅ 날짜.json
    with open(out_manifest, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print("manifest saved:", out_manifest)
    print("total frames:", len(frames))

    try:
        mp4_path = run_ffmpeg_make_mp4(out_dir, date_ymd=ymd, fps=10, save_ext=save_ext)
        print("mp4 saved:", mp4_path)
    except Exception as e:
        print("mp4 make FAILED:", e, file=sys.stderr)
        return 0

    return 0
