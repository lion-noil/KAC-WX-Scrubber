// src/utils/radarFilePicker.js

// 최신 파일 선택
export function pickLatestPath(paths, opts = {}) {
  const { cat = "08" } = opts;
  const items = paths
    .map((p) => {
      const name = p.split("/").pop();
      const mDate = name.match(/\((\d{6})\)/);
      const yymmdd = mDate ? mDate[1] : null;
      const mCat = name.match(/_cat(\d+)\.json$/);
      const catNum = mCat ? mCat[1] : null;
      return { path: p, name, yymmdd, catNum };
    })
    .filter((x) => (cat ? x.catNum === String(cat) : true))
    .filter((x) => !!x.yymmdd)
    .sort((a, b) => {
      const da = parseInt(a.yymmdd, 10);
      const db = parseInt(b.yymmdd, 10);
      if (db !== da) return db - da;
      return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" });
    });

  return items[0]?.path ?? null;
}
