import { Routes, Route, Navigate, NavLink } from "react-router-dom";
import WeatherExtractPage from "./WeatherExtractPage.jsx";
import NcDayRenderPage from "./NcDayRenderPage.jsx";

export default function WeatherExtractRouter() {
  return (
    <div>
      {/* 서브 탭 */}
      <div style={{ marginBottom: 12, display: "flex", gap: 12 }}>
        <NavLink
          to="/weather/img"
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
        >
          이미지 기반 녹화
        </NavLink>
        <NavLink
          to="/weather/nc"
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
        >
          raw파일(.nc) 기반 추출
        </NavLink>
      </div>

      <Routes>
        <Route path="/" element={<Navigate to="img" replace />} />
        <Route path="img" element={<WeatherExtractPage />} />
        <Route path="nc" element={<NcDayRenderPage />} />
      </Routes>
    </div>
  );
}
