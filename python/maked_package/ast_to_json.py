# python/ast_to_json.py
from __future__ import annotations

import os
import sys
import json
from datetime import datetime

from .config import (
    SACSIC_TO_CENTER_DMS,
    DEFAULT_CENTER_LAT_DMS,
    DEFAULT_CENTER_LON_DMS,
)
from .asterix_cat08 import parse_asterix_file_cat08  # CAT-08 전용 파서



def dms_to_decimal(dms_str: str) -> float:
    """
    "33°30'03.84\"N" 같은 DMS 문자열을 십진수 위도/경도로 변환
    """
    dms_str = dms_str.strip()
    hemi = dms_str[-1].upper()
    core = dms_str[:-1]

    deg_part, rest = core.split("°")
    min_part, sec_part = rest.split("'")
    sec_part = sec_part.replace('"', '')

    deg = float(deg_part)
    minutes = float(min_part)
    seconds = float(sec_part)

    dec = deg + minutes / 60 + seconds / 3600
    if hemi in ["S", "W"]:
        dec = -dec
    return dec


def parse_cat08_from_ast(ast_path: str):
    """
    AST 파일에서 CAT-08 Polar Vector를 읽어
    "각도 + 시작거리(NM) + 끝거리(NM)" 정보만 JSON용으로 뽑아낸다.

    asterix_cat08.parse_asterix_file_cat08() 이 반환하는 패킷 구조(설명용):

      {
        "category": 8,
        "length": ...,
        "sac": ...,
        "sic": ...,
        "intensity": 0~15,
        "vectors": [
          {
            "angle_deg": float,
            "start_nm": float,
            "end_nm": float,
            # (옵션) "range16_nm": float,
          },
          ...
        ],
      }

    여기서 만든 세그먼트 포맷(위·경도 없이):

      [pkt_idx, intensity, angle_deg, start_nm, end_nm]
    """

    packets = parse_asterix_file_cat08(
        ast_path,
        max_packets=None,  # 전부 사용
    )
    if not packets:
        raise RuntimeError("AST 파일에서 CAT-08 패킷을 찾지 못했습니다.")

    # -------------------------------
    # 1) 레이더 중심 좌표(SAC/SIC → DMS → decimal)
    # -------------------------------
    sac = packets[0].get("sac")
    sic = packets[0].get("sic")

    lat_dms, lon_dms = SACSIC_TO_CENTER_DMS.get(
        (sac, sic),
        (DEFAULT_CENTER_LAT_DMS, DEFAULT_CENTER_LON_DMS),
    )
    radar_lat = dms_to_decimal(lat_dms)
    radar_lon = dms_to_decimal(lon_dms)

    # -------------------------------
    # 2) Polar vector → 세그먼트 배열로 축적
    # -------------------------------
    segments: list[list[float]] = []
    max_range_nm = 0.0

    for pkt_index, pkt in enumerate(packets, start=1):
        intensity = int(pkt.get("intensity", 0))
        vectors = pkt.get("vectors") or []
        if not vectors:
            continue

        for v in vectors:
            ang = float(v.get("angle_deg", 0.0))

            # 새 파서: start_nm / end_nm 를 직접 제공
            if "start_nm" in v and "end_nm" in v:
                s_nm = float(v["start_nm"])
                e_nm = float(v["end_nm"])
            else:
                # 혹시 구버전 파서 사용 시 fallback: range_nm 하나만 있는 경우
                r_nm = float(v.get("range_nm", 0.0))
                if r_nm <= 0:
                    continue
                s_nm = 0.0
                e_nm = r_nm

            # 이상값 필터링 (안전망 한 번 더)
            if e_nm <= 0:
                continue
            if e_nm <= s_nm:
                continue

            segments.append(
                [int(pkt_index), intensity, ang, s_nm, e_nm]
            )

            if e_nm > max_range_nm:
                max_range_nm = e_nm

    max_pkt = len(packets)  # weather 패킷 개수
    parsed_at = datetime.now().isoformat()

    return radar_lat, radar_lon, segments, max_pkt, max_range_nm, parsed_at, sac, sic


def ast_to_json(ast_path: str, json_path: str | None = None) -> str:
    """
    단일 AST 파일에서 CAT-08 weather vector를 읽어
    <파일명>_cat08.json 형식으로 저장.

    JSON 구조:

      {
        "sac": int,
        "sic": int,
        "radar_center": [lat, lon],         # 레이더 중심 위·경도
        "max_packet": int,                  # weather 패킷 수
        "max_range_nm": float,              # 최대 끝거리 (NM)
        "parsed_at": "ISO...",
        "segments": [
          [pkt_idx, intensity, angle_deg, start_nm, end_nm],
          ...
        ]
      }
    """

    ast_path = os.path.abspath(ast_path)
    base_name = os.path.splitext(os.path.basename(ast_path))[0]

    if json_path is None:
        json_path = os.path.join(
            os.path.dirname(ast_path), base_name + "_cat08.json"
        )
    else:
        json_path = os.path.abspath(json_path)

    (
        lat,
        lon,
        segments,
        max_pkt,
        max_range_nm,
        parsed_at,
        sac,
        sic,
    ) = parse_cat08_from_ast(ast_path)

    data = {
        "sac": sac,
        "sic": sic,
        "radar_center": [lat, lon],
        "max_packet": max_pkt,
        "max_range_nm": max_range_nm,
        "parsed_at": parsed_at,
        "segments": segments,
    }

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return json_path


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]

    if not argv or argv[0] in ("-h", "--help"):
        print(
            "사용법:\n"
            "  python ast_to_json.py input.ast\n"
            "  python ast_to_json.py input.ast output.json\n"
        )
        return 0

    ast_path = argv[0]
    if not os.path.isfile(ast_path):
        print(f"[오류] AST 파일을 찾을 수 없습니다: {ast_path}")
        return 1

    json_path = argv[1] if len(argv) >= 2 else None

    try:
        out = ast_to_json(ast_path, json_path)
        print(f"[완료] JSON 저장: {out}")
        return 0
    except Exception as e:
        print(f"[오류] 변환 실패: {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
