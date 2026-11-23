#!/usr/bin/env node
// Generates the PNG icons of the PWA from the charter's logo (public/icons/mark.svg).
// Requires rsvg-convert (librsvg). The generated files are versioned.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const icons = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const mark = join(icons, "mark.svg");
const render = (svg, size, out) =>
  execFileSync("rsvg-convert", [
    "-w",
    String(size),
    "-h",
    String(size),
    "-o",
    join(icons, out),
    svg,
  ]);

for (const [size, name] of [
  [32, "favicon-32.png"],
  [180, "apple-touch-icon.png"],
  [192, "icon-192.png"],
  [512, "icon-512.png"],
]) {
  render(mark, size, name);
}

// "Maskable" icon: the logo shrunk into the safe zone, on the charter's background.
const svg = readFileSync(mark, "utf8");
const inner = svg.replace(/<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1208 1208">
  <rect width="1208" height="1208" fill="#11161d"/>
  <g transform="translate(181 181) scale(0.7)">${inner}</g>
</svg>`;
const maskablePath = join(icons, "maskable.svg");
writeFileSync(maskablePath, maskable);
render(maskablePath, 512, "maskable-512.png");
console.log("Icons generated in", icons);
