// server/routes/ncdayRoutes.js
import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {spawn} from "child_process";

const router = express.Router();
const jobs = new Map();

/** --------- utils --------- */
function safeJoin(base, sub) {
    const baseResolved = path.resolve(base);
    const p = path.resolve(baseResolved, sub);
    if (!p.startsWith(baseResolved + path.sep)) throw new Error("Invalid outDir");
    return p;
}

function ensureDir(p) {
    fs.mkdirSync(p, {recursive: true});
}


function pickPythonCmd() {
    if (process.platform === "win32") {
        // 1순위: python (가장 흔함)
        return {cmd: "python", baseArgs: []};
    }
    return {cmd: "python3", baseArgs: []};
}


function hhmmFromIndex(i, stepMinutes = 5) {
    const total = i * stepMinutes;
    const hh = String(Math.floor(total / 60)).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");
    return `${hh}${mm}`;
}

function sniffKind(buf) {
    if (buf.length >= 4) {
        const h4 = buf.slice(0, 4).toString("hex");
        if (h4 === "504b0304") return {kind: "zip", ext: "zip"}; // PK..
    }
    if (buf.length >= 4) {
        const s3 = buf.slice(0, 3).toString("ascii");
        if (s3 === "CDF") return {kind: "nc", ext: "nc"};
    }
    if (buf.length >= 8) {
        const h8 = buf.slice(0, 8).toString("hex");
        if (h8 === "894844460d0a1a0a") return {kind: "hdf5", ext: "nc"};
    }
    return {kind: "unknown", ext: "bin"};
}

/**
 * typ01 NC 다운로드 URL
 * tm: YYYYMMDDHHmm (12자리, KST)
 * qcd: 여기서는 항상 2(FQC)로 고정
 */
function kmaNcUrl({tm, stn, authKey, qcd = 2, dtm = 0, disp = 0, mode = "B"}) {
    const qs = new URLSearchParams({
        rdr: "NC", stn, tm, qcd: String(qcd), dtm: String(dtm), disp: String(disp), mode,
    });
    qs.set("authKey", authKey);
    return `https://apihub.kma.go.kr/api/typ01/url/rdr_file_down_nc.php?${qs.toString()}`;
}

async function fetchBinary(url) {
    const r = await fetch(url, {method: "GET"});
    const status = r.status;
    const ct = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    return {status, contentType: ct, body: buf};
}

function publicStatus(job) {
    return {
        running: job.running,
        expectedFrames: job.expectedFrames,
        ncDownloaded: job.ncDownloaded,
        missed: job.missed,
        dup: job.dup,
        lastTm: job.lastTm,
        lastFetchStatus: job.lastFetchStatus,
        lastFetchContentType: job.lastFetchContentType,
        error: job.error, // ✅ 프론트 표시용(상대경로)
        outDir: job.outDir,
        // ✅ 추가
        lastSavedName: job.lastSavedName || null,
        lastSavedAt: job.lastSavedAt || null,
        phase: job.phase || "downloading",          // downloading|rendering|done|error
        renderOutDir: job.renderOutDir || null,     // 프론트 표시용(상대경로)
        manifest: job.manifest || null,             //
        renderDone: job.renderDone ?? 0,
        renderTotal: job.renderTotal ?? 0,
        renderLastLine: job.renderLastLine ?? null,

        mp4: job.mp4 || null,


    };
}

/** --------- main loop --------- */

