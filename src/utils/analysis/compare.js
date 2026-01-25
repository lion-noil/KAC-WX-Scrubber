// src/utils/analysis/compare.js
export function compareBinaryGrids(gridA, gridB, options = {}) {
  if (!gridA || !gridB) return null;
  const h = gridA.length;
  const w = gridA[0].length;

  const maskFn = options.maskFn || (() => true);

  let total = 0;

  let match = 0;     // a === b 전체
  let mismatch = 0;  // a !== b 전체

  let tp = 0; // 1 & 1
  let fp = 0; // 1 & 0
  let fn = 0; // 0 & 1
  let tn = 0; // 0 & 0

  for (let y = 0; y < h; y++) {
    const rowA = gridA[y];
    const rowB = gridB[y];
    for (let x = 0; x < w; x++) {
      if (!maskFn(x, y)) continue;

      const a = rowA[x] ? 1 : 0;
      const b = rowB[x] ? 1 : 0;

      total += 1;

      if (a === b) {
        match += 1;
        if (a === 1) tp += 1;
        else tn += 1;
      } else {
        mismatch += 1;
        if (a === 1 && b === 0) fp += 1;
        else if (a === 0 && b === 1) fn += 1;
      }
    }
  }

  const overall_match_ratio = total > 0 ? match / total : 0;

  const unionActive = tp + fp + fn;
  const active_overlap_ratio = unionActive > 0 ? tp / unionActive : 0;

  const radar_precision_vs_cloud = tp + fp > 0 ? tp / (tp + fp) : 0;
  const radar_recall_vs_cloud = tp + fn > 0 ? tp / (tp + fn) : 0;

  return {
    overall_match_ratio,
    overall_match_percent: Math.round(overall_match_ratio * 100),

    active_overlap_ratio,
    active_overlap_percent: Math.round(active_overlap_ratio * 100),

    radar_precision_vs_cloud,
    radar_precision_percent: Math.round(radar_precision_vs_cloud * 100),

    radar_recall_vs_cloud,
    radar_recall_percent: Math.round(radar_recall_vs_cloud * 100),

    total_cells_in_mask: total,

    // 새로 추가된 raw 카운트들
    match_cells: match,       // a === b
    mismatch_cells: mismatch, // a !== b
    tp,
    fp,
    fn,
    tn,
  };
}
