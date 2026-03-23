import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LLAMA_HOME = path.resolve(__dirname, "..");
const CONFIG_DIR = path.join(LLAMA_HOME, "config");
const SCRIPTS_DIR = path.join(LLAMA_HOME, "scripts");
const LOGS_DIR = path.join(LLAMA_HOME, "logs");
const INDEX_PATH = path.join(__dirname, "index.html");
const RUNTIME_PATH = path.join(CONFIG_DIR, "runtime.json");
const INVENTORY_PATH = path.join(CONFIG_DIR, "inventory.json");
const SCRIPT_REGISTRY_PATH = path.join(CONFIG_DIR, "scripts.json");

function json(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function text(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function runPowerShellFile(scriptName, extraArgs = []) {
  return new Promise((resolve) => {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...extraArgs], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code: code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

async function tailLog(name) {
  const filePath = path.join(LOGS_DIR, name === "stdout" ? "llama-server.out.log" : name === "admin" ? "llama-admin.log" : "llama-server.err.log");
  try {
    const text = await fsp.readFile(filePath, "utf8");
    return text.split(/\r?\n/).slice(-200).join("\n");
  } catch {
    return "";
  }
}

async function runRegistryScript(id) {
  const registry = await readJson(SCRIPT_REGISTRY_PATH, []);
  const entry = registry.find((item) => item.id === id);
  if (!entry) {
    return { ok: false, code: 404, message: `Unknown script '${id}'.` };
  }

  return await new Promise((resolve) => {
    const child = spawn(entry.command, entry.args ?? [], {
      cwd: entry.cwd || LLAMA_HOME,
      windowsHide: true,
      detached: Boolean(entry.detached),
      stdio: Boolean(entry.detached) ? "ignore" : ["ignore", "pipe", "pipe"],
    });

    if (entry.detached) {
      child.unref();
      resolve({ ok: true, code: 0, stdout: "", stderr: "", detached: true });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ ok: (code ?? 1) === 0, code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    const runtime = await readJson(RUNTIME_PATH, {});
    const inventory = await readJson(INVENTORY_PATH, []);
    const status = await runPowerShellFile("status-llama.ps1");
    let parsedStatus = { running: false, reachable: false, models: [] };
    if (status.stdout) {
      try { parsedStatus = JSON.parse(status.stdout); } catch {}
    }
    return json(res, 200, { runtime, inventory, status: parsedStatus });
  }

  if (req.method === "GET" && url.pathname === "/api/runtime") {
    return json(res, 200, await readJson(RUNTIME_PATH, {}));
  }

  if (req.method === "POST" && url.pathname === "/api/runtime") {
    const body = await readBody(req);
    await fsp.writeFile(RUNTIME_PATH, JSON.stringify(body, null, 2));
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/start") {
    const result = await runPowerShellFile("start-llama.ps1");
    return json(res, result.code === 0 ? 200 : 500, result);
  }

  if (req.method === "POST" && url.pathname === "/api/stop") {
    const result = await runPowerShellFile("stop-llama.ps1");
    return json(res, result.code === 0 ? 200 : 500, result);
  }

  if (req.method === "POST" && url.pathname === "/api/rebuild") {
    const result = await runPowerShellFile("rebuild-models.ps1");
    return json(res, result.code === 0 ? 200 : 500, result);
  }

  if (req.method === "POST" && url.pathname === "/api/props") {
    const body = await readBody(req);
    const runtime = await readJson(RUNTIME_PATH, {});
    const target = `http://${runtime.host ?? "127.0.0.1"}:${runtime.port ?? 1234}/props`;
    try {
      const upstream = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const responseText = await upstream.text();
      res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") ?? "application/json" });
      res.end(responseText);
    } catch (error) {
      json(res, 500, { ok: false, error: String(error) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    return text(res, 200, await tailLog(url.searchParams.get("name") || "stderr"));
  }

  if (req.method === "GET" && url.pathname === "/api/scripts") {
    return json(res, 200, await readJson(SCRIPT_REGISTRY_PATH, []));
  }

  if (req.method === "POST" && url.pathname === "/api/run-script") {
    const body = await readBody(req);
    const result = await runRegistryScript(body.id);
    return json(res, result.ok ? 200 : 500, result);
  }

  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += String(chunk); });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (handled !== false) return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return text(res, 200, await fsp.readFile(INDEX_PATH, "utf8"), "text/html; charset=utf-8");
    }

    text(res, 404, "Not found");
  } catch (error) {
    json(res, 500, { ok: false, error: String(error) });
  }
});

const runtime = await readJson(RUNTIME_PATH, {});
const port = runtime.adminPort ?? 1235;
server.listen(port, runtime.adminHost ?? "127.0.0.1", () => {
  console.log(`llama-admin listening on http://${runtime.adminHost ?? "127.0.0.1"}:${port}`);
});
