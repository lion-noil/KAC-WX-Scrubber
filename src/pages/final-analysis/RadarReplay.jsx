// src/pages/final-analysis/RadarReplay.jsx
import "./RadarReplay.css";
import React, {useMemo, useEffect, useRef} from "react";
import RadarMapPlayer from "../../components/RadarMapPlayer.jsx";
import VideoScrubber from "../../components/VideoScrubber.jsx";

import {useRadarReplaySync} from "./useRadarReplaySync.js";

// ▼ mp4 + manifest(json) 같이
const videoModules = import.meta.glob("../../assets/media/*.mp4", {eager: true});
const manifestModules = import.meta.glob("../../assets/media/*.json", {eager: true});
const centerLat = 33.460447;
const centerLon = 126.940929;

function basenameNoExt(p) {
    const name = p.split("/").pop() || "";
    return name.replace(/\.[^.]+$/, "");
}

function ymdToPrevYmd(ymd) {
    // ymd: "YYYYMMDD" (KST 달력 기준)
    const y = Number(ymd.slice(0, 4));
    const m = Number(ymd.slice(4, 6));
    const d = Number(ymd.slice(6, 8));

    // KST 자정의 절대시간(ms)
    const kstMidnightMs = Date.parse(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00+09:00`);

    // 전날 KST 자정 = -24h
    const prevKstMidnightMs = kstMidnightMs - 24 * 3600 * 1000;

    // ✅ KST 달력 날짜로 뽑기 위해 +9h 후 UTC 컴포넌트 사용
    const k = new Date(prevKstMidnightMs + 9 * 3600 * 1000);
    const yy = k.getUTCFullYear();
    const mm = String(k.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(k.getUTCDate()).padStart(2, "0");
    return `${yy}${mm}${dd}`;
}


function pickTargetYmdFromManifest(manifest) {
    const frames = manifest?.frames;
    if (!Array.isArray(frames) || !frames.length) return null;

    let maxMs = -Infinity;
    for (const f of frames) {
        const t = f?.t;
        if (!t) continue;
        const ms = Date.parse(t); // ISO + Z OK
        if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
    }
    if (!Number.isFinite(maxMs)) return null;

    // 최신 프레임 시간(UTC)을 KST로 +9h 변환 후 날짜 뽑기
    const k = new Date(maxMs + 9 * 3600 * 1000);
    const y = k.getUTCFullYear();
    const m = String(k.getUTCMonth() + 1).padStart(2, "0");
    const d = String(k.getUTCDate()).padStart(2, "0");
    return `${y}${m}${d}`; // YYYYMMDD
}


function buildSlicesForTargetDay(targetYmd, cat = "08") {
    if (!targetYmd) return null;

    const dayStr = `${targetYmd.slice(0, 4)}-${targetYmd.slice(4, 6)}-${targetYmd.slice(6, 8)}`;
    const prevYmd = ymdToPrevYmd(targetYmd);

    // 00~09 : 전날 01
    // 09~21 : 당일 00
    // 21~24 : 당일 01
    return [{
        file: `RDM_B${prevYmd}01_cat${cat}.json`,
        startKst: `${dayStr} 00:00:00`,
        endKst: `${dayStr} 09:00:00`,
        chunk: 1,
    }, {
        file: `RDM_B${targetYmd}00_cat${cat}.json`,
        startKst: `${dayStr} 09:00:00`,
        endKst: `${dayStr} 21:00:00`,
        chunk: 0,
    }, {
        file: `RDM_B${targetYmd}01_cat${cat}.json`,
        startKst: `${dayStr} 21:00:00`,
        endKst: `${dayStr} 24:00:00`,
        chunk: 1,
    },];
}

function pickVideoAndManifest() {
    const entries = Object.entries(videoModules);
    if (!entries.length) return {src: "", fileName: "", manifest: null};

    entries.sort(([a], [b]) => {
        const aa = a.split("/").pop() || "";
        const bb = b.split("/").pop() || "";
        return aa.localeCompare(bb);
    });

    const [videoPath, videoMod] = entries[0];
    const base = basenameNoExt(videoPath);
    const fileName = videoPath.split("/").pop() || "";

    let manifest = null;
    for (const [mPath, mMod] of Object.entries(manifestModules)) {
        if (basenameNoExt(mPath) === base) {
            manifest = mMod?.default ?? mMod;
            break;
        }
    }

    return {src: videoMod.default, fileName, manifest};
}

// === 일치도 게이지 ===
function MatchGauge({label, valuePercent = 0, hint}) {
    const v = Math.max(0, Math.min(100, valuePercent));
    return (<div className="gauge-row">
        <div className="gauge-label">
            <span>{label}</span>
            <span className="gauge-value">{v}%</span>
        </div>
        <div className="gauge-bar-bg">
            <div className="gauge-bar-fill" style={{width: `${v}%`}}/>
        </div>
        {hint && <div className="gauge-hint">{hint}</div>}
    </div>);
}

function MatchHistoryChart({data = [], height = 220, currentIdx = null}) {
    if (!Array.isArray(data) || data.length < 2) {
        return (<div style={{opacity: 0.6, fontSize: 12}}>
            그래프를 그릴 데이터가 아직 없습니다.
        </div>);
    }

    const W = 900; // viewBox width
    const H = height;
    const padL = 30;
    const padR = 10;
    const padT = 10;
    const padB = 20;

    const xs = data.map((_, i) => i);
    const ys = data.map((d) => Number(d.pct) || 0);

    const minX = 0;
    const maxX = xs.length - 1;
    const minY = 0;
    const maxY = 100;

    const xTo = (x) => padL + ((x - minX) / Math.max(1, maxX - minX)) * (W - padL - padR);
    const yTo = (y) => padT + (1 - (y - minY) / (maxY - minY)) * (H - padT - padB);

    const dPath = data
        .map((p, i) => {
            const x = xTo(i);
            const y = yTo(p.pct);
            return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" ");

    // x축 라벨: 처음/중간/끝만 (너무 길어지니까)
    const first = data[0]?.label ?? "";
    const mid = data[Math.floor(data.length / 2)]?.label ?? "";
    const last = data[data.length - 1]?.label ?? "";

    return (<div style={{width: "100%", overflow: "hidden"}}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{width: "100%", height}}>
            {/* grid lines */}
            {[0, 25, 50, 75, 100].map((v) => {
                const y = yTo(v);
                return (<g key={v}>
                    <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="rgba(255,255,255,0.08)"/>
                    <text x={4} y={y + 4} fontSize="10" fill="rgba(255,255,255,0.55)">
                        {v}
                    </text>
                </g>);
            })}

            {/* axes */}
            <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke="rgba(255,255,255,0.18)"/>
            <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="rgba(255,255,255,0.18)"/>

            {/* line */}
            <path d={dPath} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2"/>

            {/* last point */}
            {(() => {
                const lx = xTo(data.length - 1);
                const ly = yTo(data[data.length - 1].pct);
                return <circle cx={lx} cy={ly} r="3" fill="rgba(255,255,255,0.9)"/>;
            })()}
            {/* current point (red) */}
            {(() => {
                if (currentIdx == null) return null;

                // matchHistory는 {idx,...} 형태라 idx로 찾아야 정확함
                const j = data.findIndex((d) => d?.idx === currentIdx);
                if (j < 0) return null;

                const cx = xTo(j);
                const cy = yTo(Number(data[j]?.pct) || 0);

                return <circle cx={cx} cy={cy} r="4" fill="red"/>;
            })()}


            {/* x labels */}
            <text x={padL} y={H - 4} fontSize="10" fill="rgba(255,255,255,0.55)">
                {first}
            </text>
            <text
                x={xTo(Math.floor((data.length - 1) / 2))}
                y={H - 4}
                fontSize="10"
                fill="rgba(255,255,255,0.55)"
                textAnchor="middle"
            >
                {mid}
            </text>
            <text x={W - padR} y={H - 4} fontSize="10" fill="rgba(255,255,255,0.55)" textAnchor="end">
                {last}
            </text>
        </svg>
    </div>);
}


export default function RadarReplay() {
    const SEONGSAN = {lat: 33.460447, lon: 126.940929};

    const videoEntry = useMemo(() => pickVideoAndManifest(), []);
    const radarVideo = videoEntry?.src || "";
    const manifest = videoEntry?.manifest || null;

    // ✅ 여기서 slices 자동 생성
    const slices = useMemo(() => {
        const ymd = pickTargetYmdFromManifest(manifest);
        return buildSlicesForTargetDay(ymd, "08");
    }, [manifest]);

    const {
        radarRef,
        videoRef,

        viewMode,
        setViewMode,

        analysis,
        grids,
        matchHistory,   // ✅ 추가
        currentFrameIdx,
        historyLocked,


        radarRawRangeKst,
        radarSliceSummary,
        commonRangeSec,
        commonFrameRange,

        manifestTotalFrames,
        commonUsedFrames,
        radarTotalOrigPkts,
        radarUsedOrigPkts,
        radarOrigUsagePercent,
        radarTotalNewPkts,
        firstLoopDone,

        handleVideoFrameChange,
        formatSecToClock,
        dynamicTrail,
    } = useRadarReplaySync({manifest, centerLat, centerLon});

    const lockControls = !firstLoopDone; // 첫 바퀴 끝나기 전 잠금

    // ✅ (A/B) 표시용 카운트들
    const match = analysis?.match_cells ?? 0;
    const total = analysis?.total_cells_in_mask ?? 0;

    const tp = analysis?.tp ?? 0;
    const fp = analysis?.fp ?? 0;
    const fn = analysis?.fn ?? 0;

    const unionActive = tp + fp + fn;
    const precDen = tp + fp;
    const recallDen = tp + fn;


    const autoStartedRef = useRef(false);

    useEffect(() => {
        if (autoStartedRef.current) return;
        if (!commonFrameRange?.startFrame && commonFrameRange?.startFrame !== 0) return;
        if (!videoRef.current) return;

        autoStartedRef.current = true;

        // 1) 시작 프레임으로 이동
        videoRef.current.seekFrame?.(commonFrameRange.startFrame);

        // 2) 다음 tick에 재생 시도(로딩 타이밍 때문에)
        setTimeout(() => {
            const p = videoRef.current?.play?.();
            if (p?.catch) p.catch(() => {
            });
        }, 30);
    }, [commonFrameRange]);


    return (<div className="page">
        <div className="layout">
            {/* ===== RAW 데이터 시간 범위 + 공통 구간 + 요약 ===== */}
            <div
                style={{
                    marginBottom: 8,
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #444",
                    fontSize: 12,
                    background: "#111",
                }}
            >
                <div style={{marginBottom: 2, fontWeight: 600}}>RAW 데이터 시간 범위 (KST)</div>

                <div style={{marginBottom: 2}}>
                    <span style={{opacity: 0.85}}>레이더 (CAT-08): </span>
                    {radarRawRangeKst ? (<>
                        {radarRawRangeKst.startKst} ~ {radarRawRangeKst.endKst}
                    </>) : (<span style={{opacity: 0.6}}>로딩 중...</span>)}
                </div>

                <div style={{marginBottom: 2}}>
                    <span style={{opacity: 0.85}}>영상(manifest): </span>
                    {manifest?.frames?.length ? (<>
                        {manifest.frames[0]?.t} ~ {manifest.frames[manifest.frames.length - 1]?.t}
                        <span style={{marginLeft: 8, opacity: 0.75}}>(총 {manifestTotalFrames} 프레임)</span>
                    </>) : (<span style={{opacity: 0.6}}>manifest 없음(또는 매칭 실패)</span>)}
                </div>

                <div style={{marginBottom: 2}}>
                    <span style={{opacity: 0.85}}>공통 구간: </span>
                    {commonRangeSec ? (<>
                        {formatSecToClock(commonRangeSec.start)} ~ {formatSecToClock(commonRangeSec.end)}
                        {commonFrameRange && (<span style={{marginLeft: 8, opacity: 0.75}}>
                    (사용 프레임 {commonUsedFrames} / 범위 {commonFrameRange.startFrame}~{commonFrameRange.endFrame})
                  </span>)}
                    </>) : (<span style={{opacity: 0.6}}>(레이더·영상 RAW 범위가 아직 안 겹치거나 계산 전)</span>)}
                </div>

                {/* ===== 레이더 24h 구성 요약 ===== */}
                {radarSliceSummary && (<div style={{marginTop: 8, paddingTop: 8, borderTop: "1px solid #333"}}>
                    <div style={{fontSize: 12, fontWeight: 600, marginBottom: 4}}>24시간 레이더 구성 요약</div>

                    <div style={{fontSize: 11, opacity: 0.85, marginBottom: 6, lineHeight: 1.4}}>
                        <div>
                            파일 {radarSliceSummary.totalFiles}개 / 재구성(new) pkt {radarTotalNewPkts ?? "-"}
                        </div>
                        <div>
                            원본 총 pkt {radarTotalOrigPkts ?? "-"} / 원본 사용 pkt {radarUsedOrigPkts ?? "-"}
                            <span style={{marginLeft: 6, opacity: 0.8}}>
      ({radarOrigUsagePercent != null ? `${radarOrigUsagePercent}%` : "-"})
    </span>
                        </div>
                    </div>

                    <div style={{display: "grid", gap: 6}}>
                        {(radarSliceSummary.files || []).map((f, idx) => (<div
                            key={idx}
                            style={{
                                padding: "6px 8px", borderRadius: 8, border: "1px solid #222", background: "#0c0c0c",
                            }}
                        >
                            <div style={{fontWeight: 600, marginBottom: 2}}>
                                {idx + 1}. {f.src}
                            </div>
                            <div style={{fontSize: 11, opacity: 0.85, display: "grid", gap: 2}}>
                                <div>
                                    chunk: {f.chunk} / segLen: {f.segLen} / localMaxPkts: {f.localMaxPkts}
                                </div>
                                <div>
                                    use: {f.useStartKst} ~ {f.useEndKst}
                                </div>
                                <div>
                                    origPkts: {f.usedOrigPktStart}~{f.usedOrigPktEnd} ({f.usedOrigPkts}) →
                                    newPkts:{" "}
                                    {f.usedNewPktStart}~{f.usedNewPktEnd} ({f.usedNewPkts})
                                </div>
                                <div>
                                    timeline: startSec {Math.round(f.startSec ?? 0)} /
                                    durSec {Math.round(f.durationSec ?? 0)}
                                </div>
                            </div>
                        </div>))}
                    </div>
                </div>)}
            </div>

            {/* ===== view mode ===== */}
            <div className="view-mode-bar">
                <span style={{marginRight: 8}}>표시 모드:</span>
                <button className="btn" onClick={() => setViewMode("raw")}>
                    원본만
                </button>
                <button className="btn" onClick={() => setViewMode("grid")}>
                    Grid만
                </button>
                <button className="btn" onClick={() => setViewMode("overlay")}>
                    오버레이
                </button>

                <span style={{marginLeft: 10, opacity: 0.7, fontSize: 12}}>trail: {dynamicTrail}</span>
            </div>

            {/* ===== 상단: 레이더 + 비디오 ===== */}
            <div className="top-row">
                <div className="grid">
                    <RadarMapPlayer
                        ref={radarRef}
                        slices={slices}
                        className="card-box"
                        maxRangeKm={250}
                        ringStepKm={50}
                        trail={dynamicTrail}
                        secPerPacket={1.0}
                        latestCat="08"
                        stepMs={100}
                        centerLat={SEONGSAN.lat}
                        centerLon={SEONGSAN.lon}
                        viewMode={viewMode}
                        radarGrid={grids.radar}
                        showBaseMap={true}
                        controlsDisabled={lockControls}   // ✅ 추가
                    />

                    <div style={{position: "relative"}}>
                        <VideoScrubber
                            ref={videoRef}
                            className="card-box"
                            src={radarVideo}
                            manifest={manifest}
                            showClockTiny={true}
                            onFrameChange={handleVideoFrameChange}
                            viewMode={viewMode}
                            overlayGrid={grids.cloud}
                            playbackSpeed={0.7}
                            commonFrameRange={commonFrameRange}
                            loopCommonRange={true}
                            showDetectCircle={true}
                            detectCenter={{x: 0.408, y: 0.495}}
                            detectRadiusRatio={0.22}
                            mapOverlay={true}
                            mapCenter={{lat: SEONGSAN.lat, lon: SEONGSAN.lon}}
                            mapMaxRangeKm={250}
                            mapRingStepKm={50}
                        />

                        {/* ✅ 첫 바퀴 동안 조작 잠금 */}
                        {!historyLocked && (<div
                            style={{
                                position: "absolute",
                                inset: 0,
                                borderRadius: 12,
                                background: "rgba(0,0,0,0.35)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                textAlign: "center",
                                padding: 12,
                                fontSize: 12,
                                zIndex: 9999,
                                pointerEvents: "auto",
                            }}
                        >
                            그래프 수집 중… (첫 바퀴 끝나면 재생/스크럽 가능)
                        </div>)}
                    </div>
                </div>
            </div>

            <div className="bottom-row">
                <div className="card analysis-card">
                    <div className="card-header">분석 결과</div>
                    <div className="card-body">
                        {analysis ? (<>
                            <div style={{marginTop: 12}}>
                                <div style={{fontSize: 12, fontWeight: 600, marginBottom: 6, opacity: 0.9}}>
                                    시간별 전체 일치도(프레임 기준)
                                </div>
                                <MatchHistoryChart
                                    data={matchHistory}
                                    height={220}
                                    currentIdx={currentFrameIdx}
                                />
                            </div>

                            {/* ✅ 항상 보이는 게이지 */}
                            <div className="gauge-group">
                                <MatchGauge
                                    label={`전체 일치도 (${match}/${total || 0})`}
                                    valuePercent={analysis.overall_match_percent ?? Math.round((analysis.overall_match_ratio || 0) * 100)}
                                    hint="모든 셀에서 레이더/영상이 같은 값(0 또는 1)인 비율"
                                />

                                <MatchGauge
                                    label={`활성 영역 겹침도 (${tp}/${unionActive || 0})`}
                                    valuePercent={analysis.active_overlap_percent ?? Math.round((analysis.active_overlap_ratio || 0) * 100)}
                                    hint="둘 중 하나라도 1인 영역 중, 둘 다 1인 비율(겹치는 정도)"
                                />

                                <MatchGauge
                                    label={`정밀도(오탐 적을수록↑) (${tp}/${precDen || 0})`}
                                    valuePercent={analysis.radar_precision_percent ?? Math.round((analysis.radar_precision_vs_cloud || 0) * 100)}
                                    hint="레이더가 1이라고 한 것 중 실제로 영상도 1인 비율"
                                />

                                <MatchGauge
                                    label={`재현율(미탐 적을수록↑) (${tp}/${recallDen || 0})`}
                                    valuePercent={analysis.radar_recall_percent ?? Math.round((analysis.radar_recall_vs_cloud || 0) * 100)}
                                    hint="영상이 1인 것 중 레이더도 1로 잡은 비율"
                                />
                            </div>


                            {/* ✅ JSON만 접었다 펼치기 */}
                            <details style={{marginTop: 12}}>
                                <summary style={{cursor: "pointer", opacity: 0.85}}>
                                    원본 분석값(JSON) 보기
                                </summary>
                                <pre
                                    style={{
                                        marginTop: 8,
                                        margin: 0,
                                        fontSize: 11,
                                        opacity: 0.9,
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-word",
                                        border: "1px solid #222",
                                        borderRadius: 8,
                                        padding: 10,
                                        background: "#0c0c0c",
                                    }}
                                >
              {JSON.stringify(analysis, null, 2)}
            </pre>
                            </details>
                        </>) : (<p style={{opacity: 0.7, margin: 0}}>
                            아직 분석 결과가 없습니다. 레이더/영상 공통 구간이 계산되면 결과가 표시됩니다.
                        </p>)}
                    </div>
                </div>
            </div>
        </div>
    </div>);
}
