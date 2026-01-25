# python/main.py
from __future__ import annotations
import os
import sys

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(THIS_DIR)
sys.path.insert(0, THIS_DIR)
sys.path.insert(0, PROJECT_ROOT)

from maked_package.ast_to_json import main as ast_to_json_main


def usage() -> int:
    print(
        "Usage:\n"
        "  python3 python/main.py ast_to_json <args...>\n"
        "  python3 python/main.py ncmeta <nc_path>\n"
        "  python3 python/main.py ncgrid <nc_path> <field> <composite> <gridResKm> <gridExtentKm> <maskBelowDbz>\n"
        "  python3 python/main.py ncrender_day <input_dir> <out_dir> [gridSize] [weakCutDbz] [format]\n"
        "\n"
        "Examples:\n"
        "  python3 python/main.py ncmeta download/SSP/nc/20260108/abcd1234/202601080030.nc\n"
        "  python3 python/main.py ncgrid <path> CFZH max 1.0 240.0 0.0\n"
    )
    return 2


def main() -> int:
    if len(sys.argv) < 2:
        return usage()

    cmd = sys.argv[1]

    if cmd in ("ast_to_json", "ast"):
        sys.argv = [sys.argv[0]] + sys.argv[2:]
        return int(ast_to_json_main() or 0)

    if cmd == "ncmeta":
        if len(sys.argv) < 3:
            return usage()
        nc_path = sys.argv[2]
        from maked_package.nc_tools.nc_meta import nc_meta_main
        return int(nc_meta_main([nc_path]) or 0)

    if cmd == "ncgrid":
        if len(sys.argv) < 8:
            return usage()
        # ncgrid <path> <field> <composite> <gridResKm> <gridExtentKm> <maskBelowDbz>
        args = sys.argv[2:]
        from maked_package.nc_tools.nc_grid import nc_grid_main
        return int(nc_grid_main(args) or 0)

    if cmd == "ncrender_day":
        if len(sys.argv) < 4:
            return usage()
        input_dir = sys.argv[2]
        out_dir = sys.argv[3]
        grid_size = int(sys.argv[4]) if len(sys.argv) >= 5 else 768
        weak_cut_dbz = float(sys.argv[5]) if len(sys.argv) >= 6 else 5.0
        out_format = sys.argv[6] if len(sys.argv) >= 7 else "webp"

        from maked_package.nc_tools.nc_render_day import nc_render_day_main
        return int(nc_render_day_main([input_dir, out_dir, str(grid_size), str(weak_cut_dbz), out_format]) or 0)

    return usage()


if __name__ == "__main__":
    raise SystemExit(main())
