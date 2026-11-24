// Builds the game's recorded sounds from the field recordings listed in
// scripts/audio-sources.json: trims each call, cleans and levels it, encodes
// it as a small mono MP3 in public/audio/, and writes the credits that the
// recordings' licences require.
//
// Needs ffmpeg. Source files are kept in .audio-cache/ (not committed) and are
// downloaded from Wikimedia Commons only if missing.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const sources = JSON.parse(await readFile(new URL("./audio-sources.json", import.meta.url), "utf8"));
await mkdir(".audio-cache", { recursive: true });
await mkdir("public/audio", { recursive: true });

const ffmpeg = (args) => execFileSync("ffmpeg", ["-hide_banner", "-nostdin", ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();
const clips = {};
const credits = [];

for (const source of sources) {
  const cached = `.audio-cache/${source.cache}`;
  if (!existsSync(cached)) {
    console.log(`Downloading ${source.title}`);
    const response = await fetch(source.download, { headers: { "User-Agent": "birds-eye-view audio build (one-off asset download)" } });
    if (!response.ok) throw new Error(`Could not download ${source.title}: ${response.status}`);
    await writeFile(cached, Buffer.from(await response.arrayBuffer()));
    // Be polite to Wikimedia between files.
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  for (const clip of source.clips) {
    const length = clip.end - clip.start;
    // Cut below the call to drop wind and handling rumble, and fade both ends
    // so a clip never starts or stops with a click.
    const clean = `highpass=f=320,afade=t=in:d=0.03,afade=t=out:st=${(length - 0.09).toFixed(2)}:d=0.09`;
    const cut = ["-ss", String(clip.start), "-t", length.toFixed(2), "-i", cached, "-ac", "1"];
    // Level every clip to the same peak, so the engine's gains mean the same
    // thing whichever recording plays.
    const report = ffmpegReport([...cut, "-af", `${clean},volumedetect`, "-f", "null", "-"]);
    const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(report)?.[1] ?? 0);
    const gain = (-2 - peak).toFixed(1);
    const file = `public/audio/${clip.name}.mp3`;
    ffmpeg(["-y", ...cut, "-af", `${clean},volume=${gain}dB`, "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "96k", file]);
    (clips[source.species] ??= []).push(`/audio/${clip.name}.mp3`);
    console.log(`${file}: ${length.toFixed(2)} s, ${gain} dB`);
  }
  credits.push([
    `${source.subject}: ${source.clips.map((clip) => `${clip.name}.mp3`).join(", ")}`,
    `  From "${source.title}" by ${source.author}`,
    `  ${source.page}`,
    `  Licence: ${source.licence}${source.licenceUrl ? ` (${source.licenceUrl})` : ""}`,
    "  Changes: trimmed to single calls, high-pass filtered, faded, levelled, converted to mono MP3.",
  ].join("\n"));
}

function ffmpegReport(args) {
  // ffmpeg writes its analysis to stderr, even on success.
  return spawnSync("ffmpeg", ["-hide_banner", "-nostdin", ...args], { encoding: "utf8" }).stderr ?? "";
}

await writeFile("app/sound-clips.json", `${JSON.stringify(clips, null, 2)}\n`);
await writeFile("public/audio/CREDITS.txt", [
  "Bird's Eye View: sound recording credits",
  "",
  "The bird calls in this game are field recordings shared on Wikimedia Commons.",
  "Each clip below is an adaptation of the named recording and is offered under",
  "the same licence as its source. Everything else you hear (wind, wingbeats,",
  "city, traffic, rain and thunder) is synthesised by the game.",
  "",
  credits.join("\n\n"),
  "",
].join("\n"));
console.log(`Wrote app/sound-clips.json and public/audio/CREDITS.txt for ${Object.values(clips).flat().length} clips`);
