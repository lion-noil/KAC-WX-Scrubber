// src/pages/weather-extract/WeatherExtractPage.jsx
import React, {useEffect, useMemo, useState} from "react";

const SITE_OPTIONS = [{name: "백령도(HSR)", code: "BRI"}, {name: "오성산(HSR)", code: "KSN"}, {
    name: "광덕산(HSR)",
    code: "GDK"
}, {name: "인천공항(CAPPI)", code: "IIA"}, {name: "관악산(HSR)", code: "KWK"}, {
    name: "구덕산(HSR)",
    code: "PSN"
}, {name: "면봉산(HSR)", code: "MYN"}, {name: "성산(HSR)", code: "SSP"}, {name: "고산(HSR)", code: "GSN"}, {
    name: "강릉(HSR)",
    code: "GNG"
}, {name: "진도(HSR)", code: "JNI"}];

function ymdFromDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
}

function inputDateFromYmd(ymd) {
    if (!ymd || ymd.length !== 8) return "";
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function ymdFromInputDate(value) {
    return value ? value.replaceAll("-", "") : "";
}

function ymdYesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return ymdFromDate(d);
}

async function readJsonSafe(r) {
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("application/json")) return r.json();
    const text = await r.text();
    return {error: `Expected JSON but got ${ct}\n${text.slice(0, 300)}`};
}

export default function WeatherExtractPage() {
    const [jobId, setJobId] = useState("");
    const [status, setStatus] = useState(null);

    const [siteCode, setSiteCode] = useState("SSP");
    const [dateYmd, setDateYmd] = useState(() => ymdYesterday());
    const [fps, setFps] = useState(10);
    const isRunning = !!status?.running;
    const canDownload = !!jobId && !!status?.mp4Ready && !status?.error;

    const downloadUrl = useMemo(() => {
        if (!jobId) return "";
        return `/api/radar/download?jobId=${encodeURIComponent(jobId)}`;
    }, [jobId]);

    async function start() {
        setStatus(null);
        const r = await fetch("/api/radar/start", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({siteCode, dateYmd, fps})
        });

        const j = await readJsonSafe(r);

        if (!r.ok) {
            setStatus({error: j?.error || "start failed"});
            return;
        }
        setJobId(j.jobId);
        setStatus(j.status);
    }

    async function stop() {
        if (!jobId) return;
        const r = await fetch("/api/radar/stop", {
            method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({jobId})
        });
        const j = await readJsonSafe(r);
        setStatus(j.status || j);
        setJobId(""); // ✅ 폴링 종료(다운로드 링크도 사라짐)
    }

    useEffect(() => {
        if (!jobId) return;
        const t = setInterval(async () => {
            const r = await fetch(`/api/radar/status?jobId=${encodeURIComponent(jobId)}`);
            if (r.ok) setStatus(await r.json());
        }, 1000);
        return () => clearInterval(t);
    }, [jobId]);

    return (<div className="card">
            <div className="card-header">기상레이더 추출(단순)</div>

            <div className="card-body">
                <div style={{opacity: 0.9, marginBottom: 10}}>jobId: {jobId || "—"}</div>

                <div style={{display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, maxWidth: 620}}>
                    <div style={{opacity: 0.8}}>지점</div>
                    <select value={siteCode} onChange={(e) => setSiteCode(e.target.value)} disabled={isRunning}>
                        {SITE_OPTIONS.map((s) => (<option key={s.code} value={s.code}>
                                {s.name} ({s.code})
                            </option>))}
                    </select>

                    <div style={{opacity: 0.8}}>날짜</div>
                    <input
                        type="date"
                        value={inputDateFromYmd(dateYmd)}
                        onChange={(e) => setDateYmd(ymdFromInputDate(e.target.value))}
                        disabled={isRunning}
                    />

                    <div style={{opacity: 0.8}}>FPS</div>
                    <input
                        type="number"
                        min={1}
                        max={60}
                        value={fps}
                        onChange={(e) => setFps(Math.max(1, Math.min(60, Number(e.target.value) || 10)))}
                        disabled={isRunning}
                    />

                </div>

                <div style={{display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap"}}>
                    <button className="btn" onClick={start} disabled={isRunning}>
                        시작
                    </button>
                    <button className="btn" onClick={stop} disabled={!jobId}>
                        중지 + MP4 생성
                    </button>

                    {canDownload && (<a className="btn" href={downloadUrl}>
                            MP4 다운로드
                        </a>)}
                </div>

                <div style={{marginTop: 12, opacity: 0.92}}>
                    {status ? (<>
                            <div>running: {String(!!status.running)}</div>
                            <div>frames: {status.frames ?? 0}</div>
                            <div>missed: {status.missed ?? 0}</div>
                            <div>lastTs: {status.lastTimestamp || "-"}</div>
                            <div>lastStatus: {status.lastFetchStatus ?? "-"}</div>
                            <div>lastType: {status.lastFetchContentType || "-"}</div>
                            <div>mp4Ready: {String(!!status.mp4Ready)}</div>
                            {status.error && (<div style={{color: "crimson", whiteSpace: "pre-wrap"}}>
                                    error:
                                    {"\n"}
                                    {status.error}
                                </div>)}
                        </>) : (<div style={{opacity: 0.6}}>상태 없음</div>)}
                </div>
            </div>
        </div>);
}
