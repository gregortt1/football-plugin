// Crest composer — Kino's En vivo gives one image per channel, so this turns the two club
// crests of a match into a single 600×300 PNG: home on the left, away on the right.
//
//   GET /?a=<crest url>&b=<crest url>
//
// No dependencies, no bindings, no key: PNG is decoded and encoded with the platform's own
// DecompressionStream/CompressionStream. Only the hosts in ALLOWED may be fetched, so this
// cannot be pointed at anything else.

const ALLOWED = ["a.espncdn.com"];
const WIDTH = 600;
const HEIGHT = 300;
const BOX = 260; // px each crest may occupy inside its half

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET") return reply(405, "method not allowed");

    const left = url.searchParams.get("a") || "";
    const right = url.searchParams.get("b") || "";
    if (!left && !right) return reply(400, "a and b are required");
    if (!allowed(left) || !allowed(right)) return reply(403, "host not allowed");

    const cache = caches.default;
    const key = new Request(url.toString(), { method: "GET" });
    const hit = await cache.match(key);
    if (hit) return hit;

    const [first, second] = await Promise.all([loadPng(left), loadPng(right)]);
    if (!first && !second) return reply(502, "no crest could be read");

    const png = await compose(first, second);
    const answer = new Response(png, {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400, immutable",
        "access-control-allow-origin": "*",
      },
    });
    await cache.put(key, answer.clone());
    return answer;
  },
};

function reply(status, text) {
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function allowed(value) {
  if (!value) return true; // one crest is fine
  try {
    const host = new URL(value);
    if (host.protocol !== "https:") return false;
    return ALLOWED.indexOf(host.hostname) !== -1;
  } catch (e) {
    return false;
  }
}

async function loadPng(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "kino-crest-composer/1.0" } });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (type.indexOf("image/png") === -1) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 1024 * 1024) return null;
    return decodePng(bytes);
  } catch (e) {
    return null;
  }
}

// --- PNG in ---------------------------------------------------------------

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function u32(bytes, at) {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function chunkType(bytes, at) {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

export async function decodePng(bytes) {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  let at = 8;
  let header = null;
  let palette = null;
  let alpha = null;
  const parts = [];

  while (at + 8 <= bytes.length) {
    const length = u32(bytes, at);
    const type = chunkType(bytes, at + 4);
    const body = at + 8;
    if (body + length + 4 > bytes.length) break;
    if (type === "IHDR") {
      header = {
        width: u32(bytes, body),
        height: u32(bytes, body + 4),
        depth: bytes[body + 8],
        color: bytes[body + 9],
        interlace: bytes[body + 12],
      };
    } else if (type === "PLTE") {
      palette = bytes.subarray(body, body + length);
    } else if (type === "tRNS") {
      alpha = bytes.subarray(body, body + length);
    } else if (type === "IDAT") {
      parts.push(bytes.subarray(body, body + length));
    } else if (type === "IEND") {
      break;
    }
    at = body + length + 4;
  }

  if (!header || header.interlace !== 0 || header.depth !== 8) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.color];
  if (!channels) return null;
  if (header.color === 3 && !palette) return null;

  let size = 0;
  for (let i = 0; i < parts.length; i++) size += parts[i].length;
  const joined = new Uint8Array(size);
  let cursor = 0;
  for (let i = 0; i < parts.length; i++) {
    joined.set(parts[i], cursor);
    cursor += parts[i].length;
  }

  const raw = await inflate(joined);
  const stride = header.width * channels;
  if (raw.length < (stride + 1) * header.height) return null;

  const pixels = new Uint8Array(header.width * header.height * 4);
  const line = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  let from = 0;

  for (let y = 0; y < header.height; y++) {
    const filter = raw[from++];
    // one loop per filter instead of a branch per byte: this is the hot path
    if (filter === 0) {
      line.set(raw.subarray(from, from + stride));
    } else if (filter === 1) {
      for (let x = 0; x < stride; x++) {
        line[x] = (raw[from + x] + (x >= channels ? line[x - channels] : 0)) & 0xff;
      }
    } else if (filter === 2) {
      for (let x = 0; x < stride; x++) line[x] = (raw[from + x] + prev[x]) & 0xff;
    } else if (filter === 3) {
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? line[x - channels] : 0;
        line[x] = (raw[from + x] + ((a + prev[x]) >> 1)) & 0xff;
      }
    } else if (filter === 4) {
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? line[x - channels] : 0;
        line[x] = (raw[from + x] + paeth(a, prev[x], x >= channels ? prev[x - channels] : 0)) & 0xff;
      }
    } else {
      return null;
    }
    from += stride;

    for (let x = 0; x < header.width; x++) {
      const o = (y * header.width + x) * 4;
      const i = x * channels;
      if (header.color === 2) {
        pixels[o] = line[i];
        pixels[o + 1] = line[i + 1];
        pixels[o + 2] = line[i + 2];
        pixels[o + 3] = 255;
      } else if (header.color === 6) {
        pixels[o] = line[i];
        pixels[o + 1] = line[i + 1];
        pixels[o + 2] = line[i + 2];
        pixels[o + 3] = line[i + 3];
      } else if (header.color === 0) {
        pixels[o] = pixels[o + 1] = pixels[o + 2] = line[i];
        pixels[o + 3] = 255;
      } else if (header.color === 4) {
        pixels[o] = pixels[o + 1] = pixels[o + 2] = line[i];
        pixels[o + 3] = line[i + 1];
      } else {
        const index = line[i];
        pixels[o] = palette[index * 3] || 0;
        pixels[o + 1] = palette[index * 3 + 1] || 0;
        pixels[o + 2] = palette[index * 3 + 2] || 0;
        pixels[o + 3] = alpha && index < alpha.length ? alpha[index] : 255;
      }
    }
    prev.set(line);
  }

  return { width: header.width, height: header.height, pixels };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// --- canvas ---------------------------------------------------------------

