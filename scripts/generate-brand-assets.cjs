/**
 * Generates the brand assets from code so the repository never carries an opaque binary that
 * nobody can reproduce. Running this script twice produces byte identical files.
 *
 * Usage: node scripts/generate-brand-assets.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const assets = path.join(root, "assets");

const ARM_ANGLES = [90, 210, 330];
const BRAND = { r: 0x11, g: 0x8d, b: 0xff };
const ACCENT = { r: 0xe6, g: 0x6c, b: 0x37 };

function coverage(size, x, y) {
    const center = size / 2;
    const radius = size * 0.42;
    const halfWidth = size * 0.085;
    const samples = 4;
    let hitsBrand = 0;
    let hitsAccent = 0;
    for (let sx = 0; sx < samples; sx++) {
        for (let sy = 0; sy < samples; sy++) {
            const px = x + (sx + 0.5) / samples;
            const py = y + (sy + 0.5) / samples;
            const dx = px - center;
            const dy = center - py;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= size * 0.1) {
                hitsAccent++;
                continue;
            }
            for (const angle of ARM_ANGLES) {
                const radians = (angle * Math.PI) / 180;
                const along = dx * Math.cos(radians) + dy * Math.sin(radians);
                const across = -dx * Math.sin(radians) + dy * Math.cos(radians);
                if (along >= size * 0.12 && along <= radius && Math.abs(across) <= halfWidth) {
                    hitsBrand++;
                    break;
                }
            }
        }
    }
    const total = samples * samples;
    return { brand: hitsBrand / total, accent: hitsAccent / total };
}

function renderGlyph(size, opaqueBackground) {
    const pixels = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const offset = (y * size + x) * 4;
            const { brand, accent } = coverage(size, x, y);
            const alpha = Math.min(brand + accent, 1);
            const color = accent > brand ? ACCENT : BRAND;
            if (opaqueBackground) {
                pixels[offset] = Math.round(color.r * alpha + 255 * (1 - alpha));
                pixels[offset + 1] = Math.round(color.g * alpha + 255 * (1 - alpha));
                pixels[offset + 2] = Math.round(color.b * alpha + 255 * (1 - alpha));
                pixels[offset + 3] = 255;
            } else {
                pixels[offset] = color.r;
                pixels[offset + 1] = color.g;
                pixels[offset + 2] = color.b;
                pixels[offset + 3] = Math.round(alpha * 255);
            }
        }
    }
    return pixels;
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed), 0);
    return Buffer.concat([length, typed, crc]);
}

function encodePng(size, pixels) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 6;
    header[10] = 0;
    header[11] = 0;
    header[12] = 0;

    const stride = size * 4;
    const raw = Buffer.alloc((stride + 1) * size);
    for (let y = 0; y < size; y++) {
        raw[y * (stride + 1)] = 0;
        pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0))
    ]);
}

function svgSource() {
    const arms = ARM_ANGLES.map((angle) => {
        const radians = (angle * Math.PI) / 180;
        const x1 = 50 + Math.cos(radians) * 12;
        const y1 = 50 - Math.sin(radians) * 12;
        const x2 = 50 + Math.cos(radians) * 42;
        const y2 = 50 - Math.sin(radians) * 42;
        return `  <line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#118DFF" stroke-width="17" stroke-linecap="butt" />`;
    }).join("\n");
    return [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">',
        arms,
        '  <circle cx="50" cy="50" r="10" fill="#E66C37" />',
        "</svg>",
        ""
    ].join("\n");
}

fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, "icon.svg"), svgSource());
fs.writeFileSync(path.join(assets, "icon.png"), encodePng(20, renderGlyph(20, false)));
fs.writeFileSync(
    path.join(assets, "partner-center-logo-300x300.png"),
    encodePng(300, renderGlyph(300, true))
);
console.log("Wrote assets/icon.svg, assets/icon.png (20x20) and assets/partner-center-logo-300x300.png");
