// src/pages/final-analysis/useRadarReplaySync.js
import {useEffect, useMemo, useRef, useState} from "react";

import {buildRadarBinaryGrid} from "../../utils/analysis/radarGrid.js";
import {buildCloudBinaryGrid} from "../../utils/analysis/cloudGrid.js";
import {compareBinaryGrids} from "../../utils/analysis/compare.js";

import {
    formatSecToClock, isoUtcToKstSecOfDay, manifestRangeSec, parseClockToSec, parseRadarKstToSecSinceBase,
} from "./radarReplayTimeUtils.js";

// 임의의 숫자 그리드를 0/1로
function toBinaryGrid(grid, threshold = 0) {
    if (!grid) return null;
    return grid.map((row) => row.map((v) => (v > threshold ? 1 : 0)));
}

function latLonDeltaKm(lat0, lon0, lat1, lon1) {
    const dLat = lat1 - lat0;
    const dLon = lon1 - lon0;
    const kmPerDegLat = 111.32;
    const kmPerDegLon = 111.32 * Math.cos((lat0 * Math.PI) / 180);
    return {
        eastKm: dLon * kmPerDegLon,
        northKm: dLat * kmPerDegLat,
    };
}

function msToKstStr(ms) {
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mi = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    // ms가 이미 KST 기준(+09:00)로 들어온다고 가정하면 UTC로 찍히는 문제 있음.
    // 그래서 "KST로 만들기" 위해 +9시간 보정
    const k = new Date(ms + 9 * 3600 * 1000);
    const y = k.getUTCFullYear();
    const m = String(k.getUTCMonth() + 1).padStart(2, "0");
    const da = String(k.getUTCDate()).padStart(2, "0");
    const h = String(k.getUTCHours()).padStart(2, "0");
    const mn = String(k.getUTCMinutes()).padStart(2, "0");
    const s = String(k.getUTCSeconds()).padStart(2, "0");
    return `${y}-${m}-${da} ${h}:${mn}:${s}`;
}

function dayWindowMs(dayStr) {
    const start = Date.parse(`${dayStr}T00:00:00+09:00`);
    const end = Date.parse(`${dayStr}T00:00:00+09:00`) + 24 * 3600 * 1000;
    return {start, end};
}


// ✅ 후보 파일들(날짜/청크 있는 RDM들)에서 "타겟 하루 창"과 겹치는 부분만 slice로 뽑기
function buildAutoSlicesForDay(loadedList, targetDayStr) {
    const {start: winS, end: winE} = dayWindowMs(targetDayStr);

    const slices = [];
    for (const item of loadedList) {
        const p = item.parsed;
        if (!p?.dateStr || !Number.isFinite(p.chunk)) continue;

        const {fullStartMs, fullEndMs} = chunkFullRangeSec(p.chunk, p.dateStr);

        // overlap = [max(starts), min(ends)]
        const s = Math.max(winS, fullStartMs);
        const e = Math.min(winE, fullEndMs);
        if (!(e > s)) continue;

        slices.push({
            file: item.srcName,          // 로컬이면 파일명, URL이면 file 대신 url을 넣어야 함(아래에서 처리)
            url: item.url || null,
            chunk: p.chunk,
            startKst: msToKstStr(s),
            endKst: msToKstStr(e),
        });
    }

    // startKst 기준 정렬
    slices.sort((a, b) => kstToMs(a.startKst) - kstToMs(b.startKst));
    return slices.length ? slices : null;
}


