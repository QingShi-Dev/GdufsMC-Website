import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Authentication is enforced by Caddy for /api/admin/*, before proxying.
// Keep Next.js bound to loopback; never expose its port directly.
const MAX_BODY = 25 * 1024 * 1024;
const MAX_PIXELS = 60_000_000;
const QUALITY_THRESHOLD = 300 * 1024;
let busy = false;

function error(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const allowedOrigin = process.env.ADMIN_IMAGE_ORIGIN || "https://gdufscraft.top";
  if (request.headers.get("origin") !== allowedOrigin) {
    return error("Origin not allowed", 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return error("Expected multipart/form-data with one file field", 415);
  }
  const declaredSize = Number(request.headers.get("content-length"));
  if (declaredSize > MAX_BODY) return error("Upload exceeds 25 MiB", 413);
  if (busy) return error("Image processor busy; please retry", 429);
  busy = true;
  const reader = request.body?.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    if (!reader) return error("Empty upload", 400);
    // Bound chunked uploads as well as requests with Content-Length.
    timer = setTimeout(() => {
      expired = true;
      void reader.cancel().catch(() => {});
    }, 30_000);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (expired) return error("Upload timed out", 408);
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY) {
        await reader.cancel();
        return error("Upload exceeds 25 MiB", 413);
      }
      chunks.push(value);
    }
    clearTimeout(timer);
    const body = Buffer.concat(chunks);
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(body), {
        headers: { "Content-Type": request.headers.get("content-type")! },
      }).formData();
    } catch {
      return error("Invalid multipart body", 400);
    }
    const entries = [...form.entries()];
    const file = form.get("file");
    if (entries.length !== 1 || !(file instanceof File) || file.size === 0) {
      return error("Provide exactly one non-empty file field", 400);
    }
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "warning" });
    const metadata = await image.metadata();
    // Inspect decoded format, not the user-controlled extension or MIME type.
    if (metadata.format !== "jpeg" && metadata.format !== "png") {
      return error("Only PNG and JPEG conversion is supported", 415);
    }
    if ((metadata.pages ?? 1) > 1) return error("Animated images are not supported", 415);
    const encode = (quality: number) => image.clone()
      .rotate()
      .resize({ width: 1920, height: 1080, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .timeout({ seconds: 15 })
      .toBuffer({ resolveWithObject: true });
    let quality = 90;
    let result = await encode(quality);
    if (result.data.length > QUALITY_THRESHOLD) {
      quality = 85;
      result = await encode(quality);
    }
    return new Response(new Uint8Array(result.data), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "attachment; filename=\"converted.webp\"",
        "X-Image-Width": String(result.info.width),
        "X-Image-Height": String(result.info.height),
        "X-Image-Quality": String(quality),
        "X-Image-Bytes": String(result.data.length),
        "X-Image-Over-300-KiB": String(result.data.length > QUALITY_THRESHOLD),
      },
    });
  } catch {
    return error("Image cannot be processed; check format, pixel count and file integrity", 422);
  } finally {
    if (timer) clearTimeout(timer);
    reader?.releaseLock();
    busy = false;
  }
}
