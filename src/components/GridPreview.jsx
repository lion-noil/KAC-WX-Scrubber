// src/components/GridPreview.jsx
import React from "react";

/**
 * grid: 2D 배열 [size][size], 값은 0 또는 1
 * size: grid 한 변 길이 (예: 32)
 * style: 외부에서 추가로 덮어쓸 스타일 (zIndex, opacity 등)
 */
export default function GridPreview({
  grid,
  size,
  cellBorder = "rgba(255,255,255,0.2)",
  activeColor = "rgba(0,200,255,0.45)",
  style = {},
}) {
  if (!grid || !grid.length) return null;

  const N = size || grid.length;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
          transformOrigin: "center center",   // ★ 추가

        ...style,          // ★ 레이더/비디오 쪽에서 넘긴 style 덮어쓰기
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${N} ${N}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        {/* 셀 테두리 */}
        {Array.from({ length: N + 1 }).map((_, i) => (
          <g key={i}>
            <line
              x1={i}
              y1={0}
              x2={i}
              y2={N}
              stroke={cellBorder}
              strokeWidth={0.03}
            />
            <line
              x1={0}
              y1={i}
              x2={N}
              y2={i}
              stroke={cellBorder}
              strokeWidth={0.03}
            />
          </g>
        ))}

        {/* 활성 셀 */}
        {grid.map((row, y) =>
          row.map((v, x) =>
            v ? (
              <rect
                key={`${x}-${y}`}
                x={x}
                y={y}
                width={1}
                height={1}
                fill={activeColor}
              />
            ) : null
          )
        )}
      </svg>
    </div>
  );
}
