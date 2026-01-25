# python/maked_package/nc_tools/nc_grid.py
from __future__ import annotations

import json
import sys
import numpy as np
import xarray as xr
import warnings

def _pick_field(ds, candidates=("CFZH", "DBZH")):
    for f in candidates:
        if f in ds.data_vars:
            return f
    raise KeyError(f"None of fields {candidates} found")


def _get_sweep_bounds(ds):
    start = ds["sweep_start_ray_index"].values.astype(int)
    end = ds["sweep_end_ray_index"].values.astype(int) + 1
    return start, end


def _extract_sweep(ds, field: str, sweep_idx: int):
    start, end = _get_sweep_bounds(ds)
    i0, i1 = int(start[sweep_idx]), int(end[sweep_idx])

    az = ds["azimuth"].isel(time=slice(i0, i1)).values.astype(np.float32)  # (nrays,)
    r = ds["range"].values.astype(np.float32)  # (ngates_max,)
    ng_max = int(r.shape[0])
    nrays = int(az.shape[0])

    v = ds[field]

    if "n_points" in v.dims:
        ray_start = ds["ray_start_index"].values.astype(int)[i0:i1]  # (nrays,)

        # ✅ ray마다 실제 gate 수 (없으면 전부 ng_max로 fallback)
        if "ray_n_gates" in ds:
            ray_ng = ds["ray_n_gates"].isel(time=slice(i0, i1)).values.astype(int)
        else:
            ray_ng = np.full((nrays,), ng_max, dtype=int)

        arr = v.values.astype(np.float32)  # (n_points,)

        Z = np.full((nrays, ng_max), np.nan, dtype=np.float32)

        for k, sidx in enumerate(ray_start):
            n = int(ray_ng[k])
            if n <= 0:
                continue

            # ✅ 안전장치: 파일 끝 넘지 않게
            n = min(n, ng_max, int(arr.shape[0] - sidx))
            if n <= 0:
                continue

            Z[k, :n] = arr[sidx : sidx + n]

    else:
        # (time, range) 형태면 range 길이가 고정이므로 그대로 사용
        Z = v.isel(time=slice(i0, i1)).values.astype(np.float32)

        # 혹시라도 range가 ng_max보다 짧은 케이스 방어
        if Z.ndim == 2 and Z.shape[1] != ng_max:
            Z2 = np.full((Z.shape[0], ng_max), np.nan, dtype=np.float32)
            n = min(ng_max, Z.shape[1])
            Z2[:, :n] = Z[:, :n]
            Z = Z2

    return az, r, Z


def _polar_to_xy(az_deg, r_m):
    th = np.deg2rad(az_deg)
    R, TH = np.meshgrid(r_m, th)  # (nrays, ngates)
    X = R * np.sin(TH)
    Y = R * np.cos(TH)
    return X, Y


def _gridify_max(X_m, Y_m, Z, xk, yk):
    dx = float(xk[1] - xk[0])
    dy = float(yk[1] - yk[0])

    x_edges = np.concatenate(([xk[0] - dx / 2], xk + dx / 2))
    y_edges = np.concatenate(([yk[0] - dy / 2], yk + dy / 2))

    x = (X_m / 1000.0).ravel()
    y = (Y_m / 1000.0).ravel()
    z = Z.ravel()

    m = np.isfinite(z)
    x = x[m]
    y = y[m]
    z = z[m]

    ix = np.searchsorted(x_edges, x, side="right") - 1
    iy = np.searchsorted(y_edges, y, side="right") - 1

    nx = xk.shape[0]
    ny = yk.shape[0]
    inside = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
    ix = ix[inside]
    iy = iy[inside]
    z = z[inside]

    out = np.full((ny, nx), -np.inf, dtype=np.float32)
    np.maximum.at(out, (iy, ix), z)
    out = np.where(out == -np.inf, np.nan, out)
    return out


def _low_level_priority(grids):
    out = grids[0].copy()
    for g in grids[1:]:
        m = ~np.isfinite(out) & np.isfinite(g)
        out[m] = g[m]
    return out


def _nanmax_composite(grids: list[np.ndarray]) -> np.ndarray:
    """
    np.nanmax의 'All-NaN slice encountered' RuntimeWarning을 확실히 억제하고,
    모든 sweep가 NaN인 픽셀은 NaN 유지.
    """
    if not grids:
        return np.empty((0, 0), dtype=np.float32)

    stack = np.stack(grids, axis=0)  # (nsweep, ny, nx)

    # 전부 NaN/비유효인 픽셀 마스크
    all_bad_pixel = np.all(~np.isfinite(stack), axis=0)

    # ✅ nanmax가 직접 warnings.warn을 호출하므로 errstate가 아니라 warnings로 꺼야 함
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        out = np.nanmax(stack, axis=0)

    # 전부 NaN인 픽셀은 NaN 유지
    out = out.astype(np.float32, copy=False)
    out[all_bad_pixel] = np.nan
    return out


def nc_grid_main(argv: list[str]) -> int:
    # argv: path field composite gridResKm gridExtentKm maskBelowDbz
    path = argv[0]
    field = argv[1] if len(argv) > 1 else None
    composite = (argv[2] if len(argv) > 2 else "max").lower()
    grid_res_km = float(argv[3]) if len(argv) > 3 else 1.0
    grid_extent_km = float(argv[4]) if len(argv) > 4 else 240.0
    mask_below = float(argv[5]) if len(argv) > 5 else 0.0

    if composite not in ("max", "low"):
        composite = "max"

    # 파일 닫힘 보장
    with xr.open_dataset(path) as ds:
        if not field or field not in ds.data_vars:
            field = _pick_field(ds, ("CFZH", "DBZH"))

        xk = np.arange(-grid_extent_km, grid_extent_km + grid_res_km, grid_res_km, dtype=np.float32)
        yk = np.arange(-grid_extent_km, grid_extent_km + grid_res_km, grid_res_km, dtype=np.float32)

        start, _ = _get_sweep_bounds(ds)
        nsweeps = len(start)

        grids: list[np.ndarray] = []
        for s in range(nsweeps):
            az, r, Z = _extract_sweep(ds, field, s)
            if mask_below is not None:
                Z = Z.copy()
                Z[Z < mask_below] = np.nan
            X, Y = _polar_to_xy(az, r)
            G = _gridify_max(X, Y, Z, xk, yk)
            grids.append(G)

    if composite == "low":
        Gc = _low_level_priority(grids).astype(np.float32, copy=False)
    else:
        Gc = _nanmax_composite(grids)

    ny, nx = Gc.shape

    header = {
        "field": field,
        "composite": composite,
        "nx": int(nx),
        "ny": int(ny),
        "gridResKm": float(grid_res_km),
        "gridExtentKm": float(grid_extent_km),
        "maskBelowDbz": float(mask_below),
    }

    # ✅ 중요: 첫 줄 header + '\n' + raw float32
    sys.stdout.write(json.dumps(header, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    sys.stdout.buffer.write(Gc.astype(np.float32, copy=False).tobytes(order="C"))
    sys.stdout.buffer.flush()
    return 0
