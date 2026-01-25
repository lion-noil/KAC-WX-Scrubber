// server/routes/radarRoutes.js
import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";

const router = express.Router();
const jobs = new Map();

function safeJoin(base, sub) {
  const baseResolved = path.resolve(base);
  const p = path.resolve(baseResolved, sub);
  if (!p.startsWith(baseResolved + path.sep)) throw new Error("Invalid outDir");
  return p;
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function kmaUrl({ tm, stn, authKey }) {
  const qs = new URLSearchParams({ tm, data: "img", stn, authKey });
  return `https://apihub.kma.go.kr/api/typ04/url/rdr_site_file.php?${qs.toString()}`;
}

async function fetchFrame(url) {
  const r = await fetch(url, { method: "GET" });
  const ct = r.headers.get("content-type") || "";
  const status = r.status;
  const buf = Buffer.from(await r.arrayBuffer());
  return { status, contentType: ct, body: buf };
}

function sniffKind(buf) {
  if (buf.length >= 8) {
    const h8 = buf.slice(0, 8).toString("hex");
    if (h8 === "89504e470d0a1a0a") return { kind: "png", ext: "png" };
  }
  if (buf.length >= 3) {
    const h3 = buf.slice(0, 3).toString("hex");
    if (h3 === "ffd8ff") return { kind: "jpg", ext: "jpg" };
  }
  if (buf.length >= 4) {
    const h4 = buf.slice(0, 4).toString("hex");
    if (h4 === "504b0304") return { kind: "zip", ext: "zip" };
  }
  return { kind: "unknown", ext: "bin" };
}

function ymdToTm(ymd, hhmm = "0000") {
  return `${ymd}${hhmm}00`;
}
function hhmmFromIndex(i, stepMinutes = 5) {
  const total = i * stepMinutes;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}${mm}`;
}

function runFfmpeg(jobDir, outMp4, fps, ext) {
  return new Promise((resolve, reject) => {
    // ✅ 프레임 파일명: 0001.png 형태
    const inputPattern = path.join(jobDir, `%04d.${ext}`);

    const args = [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      inputPattern,
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      outMp4,
    ];

    execFile("ffmpeg", args, (err, stdout, stderr) => {
      if (err) return reject(new Error(`ffmpeg failed: ${stderr || err.message}`));
      resolve();
    });
  });
}

function detectFrameExt(jobDir) {
  const files = fs.existsSync(jobDir) ? fs.readdirSync(jobDir) : [];
  if (files.some((f) => f.endsWith(".jpg") || f.endsWith(".jpeg"))) return "jpg";
  if (files.some((f) => f.endsWith(".png"))) return "png";
  return null;
}

function publicStatus(job) {
  return {
    running: job.running,
    frames: job.frames,
    missed: job.missed,
    dup: job.dup,
    lastTimestamp: job.lastTimestamp,
    lastFetchStatus: job.lastFetchStatus,
    lastFetchContentType: job.lastFetchContentType,
    mp4Ready: job.mp4Ready,
    error: job.error,
    // ✅ 프론트 표시용(상대경로)
    outDir: job.outDir,
  };
}

async function downloadLoop(job) {
  const stepMinutes = 5;
  const maxFrames = Math.floor((24 * 60) / stepMinutes);

  for (let i = 0; i < maxFrames; i++) {
    if (!job.running) break;

    const hhmm = hhmmFromIndex(i, stepMinutes);
    const tm = ymdToTm(job.dateYmd, hhmm);
    const url = kmaUrl({ tm, stn: job.siteCode, authKey: job.authKey });

    try {
      const res = await fetchFrame(url);

      job.lastFetchStatus = res.status;
      job.lastFetchContentType = res.contentType;

      if (res.status !== 200) {
        job.missed++;
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      const sig = sniffKind(res.body);

      if (sig.kind === "png" || sig.kind === "jpg") {
        // ✅ body 해시로 중복 프레임 제거
        const hash = crypto.createHash("sha1").update(res.body).digest("hex");
        if (job.seenHashes.has(hash)) {
          job.dup += 1;
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        job.seenHashes.add(hash);

        job.frames++;
        job.lastTimestamp = tm;

        const filename = `${String(job.frames).padStart(4, "0")}.${sig.ext}`;
        fs.writeFileSync(path.join(job.jobDir, filename), res.body);
      } else if (sig.kind === "zip") {
        job.missed++;
        fs.writeFileSync(path.join(job.jobDir, `raw_${tm}.zip`), res.body);
      } else {
        job.missed++;
        fs.writeFileSync(path.join(job.jobDir, `unknown_${tm}.bin`), res.body);
      }
    } catch (e) {
      job.missed++;
      job.error = `fetch error: ${e.message}`;
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  job.running = false;
}

router.post("/start", async (req, res) => {
  try {
    const { siteCode, dateYmd, fps = 10 } = req.body || {};
    const authKey = process.env.KMA_KEY;

    if (!siteCode || !dateYmd) return res.status(400).json({ error: "siteCode, dateYmd required" });
    if (!authKey) return res.status(500).json({ error: "KMA_KEY missing in server env" });

    const jobId = crypto.randomBytes(4).toString("hex");

    // ✅ outDir은 서버에서 고정
    const outDir = "download";
    const base = path.resolve(process.cwd(), outDir);

    // ✅ 네가 원하는 구조: download/{STN}/png/{YYYYMMDD}/{jobId}
    const jobDir = safeJoin(base, path.join(siteCode, "png", dateYmd, jobId));
    ensureDir(jobDir);

    const job = {
      jobId,
      running: true,
      siteCode,
      dateYmd,
      authKey,
      fps: Number(fps ?? 10),
      dup: 0,
      seenHashes: new Set(),

      jobDir,
      // ✅ 프론트 표시용(상대경로)
      outDir: path.posix.join(outDir, siteCode, "png", dateYmd, jobId),

      frames: 0,
      missed: 0,
      lastTimestamp: null,
      lastFetchStatus: null,
      lastFetchContentType: null,
      mp4Ready: false,
      error: null,
      mp4Path: path.join(jobDir, "wx.mp4"),
    };

    jobs.set(jobId, job);

    downloadLoop(job).catch((e) => {
      job.running = false;
      job.error = `loop failed: ${e.message}`;
    });

    return res.json({ jobId, status: publicStatus(job) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/stop", async (req, res) => {
  try {
    const { jobId } = req.body || {};
    const job = jobs.get(jobId);
    if (!job) return res.status(404).json({ error: "job not found" });

    job.running = false;

    if (job.frames > 0) {
      const ext = detectFrameExt(job.jobDir);
      if (!ext) {
        job.error = "no usable frames found";
        return res.json({ status: publicStatus(job) });
      }

      try {
        await runFfmpeg(job.jobDir, job.mp4Path, job.fps, ext);
        job.mp4Ready = true;
      } catch (e) {
        job.error = e.message;
      }
    } else {
      job.error = job.error || "no frames downloaded";
    }

    return res.json({ status: publicStatus(job) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.get("/status", (req, res) => {
  const jobId = String(req.query.jobId || "");
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: "job not found" });
  return res.json(publicStatus(job));
});

router.get("/download", (req, res) => {
  const jobId = String(req.query.jobId || "");
  const job = jobs.get(jobId);
  if (!job) return res.status(404).send("job not found");
  if (!job.mp4Ready || !fs.existsSync(job.mp4Path)) return res.status(400).send("mp4 not ready");

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="${job.siteCode}_${job.dateYmd}.mp4"`);
  fs.createReadStream(job.mp4Path).pipe(res);
});

export default router;
