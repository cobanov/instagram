import { FILE_HASH } from "./_script-hash.js";

/* VirusTotal's free tier allows 500 lookups a day. This page serves roughly
   1,600 views a day, so calling VirusTotal per request rate-limits the endpoint
   for most of the day. The answer for a fixed hash barely changes, so it is
   cached at the edge and VirusTotal sees a few requests a day instead.

   The cache key drops the query string on purpose: a ?nocache= parameter must
   not be able to force a live lookup and burn the quota. */
const OK_TTL = 21600; // 6 hours
const MISS_TTL = 900; // 15 minutes for "not scanned yet"
const FAIL_TTL = 300; // 5 minutes, enough to stop a stampede

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;

  const cache = caches.default;
  const cacheUrl = new URL(request.url);
  cacheUrl.search = "";
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const apiKey = env.virustotalapikey || env.VIRUSTOTAL_API_KEY;
  if (!apiKey) {
    return json({ ok: false, hash: FILE_HASH, error: "unconfigured" }, 200, FAIL_TTL);
  }

  let response;
  try {
    response = await fetch(`https://www.virustotal.com/api/v3/files/${FILE_HASH}`, {
      headers: { "x-apikey": apiKey }
    });
  } catch {
    return json({ ok: false, hash: FILE_HASH, error: "unreachable" }, 200, FAIL_TTL);
  }

  /* A freshly built script has no report until someone uploads it, and
     VirusTotal answers 404 for an unknown hash. That is a normal state. */
  if (response.status === 404) {
    return store(cache, cacheKey, waitUntil, json({ ok: false, hash: FILE_HASH, error: "unscanned" }, 200, MISS_TTL));
  }

  if (response.status === 429) {
    return json({ ok: false, hash: FILE_HASH, error: "rate_limited" }, 200, FAIL_TTL);
  }

  if (!response.ok) {
    return json({ ok: false, hash: FILE_HASH, error: "upstream_error" }, 200, FAIL_TTL);
  }

  const payload = await response.json();
  const attributes = payload?.data?.attributes || {};
  const stats = attributes.last_analysis_stats || {};

  return store(
    cache,
    cacheKey,
    waitUntil,
    json(
      {
        ok: true,
        hash: FILE_HASH,
        stats: {
          harmless: stats.harmless || 0,
          malicious: stats.malicious || 0,
          suspicious: stats.suspicious || 0,
          undetected: stats.undetected || 0,
          timeout: stats.timeout || 0
        },
        reputation: attributes.reputation || 0,
        lastAnalysisDate: attributes.last_analysis_date || null,
        permalink: `https://www.virustotal.com/gui/file/${FILE_HASH}/detection`
      },
      200,
      OK_TTL
    )
  );
}

function store(cache, key, waitUntil, response) {
  if (typeof waitUntil === "function") waitUntil(cache.put(key, response.clone()));
  return response;
}

function json(body, status = 200, maxAge = 300) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`
    }
  });
}
