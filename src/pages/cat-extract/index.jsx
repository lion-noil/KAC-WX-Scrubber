// src/pages/cat-extract/index.jsx

import React, { useMemo, useState } from "react";

export default function CatExtractPage() {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // 서버에서 받은 JSON 객체

  const PREVIEW_N = 200;

  const previewJson = useMemo(() => {
    if (!result) return null;
    const seg = Array.isArray(result.segments) ? result.segments : [];
    return {
      ...result,
      segments: seg.slice(0, PREVIEW_N),
      _segments_total: seg.length,
      _note: `segments 미리보기는 처음 ${PREVIEW_N}개만 표시합니다.`,
    };
  }, [result]);

  const summary = useMemo(() => {
    if (!result) return null;
    const segCount = Array.isArray(result.segments) ? result.segments.length : 0;
    return {
      sac: result.sac,
      sic: result.sic,
      center: result.radar_center,
      maxPacket: result.max_packet,
      maxRangeNm: result.max_range_nm,
      parsedAt: result.parsed_at,
      segCount,
    };
  }, [result]);

  function requireFile() {
    if (!file) {
      setError("AST 파일을 선택해 주세요.");
      return false;
    }
    return true;
  }

  async function onRun() {
    setError("");
    setResult(null);

    if (!requireFile()) return;

    const form = new FormData();
    form.append("ast", file);

    setBusy(true);
    try {
      const res = await fetch("/api/cat08/extract", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResult(data?.data ?? data);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">CAT 데이터 추출 (CAT-08)</div>

      <div className="card-body">
        <p style={{ opacity: 0.8, marginTop: 0 }}>
          AST 파일을 업로드하면 서버에서 CAT-08 Weather Polar Vector를 추출해 JSON으로 반환합니다.
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="file"
            accept=".ast,.AST,application/octet-stream"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setError("");
            }}
            disabled={busy}
          />

          <button className="btn" onClick={onRun} disabled={busy}>
            {busy ? "추출 중..." : "CAT8 추출 실행"}
          </button>
        </div>

        {file && (
          <div style={{ marginTop: 10, opacity: 0.85, fontSize: 13 }}>
            선택된 파일: <b>{file.name}</b> ({Math.round((file.size / 1024) * 10) / 10} KB)
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, color: "crimson", whiteSpace: "pre-wrap" }}>
            {error}
          </div>
        )}

        {summary && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>추출 결과 요약</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.95 }}>
              <div>• SAC/SIC: {summary.sac} / {summary.sic}</div>
              <div>
                • Radar center:{" "}
                {Array.isArray(summary.center) ? `${summary.center[0]}, ${summary.center[1]}` : "-"}
              </div>
              <div>• Max packet: {summary.maxPacket}</div>
              <div>• Max range (NM): {summary.maxRangeNm}</div>
              <div>• Segments: {summary.segCount}</div>
              <div>• Parsed at: {summary.parsedAt}</div>
            </div>

            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer" }}>원본 JSON 보기(미리보기)</summary>
              <pre style={{ marginTop: 10, maxHeight: 320, overflow: "auto" }}>
                {previewJson ? JSON.stringify(previewJson, null, 2) : ""}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
