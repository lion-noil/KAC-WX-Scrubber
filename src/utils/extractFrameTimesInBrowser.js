// src/utils/extractFrameTimesInBrowser.js
import { createWorker } from "tesseract.js";

// 시간 숫자가 있는 대략적인 영역 (원본 픽셀 기준)
// - x: 208 ~ 248
// - y: 4 ~ 13
const TIME_X_START = 208;
const TIME_X_END = 248;
const TIME_Y_START = 4;
const TIME_Y_END = 13;

// 약간 널널하게 여유
const TIME_X_PADDING = 4;
const TIME_Y_PADDING = 3;

// "YYYY-MM-DD HH:mm:ss" → UTC ms
function parseBaseKstToUtcMs(baseKst) {
  const m = String(baseKst).match(
    /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/
  );
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  const ss = Number(m[6]);
  // baseKst는 KST 기준이라고 가정하고, 여기서는 "그냥 문자열 그대로" UTC로 쓰진 않고
  // 단순 기준값으로만 사용 (절대 UTC 오차는 크게 신경 안 써도 됨)
  return Date.UTC(year, mon, day, hh, mm, ss);
}

// UTC ms → "YYYY-MM-DD HH:mm:ss"
function formatUtcMsToKstString(utcMs) {
  const d = new Date(utcMs);
  const year = d.getUTCFullYear();
  const mon = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${year}-${mon}-${day} ${hh}:${mm}:${ss}`;
}

// "MM:SS" 같은 문자열에서 offsetSec 계산 + baseKst에 더해서 KST 문자열 생성
function buildOffsetKstFromRaw(rawText, baseKst) {
  if (!rawText) return { kst: null, tSec: null };

  const m = String(rawText).match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!m) return { kst: null, tSec: null };

  const mm = Number(m[1]);
  const ss = Number(m[2]);
  if (!Number.isFinite(mm) || !Number.isFinite(ss)) {
    return { kst: null, tSec: null };
  }

  const tSec = mm * 60 + ss;

  const baseUtcMs = parseBaseKstToUtcMs(baseKst);
  if (baseUtcMs == null) {
    // 기준 시간이 이상하면 tSec만 반환
    return { kst: null, tSec };
  }

  const kstMs = baseUtcMs + tSec * 1000;
  const kstStr = formatUtcMsToKstString(kstMs);

  return { kst: kstStr, tSec };
}

/**
 * 브라우저에서 <video>의 프레임들에서 타임스탬프 OCR
 *
 * @param {HTMLVideoElement} video
 * @param {Object} options
 * @param {number} options.totalFrames      - 전체 프레임 개수 (VideoScrubber와 동일)
 * @param {number} options.frameIntervalSec - 프레임 간격(초) (VideoScrubber와 동일)
 * @param {string} options.baseKst          - 기준 시각(KST) 문자열 "YYYY-MM-DD HH:mm:ss"
 * @param {string} options.lang             - tesseract 언어 (예: "eng" 또는 "eng+kor")
 * @param {Function} options.onProgress     - (current, total) => void
 *
 * @returns Promise<{ baseKst: string, frames: { frameIndex, videoTime, rawText, kst, tSec }[] }>
 */
export async function extractFrameTimesInBrowser(
  video,
  {
    totalFrames,
    frameIntervalSec,
    baseKst = "2025-11-11 09:00:00",
    lang = "eng",
    onProgress,
  }
) {
  if (!video.duration || !Number.isFinite(video.duration)) {
    throw new Error("video metadata not loaded (duration missing)");
  }
  if (!totalFrames || totalFrames < 1) {
    throw new Error("totalFrames must be >= 1");
  }
  if (!frameIntervalSec || frameIntervalSec <= 0) {
    throw new Error("frameIntervalSec must be > 0");
  }

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    throw new Error("video videoWidth/videoHeight not ready");
  }

  // 캔버스 준비 (원본 프레임용)
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = vw;
  canvas.height = vh;

  const duration = video.duration;
  const results = [];

  // seek 이벤트 기다리는 헬퍼
  const waitSeeked = (time) =>
    new Promise((resolve, reject) => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
        resolve();
      };
      const onError = (e) => {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
        reject(e);
      };
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.currentTime = time;
    });

  const worker = await createWorker({
    logger: (m) => {
      // console.log(m); // 필요하면 진행률 디버그
    },
  });

  try {
    await worker.loadLanguage(lang);
    await worker.initialize(lang);

    // 숫자/점/콜론만 허용 + single line 모드
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789.:",
      tessedit_pageseg_mode: "7", // single text line
    });

    for (let i = 0; i < totalFrames; i++) {
      if (onProgress) onProgress(i, totalFrames);

      // VideoScrubber와 동일한 시간축: t = idx * frameIntervalSec
      const t = Math.min(duration, i * frameIntervalSec);

      await waitSeeked(t);

      // 현재 프레임을 캔버스로 복사
      ctx.drawImage(video, 0, 0, vw, vh);

      // ROI를 픽셀 기준으로 잘라내기
      const x0px = Math.max(0, TIME_X_START - TIME_X_PADDING);
      const x1px = Math.min(vw, TIME_X_END + TIME_X_PADDING);
      const y0px = Math.max(0, TIME_Y_START - TIME_Y_PADDING);
      const y1px = Math.min(vh, TIME_Y_END + TIME_Y_PADDING);

      const rx = x0px;
      const ry = y0px;
      const rw = Math.max(1, x1px - x0px);
      const rh = Math.max(1, y1px - y0px);

      const cropCanvas = document.createElement("canvas");
      const cropCtx = cropCanvas.getContext("2d");
      cropCanvas.width = rw;
      cropCanvas.height = rh;

      cropCtx.filter = "grayscale(1) contrast(1.5)";
      cropCtx.drawImage(canvas, rx, ry, rw, rh, 0, 0, rw, rh);

      const { data } = await worker.recognize(cropCanvas);
      const rawText = (data.text || "").trim();

      const { kst, tSec } = buildOffsetKstFromRaw(rawText, baseKst);

      results.push({
  frameIndex: i,
  videoTime: t,
  rawText,
  kst: rawText,   // ★ KST 직접 저장
  tSec: null      // (필요 없으므로 null)
});
    }

    if (onProgress) onProgress(totalFrames, totalFrames);
  } finally {
    await worker.terminate();
  }

  return {
    baseKst,
    frames: results,
  };
}
