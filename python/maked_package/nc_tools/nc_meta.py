# python/maked_package/nc_tools/nc_meta.py
from __future__ import annotations
import json
import xarray as xr

def _scalar_float(ds, name: str):
    if name not in ds:
        return None
    try:
        v = ds[name].values
        # scalar or 1-element
        if hasattr(v, "shape") and v.shape == ():
            return float(v)
        if hasattr(v, "__len__") and len(v) == 1:
            return float(v[0])
        # if it's longer, just take first (rare)
        return float(v.flat[0])
    except Exception:
        return None

def nc_meta_main(argv: list[str]) -> int:
    path = argv[0]
    ds = xr.open_dataset(path)

    data_vars = sorted(list(ds.data_vars.keys()))
    coords = sorted(list(ds.coords.keys()))
    dims = {k: int(v) for k, v in ds.dims.items()}

    lat = _scalar_float(ds, "latitude")
    lon = _scalar_float(ds, "longitude")
    alt = _scalar_float(ds, "altitude")

    meta = {
        "path": path,
        "data_vars": data_vars,
        "coords": coords,
        "dims": dims,
        "lat": lat,
        "lon": lon,
        "alt": alt,

        "has_CFZH": "CFZH" in ds.data_vars,
        "has_DBZH": "DBZH" in ds.data_vars,
        "has_azimuth": "azimuth" in ds,
        "has_range": "range" in ds,
        "has_sweep_start_ray_index": "sweep_start_ray_index" in ds,
        "has_sweep_end_ray_index": "sweep_end_ray_index" in ds,
    }

    if "fixed_angle" in ds:
        try:
            fa = ds["fixed_angle"].values
            meta["fixed_angle"] = [float(x) for x in fa]
        except Exception:
            pass

    print(json.dumps(meta, ensure_ascii=False))
    return 0
