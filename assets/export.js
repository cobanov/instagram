/* Reads Instagram's own "Download your information" export and finds the
   accounts you follow that do not follow you back. Everything happens in the
   browser: the files are read from disk, compared in memory, and never sent
   anywhere. That is the whole point of this method, since the live scanner
   is what Instagram now flags as automation.

   Loaded as a plain script by export.html (window.InstagramExport) and
   required by the tests under Node, which has the same Blob, Response and
   DecompressionStream globals. */
(function (root) {
  "use strict";

  class ExportError extends Error {
    constructor(code, detail) {
      super(code);
      this.code = code;
      this.detail = detail || "";
    }
  }

  /* Path segments that sit where a username would in an instagram.com URL
     but are not accounts. HTML exports link to a few of them. */
  const RESERVED = new Set([
    "_n", "_u", "about", "accounts", "developer", "direct", "explore",
    "legal", "p", "reel", "reels", "stories", "tv", "web"
  ]);
  const USERNAME = /^[a-z0-9._]{1,30}$/;

  function cleanUsername(raw) {
    if (typeof raw !== "string") return "";
    const name = raw.trim().replace(/^@/, "").toLowerCase();
    return USERNAME.test(name) && !RESERVED.has(name) ? name : "";
  }

  function usernameFromHref(href) {
    if (typeof href !== "string") return "";
    const match = href.match(/instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)/);
    return match ? cleanUsername(match[1]) : "";
  }

  /* Instagram has shipped more than one shape for the same entry: the
     username sits in string_list_data[0].value in most exports, in title in
     some newer following.json files, and in the profile href in all of them. */
  function usernameFromEntry(entry) {
    if (!entry || typeof entry !== "object") return "";
    const data = Array.isArray(entry.string_list_data) ? entry.string_list_data[0] || {} : {};
    return cleanUsername(data.value) || cleanUsername(entry.title) || usernameFromHref(data.href);
  }

  function timestampFromEntry(entry) {
    const data = entry && Array.isArray(entry.string_list_data) ? entry.string_list_data[0] : null;
    const seconds = data ? Number(data.timestamp) : 0;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  }

  /* followers_1.json has been both a bare array and an object wrapping one in
     relationships_followers; following.json wraps its list in
     relationships_following. Any relationships_* array is accepted so a
     renamed key does not quietly read as zero accounts. */
  function entriesFromJson(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith("relationships_") && Array.isArray(value)) return value;
      }
    }
    return [];
  }

  function accountsFromJson(text) {
    const accounts = [];
    for (const entry of entriesFromJson(JSON.parse(text))) {
      const username = usernameFromEntry(entry);
      if (username) accounts.push({ username, timestamp: timestampFromEntry(entry) });
    }
    return accounts;
  }

  /* The HTML export is the default Instagram offers, so people pick it by
     accident. Every account in it is a link to the profile. */
  function accountsFromHtml(text) {
    const accounts = [];
    for (const match of text.matchAll(/href="(https?:\/\/(?:www\.)?instagram\.com\/[^"]+)"/gi)) {
      const username = usernameFromHref(match[1]);
      if (username) accounts.push({ username, timestamp: 0 });
    }
    return accounts;
  }

  /* Matched on the file name alone, wherever it sits in the folder tree.
     followers_and_following/ also holds close_friends.json,
     recently_unfollowed_profiles.json and the like, which must not count. */
  function kindOf(path) {
    const name = String(path).split("/").pop().toLowerCase();
    if (/^followers(_\d+)?\.(json|html)$/.test(name)) return "followers";
    if (/^following(_\d+)?\.(json|html)$/.test(name)) return "following";
    return "";
  }

  function compare(followers, following) {
    const followerSet = new Set(followers.map((account) => account.username));
    const followed = new Map();
    for (const account of following) {
      const known = followed.get(account.username);
      if (!known || account.timestamp > known.timestamp) followed.set(account.username, account);
    }
    const notFollowingBack = [...followed.values()]
      .filter((account) => !followerSet.has(account.username))
      .sort((a, b) => b.timestamp - a.timestamp || a.username.localeCompare(b.username));
    return { followers: followerSet.size, following: followed.size, notFollowingBack };
  }

  /* ------------------------------------------------------------------------
     A small zip reader. Only the central directory and the few entries we
     need are read, through Blob.slice, so a large export never has to sit in
     memory whole. Deflate goes through the browser's own DecompressionStream.
     ------------------------------------------------------------------------ */

  const EOCD = 0x06054b50;
  const CENTRAL = 0x02014b50;
  const LOCAL = 0x04034b50;

  async function view(blob, start, end) {
    return new DataView(await blob.slice(start, end).arrayBuffer());
  }

  async function listZip(blob) {
    const tailStart = Math.max(0, blob.size - (22 + 0xffff));
    const tail = await view(blob, tailStart, blob.size);
    let at = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === EOCD) {
        at = i;
        break;
      }
    }
    if (at < 0) throw new ExportError("notZip");

    const count = tail.getUint16(at + 10, true);
    const size = tail.getUint32(at + 12, true);
    const offset = tail.getUint32(at + 16, true);
    if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
      throw new ExportError("zip64");
    }

    const directory = await view(blob, offset, offset + size);
    const decoder = new TextDecoder();
    const entries = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + 46 > directory.byteLength || directory.getUint32(p, true) !== CENTRAL) {
        throw new ExportError("badZip");
      }
      const nameLength = directory.getUint16(p + 28, true);
      const extraLength = directory.getUint16(p + 30, true);
      const commentLength = directory.getUint16(p + 32, true);
      entries.push({
        name: decoder.decode(new Uint8Array(directory.buffer, p + 46, nameLength)),
        encrypted: (directory.getUint16(p + 8, true) & 1) === 1,
        method: directory.getUint16(p + 10, true),
        compressedSize: directory.getUint32(p + 20, true),
        localOffset: directory.getUint32(p + 42, true)
      });
      p += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  /* Sizes come from the central directory, not the local header, which is
     zeroed when the zip was streamed with data descriptors. */
  async function readZipEntry(blob, entry) {
    const local = await view(blob, entry.localOffset, entry.localOffset + 30);
    if (local.getUint32(0, true) !== LOCAL) throw new ExportError("badZip");
    const start = entry.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    const body = blob.slice(start, start + entry.compressedSize);
    if (entry.method === 0) return body.text();
    if (entry.method !== 8 || typeof DecompressionStream === "undefined") {
      throw new ExportError("badZip");
    }
    const stream = body.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
  }

  function isZip(file) {
    return /\.zip$/i.test(file.path) || /zip/i.test(file.blob.type || "");
  }

  function addFile(found, kind, name, text) {
    let accounts;
    try {
      accounts = /\.json$/i.test(name) ? accountsFromJson(text) : accountsFromHtml(text);
    } catch {
      throw new ExportError("unreadable", name.split("/").pop());
    }
    for (const account of accounts) found[kind].push(account);
    found.files[kind] += 1;
  }

  /* files: [{ path, blob }]. A dropped zip, the folder Safari unzipped it
     into, or the loose JSON files all end up here. */
  async function collect(files) {
    const found = { followers: [], following: [], files: { followers: 0, following: 0 } };
    for (const file of files) {
      if (isZip(file)) {
        for (const entry of await listZip(file.blob)) {
          const kind = kindOf(entry.name);
          if (!kind) continue;
          if (entry.encrypted) throw new ExportError("badZip");
          addFile(found, kind, entry.name, await readZipEntry(file.blob, entry));
        }
      } else {
        const kind = kindOf(file.path);
        if (kind) addFile(found, kind, file.path, await file.blob.text());
      }
    }
    if (!found.files.followers && !found.files.following) throw new ExportError("nothingFound");
    if (!found.files.following) throw new ExportError("noFollowing");
    if (!found.files.followers) throw new ExportError("noFollowers");
    return found;
  }

  async function analyze(files) {
    const found = await collect(files);
    if (!found.following.length) throw new ExportError("emptyFollowing");
    return compare(found.followers, found.following);
  }

  const api = {
    ExportError,
    accountsFromHtml,
    accountsFromJson,
    analyze,
    collect,
    compare,
    kindOf,
    listZip,
    readZipEntry,
    usernameFromEntry
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.InstagramExport = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
