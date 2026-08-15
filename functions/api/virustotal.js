import { FILE_HASH } from "./_script-hash.js";

export async function onRequestGet({ env }) {
  const apiKey = env.virustotalapikey || env.VIRUSTOTAL_API_KEY;

  if (!apiKey) {
    return json({ ok: false, error: "VirusTotal API key is not configured" }, 500);
  }

  const response = await fetch(`https://www.virustotal.com/api/v3/files/${FILE_HASH}`, {
    headers: {
      "x-apikey": apiKey
    }
  });

  /* A freshly built script has no report until someone uploads it, and VirusTotal
     answers 404 for an unknown hash. That is a normal state, not a failure. */
  if (response.status === 404) {
    return json({ ok: false, hash: FILE_HASH, error: "unscanned" }, 200, {
      "Cache-Control": "public, max-age=300"
    });
  }

  if (!response.ok) {
    return json({ ok: false, hash: FILE_HASH, error: "VirusTotal request failed" }, response.status);
  }

  const payload = await response.json();
  const attributes = payload?.data?.attributes || {};
  const stats = attributes.last_analysis_stats || {};

  return json({
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
  }, 200, {
    "Cache-Control": "public, max-age=1800"
  });
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}