function runRender(job) {
    return new Promise((resolve, reject) => {
        if (job.rendering) return resolve();
        job.rendering = true;
        job.phase = "rendering";

        job.renderDir = safeJoin(job.jobDir, "render");
        ensureDir(job.renderDir);

        job.renderOutDir = path.posix.join(job.outDir, "render");

        // ✅ manifest 이름을 날짜로 (mp4와 동일 베이스)
        const baseName = `${job.dateYmd}`;              // "20260106"
        job.manifest = path.posix.join(job.renderOutDir, `${baseName}.json`);

        const pyMain = path.resolve(process.cwd(), "python", "main.py");
        const {cmd, baseArgs} = pickPythonCmd();

        const gridSize = 320;
        const weakCutDbz = 16;
        const fmt = "webp";

        const args = [
            ...baseArgs,
            pyMain,
            "ncrender_day",
            job.jobDir,        // input_dir
            job.renderDir,     // out_dir
            String(gridSize),  // argv[2]
            String(weakCutDbz),// argv[3]  ✅ 여기!
            fmt,               // argv[4]
        ];
        console.log("[ncrender] spawn:", cmd, args.join(" "));

        const py = spawn(cmd, args, {cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"]});

        let out = "";
        let err = "";


        // 렌더 시작 시 progress 초기화
        job.renderDone = 0;
        job.renderTotal = 0;
        job.renderLastLine = null;

        py.stdout.on("data", (d) => {
            const s = d.toString("utf-8");
            out += s;

            // 파이썬 로그 예: "[12/288] saved ...."
            const m = s.match(/\[(\d+)\/(\d+)\]/);
            if (m) {
                job.renderDone = Number(m[1]) || job.renderDone;
                job.renderTotal = Number(m[2]) || job.renderTotal;
            }

            // 마지막 로그 줄(프론트에 표시용)
            const lines = s.trim().split(/\r?\n/);
            if (lines.length) job.renderLastLine = lines[lines.length - 1].slice(0, 200);
        });

        py.stderr.on("data", (d) => (err += d.toString("utf-8")));

        py.on("error", (e) => {
            job.rendering = false;
            job.phase = "error";
            job.error = `render spawn error: ${e.message}`;
            console.error("[ncrender] spawn error:", e);
            reject(e);
        });

        py.on("close", (code) => {
            job.rendering = false;

            if (code === 0) {
                const baseName = `${job.dateYmd}`;
                const manifestAbs = safeJoin(job.renderDir, `${baseName}.json`);
                if (!fs.existsSync(manifestAbs)) {
                    job.phase = "error";
                    job.error = `render finished but ${baseName}.json not found`;
                    return resolve();
                }

                // ✅ 파이썬이 만든 mp4 확인
                const mp4Name = `${job.dateYmd}.mp4`;
                const mp4Abs = safeJoin(job.renderDir, mp4Name);

                if (fs.existsSync(mp4Abs)) {
                    job.mp4 = path.posix.join(job.renderOutDir, mp4Name);
                } else {
                    // mp4는 선택사항이면 error로 안 해도 됨
                    job.mp4 = null;
                    // 필요하면 에러로 처리:
                    // job.phase="error"; job.error="mp4 not found"; return resolve();
                }

                job.phase = "done";
                job.error = null;
                return resolve();
            }

            job.phase = "error";
            job.error = `render failed (exit ${code})\n` + (err || out || "").slice(0, 2000);
            return resolve();
        });


    });
}


async function downloadNcDayLoop(job) {
    const stepMinutes = job.stepMinutes ?? 5;
    const maxFrames = Math.floor((24 * 60) / stepMinutes);
    job.expectedFrames = maxFrames;

    for (let i = 0; i < maxFrames; i++) {
        if (!job.running) break;

        const hhmm = hhmmFromIndex(i, stepMinutes);
        const tm = `${job.dateYmd}${hhmm}`; // YYYYMMDDHHmm (12자리)
        const url = kmaNcUrl({
            tm, stn: job.siteCode, qcd: 2, // ✅ 항상 qcd(FQC=2) 고정
            authKey: job.authKey, dtm: 0, mode: "B",
        });

        try {
            const res = await fetchBinary(url);

            job.lastFetchStatus = res.status;
            job.lastFetchContentType = res.contentType;
            job.lastTm = tm;

            if (res.status !== 200) {
                job.missed++;
                fs.writeFileSync(path.join(job.jobDir, `http_${res.status}_${tm}.bin`), res.body);
                await new Promise((r) => setTimeout(r, 150));
                continue;
            }

            if ((res.contentType || "").includes("text/html")) {
                job.missed++;
                fs.writeFileSync(path.join(job.jobDir, `error_${tm}.html`), res.body);
                await new Promise((r) => setTimeout(r, 150));
                continue;
            }

            const sig = sniffKind(res.body);

            // body hash로 중복 제거
            const hash = crypto.createHash("sha1").update(res.body).digest("hex");
            if (job.seenHashes.has(hash)) {
                job.dup++;
                await new Promise((r) => setTimeout(r, 150));
                continue;
            }
            job.seenHashes.add(hash);

            if (sig.kind === "zip" || sig.kind === "nc" || sig.kind === "hdf5") {
                job.ncDownloaded++;

                const filename = `${tm}.${sig.ext}`;
                fs.writeFileSync(path.join(job.ncDir, filename), res.body);
                job.lastSavedName = filename;
                job.lastSavedAt = Date.now();

            } else {
                job.missed++;
                fs.writeFileSync(path.join(job.jobDir, `unknown_${tm}.bin`), res.body);
            }
        } catch (e) {
            job.missed++;
            job.error = `fetch error: ${e.message}`;
        }

        await new Promise((r) => setTimeout(r, 150));
    }

    job.running = false;

    // ✅ 다운로드가 끝났으면(정상완료/stop 모두 포함) 렌더 시작
    try {
        await runRender(job);
    } catch (e) {
        job.phase = "error";
        job.error = `render error: ${e.message}`;
    }
}

/** --------- routes --------- */

// start: 하루치 다운 시작
router.post("/start", async (req, res) => {
    try {
        const {
            siteCode, dateStr, // yyyymmdd
            stepMinutes = 5,
        } = req.body || {};
        const authKey = process.env.KMA_KEY;
        if (!authKey) return res.status(500).json({error: "KMA_KEY missing in server env"});
        if (!siteCode || !dateStr) return res.status(400).json({error: "siteCode, dateStr required"});

        const jobId = crypto.randomBytes(4).toString("hex");

        // ✅ 네가 원하는 폴더 구조:
        // download/{STN}/nc/{YYYYMMDD}/{jobId}/   (여기에 nc 파일 바로 저장)
        const outDir = "download";
        const base = path.resolve(process.cwd(), outDir);
        const jobDir = safeJoin(base, path.join(siteCode, "nc", dateStr, jobId));

        // ✅ nc 두 번 방지: jobDir 자체가 ncDir
        const ncDir = jobDir;
        ensureDir(ncDir);

        const job = {
            jobId,
            running: true,
            siteCode,
            dateYmd: dateStr,
            stepMinutes: Math.max(1, Math.min(60, Number(stepMinutes) || 5)),
            authKey,

            jobDir,
            ncDir,

            // ✅ 프론트 표시용(상대경로)
            outDir: path.posix.join(outDir, siteCode, "nc", dateStr, jobId),
            expectedFrames: 0,
            ncDownloaded: 0,
            missed: 0,
            dup: 0,
            lastTm: null,
            lastFetchStatus: null,
            lastFetchContentType: null,
            error: null,

            lastSavedFile: null,
            lastSavedName: null,
            lastSavedAt: null,
            seenHashes: new Set(),


            phase: "downloading",
            renderDir: null,        // 절대경로
            renderOutDir: null,     // 상대경로(프론트용)
            manifest: null,         // 상대경로(프론트용)
            rendering: false,       // 중복 실행 방지용

        };

        jobs.set(jobId, job);

        job.loopPromise = downloadNcDayLoop(job).catch((e) => {
            job.running = false;
            job.phase = "error";
            job.error = `loop failed: ${e.message}`;
        });

        return res.json({jobId, status: publicStatus(job)});
    } catch (e) {
        return res.status(500).json({error: e.message});
    }
});

// stop: 중지
router.post("/stop", (req, res) => {
    try {
        const {jobId} = req.body || {};
        const job = jobs.get(jobId);
        if (!job) return res.status(404).json({error: "job not found"});

        job.running = false; // 루프가 끝나면 downloadNcDayLoop 마지막에서 runRender가 자동 실행됨
        return res.json({status: publicStatus(job)});
    } catch (e) {
        return res.status(500).json({error: e.message});
    }
});


// status: 진행상태 조회
router.get("/status", (req, res) => {
    const jobId = String(req.query.jobId || "");
    const job = jobs.get(jobId);
    if (!job) return res.status(404).json({error: "job not found"});
    return res.json(publicStatus(job));
});

// files: 서버에 저장된 nc 파일 목록
router.get("/files", (req, res) => {
    const jobId = String(req.query.jobId || "");
    const job = jobs.get(jobId);
    if (!job) return res.status(404).json({error: "job not found"});

    const files = fs.existsSync(job.ncDir) ? fs.readdirSync(job.ncDir) : [];
    return res.json({
        outDir: job.outDir,
        files: files.filter((n) => n.toLowerCase().endsWith(".nc") || n.toLowerCase().endsWith(".zip")).sort(),
    });
});

// download: 특정 파일 다운로드
// - /api/ncday/download?jobId=...&name=202601060000.nc
router.get("/download", (req, res) => {
    const jobId = String(req.query.jobId || "");
    const name = String(req.query.name || "");
    const job = jobs.get(jobId);
    if (!job) return res.status(404).send("job not found");
    if (!name) return res.status(400).send("name required");

    const filePath = safeJoin(job.ncDir, name);
    if (!fs.existsSync(filePath)) return res.status(404).send("file not found");

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    fs.createReadStream(filePath).pipe(res);
});


// nc: 특정 파일을 "미리보기용"으로 스트리밍

// py/meta: 파이썬(xarray)로 NC 메타 추출
// - /api/ncday/py/meta?jobId=...&file=202601080030.nc
router.get("/py/meta", (req, res) => {
    try {
        const jobId = String(req.query.jobId || "");
        const file = String(req.query.file || "");

        const job = jobs.get(jobId);
        if (!job) return res.status(404).json({error: "job not found"});
        if (!file) return res.status(400).json({error: "file required"});

        const safeName = path.basename(file);
        const filePath = safeJoin(job.ncDir, safeName);
        if (!fs.existsSync(filePath)) return res.status(404).json({error: "file not found"});

        const pyMain = path.resolve(process.cwd(), "python", "main.py");
        const {cmd, baseArgs} = pickPythonCmd();

        const py = spawn(cmd, [...baseArgs, pyMain, "ncmeta", filePath], {
            cwd: process.cwd(),
            stdio: ["ignore", "pipe", "pipe"],
        });

        let out = "";
        let err = "";

        py.stdout.on("data", (d) => (out += d.toString("utf-8")));
        py.stderr.on("data", (d) => (err += d.toString("utf-8")));

        py.on("error", (e) => {
            return res.status(500).json({
                error: "Python spawn error",
                message: e.message,
                code: e.code,
                pyMain,
            });
        });

        py.on("close", (code) => {
            if (code !== 0) {
                return res.status(500).json({
                    error: "Python exit",
                    exitCode: code,
                    stderr: err.slice(0, 4000),
                    stdout: out.slice(0, 4000),
                    pyMain,
                });
            }
            try {
                return res.json(JSON.parse(out));
            } catch (e) {
                return res.status(500).json({
                    error: "meta JSON parse failed",
                    stderr: err.slice(0, 2000),
                    stdout: out.slice(0, 2000),
                });
            }
        });
    } catch (e) {
        return res.status(500).json({error: e.message});
    }
});

// - /api/ncday/nc?jobId=...&file=202601060000.nc
router.get("/nc", (req, res) => {
    try {
        const jobId = String(req.query.jobId || "");
        const file = String(req.query.file || "");

        const job = jobs.get(jobId);
        if (!job) return res.status(404).json({error: "job not found"});
        if (!file) return res.status(400).json({error: "file required"});

        // 🔒 path traversal 방지: 파일명만 허용
        const safeName = path.basename(file);

        // safeJoin으로 job.ncDir 내부만 접근
        const filePath = safeJoin(job.ncDir, safeName);
        if (!fs.existsSync(filePath)) return res.status(404).json({error: "file not found"});

        // (선택) 허용 확장자 제한
        const low = safeName.toLowerCase();
        const ok = low.endsWith(".nc") || low.endsWith(".zip");
        if (!ok) return res.status(400).json({error: "only .nc or .zip allowed"});

        res.setHeader("Content-Type", "application/octet-stream");
        // 미리보기는 attachment 아니어도 됨 (프론트에서 arrayBuffer로 받음)
        res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
        fs.createReadStream(filePath).pipe(res);
    } catch (e) {
        return res.status(500).json({error: e.message});
    }
});

// py/grid: 파이썬으로 polar->grid 합성 후 float32 격자 반환
// - /api/ncday/py/grid?jobId=...&file=...&field=CFZH&composite=max&gridResKm=1.0&gridExtentKm=240&maskBelowDbz=0
router.get("/py/grid", (req, res) => {
    try {
        const jobId = String(req.query.jobId || "");
        const file = String(req.query.file || "");

        const field = String(req.query.field || "CFZH");
        const composite = String(req.query.composite || "max"); // max|low
        const gridResKm = String(req.query.gridResKm || "1.0");
        const gridExtentKm = String(req.query.gridExtentKm || "240.0");
        const maskBelowDbz = String(req.query.maskBelowDbz || "0.0");

        const job = jobs.get(jobId);
        if (!job) return res.status(404).json({error: "job not found"});
        if (!file) return res.status(400).json({error: "file required"});

        const safeName = path.basename(file);
        const filePath = safeJoin(job.ncDir, safeName);
        if (!fs.existsSync(filePath)) return res.status(404).json({error: "file not found"});

        const pyMain = path.resolve(process.cwd(), "python", "main.py");
        const {cmd, baseArgs} = pickPythonCmd();

        res.setHeader("Content-Type", "application/octet-stream");

        const py = spawn(
            cmd,
            [...baseArgs, pyMain, "ncgrid", filePath, field, composite, gridResKm, gridExtentKm, maskBelowDbz],
            {cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"]}
        );

        py.on("error", (e) => {
            return res.status(500).json({error: "Python spawn error", message: e.message, code: e.code, pyMain});
        });

        py.stderr.on("data", (d) => console.error("[ncgrid]", d.toString("utf-8")));
        py.stdout.pipe(res);

        py.on("close", (code) => {
            if (code !== 0) {
                try {
                    res.end();
                } catch {
                }
            }
        });
    } catch (e) {
        return res.status(500).json({error: e.message});
    }
});

export default router;
