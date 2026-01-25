// src/utils/analysis/colorRemovalConfig.js

// 한 규칙 = 기준 색 + 허용 거리
// dist 값은 대략 20~40 사이에서 튜닝
export const COLOR_REMOVE_RULES = [
  {
    name: "whiteBackground",
    r: 255,
    g: 255,
    b: 255,
    dist: 90, // 바탕 회색 (필요하면 조정)
  },
    {
    name: "blackLine",
    r: 0,
    g: 0,
    b: 0,
    dist: 90,
  },
    {
    name: "grayLine",
    r: 128,
    g: 128,
    b: 128,
    dist: 150,
  },
    {
  name: "redLineCore",
  r: 233,
  g: 12,
  b: 5,
  dist: 65,   // 25~35 정도가 딱 코어만 지움
},
    {
  name: "redLineWide",
  r: 200,
  g: 25,
  b: 20,
  dist: 90,  // 50~75 사이로 조절
},
     {
    name: "redLineEdge",
    r: 180,  // 대략 170~185 부근
    g: 35,
    b: 35,
    dist: 65, // 35~50 사이에서 조절. 노이즈 남으면 조금씩 올려보기
  },

  // ... 필요할 때 계속 추가/수정
];
