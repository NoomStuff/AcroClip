import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Clapperboard } from "lucide-react";

// Match AttaCut's 240px rounded tile. Lucide has padding inside its viewBox,
// so a 168px canvas gives the mark the same visible size as AttaCut's scissors.
const mark = renderToStaticMarkup(createElement(Clapperboard, { size: 168, x: 44, y: 44, color: "#b197fc", strokeWidth: 2 }));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 256 256"><rect x="8" y="8" width="240" height="240" rx="54" fill="#27252b"/>${mark}</svg>`;
await mkdir("build", { recursive: true });
await writeFile("build/icon.svg", svg);
const png = await sharp(Buffer.from(svg)).png().toBuffer();
await writeFile("build/icon.png", png);
await writeFile("build/icon.ico", await pngToIco(await sharp(png).resize(256, 256).toBuffer()));
const element = Buffer.alloc(8);
element.write("ic10");
element.writeUInt32BE(png.length + 8, 4);
const header = Buffer.alloc(8);
header.write("icns");
header.writeUInt32BE(png.length + 16, 4);
await writeFile("build/icon.icns", Buffer.concat([header, element, png]));

// NSIS requires uncompressed BMP artwork. The portable extraction screen matches
// AttaCut's compact splash layout, with Loading text at the indicator position.
async function brandedBitmap(file: string, width: number, height: number, splash = false): Promise<void> {
   const iconSize = 64;
   const iconY = splash ? 22 : Math.round(height / 2 - iconSize / 2 - 18);
   const textY = splash ? 123 : iconY + iconSize + 30;
   const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#18171b"/><image x="${(width - iconSize) / 2}" y="${iconY}" width="${iconSize}" height="${iconSize}" href="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"/><text x="50%" y="${textY}" text-anchor="middle" fill="${splash ? "#a6a6a6" : "#eeeeee"}" font-family="Segoe UI, sans-serif" font-size="${splash ? 11 : 18}" font-weight="${splash ? 400 : 600}">${splash ? "Loading..." : "AcroClip"}</text></svg>`;
   const pixels = await sharp(Buffer.from(artwork)).flatten({ background: "#18171b" }).removeAlpha().raw().toBuffer();
   const stride = Math.ceil((width * 3) / 4) * 4;
   const bitmap = Buffer.alloc(54 + stride * height);
   bitmap.write("BM");
   bitmap.writeUInt32LE(bitmap.length, 2);
   bitmap.writeUInt32LE(54, 10);
   bitmap.writeUInt32LE(40, 14);
   bitmap.writeInt32LE(width, 18);
   bitmap.writeInt32LE(height, 22);
   bitmap.writeUInt16LE(1, 26);
   bitmap.writeUInt16LE(24, 28);
   bitmap.writeUInt32LE(stride * height, 34);
   for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
         const source = (y * width + x) * 3;
         const target = 54 + (height - 1 - y) * stride + x * 3;
         bitmap[target] = pixels[source + 2]!;
         bitmap[target + 1] = pixels[source + 1]!;
         bitmap[target + 2] = pixels[source]!;
      }
   }
   await writeFile(file, bitmap);
}
await brandedBitmap("build/installerSidebar.bmp", 164, 314);
await brandedBitmap("build/portableSplash.bmp", 216, 148, true);
console.log("Generated icons.");
