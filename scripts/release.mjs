#!/usr/bin/env node
// npm run release [-- --notes "…"] [--yes]
// Makes the version in package.json a release on GitHub, which is what copies of Rounds opened
// with npx look for once a day (server/updates.mjs). Run it in the public repo with main pushed.
// It checks first, shows the tag and the notes, and asks before tagging and publishing. Without
// --notes, the notes are the commit subjects since the last release.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { execFileSync } from "node:child_process";

const REPO = "krispuckett/rounds";
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
// output shown straight to the terminal comes back as null
const run = (cmd, a, opts = {}) => (execFileSync(cmd, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }) ?? "").trim();
const stop = (why) => { console.log(why); process.exit(1); };
const parts = (v) => v.replace(/^v/, "").split(".").map((n) => Number(n) || 0);
const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

const origin = run("git", ["remote", "get-url", "origin"]);
if (!origin.includes(REPO)) stop(`This is ${origin}. Releases come from the public repo, ${REPO}.`);
if (run("git", ["status", "--porcelain"])) stop("There are changes not committed here. Commit or put them away first.");
run("git", ["fetch", "--quiet", "--tags", "origin"]);
if (run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", "origin/main"])) stop("This isn't what's on GitHub's main. Push main first (or pull it).");

const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const tag = `v${version}`;
if (run("git", ["tag", "--list", tag])) stop(`${tag} is already a release. Raise the version in package.json first.`);
let last = "";
try { last = run("gh", ["release", "view", "--repo", REPO, "--json", "tagName", "--jq", ".tagName"]); } catch {}
if (last && !newer(tag, last)) stop(`${tag} isn't newer than ${last}.`);

let notes = flag("--notes");
if (!notes) {
  const range = last ? [`${last}..HEAD`] : ["-20"];
  notes = run("git", ["log", "--format=- %s", ...range]) || "- Small fixes.";
}
console.log(`\nRelease ${tag}${last ? `, after ${last}` : ""}:\n\n${notes}\n`);
if (!args.includes("--yes")) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await Promise.race([rl.question(`Tag ${tag}, push the tag and publish the release? [y/N] `), new Promise((r) => rl.once("close", () => r("")))]);
  const ok = /^y/i.test(answer.trim());
  rl.close();
  if (!ok) stop("Nothing done.");
}
const file = path.join(os.tmpdir(), `rounds-${tag}.md`);
fs.writeFileSync(file, notes + "\n");
run("git", ["tag", "-a", tag, "-m", `Rounds ${version}`]);
run("git", ["push", "origin", tag], { stdio: "inherit" });
// GitHub can take a moment to see a tag it was just sent (--verify-tag fails until it does), so try a few times
const publish = ["release", "create", tag, "--repo", REPO, "--title", `Rounds ${version}`, "--notes-file", file, "--verify-tag"];
for (let i = 1; ; i++) {
  try { run("gh", publish, { stdio: ["ignore", "inherit", "pipe"] }); break; }
  catch (e) {
    try { run("gh", ["release", "view", tag, "--repo", REPO]); break; } catch {} // it went through after all
    const why = String(e.stderr || e.message).trim();
    if (i === 5) stop(`${tag} is tagged and pushed, but GitHub didn't make the release:\n${why}\nTo finish it: gh ${publish.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
    console.log(`GitHub didn't make the release yet (${why.split("\n")[0]}). Trying again…`);
    await new Promise((r) => setTimeout(r, 3000 * i));
  }
}
console.log(`Released ${tag}. Copies opened with npx offer it within a day.`);
