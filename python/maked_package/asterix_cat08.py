# python/maked_package/asterix_cat08.py

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Dict, Any, Optional


def _now_utc_iso() -> str:
    return (
        datetime.utcnow()
        .replace(tzinfo=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )

RANGE_LSB_NM = 1.0 / 128.0       # 16비트용 (참고)
RANGE_CELL_LSB_NM = 0.5          # 셀 스텝 (NM)


def _decode_range16_nm(hi: int, lo: int) -> float:
    """
    16비트 raw range → NM (참고 출력용)
    """
    raw = (hi << 8) | lo
    return raw * RANGE_LSB_NM


def _decode_angle_deg(hi: int, lo: int) -> float:
    """
    angle_deg = raw * 360/65536
    """
    raw = (hi << 8) | lo
    return raw * (360.0 / 65536.0)


def _decode_intensity(src: int) -> int:
    """
    Vector Qualifier / MessageType 바이트에서 intensity 단계 추출.
    VR-3000 패턴상 상위 nibble(4비트)에 단계가 들어있음.
      예: 0x10, 0x20, 0x30 → 1, 2, 3 ...
    """
    return (src >> 4) & 0x0F


# -------------------------------------------------------------
#  FSPEC 관련
# -------------------------------------------------------------
def _item_present(fspec: int, bit: int) -> bool:
    """
    FSPEC의 특정 bit가 켜져 있는지 확인
    - bit 번호: 8~2 (FRN1~FRN7) / bit1(FX)는 사용하지 않음
    - 이 함수는 *첫 번째* FSPEC 옥텟에 대해서만 사용한다.
    """
    if bit < 2 or bit > 8:
        return False
    # bit8 → mask = 1 << 7, bit7 → 1 << 6, ... bit2 → 1 << 1
    return bool(fspec & (1 << (bit - 1)))


# -------------------------------------------------------------
#  CAT-08 패킷 파싱 (VR-3000 Polar Vector 구조)
# -------------------------------------------------------------
def parse_cat08_packet(pkt: bytes) -> Optional[Dict[str, Any]]:
    """
    VR-3000 / Indra ASTERIX CAT-08 (Weather) 전용 패킷 파서.

    규칙 요약:

    - 카테고리 8, length 정상인 패킷만 처리.
    - FSPEC 은 최소 1바이트, FX(LSB)가 1이면 계속 이어짐.
    - VR-3000 weather 벡터는 **FSPEC 1바이트(E8 등)** 패턴만 사용한다고 가정:
        → FSPEC 길이가 2바이트 이상이면 SOP/제어/시간 패킷으로 간주하고 None.
    - 남은 payload 가 [vec_count(1바이트)][4바이트 × vec_count] 패턴이면
      Polar Vector 블록으로 간주.
    - 각 4바이트 벡터는:
        r_hi, r_lo, a_hi, a_lo
      로 구성되며,
        start_nm = r_hi * 0.5 NM
        end_nm   = r_lo * 0.5 NM
      으로 해석.
      만약 end_nm < start_nm 이면 swap.
      end_nm <= 0 이거나 end_nm <= start_nm 이면 geometry 상 의미 없으므로 버림.
    - 이런 "유효 벡터"가 하나도 없으면 None 반환 (weather 로 사용 안 함).
    """

    if len(pkt) < 4:
        return None

    category = pkt[0]
    if category != 8:
        return None

    length = int.from_bytes(pkt[1:3], "big")
    if length != len(pkt):
        # 길이 안 맞으면 안전하게 버림
        return None

    # ----------------------------
    #  FSPEC 읽기 (FX = LSB(0x01))
    # ----------------------------
    fspec_bytes: List[int] = []
    offset = 3

    while True:
        if offset >= length:
            return None
        b = pkt[offset]
        fspec_bytes.append(b)
        offset += 1
        # FX 비트(LSB)가 0이면 FSPEC 끝
        if (b & 0x01) == 0:
            break

    # ✅ VR-3000 weather 벡터는 FSPEC 1바이트짜리만 사용
    #    FSPEC이 2바이트 이상이면 weather 데이터로 취급하지 않음.
    if len(fspec_bytes) != 1:
        return None

    fspec1 = fspec_bytes[0]

    sac: Optional[int] = None
    sic: Optional[int] = None
    msg_type: Optional[int] = None
    qualifier: Optional[int] = None
    vectors: List[Dict[str, float]] = []

    # ----------------------------
    # I008/010  Data Source Identifier (SAC/SIC) - FRN1 (bit8)
    # ----------------------------
    if _item_present(fspec1, 8):  # FRN1
        if offset + 2 > length:
            return None
        sac = pkt[offset]
        sic = pkt[offset + 1]
        offset += 2

    # ----------------------------
    # I008/000  Message Type - FRN2 (bit7)
    # ----------------------------
    if _item_present(fspec1, 7):  # FRN2
        if offset + 1 > length:
            return None
        msg_type = pkt[offset]
        offset += 1

    # ----------------------------
    # I008/020  Vector Qualifier (Vector characteristics) - FRN3 (bit6)
    # ----------------------------
    if _item_present(fspec1, 6):  # FRN3
        if offset + 1 > length:
            return None
        qualifier = pkt[offset]
        offset += 1

    # ---------------------------------------------------------
    #  Polar Vectors
    #
    #  남은 payload가:
    #     [vec_count(1바이트)][4바이트 × vec_count] 를 만족하면
    #  Polar Vector 블록으로 간주한다.
    # ---------------------------------------------------------
    if offset < length:
        remaining = length - offset
        if remaining >= 1:
            count = pkt[offset]
            max_vectors_by_size = (remaining - 1) // 4  # count 한 바이트 제외

            if 1 <= count <= max_vectors_by_size:
                # 실제로 Polar Vector라고 판단
                offset += 1
                for _ in range(count):
                    if offset + 4 > length:
                        break

                    r_hi = pkt[offset]
                    r_lo = pkt[offset + 1]
                    a_hi = pkt[offset + 2]
                    a_lo = pkt[offset + 3]
                    offset += 4

                    # 16비트 range (참고용)
                    raw16 = (r_hi << 8) | r_lo
                    range16_nm = raw16 * RANGE_LSB_NM

                    # 각도 디코드
                    ang_deg = _decode_angle_deg(a_hi, a_lo)

                    # VR-3000 range cell → start/end (NM)
                    hi_idx = r_hi
                    lo_idx = r_lo
                    s_nm = hi_idx * RANGE_CELL_LSB_NM
                    e_nm = lo_idx * RANGE_CELL_LSB_NM

                    # 역전되어 있으면 swap
                    if e_nm < s_nm:
                        s_nm, e_nm = e_nm, s_nm

                    # 0이거나, 길이가 0 이하인 경우는 노이즈로 간주
                    if e_nm <= 0 or e_nm <= s_nm:
                        continue

                    vectors.append(
                        {
                            "angle_deg": ang_deg,
                            "start_nm": s_nm,
                            "end_nm": e_nm,
                            # 참고용 메타
                            "range16_nm": range16_nm,
                            "range_raw": raw16,
                            "hi_idx": hi_idx,
                            "lo_idx": lo_idx,
                        }
                    )

    # "유효 벡터"가 하나도 없으면 weather 데이터로 쓰지 않음
    if not vectors:
        return None

    # ---------------------------------------------------------
    #  Intensity 계산
    #   - 우선순위: qualifier(벡터 특성) → msg_type(메시지 타입) → 0
    # ---------------------------------------------------------
    if qualifier is not None:
        intensity = _decode_intensity(qualifier)
    elif msg_type is not None:
        intensity = _decode_intensity(msg_type)
    else:
        intensity = 0

    return {
        "category": 8,
        "length": length,
        "sac": sac,
        "sic": sic,
        "message_type": msg_type,
        "qualifier": qualifier,
        "intensity": intensity,
        "vectors": vectors,          # 위 규칙으로 필터링된 start/end 벡터들
        "utc_parsed_at": _now_utc_iso(),
    }


# -------------------------------------------------------------
#  파일 전체에서 CAT-08 weather 패킷만 추출
# -------------------------------------------------------------
def parse_asterix_file_cat08(
    file_path: str,
    max_packets: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    AST 파일 전체를 훑으면서 CAT=8 패킷만 골라 parse_cat08_packet()으로 파싱.

    - parse_cat08_packet() 이 None 을 반환하는 CAT-08 패킷은
      상태/관리/시간 또는 유효 벡터가 없는 것으로 보고 제외.
    - 결과 리스트에는 "실제 weather 벡터가 존재하는 패킷"만 들어 있다.
    """
    with open(file_path, "rb") as f:
        data = f.read()

    offset = 0
    out: List[Dict[str, Any]] = []
    count = 0
    total_len = len(data)

    while offset + 3 <= total_len:
        cat = data[offset]
        length = int.from_bytes(data[offset + 1: offset + 3], "big")

        # length가 이상하면 더 이상 진행 불가 → 중단
        if length < 3 or offset + length > total_len:
            break

        if cat == 8:
            pkt = data[offset: offset + length]
            parsed = parse_cat08_packet(pkt)
            if parsed:
                out.append(parsed)
                count += 1
                if max_packets is not None and count >= max_packets:
                    break

        offset += length

    return out
