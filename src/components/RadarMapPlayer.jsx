// src/components/RadarMapPlayer.jsx
import React, {useEffect, useRef, useImperativeHandle, forwardRef, useState} from "react";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

import {pktTimesLiberal} from "../utils/radarTime";
import {useRadarData} from "../hooks/useRadarData";
import {usePlaybackController} from "../hooks/usePlaybackController";
import GridPreview from "./GridPreview";

// NM → m
const NM_TO_M = 1852.0;

// 레이더 탐지 범위 (60 NM)
const DETECT_RANGE_NM = 60;


// 레이더 중심(lat0, lon0)에서 bearing/거리로 목적지 좌표 계산 (Python dest_bulk와 동일 원리)
function destFromCenter(lat0Deg, lon0Deg, bearingDeg, distNm) {
    const R = 6371000.0;
    const distM = distNm * NM_TO_M;

    const lat0 = (lat0Deg * Math.PI) / 180;
    const lon0 = (lon0Deg * Math.PI) / 180;
    const brg = (bearingDeg * Math.PI) / 180;

    const d = distM / R;

    const sinLat0 = Math.sin(lat0);
    const cosLat0 = Math.cos(lat0);
    const sinD = Math.sin(d);
    const cosD = Math.cos(d);

    const sinLat2 = sinLat0 * cosD + cosLat0 * sinD * Math.cos(brg);
    const lat2 = Math.asin(sinLat2);

    const y = Math.sin(brg) * sinD * cosLat0;
    const x = cosD - sinLat0 * sinLat2;
    let lon2 = lon0 + Math.atan2(y, x);

    // -pi..pi wrap
    lon2 = ((lon2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;

    return {
        lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI,
    };
}


const RadarMapPlayer = forwardRef(function RadarMapPlayer({
                                                              jsonUrl,
                                                              slices = null,
                                                              maxRangeKm = 250,
                                                              ringStepKm = 50,
                                                              trail = 3,
                                                              controlsDisabled = false,
                                                              sampleStep = 1,
                                                              className = "",
                                                              latestCat = "08",
                                                              secPerPacket = 1.0,
                                                              stepMs = 100,
                                                              centerLat,
                                                              centerLon,

                                                              viewMode = "raw",
                                                              radarGrid = null,

                                                              showBaseMap = true,
                                                              onZoomChange,
                                                          }, ref) {
    const mapDivRef = useRef(null);
    const mapRef = useRef(null);
    const layersRef = useRef({static: null, data: null});
    const baseLayerRef = useRef(null);

    const maxRangeKmNum = Number(maxRangeKm);
    const ringStepKmNum = Number(ringStepKm);
    const [mapReady, setMapReady] = useState(false);
    const [gridOffset, setGridOffset] = useState({dx: 0, dy: 0});
    const {
        meta, byPkt, maxPkt, baseDateUTC, sopToDSec, loadErr, pktTimeline, sliceSummary
    } = useRadarData({jsonUrl, slices, latestCat});

    const {pkt, setPkt, playing, play, pause, toggle, next, prev} = usePlaybackController({max: maxPkt, stepMs});
    useEffect(() => {
        const map = mapRef.current;
        if (!mapReady || !map) return;
        if (!meta?.lat || !meta?.lon) return;

        let raf1 = 0;
        let raf2 = 0;

        const update = () => {
            try {
                map.invalidateSize(false);

                const radarPt = map.latLngToContainerPoint([meta.lat, meta.lon]);
                const size = map.getSize();
                const center = L.point(size.x / 2, size.y / 2);

                setGridOffset({
                    dx: radarPt.x - center.x, dy: radarPt.y - center.y,
                });
            } catch {
            }
        };

        const updateStable = () => {
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
            raf1 = requestAnimationFrame(() => {
                raf2 = requestAnimationFrame(update);
            });
        };

        // ✅ 최초 1회 확정 계산
        updateStable();

        map.on("moveend", updateStable);
        map.on("zoomend", updateStable);
        map.on("load", updateStable);

        return () => {
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
            map.off("moveend", updateStable);
            map.off("zoomend", updateStable);
            map.off("load", updateStable);
        };
    }, [mapReady, meta?.lat, meta?.lon]);


    // -----------------------------
    //  Leaflet map 초기화
    // -----------------------------
    useEffect(() => {
        if (!mapDivRef.current || !meta) return;
        if (mapRef.current) return;

        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
            iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
            iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
            shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        });

        const map = L.map(mapDivRef.current, {
            center: [centerLat ?? meta.lat, centerLon ?? meta.lon],
            zoom: 9,
            zoomControl: false,
            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
            tap: false,
            preferCanvas: true,
            zoomSnap: 0.1,
            zoomDelta: 0.1,
        });
        mapRef.current = map;

        const baseLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
            subdomains: "abcd", maxZoom: 20,
        }).addTo(map);
        baseLayerRef.current = baseLayer;

        const staticGroup = L.layerGroup().addTo(map);
        const dataGroup = L.layerGroup().addTo(map);
        layersRef.current.static = staticGroup;
        layersRef.current.data = dataGroup;

        const mapCenterLat = (centerLat ?? meta.lat);
        const mapCenterLon = (centerLon ?? meta.lon);

        const outerCircle = L.circle([mapCenterLat, mapCenterLon], {
            radius: maxRangeKmNum * 1000,
        }).addTo(map);

        map.fitBounds(outerCircle.getBounds(), {padding: [6, 6]});
        map.whenReady(() => {
            map.invalidateSize(false);
            setMapReady(true);
        });
        outerCircle.remove();
    }, [meta, maxRangeKmNum, ringStepKmNum, centerLat, centerLon]);

    // -----------------------------
    // Base map on/off
    // -----------------------------

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const baseLayer = baseLayerRef.current;
        const dataGroup = layersRef.current.data;

        const gridOnly = (viewMode === "grid");

        // 1) 지도 타일 끄기 (grid-only에서는 무조건 OFF)
        if (gridOnly) {
            if (baseLayer && map.hasLayer(baseLayer)) baseLayer.remove();
        } else {
            // grid-only가 아니면 기존 showBaseMap 정책대로 복원
            if (showBaseMap) {
                if (baseLayer && !map.hasLayer(baseLayer)) baseLayer.addTo(map);
            }
        }

        // 2) CAT-08 데이터 레이어 끄기 (grid-only에서는 무조건 OFF)
        if (dataGroup) {
            if (gridOnly) {
                if (map.hasLayer(dataGroup)) map.removeLayer(dataGroup);
                dataGroup.clearLayers(); // 남아있는 polyline도 제거
            } else {
                if (!map.hasLayer(dataGroup)) dataGroup.addTo(map);
            }
        }
    }, [viewMode, showBaseMap]);


    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        let baseLayer = baseLayerRef.current;
        const create = () => L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
            subdomains: "abcd", maxZoom: 20,
        });

        if (showBaseMap) {
            if (!baseLayer) {
                baseLayer = create();
                baseLayer.addTo(map);
                baseLayerRef.current = baseLayer;
            } else if (!map.hasLayer(baseLayer)) {
                baseLayer.addTo(map);
            }
        } else {
            if (baseLayer && map.hasLayer(baseLayer)) baseLayer.remove();
        }
    }, [showBaseMap]);
