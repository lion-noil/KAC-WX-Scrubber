// src/pages/weather-extract/NcDayRenderPage.jsx
import React, {useEffect, useMemo, useState} from "react";
import NcPreviewMap from "./NcPreviewMap";
import {useNcPreview} from "./useNcPreview";

const SITE_OPTIONS = [{name: "백령도", code: "BRI"}, {name: "오성산", code: "KSN"}, {name: "광덕산", code: "GDK"}, {
    name: "인천공항", code: "IIA"
}, {name: "관악산", code: "KWK"}, {name: "구덕산", code: "PSN"}, {name: "면봉산", code: "MYN"}, {
    name: "성산", code: "SSP"
}, {name: "고산", code: "GSN"}, {name: "강릉", code: "GNG"}, {name: "진도", code: "JNI"},];

function inputDateFromYmd(ymd) {
    if (!ymd || ymd.length !== 8) return "";
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function ymdFromInputDate(value) {
    return value ? value.replaceAll("-", "") : "";
}

function ymdFromDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
}

function ymdYesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return ymdFromDate(d);
}

export default function NcDayRenderPage() {
    const [jobId, setJobId] = useState(null);
    const [status, setStatus] = useState(null);

    const [siteCode, setSiteCode] = useState("SSP");
    const [dataType, setDataType] = useState("qcd");
    const [dateStr, setDateStr] = useState(() => ymdYesterday());


    const [files, setFiles] = useState([]);

    const [previewFile, setPreviewFile] = useState("");

    const startJob = async () => {
        setFiles([]);
        setPreviewFile("");
        setStatus(null);

        const r = await fetch("/api/ncday/start", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({siteCode, dateStr, dataType}),
        });
        const j = await r.json();
        setJobId(j.jobId);
        setStatus(j.status);
    };

    const stopJob = async () => {
        if (!jobId) return;

        const r = await fetch("/api/ncday/stop", {
            method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({jobId}),
        });
        const j = await r.json();
        setStatus(j.status);
    };
