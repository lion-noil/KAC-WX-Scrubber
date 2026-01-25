//server/app.js
import "dotenv/config";
import express from "express";
import path from "path"; // ✅ 추가

import cat08Routes from "./routes/cat08Routes.js";
import ncdayRoutes from "./routes/ncdayRoutes.js";
import radarRoutes from "./routes/radarRoutes.js";

console.log(
  "KMA_KEY exists?",
  !!process.env.KMA_KEY,
  "len=",
  (process.env.KMA_KEY || "").length
);

const app = express();
app.use(express.json());

// ✅ download 폴더 정적서빙 (webp/manifest 접근용)
app.use("/download", express.static(path.resolve(process.cwd(), "download")));
app.use("/api/cat08", cat08Routes);
app.use("/api/radar", radarRoutes);
app.use("/api/ncday", ncdayRoutes);

export default app;
