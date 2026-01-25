// src/App.jsx
import { Routes, Route, Navigate, NavLink } from "react-router-dom";
import CatExtract from "./pages/cat-extract/index.jsx";
import WeatherExtract from "./pages/weather-extract/index.jsx";
import FinalAnalysis from "./pages/final-analysis/index.jsx";

import { LOCAL_ONLY } from "./utils/env.js"; // ✅ 너가 만든 공통 플래그 경로에 맞춰 수정

export default function App() {
  return (
    <div className="page">
      <div className="layout">
        <div className="page-header">
          <nav className="page-nav">
            {/* ✅ 로컬에서만 노출 */}
            {LOCAL_ONLY && (
              <NavLink
                to="/cat"
                className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              >
                CAT 데이터 추출
              </NavLink>
            )}

            {LOCAL_ONLY && (
              <NavLink
                to="/weather"
                className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              >
                기상데이터 추출
              </NavLink>
            )}

            {/* ✅ 온라인/로컬 모두 노출 */}
            <NavLink
              to="/final"
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              최종분석
            </NavLink>
          </nav>
        </div>

        <Routes>
          {/* ✅ 기본 진입: 로컬은 /cat, 온라인은 /final */}
          <Route path="/" element={<Navigate to={LOCAL_ONLY ? "/cat" : "/final"} replace />} />

          {/* ✅ 로컬에서만 라우트 등록 */}
          {LOCAL_ONLY && <Route path="/cat" element={<CatExtract />} />}
          {LOCAL_ONLY && <Route path="/weather/*" element={<WeatherExtract />} />}

          {/* ✅ 항상 허용 */}
          <Route path="/final" element={<FinalAnalysis />} />

          {/* ✅ 온라인에서 /cat, /weather 직접 치면 /final로 보내기 */}
          {!LOCAL_ONLY && <Route path="*" element={<Navigate to="/final" replace />} />}

          {/* (선택) 로컬에서는 404 페이지가 있으면 그걸로, 없으면 /cat로 보내도 됨 */}
          {LOCAL_ONLY && <Route path="*" element={<Navigate to="/cat" replace />} />}
        </Routes>
      </div>
    </div>
  );
}
