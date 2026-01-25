import express from "express";
import multer from "multer";
import os from "os";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import {execFile} from "child_process";

const router = express.Router();

const uploadAst = multer({
    dest: path.join(os.tmpdir(), "cat08_uploads"), limits: {fileSize: 200 * 1024 * 1024},
});

async function safeUnlink(p) {
    if (!p) return;
    await fs.unlink(p).catch(() => {
    });
}

function ymdKst() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
}

function pickPythonCmd() {
    return process.platform === "win32" ? {cmd: "python", baseArgs: []} : {cmd: "python3", baseArgs: []};
}

function ymdFromName(name) {
    if (!name) return null;

    // RDM_B2025122301.ast  → 20251223
    let m = String(name).match(/B(20\d{6})\d{2}\b/i);
    if (m) return m[1];

    // fallback: 그냥 YYYYMMDD가 있으면
    m = String(name).match(/\b(20\d{6})\b/);
    if (m) return m[1];

    return null;
}


function resolveDateStr(req) {
    const fromBody = String(req.body?.dateStr || "").trim();
    if (fromBody) return fromBody;

    const fromName = ymdFromName(req.file?.originalname);
    if (fromName) return fromName;

    return ymdKst();
}

function runAstToCat08Json(astPath, outJsonPath) {
    return new Promise((resolve, reject) => {
        const pyMain = path.resolve(process.cwd(), "python", "main.py");
        const {cmd, baseArgs} = pickPythonCmd();

        const args = [...baseArgs, pyMain, "ast_to_json", astPath, outJsonPath,];

        execFile(cmd, args, {cwd: process.cwd()}, (err, stdout, stderr) => {
            if (err) {
                return reject(new Error(`main.py failed (code=${err.code ?? "?"})\n${stderr || stdout || err.message}`));
            }
            resolve({stdout, stderr});
        });
    });
}

router.post("/extract", uploadAst.single("ast"), async (req, res) => {
  const uploaded = req.file;
  if (!uploaded) return res.status(400).send("No file uploaded (field name: ast)");

  const siteCode = "SSP";
  const dateStr = resolveDateStr(req);
  const jobId = crypto.randomBytes(4).toString("hex");

  const outDir = path.join(process.cwd(), "download", siteCode, "astjson", dateStr, jobId);
  await fs.mkdir(outDir, { recursive: true });

  const tmpJsonPath = path.join(
    os.tmpdir(),
    `cat08_${Date.now()}_${Math.random().toString(16).slice(2)}.json`
  );

  const safeAstName = path.basename(uploaded.originalname);
  const baseName = safeAstName.replace(/\.[^.]+$/, "");
  const finalJsonName = `${baseName}.json`;

  const finalAstPath = path.join(outDir, safeAstName);
  const finalJsonPath = path.join(outDir, finalJsonName);

  try {
    await fs.copyFile(uploaded.path, finalAstPath);

    await runAstToCat08Json(uploaded.path, tmpJsonPath);

    await fs.copyFile(tmpJsonPath, finalJsonPath);

    const text = await fs.readFile(finalJsonPath, "utf-8");
    const data = JSON.parse(text);

    return res.json({
      ok: true,
      jobId,
      outDir: path.posix.join("download", siteCode, "astjson", dateStr, jobId),
      file: finalJsonName,
      data,
    });
  } catch (e) {
    return res.status(500).send(String(e?.message || e));
  } finally {
    await safeUnlink(uploaded.path);
    await safeUnlink(tmpJsonPath);
  }
});


export default router;
