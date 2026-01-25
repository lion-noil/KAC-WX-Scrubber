// src/utils/radarTime.js

// 파일명에서 날짜 추론하는 헬퍼
// - 예: RDM_A2025071500_cat08.json → "2025-11-11"
// - 그 외에도 8자리 yyyymmdd 있으면 거기서 날짜 추출
export function inferBaseDateFromName(name) {
  if (!name) return null;

  // 1) RDM_AYYYYMMDDxx_cat 같은 패턴
  let m = name.match(/RDM_A(\d{8})\d{2}_cat/i);
  if (m) {
    const ymd = m[1];
    const yyyy = ymd.slice(0, 4);
    const mm = ymd.slice(4, 6);
    const dd = ymd.slice(6, 8);
    return `${yyyy}-${mm}-${dd}`; // "2025-11-11"
  }

  // 2) 그냥 8자리 yyyymmdd 가 있는 경우
  m = name.match(/(\d{4})(\d{2})(\d{2})/);
  if (m) {
    const [, yyyy, mm, dd] = m;
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function formatDateTimeUTC(d) {
  const yyyy = d.getUTCFullYear();
  const mm = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const mi = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function formatDateTimeKST(d) {
  // KST = UTC + 9
  const kstMs = d.getTime() + 9 * 3600 * 1000;
  const kd = new Date(kstMs);
  const yyyy = kd.getUTCFullYear();
  const mm = pad2(kd.getUTCMonth() + 1);
  const dd = pad2(kd.getUTCDate());
  const hh = pad2(kd.getUTCHours());
  const mi = pad2(kd.getUTCMinutes());
  const ss = pad2(kd.getUTCSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

/**
 * pktTimesLiberal
 *
 * @param {string|null} baseDateUTC  "2025-11-11" 또는 ISO 문자열
 * @param {number|null} sopToDSec    기준 시각 offset (초). null이면 0으로 간주 + inferred=true
 * @param {number}      pkt          현재 패킷 번호 (1 기반)
 * @param {number}      secPerPacket 패킷당 시간(초)
 *
 * 리턴값 예:
 *   {
 *     utc: "2025-11-11 00:00:00",
 *     kst: "2025-11-11 09:00:00",
 *     inferred: true/false
 *   }
 */
export function pktTimesLiberal(baseDateUTC, sopToDSec, pkt, secPerPacket) {
  if (!baseDateUTC || pkt == null || !Number.isFinite(secPerPacket)) {
    return null;
  }

  // 문자열이 "2025-11-11" 같이 날짜만 있을 수도, ISO 전체일 수도 있음
  let base;
  if (/^\d{4}-\d{2}-\d{2}$/.test(baseDateUTC)) {
    // 시간 없으면 "T00:00:00Z" 붙여서 UTC 자정으로 해석
    base = new Date(`${baseDateUTC}T00:00:00Z`);
  } else {
    base = new Date(baseDateUTC);
  }

  if (!Number.isFinite(base.getTime())) {
    return null;
  }

  const inferred = !Number.isFinite(sopToDSec);
  const sop = inferred ? 0 : Number(sopToDSec || 0);

  // pkt는 1 기반이라고 가정 → (pkt-1) * secPerPacket 만큼 경과
  const elapsed = (pkt - 1) * secPerPacket; // 초
  const tUtcMs = base.getTime() + (sop + elapsed) * 1000;
  const dUtc = new Date(tUtcMs);

  return {
    utc: formatDateTimeUTC(dUtc),
    kst: formatDateTimeKST(dUtc),
    inferred,
  };
}
