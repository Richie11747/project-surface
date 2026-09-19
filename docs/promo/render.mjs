// Renders docs/promo/promo.gif and docs/promo/promo.mp4 from promo-film.html.
//
// promo-film.html is a self-contained export of the promo film (a scripted
// 1920x1080 composition; React, Babel and the fonts are inside the file). The
// composition exposes a per-frame seek event, so every frame here is a
// deterministic render at an exact timestamp - no screen recording, no drift,
// and the loop closes where the film says it does.
//
// Prerequisites (not project dependencies; nothing is added to package.json):
//   npm i --no-save playwright-core ffmpeg-static
// A Chromium is needed: the one playwright-core expects if installed, else
// Google Chrome or Edge. Then, from the repository root:
//   node docs/promo/render.mjs
// --deps /path/to/node_modules points at the two packages when they were
// installed elsewhere; --fps N (default 30) sets the capture rate.

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, "promo-film.html");
const framesDir = path.join(tmpdir(), "project-surface-promo-frames");
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const deps = flag("--deps");
const fps = Number(flag("--fps")) || 30;

function resolveDep(name) {
  const bases = [import.meta.url];
  if (deps) bases.push(pathToFileURL(path.join(deps, "_")).href);
  for (const base of bases) {
    try { return createRequire(base).resolve(name); } catch {}
  }
  throw new Error(`Cannot find ${name}. Run: npm i --no-save playwright-core ffmpeg-static (or pass --deps)`);
}

const playwright = await import(pathToFileURL(resolveDep("playwright-core")).href);
const { chromium } = playwright.default ?? playwright;
let ffmpeg = "ffmpeg";
try { ffmpeg = createRequire(import.meta.url)(resolveDep("ffmpeg-static")); } catch {}

function launchOptions() {
  try {
    const exe = chromium.executablePath();
    if (exe && existsSync(exe)) return { executablePath: exe };
  } catch {}
  return { channel: existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "chrome" : "msedge" };
}

function run(args) {
  const r = spawnSync(ffmpeg, args, { stdio: ["ignore", "inherit", "pipe"], encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}):\n${(r.stderr || "").split("\n").slice(-15).join("\n")}`);
}

// 1. Capture: one PNG per frame, straight from the composition at 1920x1080.
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

const browser = await chromium.launch({ headless: true, ...launchOptions() });
const page = await browser.newPage({ viewport: { width: 1920, height: 1201 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("[page]", String(e).slice(0, 300)));
await page.goto(pathToFileURL(source).href);

const stage = page.locator("[data-om-exportable-video-with-duration-secs]").first();
await stage.waitFor({ state: "visible", timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1000);

const duration = Number(await stage.getAttribute("data-om-exportable-video-with-duration-secs"));
const box = await stage.boundingBox();
if (!(duration > 0)) throw new Error("the composition did not report a duration");
if (Math.round(box.width) !== 1920 || Math.round(box.height) !== 1080) {
  throw new Error(`stage rendered at ${box.width}x${box.height}, expected 1920x1080`);
}

const total = Math.round(duration * fps);
console.log(`capturing ${total} frames at ${fps} fps (${duration}s)`);
const started = Date.now();
for (let i = 0; i < total; i++) {
  const time = i / fps;
  await stage.evaluate((el, t) => {
    el.dispatchEvent(new CustomEvent("data-om-seek-to-time-frame", { detail: { time: t, sync: true } }));
  }, time);
  await stage.screenshot({ path: path.join(framesDir, `f${String(i).padStart(5, "0")}.png`), animations: "disabled" });
  if (i % 60 === 0 && i > 0) {
    const rate = i / ((Date.now() - started) / 1000);
    console.log(`  ${i}/${total}  (${rate.toFixed(1)} frames/s, ~${Math.round((total - i) / rate)}s left)`);
  }
}
await browser.close();
console.log(`captured ${readdirSync(framesDir).length} frames in ${Math.round((Date.now() - started) / 1000)}s`);

// 2. Encode. The MP4 is the full-resolution version linked from the README;
//    the GIF is what renders inline on GitHub, so it is kept under ~8 MB.
const input = ["-framerate", String(fps), "-i", path.join(framesDir, "f%05d.png")];
const mp4 = path.join(here, "promo.mp4");
run(["-y", "-loglevel", "error", ...input, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
  "-preset", "slow", "-movflags", "+faststart", mp4]);
console.log(`wrote ${path.relative(process.cwd(), mp4)} (${(statSync(mp4).size / 1e6).toFixed(1)} MB)`);

const gif = path.join(here, "promo.gif");
const tiers = [
  { fps: 15, width: 960, colors: 128 },
  { fps: 12, width: 880, colors: 96 },
  { fps: 10, width: 800, colors: 64 },
];
for (const t of tiers) {
  const filter = `fps=${t.fps},scale=${t.width}:-1:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=${t.colors}:stats_mode=diff[p];` +
    `[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  run(["-y", "-loglevel", "error", ...input, "-vf", filter, "-loop", "0", gif]);
  const mb = statSync(gif).size / 1e6;
  console.log(`wrote ${path.relative(process.cwd(), gif)} at ${t.fps} fps, ${t.width}px, ${t.colors} colours (${mb.toFixed(1)} MB)`);
  if (mb <= 8) break;
}

rmSync(framesDir, { recursive: true, force: true });
