// Bundled into the pinned CMS; no GitHub credentials are sent to this endpoint.
export function createImageConverter({ fetchImpl = (...args) => fetch(...args), timeout = 65000 } = {}) {
  let tail = Promise.resolve();
  return function convert(file) {
    const task = tail.then(async () => {
      const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const png = [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => signature[i] === n);
      const jpeg = signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
      const claimed = /\.(jpe?g|png)$/i.test(file.name) || /^image\/(jpeg|png)$/i.test(file.type);
      if (!png && !jpeg && !claimed) return file;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const body = new FormData();
        body.append("file", file);
        const response = await fetchImpl("/api/admin/image-convert", {
          method: "POST", body, credentials: "same-origin", redirect: "error",
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error(`图片转换失败 (HTTP ${response.status})，请重试；原图未提交。`);
        if (response.headers.get("content-type")?.split(";")[0] !== "image/webp") {
          throw new Error("图片接口未返回 WebP；原图未提交。");
        }
        const blob = await response.blob();
        const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
        if (blob.size < 12 || String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" ||
            String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP") {
          throw new Error("图片接口返回文件无效；原图未提交。");
        }
        const base = file.name.replace(/\.[^.]+$/, "") || "image";
        return new File([blob], `${base}.webp`, { type: "image/webp", lastModified: file.lastModified });
      } finally {
        clearTimeout(timer);
      }
    });
    // A failed conversion must reject its caller, but must not poison later uploads.
    tail = task.catch(() => {});
    return task;
  };
}
export const convertImage = createImageConverter();
