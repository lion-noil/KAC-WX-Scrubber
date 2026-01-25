// src/utils/parseVideoTimestamp.js
export function parseKstTimestampFromText(
  text,
  baseKstStr = "2025-11-11 09:00:00"
) {
  if (!text) return null;

  // 개행/중복 공백 정리
  const clean = text.replace(/\s+/g, " ").trim();

  // 2025.11.11.12:33 , 2025.11.11 12:33 등
  const m = clean.match(
    /(\d{4})[.\s\-\/](\d{2})[.\s\-\/](\d{2}).*?(\d{2}):(\d{2})/
  );
  if (!m) return null;

  const [, yyyy, mm, dd, HH, MM] = m;
  const kstStr = `${yyyy}-${mm}-${dd} ${HH}:${MM}:00`;

  // 기준 09:00에서 몇 초 지났는지 (tSec) 계산
  const base = new Date(baseKstStr.replace(" ", "T") + "+09:00"); // KST
  const t = new Date(kstStr.replace(" ", "T") + "+09:00");
  const tSec = Math.round((t.getTime() - base.getTime()) / 1000);

  return { kst: kstStr, tSec };
}