// ✅ 다운 중에도 files 갱신 (2초마다)
    useEffect(() => {
        if (!jobId) return;
        if (status?.phase === "done" || status?.error) return;

        const t = setInterval(async () => {
            try {
                const r = await fetch(`/api/ncday/files?jobId=${encodeURIComponent(jobId)}`);
                if (!r.ok) return;
                const j = await r.json();
                setFiles(j.files || []);
            } catch {
            }
        }, 2000);

        return () => clearInterval(t);
    }, [jobId, status?.phase, status?.error]);

    // status polling
    useEffect(() => {
        if (!jobId) return;
        if (status?.phase === "done" || status?.error) return;
        const t = setInterval(async () => {
            try {
                const r = await fetch(`/api/ncday/status?jobId=${encodeURIComponent(jobId)}`);
                if (r.ok) setStatus(await r.json());
            } catch {
            }
        }, 1000);

        return () => clearInterval(t);
    }, [jobId, status?.phase, status?.error]);


    // ✅ 처음 파일이 생겼는데 previewFile이 비어있을 때만 기본값 세팅
    useEffect(() => {
        if (previewFile) return;
        if (!files || files.length === 0) return;

        const onlyNc = files.filter((x) => String(x).toLowerCase().endsWith(".nc"));
        const pick = onlyNc[0] ?? files[0];
        if (pick) setPreviewFile(pick);
    }, [files, previewFile]);

    // ✅ 방금 저장된 파일을 자동으로 프리뷰로 선택
    useEffect(() => {
        const name = status?.lastSavedName;
        if (!name) return;
        if (!files.includes(name)) return;

        setPreviewFile((prev) => (prev === name ? prev : name));
    }, [status?.lastSavedName, files]);


    const previewEnabled = !!jobId && !!previewFile;
    const {meta, center, bounds, dataUrl, metaLoading, gridLoading, error, safeJson} = useNcPreview({
        jobId, previewFile, enabled: previewEnabled,
    });
    const phase = status?.phase || (status?.running ? "downloading" : "idle");
    const isRendering = phase === "rendering";
    const isEncoding = phase === "encoding";

    const isRunning = !!status?.running || isRendering || isEncoding;
    const isDone = phase === "done";
    const canStop = !!jobId && !!status?.running; // 다운로드 중일 때만 stop 가능
    return (<div className="card">
        <div className="card-header">NC 기반 하루치 영상 생성</div>

        <div className="card-body">
            <div style={{opacity: 0.9, marginBottom: 10}}>{jobId ? `jobId: ${jobId}` : "—"}</div>

            <div style={{display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, maxWidth: 520}}>
                <div style={{opacity: 0.8}}>레이더 지점</div>
                <select value={siteCode} onChange={(e) => setSiteCode(e.target.value)} disabled={isRunning}>
                    {SITE_OPTIONS.map((s) => (<option key={s.code} value={s.code}>
                        {s.name} ({s.code})
                    </option>))}
                </select>

                <div style={{opacity: 0.8}}>날짜(하루)</div>
                <input
                    type="date"
                    value={inputDateFromYmd(dateStr)}
                    onChange={(e) => setDateStr(ymdFromInputDate(e.target.value))}
                    disabled={isRunning}
                />

                <div style={{opacity: 0.8}}>자료</div>
                <select value={dataType} onChange={(e) => setDataType(e.target.value)} disabled={isRunning}>
                    <option value="qcd">qcd (QC 적용)</option>
                    <option value="raw">raw (원시)</option>
                </select>
            </div>

            <div style={{display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center"}}>
                <button className="btn" onClick={startJob} disabled={isRunning}>
                    NC 파일 1일치 생성 시작
                </button>
                <button className="btn" onClick={stopJob} disabled={!canStop}>
                    {status?.running ? "중지(렌더 시작)" : (isRendering ? "렌더링 중…" : (isEncoding ? "영상 인코딩 중…" : "중지"))}
                </button>

                <div style={{marginLeft: "auto", display: "flex", gap: 8, alignItems: "center"}}>
                    <div style={{opacity: 0.85}}>미리보기 파일</div>

                    <div style={{opacity: 0.85}}>
                        현재 프리뷰: {previewFile || "(대기 중)"}
                    </div>
                </div>
            </div>

            <div style={{marginTop: 12, opacity: 0.9}}>
                {status ? (<>
                    <div>running: {String(status.running)}</div>
                    <div>ncDownloaded: {status.ncDownloaded ?? 0}</div>
                    <div>dup: {status.dup ?? 0}</div>
                    <div>lastTm: {status.lastTm || "-"}</div>
                    <div>lastStatus: {status.lastFetchStatus ?? "-"}</div>
                    <div>lastType: {status.lastFetchContentType || "-"}</div>
                    <div>jobDir: {status.outDir || "-"}</div>
                    <div>missed: {status.missed ?? 0}</div>
                    <div>phase: {status.phase || "-"}</div>

                    {status.phase === "rendering" && (
                        <div>
                            rendering: {status.renderDone ?? 0}/{status.renderTotal ?? "?"}
                        </div>
                    )}

                    {status.manifest && (
                        <div>
                            manifest:{" "}
                            <a href={`/${status.manifest}`} target="_blank" rel="noreferrer">
                                open
                            </a>
                        </div>
                    )}
                    {status.mp4 && (
                        <div>
                            mp4:{" "}
                            <a href={`/${status.mp4}`} target="_blank" rel="noreferrer">
                                open
                            </a>
                        </div>
                    )}

                    {status.error && (<div style={{color: "crimson", whiteSpace: "pre-wrap"}}>
                        error:{"\n"}
                        {status.error}
                    </div>)}
                </>) : (<div style={{opacity: 0.6}}>상태 없음</div>)}
            </div>

            <div style={{marginTop: 18, borderTop: "1px solid #333", paddingTop: 14}}>
                <div style={{display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap"}}>
                    <div style={{fontWeight: 800}}>NC 한 장 미리보기</div>
                    <div style={{opacity: 0.8}}>{previewFile ? `파일: ${previewFile}` : "파일을 선택하세요"}</div>
                </div>

                {!previewEnabled && <div style={{marginTop: 8, opacity: 0.7}}>다운로드 작업이 완료되면 미리보기가 활성화됩니다.</div>}

                <div style={{marginTop: 10, minHeight: 22, opacity: 0.8}}>
                    {(metaLoading || gridLoading) ? "불러오는 중…" : "\u00A0"}
                </div>

                {error && (
                    <div style={{marginTop: 6, minHeight: 22, color: "crimson", whiteSpace: "pre-wrap"}}>
                        {error}
                    </div>
                )}
                <div
                    style={{
                        marginTop: 12,
                        width: "100%",
                        aspectRatio: "1/1",
                        borderRadius: 12,
                        overflow: "hidden",
                        border: "1px solid #333",
                    }}
                >
                    <NcPreviewMap center={center} bounds={bounds} dataUrl={dataUrl}/>
                </div>

                <details style={{marginTop: 12}} open={false}>
                    <summary style={{cursor: "pointer", fontWeight: 700}}>
                        메타 보기 (py/meta)
                        {metaLoading ? " (loading)" : ""}
                    </summary>

                    {/* ✅ 레이아웃 고정: minHeight */}
                    <pre style={{whiteSpace: "pre-wrap", marginTop: 8, minHeight: 120}}>
    {meta ? safeJson(meta) : (metaLoading ? "메타 불러오는 중…" : "메타 없음(대기 중)")}
  </pre>
                </details>
            </div>
        </div>
    </div>);
}
