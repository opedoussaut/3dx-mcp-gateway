import http from "node:http";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const TENANT = (process.env.THREEDX_TENANT || "DSEXT001").toUpperCase();
const COMPASS = process.env.THREEDX_COMPASS_URL || "https://eu1-215dsi0708-compass.3dexperience.3ds.com/enovia";
const OVERRIDE = process.env.THREEDX_LAKEGOVERNANCE_URL || "";
const COMPASS_SEED = "7F7316C4CC137143";

const audit = [];
let discovered = null;

function record(event, detail = {}) {
  const entry = { id: randomUUID(), at: new Date().toISOString(), event, ...detail };
  audit.unshift(entry);
  if (audit.length > 100) audit.length = 100;
  console.error(JSON.stringify(entry));
  return entry;
}

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(payload);
}

function allowedOrigin(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".3dexperience.3ds.com");
  } catch { return false; }
}

async function discover() {
  const header = createHash("sha1").update(Buffer.concat([
    Buffer.from(COMPASS_SEED), Buffer.from(TENANT)
  ])).digest("hex");
  const url = `${COMPASS.replace(/\/$/, "")}/resources/AppsMngt/api/v1/public/services/platform?platform=${encodeURIComponent(TENANT)}`;
  const response = await fetch(url, { headers: { "X-3DCOMPASS": header }, redirect: "manual" });
  if (!response.ok) throw new Error(`Compass discovery returned HTTP ${response.status}`);
  const body = await response.json();
  const services = body?.platforms?.[0]?.services || [];
  const lake = services.find(s => String(s.id || s.name || "").toLowerCase() === "lakegovernance");
  if (!lake?.url) throw new Error("lakegovernance was not present in service discovery");
  if (!allowedOrigin(lake.url)) throw new Error("Discovered service origin failed the 3DEXPERIENCE allowlist");
  discovered = { id: lake.id, name: lake.name, url: lake.url.replace(/\/$/, ""), serviceCount: services.length };
  record("service.discovery", { outcome: "success", service: "lakegovernance", serviceCount: services.length });
  return discovered;
}

async function target() {
  if (OVERRIDE) {
    if (!allowedOrigin(OVERRIDE)) throw new Error("Configured lakegovernance URL failed allowlist");
    return OVERRIDE.replace(/\/$/, "");
  }
  return (discovered || await discover()).url;
}

// Deliberately tiny live surface. No arbitrary URL/path parameter is accepted.
const READS = {
  roots_v4: () => ({
    path: "/3drdfpersist/governance/v4/catalogs?onlyRoot=true&mask=title&top=1",
    note: "Documented v4 minimal root-catalog probe"
  })
};

async function liveRead(operation) {
  const binding = READS[operation];
  if (!binding) throw Object.assign(new Error("Operation is not allowlisted"), { status: 403 });
  const base = await target();
  const { path, note } = binding();
  const url = base + path;
  record("live.read.attempt", { operation, method: "GET", note });
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: { "accept": "application/json" }
  });
  const location = response.headers.get("location");
  const result = {
    operation,
    method: "GET",
    status: response.status,
    authenticated: false,
    followedRedirect: false,
    classification: response.status === 302 ? "AUTH_REQUIRED" :
      response.status === 401 || response.status === 403 ? "AUTH_REQUIRED_OR_FORBIDDEN" :
      response.ok ? "UNAUTHENTICATED_READ_SUCCEEDED" : "HTTP_ERROR",
    locationHost: location ? new URL(location).host : null,
    bodyReturned: false
  };
  record("live.read.result", { operation, status: response.status, classification: result.classification });
  // Do not return enterprise response bodies in this unauthenticated foundation.
  return result;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && u.pathname === "/api/status") {
      return json(res, 200, {
        name: "3DX MCP Gateway — Dataset Governance PoC",
        mode: "foundation-no-credentials",
        tenant: TENANT,
        bind: "loopback",
        writes: "DENIED",
        arbitraryPaths: "DENIED",
        redirects: "NOT_FOLLOWED",
        credentialsAccepted: false,
        authAdapter: "NOT_IMPLEMENTED",
        evidenceBoundary: "Local integration evidence; not a Claude capability result",
        limitations: [
          "No user, cookie, password, token or Openness Agent credential is accepted.",
          "No MCP transport is implemented in this foundation slice.",
          "No authenticated Dataset Governance read is claimed.",
          "Observed production UI used v3; supplied OpenAPI describes v4; equivalence is not assumed."
        ]
      });
    }
    if (req.method === "POST" && u.pathname === "/api/discover") return json(res, 200, await discover());
    if (req.method === "POST" && u.pathname === "/api/read/roots-v4") return json(res, 200, await liveRead("roots_v4"));
    if (req.method === "GET" && u.pathname === "/api/audit") return json(res, 200, audit);
    if (u.pathname.startsWith("/api/")) return json(res, 404, { error: "Unknown or non-allowlisted operation" });
    if (req.method !== "GET") return json(res, 405, { error: "Only GET is allowed for static content" });
    const path = u.pathname === "/" ? "index.html" : u.pathname.slice(1);
    if (!["index.html", "app.js", "styles.css"].includes(path)) return json(res, 404, { error: "Not found" });
    const type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html";
    const content = await readFile(join(__dirname, "public", path));
    res.writeHead(200, { "content-type": type + "; charset=utf-8", "cache-control": "no-store" });
    res.end(content);
  } catch (error) {
    record("gateway.error", { message: String(error.message || error) });
    json(res, error.status || 500, { error: String(error.message || error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`3DX MCP Gateway PoC: http://127.0.0.1:${PORT}`);
  console.log("Foundation mode: no credentials, no writes, no redirect following.");
});
