import { Routes, Route, Navigate, NavLink } from "react-router-dom";
import CatExtract from "./pages/cat-extract/index.jsx";
import WeatherExtract from "./pages/weather-extract/index.jsx";
import FinalAnalysis from "./pages/final-analysis/index.jsx";

export default function App() {
  return (
    <div className="page">
      <div className="layout">
        <div className="page-header">
          <nav className="page-nav">
            <NavLink to="/cat" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
              CAT 데이터 추출
            </NavLink>
            <NavLink to="/weather" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
              기상데이터 추출
            </NavLink>
            <NavLink to="/final" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
              최종분석
            </NavLink>
          </nav>
        </div>

        <Routes>
          <Route path="/" element={<Navigate to="/cat" replace />} />
          <Route path="/cat" element={<CatExtract />} />
          <Route path="/weather/*" element={<WeatherExtract />} />
          <Route path="/final" element={<FinalAnalysis />} />
        </Routes>
      </div>
    </div>
  );
}
