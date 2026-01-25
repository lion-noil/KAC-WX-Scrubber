# python/maked_package/config.py
from __future__ import annotations

NM_TO_M = 1852.0

# (필요하면 여기 매핑 채워 넣기)
# 예: SACSIC_TO_CENTER_DMS[(8, 1)] = ("33°30'03.84\"N", "126°28'59.37\"E")
SACSIC_TO_CENTER_DMS: dict[tuple[int, int], tuple[str, str]] = {}

# 매핑에 없을 때 사용하는 기본값 (제주 레이더 기준)
DEFAULT_CENTER_LAT_DMS = '33°30\'03.84"N'
DEFAULT_CENTER_LON_DMS = '126°28\'59.37"E'
