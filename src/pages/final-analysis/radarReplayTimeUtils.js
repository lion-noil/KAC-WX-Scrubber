// src/pages/final-analysis/radarReplayTimeUtils.js

// "HH:MM" 또는 "HH:MM:SS" → 하루 기준 초(sec)
export function parseClockToSec(clockStr) {
  if (!clockStr) return null;
  const trimmed = String(clockStr).trim();
  if (!trimmed) return null;

  const parts = trimmed.split(":");
  const h = parseInt(parts[0] || "0", 10);
  const m = parseInt(parts[1] || "0", 10);
  const s = parseInt(parts[2] || "0", 10);

  if ([h, m, s].some((v) => Number.isNaN(v))) return null;
  return h * 3600 + m * 60 + s;
}

// 레이더 KST "YYYY-MM-DD HH:MM:SS" 를 baseDate 자정 기준 sec로
export function parseRadarKstToSecSinceBase(kstDateTimeStr, baseDateStr) {
  if (!kstDateTimeStr || !baseDateStr) return null;

  const trimmed = kstDateTimeStr.trim();
  const [datePart, timePart] = trimmed.split(" ");
  if (!timePart) return null;

  const tSec = parseClockToSec(timePart);
  if (tSec == null) return null;

  const baseDate = new Date(`${baseDateStr}T00:00:00+09:00`);
  const thisDate = new Date(`${datePart}T00:00:00+09:00`);
  const diffDays = Math.round((thisDate.getTime() - baseDate.getTime()) / (24 * 3600 * 1000));

  const dayOffset = Math.max(0, diffDays);
  return tSec + dayOffset * 86400;
}

export function formatSecToClock(sec) {
  if (sec == null || !isFinite(sec)) return "";
  const v = Math.floor(sec % 86400);
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ISO UTC → KST sec-of-day
export function isoUtcToKstSecOfDay(isoUtc) {
  if (!isoUtc) return null;
  const d = new Date(isoUtc);

  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const h = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  const s = parseInt(parts.find((p) => p.type === "second")?.value || "0", 10);

  if ([h, m, s].some((v) => Number.isNaN(v))) return null;
  return h * 3600 + m * 60 + s;
}

export function manifestRangeSec(manifest) {
  const frames = manifest?.frames;
  if (!Array.isArray(frames) || frames.length === 0) return null;
  const start = isoUtcToKstSecOfDay(frames[0]?.t);
  const end = isoUtcToKstSecOfDay(frames[frames.length - 1]?.t);
  if (start == null || end == null) return null;
  return { start, end };
}