export function compose(left, right) {
  const canvas = new Uint8Array(WIDTH * HEIGHT * 4);
  if (left) draw(canvas, left, 0);
  if (right) draw(canvas, right, Math.floor(WIDTH / 2));
  return encodePng(canvas, WIDTH, HEIGHT);
}

function draw(canvas, image, offsetX) {
  const scale = Math.min(BOX / image.width, BOX / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const left = offsetX + Math.floor((WIDTH / 2 - width) / 2);
  const top = Math.floor((HEIGHT - height) / 2);

  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor(x / scale));
      const si = (sy * image.width + sx) * 4;
      const alpha = image.pixels[si + 3] / 255;
      if (alpha === 0) continue;
      const di = ((top + y) * WIDTH + (left + x)) * 4;
      if (di < 0 || di + 3 >= canvas.length) continue;
      canvas[di] = image.pixels[si] * alpha + canvas[di] * (1 - alpha);
      canvas[di + 1] = image.pixels[si + 1] * alpha + canvas[di + 1] * (1 - alpha);
      canvas[di + 2] = image.pixels[si + 2] * alpha + canvas[di + 2] * (1 - alpha);
      canvas[di + 3] = Math.min(255, image.pixels[si + 3] + canvas[di + 3] * (1 - alpha));
    }
  }
}

// --- PNG out --------------------------------------------------------------

const CRC = (function () {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  const check = new Uint8Array(4 + body.length);
  check.set(out.subarray(4, 8 + body.length));
  view.setUint32(8 + body.length, crc32(check));
  return out;
}

async function encodePng(canvas, width, height) {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(canvas.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const compressed = await deflate(raw);

  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const pieces = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array(0)),
  ];

  let total = 0;
  for (let i = 0; i < pieces.length; i++) total += pieces[i].length;
  const out = new Uint8Array(total);
  let at = 0;
  for (let i = 0; i < pieces.length; i++) {
    out.set(pieces[i], at);
    at += pieces[i].length;
  }
  return out;
}
