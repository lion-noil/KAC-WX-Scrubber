export function fmt2(n) {
  return String(n).padStart(2, "0");
}

export function toYmdHm(d) {
  return `${d.getFullYear()}${fmt2(d.getMonth() + 1)}${fmt2(d.getDate())}${fmt2(
    d.getHours()
  )}${fmt2(d.getMinutes())}`;
}

export function addMinutes(d, m) {
  return new Date(d.getTime() + m * 60_000);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function dayStartKst(dateStr) {
  return new Date(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(4, 6)) - 1,
    Number(dateStr.slice(6, 8)),
    0, 0, 0, 0
  );
}

export function safeJobId() {
  return Math.random().toString(36).slice(2, 10);
}