export function useRadarReplaySync({manifest, centerLat = null, centerLon = null}) {
    const radarRef = useRef(null);
    const videoRef = useRef(null);

    const [analysis, setAnalysis] = useState(null);
    const [grids, setGrids] = useState({radar: null, cloud: null});
    const [viewMode, setViewMode] = useState("raw");

    // 레이더 RAW 범위(KST 문자열)
    const [radarRawRangeKst, setRadarRawRangeKst] = useState(null);

    // 레이더 slice summary
    const [radarSliceSummary, setRadarSliceSummary] = useState(null);

    // 공통 시간 구간 (sec)
    const [commonRangeSec, setCommonRangeSec] = useState(null);

    // 공통 구간 프레임 범위 (manifest 기준)
    const [commonFrameRange, setCommonFrameRange] = useState(null);

    // 레이더 패킷별 KST(sec-of-day)
    const [radarPktTimes, setRadarPktTimes] = useState(null);

    // 동적 trail
    const [dynamicTrail, setDynamicTrail] = useState(3);

// ✅ 그래프용: (idx, tMs, timeLabel, pct)
    const [matchHistory, setMatchHistory] = useState([]);
    const [currentFrameIdx, setCurrentFrameIdx] = useState(null);

// ✅ 첫 바퀴 끝나면 누적 잠금
    const [historyLocked, setHistoryLocked] = useState(false);
// ✅ 첫 바퀴 끝났는지
    const [firstLoopDone, setFirstLoopDone] = useState(false);

    const seenIdxRef = useRef(new Set());
    const currentFrameMetaRef = useRef({idx: null, tMs: null, label: ""});
    const lastFrameSecRef = useRef(null);
    const lastFrameIdxRef = useRef(null);
    const lastTrailFrameIdxRef = useRef(null); // trail 계산용 (별도)


    // 🔴 60NM 마스크(그리드 비교 범위)
    const DETECT_RANGE_NM = 60;
    const DETECT_RANGE_KM = DETECT_RANGE_NM * 1.852;
    const RADAR_MAX_RANGE_KM = 250;
    const RADAR_GRID_OFFSET_X = 0;
    const RADAR_GRID_OFFSET_Y = 0;

    function makeDetectMaskFn(size, meta) {
        const center = (size - 1) / 2;
        const radiusCellsFull = center;

        // 60NM 반경(셀)
        const radiusFrac = DETECT_RANGE_KM / RADAR_MAX_RANGE_KM;
        const detectRadiusCells = radiusCellsFull * radiusFrac;
        const detectR2 = detectRadiusCells * detectRadiusCells;

        // ✅ refCenter(성산) = grid 좌표계의 중심
        const refLat = centerLat ?? meta?.lat;
        const refLon = centerLon ?? meta?.lon;

        // ✅ 공항 레이더(meta)가 refCenter 대비 얼마나 이동했는지(km)
        const {eastKm, northKm} =
            (refLat != null && refLon != null && meta?.lat != null && meta?.lon != null)
                ? latLonDeltaKm(refLat, refLon, meta.lat, meta.lon)
                : {eastKm: 0, northKm: 0};

        // ✅ km → grid cell 오프셋
        // x: 동쪽(+)이면 오른쪽으로
        const offX = (eastKm / RADAR_MAX_RANGE_KM) * radiusCellsFull;
        // y: 북쪽(+)이면 위로 가야하니까 화면좌표(y)는 감소
        const offY = (-northKm / RADAR_MAX_RANGE_KM) * radiusCellsFull;

        // ✅ 마스크 중심 = "공항 레이더(meta)" 위치
        const cx = center + offX;
        const cy = center + offY;

        return (x, y) => {
            const dx = x - cx;
            const dy = y - cy;
            return dx * dx + dy * dy <= detectR2;
        };
    }


    // ★ 레이더 RAW 범위(KST) + sliceSummary 폴링
    useEffect(() => {
        let cancelled = false;
        let tries = 0;
        const maxTries = 60;

        const tick = () => {
            if (cancelled) return;

            const radar = radarRef.current;

            if (radar?.getSliceSummary) {
                const sum = radar.getSliceSummary();
                if (sum) setRadarSliceSummary(sum);
            }

            if (radar?.getRawRangeKst) {
                const range = radar.getRawRangeKst();
                if (range) setRadarRawRangeKst(range);
            }

            tries += 1;
            if (tries < maxTries) setTimeout(tick, 300);
        };

        tick();
        return () => {
            cancelled = true;
        };
    }, []);

    // ✅ 영상(=manifest) RAW 범위
    const videoRangeSec = useMemo(() => manifestRangeSec(manifest), [manifest]);
    useEffect(() => {
        setMatchHistory([]);
        setCurrentFrameIdx(null);
        setHistoryLocked(false);
        setFirstLoopDone(false); // ✅ 추가
        seenIdxRef.current = new Set();
        lastFrameIdxRef.current = null;
        currentFrameMetaRef.current = {idx: null, tMs: null, label: ""};
    }, [manifest]);

    // ✅ 공통 시간 구간 계산 (레이더 vs manifest)
    useEffect(() => {
        if (!radarRawRangeKst || !videoRangeSec) {
            setCommonRangeSec(null);
            return;
        }

        const baseDateStr = radarRawRangeKst.startKst.split(" ")[0] || null;
        const rStartSec = parseRadarKstToSecSinceBase(radarRawRangeKst.startKst, baseDateStr);
        const rEndSec = parseRadarKstToSecSinceBase(radarRawRangeKst.endKst, baseDateStr);

        const vStartSec = videoRangeSec.start;
        const vEndSec = videoRangeSec.end;

        if (rStartSec == null || rEndSec == null || vStartSec == null || vEndSec == null) {
            setCommonRangeSec(null);
            return;
        }

        const start = Math.max(rStartSec, vStartSec);
        const end = Math.min(rEndSec, vEndSec);

        if (!isFinite(start) || !isFinite(end) || start >= end) setCommonRangeSec(null); else setCommonRangeSec({
            start, end
        });
    }, [radarRawRangeKst, videoRangeSec]);

    // ✅ 공통 프레임 범위 계산 (manifest.frames[i].t 기준)
    useEffect(() => {
        const frames = manifest?.frames;
        if (!commonRangeSec || !Array.isArray(frames) || !frames.length) {
            setCommonFrameRange(null);
            return;
        }

        let startIdx = null;
        let endIdx = null;

        for (let i = 0; i < frames.length; i++) {
            const sec = isoUtcToKstSecOfDay(frames[i]?.t);
            if (sec == null) continue;

            if (sec >= commonRangeSec.start && startIdx === null) startIdx = i;
            if (sec <= commonRangeSec.end) endIdx = i;
        }

        if (startIdx == null || endIdx == null || startIdx > endIdx) setCommonFrameRange(null); else setCommonFrameRange({
            startFrame: startIdx, endFrame: endIdx
        });
    }, [commonRangeSec, manifest]);

    // ★ 레이더 패킷별 KST(sec-of-day) 테이블 생성 (하루 기준)
    useEffect(() => {
        if (!radarRawRangeKst) {
            setRadarPktTimes(null);
            return;
        }

        const radar = radarRef.current;
        if (!radar || !radar.getPacketTimeKst || !radar.maxPacket) {
            setRadarPktTimes(null);
            return;
        }

        const maxPkt = radar.maxPacket() || 1;

        const table = [];
        for (let p = 1; p <= maxPkt; p++) {
            const kstStr = radar.getPacketTimeKst(p);
            if (!kstStr) continue;

            const parts = kstStr.trim().split(" ");
            let timePart = parts.length === 2 ? parts[1] : parts[0];

            const sec = parseClockToSec(timePart);
            if (sec == null) continue;

            table.push({pkt: p, sec});
        }

        if (!table.length) {
            setRadarPktTimes(null);
            return;
        }

        setRadarPktTimes(table);
    }, [radarRawRangeKst]);

    // ✅ 분석
    const runAnalysis = (pktStartOverride = null, pktEndOverride = null) => {
        const radar = radarRef.current;
        const video = videoRef.current;
        if (!radar || !video) return;

        const currentPkt = radar.getPacket?.() || 1;
        let pktStart = pktStartOverride ?? currentPkt;
        let pktEnd = pktEndOverride ?? currentPkt;

        if (pktStart > pktEnd) [pktStart, pktEnd] = [pktEnd, pktStart];
        pktStart = Math.max(1, pktStart | 0);
        pktEnd = Math.max(pktStart, pktEnd | 0);

        const meta = radar.getMeta?.();
        const imgDataRaw = video.captureImage?.(); // 원본 프레임
        if (!meta || !imgDataRaw) return;

        // 레이더 segment merge
        let mergedSegments = [];
        for (let p = pktStart; p <= pktEnd; p++) {
            const seg = radar.getSegments?.(p);
            if (seg && seg.length) mergedSegments = mergedSegments.concat(seg);
        }
        if (!mergedSegments.length) return;

        // 1) radar grid
        const radarGridRaw = buildRadarBinaryGrid({
            segments: mergedSegments,
            meta,
            maxRangeKm: 250,
            gridSize: 32,
            ciThreshold: 1,

            // ✅ 추가: 비교 기준 중심(성산)
            refCenterLat: centerLat ?? meta.lat,
            refCenterLon: centerLon ?? meta.lon,
        });

        // 2) video grid
        const cloudGridRaw = buildCloudBinaryGrid(imgDataRaw, 32, undefined, {
            satThreshold: 0.25, minV: 0.15, maxV: 0.98,
        });

        const radarGrid = toBinaryGrid(radarGridRaw, 0);
        const cloudGrid = toBinaryGrid(cloudGridRaw, 0);
        if (!radarGrid || !cloudGrid) return;

        // 60NM 마스크 적용
        const size = radarGrid.length;
        const maskFn = makeDetectMaskFn(size, meta);

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                if (!maskFn(x, y)) {
                    radarGrid[y][x] = 0;
                    cloudGrid[y][x] = 0;
                }
            }
        }

        const stats = compareBinaryGrids(radarGrid, cloudGrid, {maskFn});

        setAnalysis(stats);
        setGrids({radar: radarGrid, cloud: cloudGrid});
    };

    // ✅ 프레임 변화 시: manifest.t로 시간 매핑 → 레이더 packet 매핑 + 분석(trail 포함)
    const handleVideoFrameChange = (frameIdx, frameInfo) => {
        const radar = radarRef.current;
        const video = videoRef.current;
        if (!radar || !video) return;

        // ✅ 루프 감지용 prevIdx (여기서만!)
        const prevIdx = lastFrameIdxRef.current;
        if (prevIdx != null && frameIdx < prevIdx) {
            setHistoryLocked(true);      // 기존
            setFirstLoopDone(true);      // ✅ 추가: 첫 바퀴 끝남 확정
        }
        lastFrameIdxRef.current = frameIdx;


        setCurrentFrameIdx(frameIdx);

        // ✅ 프레임 시간(ms) & 라벨 저장 (그래프 x축)
        const frameMs = frameInfo?.t ? Date.parse(frameInfo.t) : null;
        const fullKst = frameMs != null ? msToKstStr(frameMs) : "";
        const timeLabel = fullKst ? (fullKst.split(" ")[1] || fullKst) : `frame ${frameIdx}`;
        currentFrameMetaRef.current = {idx: frameIdx, tMs: frameMs, label: timeLabel};

        const frameKstSec = isoUtcToKstSecOfDay(frameInfo?.t);


        // 1) 가장 가까운 패킷 찾기
        let mappedPkt = null;
        if (frameKstSec != null && Array.isArray(radarPktTimes) && radarPktTimes.length > 0) {
            let bestPkt = null;
            let bestDiff = Infinity;

            for (const row of radarPktTimes) {
                const diff = Math.abs(row.sec - frameKstSec);
                if (diff < bestDiff) {
                    bestDiff = diff;
                    bestPkt = row.pkt;
                }
            }
            if (bestPkt != null) mappedPkt = bestPkt;
        }

        // 2) fallback: 인덱스 비율
        if (mappedPkt == null) {
            const frameCount = video.getFrameCount?.() || 1;
            const maxPkt = radar.maxPacket?.() || 1;

            if (frameCount > 1 && maxPkt > 1) {
                const ratio = frameIdx / (frameCount - 1);
                mappedPkt = Math.max(1, Math.round(1 + ratio * (maxPkt - 1)));
            } else {
                mappedPkt = 1;
            }
        }

        // 3) 동적 trail
        let trailForThisStep = dynamicTrail;
        const prevTrailIdx = lastTrailFrameIdxRef.current;

        if (frameKstSec != null && Array.isArray(radarPktTimes) && radarPktTimes.length > 0) {
            const prevSec = lastFrameSecRef.current;

            if (prevSec != null && prevTrailIdx != null && frameIdx > prevTrailIdx) {
                const minSec = Math.min(prevSec, frameKstSec);
                const maxSec = Math.max(prevSec, frameKstSec);

                let count = 0;
                for (const row of radarPktTimes) {
                    if (row.sec > minSec && row.sec <= maxSec) count++;
                }
                trailForThisStep = count > 0 ? count : 1;
                setDynamicTrail(trailForThisStep);
            } else if (prevTrailIdx != null && frameIdx < prevTrailIdx) {
                trailForThisStep = 3;
                setDynamicTrail(3);
            }
        }

        lastFrameSecRef.current = frameKstSec;
        lastTrailFrameIdxRef.current = frameIdx;

        // 4) 레이더 표시
        radar.setPacket?.(mappedPkt);

        // 5) 분석 구간
        const pktEnd = mappedPkt;
        const pktStart = Math.max(1, mappedPkt - (trailForThisStep - 1));
        runAnalysis(pktStart, pktEnd);
    };
    useEffect(() => {
        if (!analysis) return;
        if (historyLocked) return;

        const meta = currentFrameMetaRef.current;
        const idx = meta?.idx;
        if (idx == null) return;

        // ✅ 프레임 idx 중복 방지
        if (seenIdxRef.current.has(idx)) return;
        seenIdxRef.current.add(idx);

        const pct =
            analysis.overall_match_percent ??
            Math.round((analysis.overall_match_ratio || 0) * 100);

        setMatchHistory((prev) => {
            const next = [...prev, {idx, tMs: meta.tMs, label: meta.label, pct}];
            return next.length > 2000 ? next.slice(-2000) : next;
        });
    }, [analysis, historyLocked]);


    // 요약 값들도 hook에서 같이 계산해주면 페이지가 얇아짐
    const manifestTotalFrames = manifest?.frames?.length ? manifest.frames.length : 0;
    const commonUsedFrames = commonFrameRange ? Math.max(0, commonFrameRange.endFrame - commonFrameRange.startFrame + 1) : 0;

    const radarTotalNewPkts = radarSliceSummary?.totalPkts ?? null;
    const radarUsedNewPkts = radarSliceSummary?.totalUsedNewPkts ?? null;

    const files = radarSliceSummary?.files || [];

    // 원본 파일에 실제 존재하는 총 pkt 합 (localMaxPkts 합)
    const radarTotalOrigPkts = files.length ? files.reduce((acc, f) => acc + (Number(f.localMaxPkts) || 0), 0) : null;

    // 원본에서 실제 사용한 pkt 합 (usedOrigPkts 합) - 네 summary에 이미 있음
    const radarUsedOrigPkts = files.length ? files.reduce((acc, f) => acc + (Number(f.usedOrigPkts) || 0), 0) : null;

    // (옵션) 원본 사용 비율
    const radarOrigUsagePercent = radarTotalOrigPkts && radarUsedOrigPkts != null ? Math.round((radarUsedOrigPkts / radarTotalOrigPkts) * 100) : null;

    return {
        // refs
        radarRef, videoRef,

        // ui state
        viewMode, setViewMode,

        // analysis outputs
        analysis, grids, matchHistory,
        currentFrameIdx,
        historyLocked,
        firstLoopDone,      // ✅ 추가
        // timing summaries
        radarRawRangeKst, radarSliceSummary, commonRangeSec, commonFrameRange,

        manifestTotalFrames, commonUsedFrames, radarTotalNewPkts, radarUsedNewPkts,

        radarTotalOrigPkts, radarUsedOrigPkts, radarOrigUsagePercent,

        // handlers
        handleVideoFrameChange,

        // helpers for UI formatting (원하면 페이지에서 import 해도 됨)
        formatSecToClock, dynamicTrail,
    };
}
