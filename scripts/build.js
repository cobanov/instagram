const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "src", "instagram-unfollower.js");
const distDir = path.join(root, "dist");
const distPath = path.join(distDir, "instagram-unfollower.one-line.js");

const raw = fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "");

/* The output only needs to be a pasteable one-liner, not an aggressively
   minified bundle. We strip comment-only lines and standalone block comments,
   then trim and join. Inline `//` comments are intentionally not stripped to
   avoid breaking URLs in strings. Keep the source free of inline comments. */

const stripped = raw
  .split(/\r?\n/)
  .map((line) => (/^\s*\/\//.test(line) ? "" : line))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const oneLine = stripped
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .join(" ");

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(distPath, oneLine + "\n", "utf8");

console.log(`Built ${path.relative(root, distPath)}`);
console.log(`${oneLine.length.toLocaleString()} characters`);
