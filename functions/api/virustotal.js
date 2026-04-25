const FILE_HASH = "048d5406cbe26e88ee08f5d867c2de6f074a1beda8dac36f17628eb495659d7d";

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

  if (!response.ok) {
    return json({ ok: false, error: "VirusTotal request failed" }, response.status);
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
