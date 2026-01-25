// src/hooks/useRadarData.js
import {useEffect, useMemo, useState} from "react";
import {inferBaseDateFromName} from "../utils/radarTime.js";

const jsonModules = import.meta.glob("../assets/data/*.json");

function basename(p) {
    return (p || "").split("/").pop() || "";
}

function resolveLocalJsonModuleByFile(fileName) {
    const entries = Object.entries(jsonModules);
    for (const [path, loader] of entries) {
        if (basename(path) === fileName) return {path, loader};
    }
    return null;
}

function parseRdmName(name) {
    const m = name.match(/RDM_[A-Z](\d{8})(\d{2})_cat(\d+)/i);
    if (!m) return null;
    const [, ymd, hhCode, catNum] = m;
    const yyyy = ymd.slice(0, 4);
    const mm = ymd.slice(4, 6);
    const dd = ymd.slice(6, 8);
    return {
        dateStr: `${yyyy}-${mm}-${dd}`, ts: Date.parse(`${yyyy}-${mm}-${dd}`), chunk: Number(hhCode), // 00 or 01
        cat: catNum,
    };
}

function kstToMs(kstStr) {
    if (!kstStr) return NaN;
    const s = String(kstStr).trim();
    const [d, t = "00:00:00"] = s.split(" ");
    return Date.parse(`${d}T${t}+09:00`);
}

// 12시간 파일의 "원래 구간" 정의 (chunk 00/01)
function chunkFullRangeSec(chunk, dayStr) {
    if (chunk === 0 || chunk === "00") {
        // 09:00 ~ 21:00
        const s = Date.parse(`${dayStr}T09:00:00+09:00`);
        const e = Date.parse(`${dayStr}T21:00:00+09:00`);
        return {fullStartMs: s, fullEndMs: e};
    }
    // chunk 01: 21:00 ~ next day 09:00
    const s = Date.parse(`${dayStr}T21:00:00+09:00`);
    const e = Date.parse(`${dayStr}T09:00:00+09:00`) + 24 * 3600 * 1000;
    return {fullStartMs: s, fullEndMs: e};
}

// slice 사용구간을 fullRange 대비 [0..1] 비율로 환산
function sliceToFrac({sliceStartMs, sliceEndMs, fullStartMs, fullEndMs}) {
    const fullDur = fullEndMs - fullStartMs;
    if (!(fullDur > 0)) return null;

    const s = Math.max(fullStartMs, Math.min(sliceStartMs, fullEndMs));
    const e = Math.max(fullStartMs, Math.min(sliceEndMs, fullEndMs));
    if (!(e > s)) return null;

    const a = (s - fullStartMs) / fullDur;
    const b = (e - fullStartMs) / fullDur;
    return {a, b};
}

// origPkt 범위 계산 (1..localMax)
function fracToPktRange(a, b, localMax) {
    const N = Math.max(1, localMax | 0);
    const start = Math.max(1, Math.min(N, Math.ceil(a * N)));
    const end = Math.max(1, Math.min(N, Math.floor(b * N)));
    if (start > end) return null;
    return {start, end};
}

function dayWindowMs(dayStr) {
    const start = Date.parse(`${dayStr}T00:00:00+09:00`);
    const end = start + 24 * 3600 * 1000;
    return {start, end};
}

// ms -> "YYYY-MM-DD HH:MM:SS" (KST)
function msToKstStr(ms) {
    const k = new Date(ms + 9 * 3600 * 1000);
    const y = k.getUTCFullYear();
    const m = String(k.getUTCMonth() + 1).padStart(2, "0");
    const d = String(k.getUTCDate()).padStart(2, "0");
    const h = String(k.getUTCHours()).padStart(2, "0");
    const mi = String(k.getUTCMinutes()).padStart(2, "0");
    const s = String(k.getUTCSeconds()).padStart(2, "0");
    return `${y}-${m}-${d} ${h}:${mi}:${s}`;
}

function pickTargetDayFromLoaded(loadedList) {
    const days = loadedList
        .map((x) => x.parsed?.dateStr)
        .filter(Boolean)
        .sort(); // YYYY-MM-DD라 문자열 정렬=시간 정렬
    return days.length ? days[days.length - 1] : null; // 최신 날짜
}

