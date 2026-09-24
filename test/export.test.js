const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const {
  ExportError,
  accountsFromHtml,
  accountsFromJson,
  analyze,
  kindOf,
  usernameFromEntry
} = require("../assets/export.js");

/* A minimal zip writer, enough to produce what Instagram and the usual
   archivers hand people: deflated or stored entries, optionally streamed
   with a data descriptor so the local header carries zero sizes. */
function makeZip(files, { streamed = false, store = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const body = store ? data : zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const flags = 0x0800 | (streamed ? 0x0008 : 0);
    const method = store ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(streamed ? 0 : crc, 14);
    local.writeUInt32LE(streamed ? 0 : body.length, 18);
    local.writeUInt32LE(streamed ? 0 : data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const parts = [local, nameBytes, body];
    if (streamed) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(body.length, 8);
      descriptor.writeUInt32LE(data.length, 12);
      parts.push(descriptor);
    }
    const localRecord = Buffer.concat(parts);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBytes]));

    locals.push(localRecord);
    offset += localRecord.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Blob([...locals, directory, end], { type: "application/zip" });
}

const DIR = "connections/followers_and_following/";

function entry(username, timestamp, { inTitle = false, legacyHref = false } = {}) {
  const href = legacyHref
    ? `https://www.instagram.com/${username}`
    : `https://www.instagram.com/_u/${username}`;
  return inTitle
    ? { title: username, string_list_data: [{ href, timestamp }] }
    : { title: "", media_list_data: [], string_list_data: [{ href, value: username, timestamp }] };
}

function followersFile(names) {
  return JSON.stringify(names.map((name, i) => entry(name, 1700000000 + i, { legacyHref: true })));
}

function followingFile(entries) {
  return JSON.stringify({ relationships_following: entries });
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof ExportError && error.code === code);
}

test("reads the username from value, title or href", () => {
  assert.equal(usernameFromEntry(entry("alice", 1)), "alice");
  assert.equal(usernameFromEntry(entry("bob", 1, { inTitle: true })), "bob");
  assert.equal(
    usernameFromEntry({ title: "", string_list_data: [{ href: "https://www.instagram.com/_u/Carol.X" }] }),
    "carol.x"
  );
  assert.equal(usernameFromEntry({ title: "", string_list_data: [{}] }), "");
});

test("accepts followers as a bare array or wrapped in relationships_followers", () => {
  const bare = accountsFromJson(followersFile(["alice", "bob"]));
  const wrapped = accountsFromJson(
    JSON.stringify({ relationships_followers: [entry("alice", 5), entry("bob", 6)] })
  );
  assert.deepEqual(bare.map((a) => a.username), ["alice", "bob"]);
  assert.deepEqual(wrapped.map((a) => a.username), ["alice", "bob"]);
  assert.equal(wrapped[1].timestamp, 6);
});

test("reads profile links out of the HTML export and skips non-account links", () => {
  const html = `
    <a target="_blank" href="https://www.instagram.com/alice">alice</a>
    <a target="_blank" href="https://www.instagram.com/_u/bob">bob</a>
    <a href="https://www.instagram.com/accounts/login/">log in</a>
    <a href="https://example.com/carol">carol</a>`;
  assert.deepEqual(accountsFromHtml(html).map((a) => a.username), ["alice", "bob"]);
});

test("recognises only the followers and following files", () => {
  assert.equal(kindOf(`${DIR}followers_1.json`), "followers");
  assert.equal(kindOf(`${DIR}followers_12.json`), "followers");
  assert.equal(kindOf(`${DIR}following.json`), "following");
  assert.equal(kindOf("followers_1.html"), "followers");
  assert.equal(kindOf(`${DIR}recently_unfollowed_profiles.json`), "");
  assert.equal(kindOf(`${DIR}close_friends.json`), "");
  assert.equal(kindOf(`${DIR}following_hashtags.json`), "");
});

test("finds non-followers inside a zip, merging every followers part", async () => {
  const zip = makeZip({
    [`${DIR}followers_1.json`]: followersFile(["alice", "bob"]),
    [`${DIR}followers_2.json`]: followersFile(["dave"]),
    [`${DIR}close_friends.json`]: followersFile(["zed"]),
    [`${DIR}following.json`]: followingFile([
      entry("alice", 100),
      entry("carol", 300, { inTitle: true }),
      entry("dave", 200),
      entry("erin", 400)
    ])
  });
  const result = await analyze([{ path: "instagram-me-2026-09-24.zip", blob: zip }]);
  assert.equal(result.following, 4);
  assert.equal(result.followers, 3);
  assert.deepEqual(result.notFollowingBack.map((a) => a.username), ["erin", "carol"]);
});

test("reads zips written with data descriptors and stored entries", async () => {
  const files = {
    [`${DIR}followers_1.json`]: followersFile(["alice"]),
    [`${DIR}following.json`]: followingFile([entry("alice", 1), entry("bob", 2)])
  };
  for (const options of [{ streamed: true }, { store: true }]) {
    const result = await analyze([{ path: "export.zip", blob: makeZip(files, options) }]);
    assert.deepEqual(result.notFollowingBack.map((a) => a.username), ["bob"]);
  }
});

test("works on loose files from an unzipped folder", async () => {
  const result = await analyze([
    { path: `${DIR}followers_1.json`, blob: new Blob([followersFile(["alice"])]) },
    { path: `${DIR}following.json`, blob: new Blob([followingFile([entry("alice", 1), entry("bob", 2)])]) },
    { path: "personal_information/personal_information.json", blob: new Blob(["{}"]) }
  ]);
  assert.deepEqual(result.notFollowingBack.map((a) => a.username), ["bob"]);
});

test("names the missing half instead of reporting everyone as a non-follower", async () => {
  const onlyFollowing = makeZip({ [`${DIR}following.json`]: followingFile([entry("bob", 2)]) });
  await expectCode(analyze([{ path: "a.zip", blob: onlyFollowing }]), "noFollowers");

  const onlyFollowers = makeZip({ [`${DIR}followers_1.json`]: followersFile(["alice"]) });
  await expectCode(analyze([{ path: "a.zip", blob: onlyFollowers }]), "noFollowing");

  const unrelated = makeZip({ "media/posts_1.json": "[]" });
  await expectCode(analyze([{ path: "a.zip", blob: unrelated }]), "nothingFound");
});

test("rejects files that are not zips or not JSON", async () => {
  await expectCode(analyze([{ path: "photo.zip", blob: new Blob(["not a zip at all"]) }]), "notZip");
  await expectCode(
    analyze([
      { path: "followers_1.json", blob: new Blob(["{ broken"]) },
      { path: "following.json", blob: new Blob([followingFile([])]) }
    ]),
    "unreadable"
  );
});
