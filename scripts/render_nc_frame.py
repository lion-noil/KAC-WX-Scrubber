# scripts/render_nc_frame.py
# usage:
#   python scripts/render_nc_frame.py <in_nc> <out_png> <field> <maskBelow> <extentKm> <smoothSigma>
#
# 예)
#   python scripts/render_nc_frame.py data_202512252030.nc frame_00001.png CFZH 0 150 1.0

import sys
import numpy as np
import xarray as xr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import BoundaryNorm

try:
    from scipy.ndimage import gaussian_filter
    HAS_SCIPY = True
except Exception:
    HAS_SCIPY = False

DBZ_LEVELS = [-10, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70]

def pick_field(ds, preferred):
    if preferred in ds.data_vars:
        return preferred
    # fallback
    for cand in ["CFZH", "DBZH"]:
        if cand in ds.data_vars:
            return cand
    raise KeyError("No CFZH/DBZH in dataset")

def get_sweep_ray_bounds(ds):
    start = ds["sweep_start_ray_index"].values.astype(int)
    end = ds["sweep_end_ray_index"].values.astype(int) + 1
    return start, end

def extract_sweep_polar(ds, field, sweep_idx):
    start, end = get_sweep_ray_bounds(ds)
    i0, i1 = start[sweep_idx], end[sweep_idx]
    ngates = ds.dims["range"]

    az = ds["azimuth"].isel(time=slice(i0, i1)).values.astype(np.float32)
    r = ds["range"].values.astype(np.float32)

    v = ds[field]
    if "n_points" in v.dims:
        ray_start = ds["ray_start_index"].values.astype(int)
        ray_start_sel = ray_start[i0:i1]

        arr = v.values.astype(np.float32)
        nrays = i1 - i0
        Z = np.full((nrays, ngates), np.nan, dtype=np.float32)
        for k, sidx in enumerate(ray_start_sel):
            Z[k, :] = arr[sidx:sidx + ngates]
    else:
        Z = v.isel(time=slice(i0, i1)).values.astype(np.float32)

    return az, r, Z

def polar_to_xy(az_deg, r_m):
    theta = np.deg2rad(az_deg)
    R, TH = np.meshgrid(r_m, theta)
    X = R * np.sin(TH)  # East
    Y = R * np.cos(TH)  # North
    return X, Y

def gridify_max(X_m, Y_m, Z, grid_x_km, grid_y_km):
    x_cent = grid_x_km
    y_cent = grid_y_km
    dx = (x_cent[1] - x_cent[0])
    dy = (y_cent[1] - y_cent[0])

    x_edges = np.concatenate(([x_cent[0] - dx/2], x_cent + dx/2))
    y_edges = np.concatenate(([y_cent[0] - dy/2], y_cent + dy/2))

    x = (X_m / 1000.0).ravel()
    y = (Y_m / 1000.0).ravel()
    z = Z.ravel()

    m = np.isfinite(z)
    x = x[m]; y = y[m]; z = z[m]

    ix = np.searchsorted(x_edges, x, side="right") - 1
    iy = np.searchsorted(y_edges, y, side="right") - 1

    nx = len(x_cent)
    ny = len(y_cent)
    inside = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)

    ix = ix[inside]; iy = iy[inside]; z = z[inside]

    G2 = np.full((ny, nx), -np.inf, dtype=np.float32)
    np.maximum.at(G2, (iy, ix), z)
    return np.where(G2 == -np.inf, np.nan, G2)

def draw_ring_and_crosshairs(ax, max_r_km=150, ring_step_km=50):
    ax.plot([-max_r_km, max_r_km], [0, 0], linewidth=1)
    ax.plot([0, 0], [-max_r_km, max_r_km], linewidth=1)
    for r in range(ring_step_km, max_r_km + 1, ring_step_km):
        t = np.linspace(0, 2*np.pi, 360)
        ax.plot(r*np.cos(t), r*np.sin(t), linewidth=0.8)

def main():
    if len(sys.argv) < 7:
        print("usage: render_nc_frame.py in_nc out_png field maskBelow extentKm smoothSigma", file=sys.stderr)
        sys.exit(2)

    in_nc = sys.argv[1]
    out_png = sys.argv[2]
    field_pref = sys.argv[3]
    mask_below = float(sys.argv[4])
    extent_km = float(sys.argv[5])
    smooth_sigma = float(sys.argv[6])

    ds = xr.open_dataset(in_nc)

    field = pick_field(ds, field_pref)
    start, end = get_sweep_ray_bounds(ds)
    nsweeps = len(start)

    # grid (1km)
    GRID_RES_KM = 1.0
    GRID_EXTENT_KM = 240.0
    xk = np.arange(-GRID_EXTENT_KM, GRID_EXTENT_KM + GRID_RES_KM, GRID_RES_KM, dtype=np.float32)
    yk = np.arange(-GRID_EXTENT_KM, GRID_EXTENT_KM + GRID_RES_KM, GRID_RES_KM, dtype=np.float32)

    grids = []
    for s in range(nsweeps):
        az, r, Z = extract_sweep_polar(ds, field, s)
        Z = Z.copy()
        Z[Z < mask_below] = np.nan

        X, Y = polar_to_xy(az, r)
        G = gridify_max(X, Y, Z, xk, yk)
        grids.append(G)

    # MAX composite
    Gc = np.nanmax(np.stack(grids, axis=0), axis=0)

    # smoothing (optional)
    if HAS_SCIPY and smooth_sigma > 0:
        nanmask = ~np.isfinite(Gc)
        tmp = np.where(nanmask, 0.0, Gc)
        tmp = gaussian_filter(tmp, sigma=smooth_sigma)
        Gc = np.where(nanmask, np.nan, tmp)

    cmap = plt.get_cmap("turbo", len(DBZ_LEVELS) - 1)
    norm = BoundaryNorm(DBZ_LEVELS, cmap.N)

    extent = [xk[0], xk[-1], yk[0], yk[-1]]
    fig = plt.figure(figsize=(7.8, 7.8), dpi=120)
    ax = plt.gca()
    im = ax.imshow(Gc, origin="lower", extent=extent, aspect="equal", cmap=cmap, norm=norm)

    ax.set_xlim(-extent_km, extent_km)
    ax.set_ylim(-extent_km, extent_km)

    draw_ring_and_crosshairs(ax, max_r_km=int(extent_km), ring_step_km=50)

    ax.set_title(f"{field} composite")
    ax.set_xlabel("x (km, East)")
    ax.set_ylabel("y (km, North)")
    plt.tight_layout()
    plt.savefig(out_png, bbox_inches="tight")
    plt.close(fig)

if __name__ == "__main__":
    main()