// 링 (맵 중심 기준 + 레이더 기준 탐지범위)
// -----------------------------
    useEffect(() => {
        const staticGroup = layersRef.current.static;
        if (!staticGroup) return;

        // ⚪ 회색 링/지도 중심 = 성산(넘겨준 centerLat/Lon) 우선
        const cx = (centerLat ?? meta?.lat);
        const cy = (centerLon ?? meta?.lon);

// 🔴 빨간 60NM 원 중심 = 우리 레이더(meta) 고정
        const radarLat = meta?.lat;
        const radarLon = meta?.lon;

        if (cx == null || cy == null || radarLat == null || radarLon == null) return;

        staticGroup.clearLayers();

        // 🔴 60NM 레이더 탐지범위 원: 표시 모드 / 베이스맵 여부와 무관하게 항상 그림
        const detectRadiusM = DETECT_RANGE_NM * NM_TO_M;
        L.circle([radarLat, radarLon], {
            radius: detectRadiusM, color: "#ff0000", weight: 2, opacity: 0.9, fill: false,
        }).addTo(staticGroup);

        // 회색 range 링들은 베이스맵 있을 때만
        if (showBaseMap) {
            for (let km = ringStepKmNum; km <= maxRangeKmNum; km += ringStepKmNum) {
                L.circle([cx, cy], {
                    radius: km * 1000, color: "#666", weight: 1, opacity: 0.4, fill: false, dashArray: "4,4",
                }).addTo(staticGroup);
            }
        }
    }, [meta, showBaseMap, maxRangeKmNum, ringStepKmNum, centerLat, centerLon]);
    // 시간 계산 (패킷 → 시간)
    // -----------------------------
    const computeTimeInfo = (packetIndex) => {
        if (!pktTimeline?.length || !baseDateUTC) return null;
        if (!maxPkt) return null;

        const safe = Math.max(1, Math.min(packetIndex, maxPkt));
        const chunk = pktTimeline.find((c) => safe >= c.startPkt && safe <= c.endPkt);
        if (!chunk) return null;

        const spanPkt = Math.max(1, chunk.endPkt - chunk.startPkt);
        const ratio = (safe - chunk.startPkt) / spanPkt;

        const offsetInChunk = ratio * chunk.durationSec;
        const offsetSec = chunk.startSec + offsetInChunk;

        return pktTimesLiberal(baseDateUTC, sopToDSec, 1 + offsetSec, 1);
    };

    // -----------------------------
    // CAT-08 세그먼트 그리기
    // -----------------------------
    const drawWindow = (pktStart, pktEnd) => {
        if (!layersRef.current.data || !meta) return;
        const g = layersRef.current.data;
        g.clearLayers();

        // intensity 0~15 색상 맵
        const palette = {
            0: "#00FF00",
            1: "#32CD32",
            2: "#1E90FF",
            3: "#FFA500",
            4: "#FF4500",
            5: "#FF0000",
            6: "#8A2BE2",
            7: "#00CED1",
            8: "#FFD700",
            9: "#FF1493",
            10: "#ADFF2F",
            11: "#00BFFF",
            12: "#FF69B4",
            13: "#E6E6FA",
            14: "#7FFFD4",
            15: "#F08080",
        };

        const tt = computeTimeInfo(pktEnd);
        const tlabel = tt ? `\nKST ${tt.kst}` : "";

        const radarLat = meta.lat;
        const radarLon = meta.lon;

        for (let p = pktStart; p <= pktEnd; p++) {
            const arr = byPkt?.[p];
            if (!arr) continue;

            for (let i = 0; i < arr.length; i += Math.max(1, sampleStep)) {
                const s = arr[i];
                if (!Array.isArray(s) || s.length < 5) continue;

                const [pktIndex, ci, angleDeg, startNm, endNm] = s;

                const color = palette[ci] || "#32CD32";

                // NM → km 단순 변환 (1 NM = 1.852 km)
                const startKm = startNm * 1.852;
                const endKm = endNm * 1.852;

                // 시작점 / 끝점 위·경도 계산
                const {lat: sLat, lon: sLon} = destFromCenter(radarLat, radarLon, angleDeg, startNm);
                const {lat: eLat, lon: eLon} = destFromCenter(radarLat, radarLon, angleDeg, endNm);

                const poly = L.polyline([[sLat, sLon], [eLat, eLon],], {color, weight: 2, opacity: 0.9}).addTo(g);

                poly.bindTooltip(`Pkt ${p} | θ ${Number(angleDeg).toFixed(2)}° | ${startKm.toFixed(1)}~${endKm.toFixed(1)} km${tlabel}`, {sticky: true});
            }
        }
    };

    // 패킷 변경 시 그림 갱신
    useEffect(() => {
        if (viewMode === "grid") return;
        if (!maxPkt || !meta || !byPkt) return;
        const safe = Math.max(1, Math.min(pkt, maxPkt));
        const start = Math.max(1, safe - (trail - 1));
        drawWindow(start, safe);
    }, [viewMode, pkt, trail, sampleStep, maxPkt, meta, byPkt, baseDateUTC, sopToDSec, pktTimeline]);

    // -----------------------------
    // 외부로 내보내는 메서드들
    // -----------------------------
    useImperativeHandle(ref, () => ({
        maxPacket: () => maxPkt,
        setPacket: (p) => setPkt(() => Math.max(1, Math.min(p | 0, maxPkt || 1))),
        getPacket: () => pkt,
        getSliceSummary: () => sliceSummary,
        next,
        prev,
        play,
        pause,
        toggle,
        getSegments: (p) => byPkt?.[p] || [],
        getMeta: () => meta,

        getRawRangeKst: () => {
            if (!maxPkt) return null;
            const first = computeTimeInfo(1);
            const last = computeTimeInfo(maxPkt);
            if (!first || !last) return null;
            return {
                startKst: first.kst, endKst: last.kst,
            };
        },

        getPacketTimeKst: (p) => {
            const t = computeTimeInfo(p);
            return t?.kst || null;
        },
    }));

    const headerTime = (() => {
        const t = computeTimeInfo(pkt);
        return t ? `KST ${t.kst}` : "시간정보 없음";
    })();

    return (<div className={`card ${className}`}>
        <div className="card-header">
            CAT-08 재생 ({maxRangeKmNum} km)
            <span style={{float: "right", opacity: 0.85}}>{headerTime}</span>
        </div>

        <div className="card-body">
            {loadErr && (<div className="warn" style={{marginBottom: 8}}>
                JSON 로드 실패: {loadErr}
            </div>)}

            <div
                style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: "1/1",
                    borderRadius: 12,
                    overflow: "hidden",
                    border: "1px solid #333",
                }}
            >
                <div
                    ref={mapDivRef}
                    style={{
                        width: "100%", height: "100%", opacity: 1, transition: "opacity 0.2s",
                    }}
                />

                {radarGrid && viewMode !== "raw" && (
                    <GridPreview
                        grid={radarGrid}
                        size={radarGrid.length}
                        activeColor="rgba(255,0,0,0.5)"
                        cellBorder="rgba(255,255,255,0.5)"
                        style={{
                            zIndex: 500,
                            opacity: viewMode === "overlay" ? 0.35 : 1,
                        }}
                    />
                )}

            </div>

            <div style={{marginTop: 10, display: "grid", gap: 8}}>
                <div style={{display: "flex", gap: 8, alignItems: "center"}}>
                    <button className="btn" onClick={prev} disabled={!maxPkt}>
                        ⟨ 이전
                    </button>
                    <button className="btn" onClick={toggle} disabled={!maxPkt}>
                        {playing ? "⟨⏸ 일시정지" : "▶ 재생"}
                    </button>
                    <button className="btn" onClick={next} disabled={!maxPkt}>
                        다음 ⟩
                    </button>

                    <div style={{marginLeft: "auto", opacity: 0.85}}>
                        {pkt} / {maxPkt || 1}
                    </div>
                </div>

                <input
                    type="range"
                    min={1}
                    max={Math.max(1, maxPkt)}
                    value={pkt}
                    disabled={controlsDisabled}   // ✅ 추가
                    onChange={(e) => {
                        pause();
                        setPkt(parseInt(e.target.value, 10));
                    }}
                />
            </div>
        </div>
    </div>);
});

export default RadarMapPlayer;
