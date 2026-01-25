// src/components/VideoScrubber.jsx
import React, {
    useEffect, useRef, useState, useImperativeHandle, forwardRef, useMemo,
} from "react";
import GridPreview from "./GridPreview";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

function formatIsoUtcToKstClock(isoUtc) {
    if (!isoUtc) return "";
    const d = new Date(isoUtc);
    return new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(d);
}

const VideoScrubber = forwardRef(function VideoScrubber({
                                                            src,
                                                            className = "",

                                                            // ✅ manifest JSON ( { frames: [{t,img,src}, ...], ... } )
                                                            manifest = null,

                                                            showClockTiny = false,
                                                            onFrameChange,

                                                            viewMode = "raw",
                                                            overlayGrid = null,

                                                            playbackSpeed = 2,

                                                            commonFrameRange = null,
                                                            loopCommonRange = false,

                                                            // ✅ 비디오 위 Leaflet 지도 오버레이
                                                            mapOverlay = false,
                                                            mapCenter = null, // {lat, lon}
                                                            mapMaxRangeKm = 250,
                                                            mapRingStepKm = 50,
                                                            mapOpacity = 0.55, // (옵션) 지도 투명도
                                                            mapZoom = null, // 🔴 레이더 60NM 표시용
                                                            showDetectCircle = false,
                                                            detectCenter = {x: 0.5, y: 0.5},
                                                            detectRadiusRatio = 0.35,
                                                        }, ref) {
    const videoRef = useRef(null);
    const timerRef = useRef(null);
    const containerRef = useRef(null);
    const mapContainerElRef = useRef(null); // ✅ 맵이 붙어있는 실제 DOM 기억
    const keyCanvasRef = useRef(null);
    const rafRef = useRef(null);
    // leaflet overlay
    const mapHostRef = useRef(null);
    const mapRef = useRef(null);
    const ringsLayerRef = useRef(null);

    const [supported, setSupported] = useState(true);
    const [errMsg, setErrMsg] = useState("");
    const [ready, setReady] = useState(false);

    const [duration, setDuration] = useState(0);
    const [frameCount, setFrameCount] = useState(1);
    const [idx, setIdx] = useState(0);
    const [playing, setPlaying] = useState(false);


    // 비디오가 contain으로 그려지는 실제 박스(레터박스 제외) 계산
    const [videoBox, setVideoBox] = useState({left: 0, top: 0, width: 0, height: 0});

    const frames = manifest?.frames;

    const manifestFrameCount = useMemo(() => {
        if (!Array.isArray(frames) || frames.length === 0) return 1;
        return frames.length;
    }, [frames]);

    useEffect(() => {
        const v = document.createElement("video");
        const ok = v.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
        if (!ok) setSupported(false);
    }, []);

    const onLoadedMetadata = () => {
        const dur = videoRef.current?.duration ?? 0;
        setDuration(dur);
        setFrameCount(Math.max(1, manifestFrameCount));
        setIdx(0);
        setReady(true);
        if (videoRef.current) videoRef.current.currentTime = 0;
    };

    useEffect(() => {
        setFrameCount(Math.max(1, manifestFrameCount));
        setIdx(0);
        if (videoRef.current) videoRef.current.currentTime = 0;
    }, [manifestFrameCount]);

    const onError = () => {
        const err = videoRef.current?.error;
        console.error("VIDEO ERROR:", err);
        let msg = "알 수 없는 재생 오류";
        if (err) {
            switch (err.code) {
                case 1:
                    msg = "사용자 중단";
                    break;
                case 2:
                    msg = "네트워크 오류";
                    break;
                case 3:
                    msg = "디코딩 오류 (코덱 가능성 높음)";
                    break;
                case 4:
                    msg = "소스 불가(경로/코덱)";
                    break;
                default:
                    break;
            }
        }
        setErrMsg(`${msg}. 비디오 파일 경로(src/assets 또는 public)를 확인하고 ` + `H.264(AAC, yuv420p) 코덱으로 인코딩되어 있는지 확인하세요.`);
    };

    const idxToVideoTime = (i) => {
        const fc = Math.max(1, frameCount);
        if (!duration || fc <= 1) return 0;
        const step = duration / (fc - 1);
        return Math.max(0, Math.min(duration, i * step));
    };

    const gotoFrame = (nextIdx) => {
        const clamped = Math.max(0, Math.min(nextIdx | 0, (frameCount - 1) | 0));
        setIdx(clamped);
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = idxToVideoTime(clamped);
        }
    };

    const pause = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setPlaying(false);
    };

    const prev = () => {
        if (!ready) return;
        pause();
        gotoFrame(idx - 1);
    };

    const next = () => {
        if (!ready) return;
        pause();
        gotoFrame(idx + 1);
    };

    const play = () => {
        if (!ready || playing) return;

        // 공통구간 밖이면 공통구간 시작으로 점프
        let startIdx = idx;
        if (loopCommonRange && commonFrameRange) {
            const {startFrame, endFrame} = commonFrameRange;
            if (startFrame != null && endFrame != null) {
                if (startIdx < startFrame || startIdx > endFrame) {
                    startIdx = startFrame;
                }
            }
        }
        gotoFrame(startIdx);

        setPlaying(true);

        const BASE_FPS = 10;
        const safeSpeed = Math.max(0.1, playbackSpeed);
        const intervalMs = Math.max(15, 1000 / (BASE_FPS * safeSpeed));
        timerRef.current = setInterval(() => {
            setIdx((cur) => {
                let n = cur + 1;

                let start = 0;
                let end = frameCount - 1;

                if (loopCommonRange && commonFrameRange) {
                    if (typeof commonFrameRange.startFrame === "number") start = commonFrameRange.startFrame;
                    if (typeof commonFrameRange.endFrame === "number") end = commonFrameRange.endFrame;
                }

                if (n > end) n = start;

                if (videoRef.current) {
                    videoRef.current.pause();
                    videoRef.current.currentTime = idxToVideoTime(n);
                }

                return n;
            });
        }, intervalMs);
    };

    const toggle = () => (playing ? pause() : play());

    // idx 변경 시 부모에 알림
    useEffect(() => {
        if (!ready) return;
        if (typeof onFrameChange === "function") {
            const frameInfo = Array.isArray(frames) ? frames[idx] : null;
            onFrameChange(idx, frameInfo);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idx, ready]);

    // 현재 비디오 프레임 캡처
    const captureImage = () => {
        const video = videoRef.current;
        if (!video) return null;
        const w = video.videoWidth || 0;
        const h = video.videoHeight || 0;
        if (!w || !h) return null;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h);
    };

    useImperativeHandle(ref, () => ({
        play,
        pause,
        toggle,
        isPaused: () => !playing,
        getFrameIndex: () => idx,
        getFrameCount: () => frameCount,
        isReady: () => ready,
        captureImage,
        seekFrame: (i) => gotoFrame(i),
    }));

    useEffect(() => () => pause(), []);

    const tinyClock = useMemo(() => {
        if (!showClockTiny || !ready) return "";
        const t = Array.isArray(frames) ? frames[idx]?.t : null;
        return formatIsoUtcToKstClock(t);
    }, [showClockTiny, ready, idx, frames]);
    const showGridOnly = viewMode === "grid";
    const showGrid = overlayGrid && viewMode !== "raw";
    // ===== 비디오 실제 렌더 박스 계산 (contain 기준) =====
    const computeVideoBox = () => {
        const video = videoRef.current;
        const container = containerRef.current;
        if (!video || !container) return null;

        const rect = container.getBoundingClientRect();
        const containerW = rect.width;
        const containerH = rect.height;

        const videoW = video.videoWidth;
        const videoH = video.videoHeight;
        if (!videoW || !videoH) return null;

        const scale = Math.min(containerW / videoW, containerH / videoH);
        const renderW = videoW * scale;
        const renderH = videoH * scale;
        const offsetX = (containerW - renderW) / 2;
        const offsetY = (containerH - renderH) / 2;

        return {left: offsetX, top: offsetY, width: renderW, height: renderH};
    };

    useEffect(() => {
        const update = () => {
            const b = computeVideoBox();
            if (b) setVideoBox(b);
        };
        update();

        const ro = new ResizeObserver(update);
        if (containerRef.current) ro.observe(containerRef.current);

        window.addEventListener("resize", update);
        return () => {
            ro.disconnect();
            window.removeEventListener("resize", update);
        };
    }, [ready, src]);

    // ===== Leaflet overlay 생성/업데이트 =====
    useEffect(() => {
        if (!mapOverlay) return;
        if (!ready) return;
        if (!Number.isFinite(mapCenter?.lat) || !Number.isFinite(mapCenter?.lon)) return;
        if (!mapHostRef.current) return;
        if (!videoBox.width || !videoBox.height) return;

        const hostEl = mapHostRef.current;

        // ✅ (중요) mapRef는 남아있는데 DOM이 바뀐 경우 => 반드시 제거 후 재생성
        if (mapRef.current && mapContainerElRef.current !== hostEl) {
            try {
                mapRef.current.remove();
            } catch (e) {
                // ignore
            }
            mapRef.current = null;
            ringsLayerRef.current = null;
        }

        // ✅ 최초 생성
        if (!mapRef.current) {
            // ✅ (중요) Leaflet이 DOM에 _leaflet_id 남겨둔 경우 방지
            if (hostEl._leaflet_id) {
                hostEl._leaflet_id = null;
                hostEl.innerHTML = "";
            }

            const map = L.map(hostEl, {
                center: [mapCenter.lat, mapCenter.lon],
                zoom: 9,
                zoomControl: false,
                dragging: false,
                scrollWheelZoom: false,
                doubleClickZoom: false,
                boxZoom: false,
                keyboard: false,
                tap: false,
                preferCanvas: true,
                attributionControl: false,
                zoomSnap: 0.1,
                zoomDelta: 0.1,
            });

            mapRef.current = map;
            mapContainerElRef.current = hostEl;

            L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
                subdomains: "abcd", maxZoom: 20,
            }).addTo(map);

            ringsLayerRef.current = L.layerGroup().addTo(map);
        }

        const map = mapRef.current;
        const rings = ringsLayerRef.current;

        // ✅ 링 다시 그리기
        if (rings) {
            rings.clearLayers();
            for (let km = mapRingStepKm; km <= mapMaxRangeKm; km += mapRingStepKm) {
                L.circle([mapCenter.lat, mapCenter.lon], {
                    radius: km * 1000, color: "#666", weight: 1, opacity: 0.45, fill: false, dashArray: "4,4",
                }).addTo(rings);
            }
        }

        // ✅ 사이즈 반영 (DOM 배치 이후)
        requestAnimationFrame(() => {
            try {
                map.invalidateSize();

                if (typeof mapZoom === "number") {
                    // ✅ 줌 고정 모드
                    map.setView([mapCenter.lat, mapCenter.lon], mapZoom, {animate: false});
                } else {
                    // ✅ 왼쪽(RadarMapPlayer)과 동일: 반경이 화면에 꽉 차게
                    const outer = L.circle([mapCenter.lat, mapCenter.lon], {radius: mapMaxRangeKm * 1000}).addTo(map);
                    map.fitBounds(outer.getBounds(), {padding: [6, 6]});
                    outer.remove();
                }
            } catch (e) {
                // ignore
            }
        });
    }, [mapOverlay, ready, mapCenter?.lat, mapCenter?.lon, mapMaxRangeKm, mapRingStepKm, videoBox.width, videoBox.height, mapZoom,]);


    useEffect(() => {
        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
                ringsLayerRef.current = null;
            }
        };
    }, []);
    useEffect(() => {
        if (!ready) return;
        if (viewMode === "grid") return; // ✅ 추가: grid-only면 캔버스 렌더 자체를 안 함

        const video = videoRef.current;
        const canvas = keyCanvasRef.current;
        const container = containerRef.current;
        if (!video || !canvas || !container) return;

        const ctx = canvas.getContext("2d", {willReadFrequently: true});
        const THRESH = 35;

        const render = () => {
            const rect = container.getBoundingClientRect();
            const cw = Math.max(1, Math.floor(rect.width));
            const ch = Math.max(1, Math.floor(rect.height));
            if (canvas.width !== cw || canvas.height !== ch) {
                canvas.width = cw;
                canvas.height = ch;
            }

            const vw = video.videoWidth || 0;
            const vh = video.videoHeight || 0;
            if (!vw || !vh) {
                rafRef.current = requestAnimationFrame(render);
                return;
            }

            const scale = Math.min(cw / vw, ch / vh);
            const VIDEO_SCALE = 0.96;
            const rw = vw * scale * VIDEO_SCALE;
            const rh = vh * scale * VIDEO_SCALE;
            const ox = (cw - rw) / 2;
            const oy = (ch - rh) / 2;

            ctx.clearRect(0, 0, cw, ch);
            ctx.drawImage(video, ox, oy, rw, rh);

            const img = ctx.getImageData(0, 0, cw, ch);
            const d = img.data;
            for (let i = 0; i < d.length; i += 4) {
                const r = d[i], g = d[i + 1], b = d[i + 2];
                const lum = (r + g + b) / 3;
                if (lum < THRESH) d[i + 3] = 0;
            }
            ctx.putImageData(img, 0, 0);

            rafRef.current = requestAnimationFrame(render);
        };

        rafRef.current = requestAnimationFrame(render);

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        };
    }, [ready, src, viewMode]); // ✅ viewMode 추가


    return (<div className={`card ${className}`}>
        <div className="card-header">
            동영상 재생
            <span style={{float: "right", opacity: 0.85}}>
          {ready ? `${idx + 1} / ${frameCount}` : "0 / 0"}
                {tinyClock ? (<span style={{marginLeft: 8, fontSize: 12, opacity: 0.75}}>({tinyClock})</span>) : null}
        </span>
        </div>

        <div className="card-body">
            {!supported && (<div className="warn" style={{marginBottom: 8}}>
                브라우저가 H.264/AAC MP4를 지원하지 않습니다. 파일을 재인코딩하세요.
            </div>)}
            {errMsg && (<div className="warn" style={{marginBottom: 8}}>
                {errMsg}
            </div>)}

            <div
                ref={containerRef}
                style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: "1 / 1",
                    borderRadius: 12,
                    overflow: "hidden",
                    border: "1px solid #333",
                    background: "#000",
                    cursor: "crosshair",
                }}
            >
                <video
                    ref={videoRef}
                    src={src}
                    playsInline
                    onError={onError}
                    onLoadedMetadata={onLoadedMetadata}
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        display: "block",
                        opacity: showGridOnly ? 0 : 1,
                        pointerEvents: "none", // ✅ 클릭 방지
                    }}
                />

                <canvas
                    ref={keyCanvasRef}
                    style={{
                        position: "absolute", left: 0, top: 0, width: "100%", height: "100%", zIndex: 20,          // ✅ 지도(예: 10)보다 위, detectCircle(40)보다 아래로 적당히
                        pointerEvents: "none", display: showGridOnly ? "none" : "block",  // ✅ 핵심
                    }}
                />
                {/* ✅ Leaflet 지도 오버레이 (비디오 실제 표시 영역에만) */}
                {mapOverlay && (<div style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: "100%",
                    height: "100%",
                    zIndex: 10,
                    pointerEvents: "none",
                    opacity: showGridOnly ? 0 : 1,     // ✅ 추가
                }}>
                    <div ref={mapHostRef} style={{width: "100%", height: "100%"}}/>
                </div>)}


                {showGrid && (<GridPreview
                    grid={overlayGrid}
                    size={overlayGrid.length}
                    activeColor="rgba(255,180,0,0.45)"
                    style={{zIndex: 35, pointerEvents: "none"}}
                />)}
                {showDetectCircle && detectCenter && (<div
                    style={{
                        position: "absolute",
                        left: `${(detectCenter.x ?? 0.5) * 100}%`,
                        top: `${(detectCenter.y ?? 0.5) * 100}%`,
                        transform: "translate(-50%, -50%)",
                        width: `${detectRadiusRatio * 2 * 100}%`,
                        height: `${detectRadiusRatio * 2 * 100}%`,
                        borderRadius: "50%",
                        border: "2px solid red",
                        boxShadow: "0 0 8px rgba(255,0,0,0.6)",
                        pointerEvents: "none",
                        zIndex: 40,
                    }}
                />)}
            </div>

            <div style={{marginTop: 10, display: "grid", gap: 8}}>
                <div style={{display: "flex", gap: 8, alignItems: "center"}}>
                    <button className="btn" onClick={prev} disabled={!ready}>
                        ⟨ 이전
                    </button>
                    <button className="btn" onClick={toggle} disabled={!ready}>
                        {playing ? "⏸ 일시정지" : "▶ 재생"}
                    </button>
                    <button className="btn" onClick={next} disabled={!ready}>
                        다음 ⟩
                    </button>
                </div>

                <input
                    type="range"
                    min={0}
                    max={Math.max(0, frameCount - 1)}
                    value={idx}
                    onChange={(e) => gotoFrame(parseInt(e.target.value, 10))}
                    disabled={!ready}
                />
            </div>


        </div>
    </div>);
});

export default VideoScrubber;
