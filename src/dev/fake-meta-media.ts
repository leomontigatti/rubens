// The media the fake Meta (`fake-meta.ts`) serves, made up inside the Worker
// so a browser check opens a photo, a file and a voice note with no Meta
// account and no real patient's media: a media id that names its kind
// (`media-fake-image-1`, `media-fake-document-1`, `media-fake-audio-1`)
// gets a drawn picture, a one-page PDF or a short tone. Any other id is one
// Meta does not hold.

const mediaHost = "lookaside.fbsbx.com";

const kinds = {
  image: { mimeType: "image/png", make: picture },
  document: { mimeType: "application/pdf", make: () => Promise.resolve(onePagePdf()) },
  audio: { mimeType: "audio/wav", make: () => Promise.resolve(tone()) },
} as const;

function kindOf(mediaId: string) {
  const kind = /^media-fake-(image|document|audio)-[\w-]+$/.exec(mediaId)?.[1];
  return kind ? kinds[kind as keyof typeof kinds] : null;
}

/** The fake Meta's answer to a request about media, or `null` for one that is not. */
export async function fakeMediaAnswer(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET") {
    return null;
  }
  if (url.hostname === mediaHost) {
    const kind = kindOf(url.searchParams.get("mid") ?? "");
    return kind
      ? new Response(await kind.make(), { headers: { "content-type": kind.mimeType } })
      : new Response("Not found", { status: 404 });
  }
  const mediaId = /^\/v[\d.]+\/(media-[\w-]+)$/.exec(url.pathname)?.[1];
  if (url.hostname !== "graph.facebook.com" || !mediaId) {
    return null;
  }
  const kind = kindOf(mediaId);
  if (!kind) {
    return Response.json(
      { error: { message: "Unsupported get request.", code: 100 } },
      { status: 400 },
    );
  }
  return Response.json({
    messaging_product: "whatsapp",
    url: `https://${mediaHost}/whatsapp_business/attachments/?mid=${mediaId}`,
    mime_type: kind.mimeType,
    id: mediaId,
  });
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array) {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** A 640 × 420 PNG: a soft gradient with a light disc, a stand-in for a patient's photo. */
async function picture() {
  const width = 640;
  const height = 420;
  const rows = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const inDisc = (x - 320) ** 2 + (y - 210) ** 2 < 120 ** 2;
      const pixel = row + 1 + x * 3;
      rows[pixel] = inDisc ? 245 : 150 + Math.round((x / width) * 60);
      rows[pixel + 1] = inDisc ? 240 : 170 + Math.round((y / height) * 40);
      rows[pixel + 2] = inDisc ? 230 : 200;
    }
  }
  const compressed = new Uint8Array(
    await new Response(
      new Blob([rows]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  ];
  return new Blob(parts).arrayBuffer();
}

/** A one-page PDF that says it is made up. */
function onePagePdf() {
  const text = "BT /F1 24 Tf 72 720 Td (Estudio de prueba, datos inventados) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/** Two seconds of a soft 440 Hz tone, as 8 kHz 16-bit mono WAV. */
function tone() {
  const rate = 8000;
  const samples = rate * 2;
  const wav = new DataView(new ArrayBuffer(44 + samples * 2));
  const ascii = (offset: number, text: string) =>
    [...text].forEach((char, index) => wav.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, "RIFF");
  wav.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVEfmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, rate, true);
  wav.setUint32(28, rate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  ascii(36, "data");
  wav.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index += 1) {
    wav.setInt16(
      44 + index * 2,
      Math.round(Math.sin((2 * Math.PI * 440 * index) / rate) * 3000),
      true,
    );
  }
  return wav.buffer;
}