// ✅ 타겟 날짜 하루(00~24)와 겹치는 부분만 slice 자동 생성
function buildAutoSlicesForDay(loadedList, targetDayStr) {
    const {start: winS, end: winE} = dayWindowMs(targetDayStr);

    const out = [];
    for (const item of loadedList) {
        const p = item.parsed;
        if (!p?.dateStr || !Number.isFinite(p.chunk)) continue;

        const {fullStartMs, fullEndMs} = chunkFullRangeSec(p.chunk, p.dateStr);

        const s = Math.max(winS, fullStartMs);
        const e = Math.min(winE, fullEndMs);
        if (!(e > s)) continue;

        out.push({
            file: item.srcName,
            chunk: p.chunk,
            startKst: msToKstStr(s),
            endKst: msToKstStr(e),
        });
    }

    out.sort((a, b) => kstToMs(a.startKst) - kstToMs(b.startKst));
    return out.length ? out : null;
}


export function useRadarData({
                                 jsonUrl, slices = null, latestCat = "08", centerLat, centerLon,
                             }) {
    const [meta, setMeta] = useState(null);
    const [byPkt, setByPkt] = useState({});
    const [maxPkt, setMaxPkt] = useState(1);
    const [baseDateUTC, setBaseDateUTC] = useState(null);
    const [sopToDSec, setSopToDSec] = useState(null);
    const [loadErr, setLoadErr] = useState("");
    const [pktTimeline, setPktTimeline] = useState([]);
    const [sliceSummary, setSliceSummary] = useState(null);

    const externalUrls = useMemo(() => {
        if (!jsonUrl) return null;
        return Array.isArray(jsonUrl) ? jsonUrl : [jsonUrl];
    }, [jsonUrl]);

    const normalizedSlices = useMemo(() => {
        if (!slices) return null;
        const arr = Array.isArray(slices) ? slices : [];
        const cleaned = arr
            .map((x) => ({
                file: x?.file, url: x?.url, startKst: x?.startKst, endKst: x?.endKst, chunk: x?.chunk,
            }))
            .filter((x) => (x.file || x.url) && x.startKst && x.endKst);

        cleaned.sort((a, b) => kstToMs(a.startKst) - kstToMs(b.startKst));
        return cleaned.length ? cleaned : null;
    }, [slices]);

    const latestPaths = useMemo(() => {
        const entries = Object.entries(jsonModules);
        if (!entries.length) return [];

        const token = latestCat ? `cat${latestCat}` : "";
        const filtered = entries.filter(([p]) => p.includes(token));
        const candidates = filtered.length ? filtered : entries;

        const groups = new Map();
        for (const [path] of candidates) {
            const name = path.split("/").pop() || "";
            const info = parseRdmName(name);
            if (!info || !Number.isFinite(info.ts)) continue;
            let g = groups.get(info.dateStr);
            if (!g) groups.set(info.dateStr, (g = {ts: info.ts, items: []}));
            g.items.push({path, chunk: info.chunk});
        }

        if (groups.size === 0) {
            const dated = candidates
                .map(([path]) => {
                    const name = path.split("/").pop() || "";
                    const d = inferBaseDateFromName(name);
                    const ts = d ? Date.parse(d) : NaN;
                    return {path, ts};
                })
                .filter((x) => Number.isFinite(x.ts));

            if (!dated.length) return candidates.slice(-2).map(([p]) => p);
            dated.sort((a, b) => a.ts - b.ts);
            return dated.slice(-2).map((x) => x.path);
        }

        const arr = Array.from(groups.values()).sort((a, b) => a.ts - b.ts);
        const latest = arr[arr.length - 1];
        latest.items.sort((a, b) => a.chunk - b.chunk);
        return latest.items.map((x) => x.path);
    }, [latestCat]);

    useEffect(() => {
        let alive = true;

        (async () => {
            try {
                setLoadErr("");
                setSliceSummary(null);

                const loadedList = [];

                if (normalizedSlices?.length) {
                    for (const s of normalizedSlices) {
                        let j = null;
                        let srcName = "";

                        if (s.file) {
                            const hit = resolveLocalJsonModuleByFile(s.file);
                            if (!hit) {
                                throw new Error(`로컬 JSON 매칭 실패: ${s.file} (src/assets/data에 있는지 확인)`);
                            }
                            const mod = await hit.loader();
                            j = mod.default;
                            srcName = s.file;
                        } else if (s.url) {
                            const res = await fetch(s.url, {cache: "no-cache"});
                            if (!res.ok) throw new Error(`Fetch 실패: ${res.status} (${s.url})`);
                            j = await res.json();
                            srcName = s.url.split("/").pop() || "";
                        } else {
                            throw new Error("slice에 file 또는 url이 필요합니다.");
                        }

                        loadedList.push({
                            j, srcName, slice: s, parsed: parseRdmName(srcName),
                        });
                    }
                } else if (externalUrls?.length) {
                    for (const url of externalUrls) {
                        const res = await fetch(url, {cache: "no-cache"});
                        if (!res.ok) throw new Error(`Fetch 실패: ${res.status} (${url})`);
                        const j = await res.json();
                        const srcName = url.split("/").pop() || "";
                        loadedList.push({j, srcName, slice: null, parsed: parseRdmName(srcName)});
                    }
                } else {
                    if (!latestPaths.length) throw new Error("데이터 파일 없음.");
                    for (const path of latestPaths) {
                        const loader = jsonModules[path];
                        const mod = await loader();
                        const j = mod.default;
                        const srcName = path.split("/").pop() || "";
                        loadedList.push({j, srcName, slice: null, parsed: parseRdmName(srcName)});
                    }
                }

                if (!alive) return;
                if (!loadedList.length) throw new Error("로드 실패.");

                // ✅ slices가 없으면: 최신 날짜(targetDay) 기준으로 하루(00~24) 자동 slice 생성
                let effectiveSlices = normalizedSlices;

                if (!effectiveSlices?.length) {
                    const targetDay = pickTargetDayFromLoaded(loadedList);
                    if (targetDay) {
                        const auto = buildAutoSlicesForDay(loadedList, targetDay);
                        if (auto?.length) {
                            // auto slice 순서대로 loadedList를 재구성(=slice가 붙은 아이템만 build에 들어가게)
                            const mapByFile = new Map(loadedList.map((x) => [x.srcName, x]));
                            const rebuilt = [];
                            for (const s of auto) {
                                const it = mapByFile.get(s.file);
                                if (!it) continue;
                                rebuilt.push({...it, slice: s});
                            }
                            loadedList.length = 0;
                            loadedList.push(...rebuilt);
                            effectiveSlices = auto;
                        }
                    }
                }


                // meta
                const first = loadedList[0].j;
                const [jsonLat, jsonLon] = first.radar_center || first.radarCenter || [33.5, 126.5];
                const sac = first.sac ?? 0;
                const sic = first.sic ?? 0;
                setMeta({lat: jsonLat, lon: jsonLon, sac, sic});

                // baseKstMidnight: slices[0].startKst 날짜의 00:00 (KST)
                let baseKstMidnightMs = NaN;
                let baseDay = null;

                if (normalizedSlices?.length) {
                    baseDay = effectiveSlices[0].startKst.split(" ")[0];
                    baseKstMidnightMs = Date.parse(`${baseDay}T00:00:00+09:00`);
                    setBaseDateUTC(baseDay);
                } else {
                    const d = inferBaseDateFromName(loadedList[0].srcName);
                    baseDay = d || null;
                    setBaseDateUTC(d || null);
                    if (d) baseKstMidnightMs = Date.parse(`${d}T00:00:00+09:00`);
                }

                // ===== build =====
                const bp = {};       // newPkt -> [segments...]
                const chunks = [];   // timeline chunks
                const perFile = [];

                let globalPkt = 0;
                let totalOrigPktsAll = 0;   // 원본 full pkt 합 (localMaxPkts 합)
                let totalUsedOrigPkts = 0;  // 잘라서 쓴 orig pkt 합 (usedOrigPkts 합)
                let totalNewPkts = 0;       // stitched new pkt 합 (usedNewPkts 합)


                for (let fileIndex = 0; fileIndex < loadedList.length; fileIndex++) {
                    const {j, slice, parsed, srcName} = loadedList[fileIndex];

                    const rawArr = j.segments || j.vectors || [];
                    if (!rawArr.length) {
                        console.warn("[Radar] empty segments/vectors:", srcName, "keys=", Object.keys(j || {}));
                        continue;
                    }

                    // localMax(원래 pkt 최대값)
                    let localMax = 0;
                    for (const row of rawArr) {
                        if (!Array.isArray(row) || row.length < 5) continue;
                        const origPkt = row[0];
                        if (origPkt > localMax) localMax = origPkt;
                    }
                    localMax = Math.max(1, localMax | 0);

                    // chunk 판별
                    let chunk = slice?.chunk;
                    if (chunk == null) chunk = parsed?.chunk;
                    if (typeof chunk === "string") chunk = parseInt(chunk, 10);
                    if (!Number.isFinite(chunk)) {
                        throw new Error(`chunk(00/01) 판별 실패: ${srcName} (slice.chunk 추가 필요)`);
                    }

                    const dayStrFromFile = parsed?.dateStr || null;
                    if (!dayStrFromFile) throw new Error(`날짜 판별 실패: ${srcName}`);

                    // file full range
                    const {fullStartMs, fullEndMs} = chunkFullRangeSec(chunk, dayStrFromFile);

                    // use range (slice)
                    const useStartMs = slice ? kstToMs(slice.startKst) : fullStartMs;
                    const useEndMs = slice ? kstToMs(slice.endKst) : fullEndMs;

                    const frac = sliceToFrac({
                        sliceStartMs: useStartMs, sliceEndMs: useEndMs, fullStartMs, fullEndMs,
                    });
                    if (!frac) continue;

                    const pktRange = fracToPktRange(frac.a, frac.b, localMax);
                    if (!pktRange) continue;

                    // ✅ origPkt -> newPkt 매핑(패킷 단위!)
                    const origToNew = new Map();
                    let cursor = globalPkt;

                    for (let orig = pktRange.start; orig <= pktRange.end; orig++) {
                        cursor += 1;
                        origToNew.set(orig, cursor);
                    }

                    const startPktNew = globalPkt + 1;
                    const endPktNew = cursor;

                    // ✅ segment row들을 "같은 newPkt"로 묶는다
                    for (const row of rawArr) {
                        if (!Array.isArray(row) || row.length < 5) continue;
                        const [origPkt, ci, angDeg, startNm, endNm] = row;

                        if (origPkt < pktRange.start || origPkt > pktRange.end) continue;

                        const newPkt = origToNew.get(origPkt);
                        if (!newPkt) continue;

                        (bp[newPkt] ||= []).push([newPkt, ci, angDeg, startNm, endNm]);
                    }

                    // timeline
                    let startSec = 0;
                    let durationSec = 0;

                    if (baseKstMidnightMs === baseKstMidnightMs) {
                        startSec = Math.round((useStartMs - baseKstMidnightMs) / 1000);
                        durationSec = Math.max(0, (useEndMs - useStartMs) / 1000);
                    } else {
                        durationSec = Math.max(0, (fullEndMs - fullStartMs) / 1000);
                    }

                    chunks.push({
                        startPkt: startPktNew, endPkt: endPktNew, startSec, durationSec,
                    });

                    // summary
                    const usedOrigPkts = pktRange.end - pktRange.start + 1;
                    const usedNewPkts = endPktNew - startPktNew + 1;

                    perFile.push({
                        src: srcName, chunk, segLen: rawArr.length, localMaxPkts: localMax,

                        useStartKst: slice?.startKst ?? null, useEndKst: slice?.endKst ?? null,

                        usedOrigPktStart: pktRange.start, usedOrigPktEnd: pktRange.end, usedOrigPkts,

                        usedNewPktStart: startPktNew, usedNewPktEnd: endPktNew, usedNewPkts,

                        startSec, durationSec,
                    });
                    totalOrigPktsAll += localMax;
                    totalUsedOrigPkts += usedOrigPkts;
                    totalNewPkts += usedNewPkts; // ✅ [추가] 사용한 new pkt 누적
                    globalPkt = endPktNew;
                }

                setByPkt(bp);
                setMaxPkt(globalPkt || 1);
                setPktTimeline(chunks);

                setSliceSummary({
                    files: perFile,
                    totalFiles: perFile.length,
                    totalPkts: globalPkt || 1,


                    totalOrigPktsAll,      // ✅ "원본 총 pkt"
                    totalUsedOrigPkts,     // ✅ "원본에서 사용한 pkt"
                    totalUsedNewPkts: totalNewPkts, // ✅ "최종 stitched pkt"
                    nonEmptyPkts: Object.keys(bp).length,
                });


                // slices 모드(KST 00시 기준 출력 보정)
                if (effectiveSlices?.length) {
                    setSopToDSec(-9 * 3600);
                } else {
                    const firstSop = first.sop_tod_sec !== undefined && first.sop_tod_sec !== null ? Number(first.sop_tod_sec) : null;
                    setSopToDSec(firstSop);
                }
            } catch (e) {
                console.error(e);
                setLoadErr(String(e));
                setByPkt({});
                setMaxPkt(1);
                setPktTimeline([]);
                setSliceSummary(null);
            }
        })();

        return () => {
            alive = false;
        };
    }, [normalizedSlices, externalUrls, latestPaths, centerLat, centerLon]);

    return {
        meta, byPkt, maxPkt, baseDateUTC, sopToDSec, loadErr, pktTimeline, sliceSummary,
    };
}
