export type ImageUpload = { file: File; id: string; onProgress: (percent: number) => void };
export async function uploadImage(image: ImageUpload): Promise<void> {
  if (!image.file.size || image.file.size > 20 * 1024 * 1024) throw new Error("Choose one image up to 20 MiB.");
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await image.file.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("");
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/media/uploads/${encodeURIComponent(image.id)}`);
    xhr.timeout = 60_000; xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Stash-Request", "1"); xhr.setRequestHeader("X-Stash-Content-SHA256", sha);
    xhr.upload.onprogress = event => { if (event.lengthComputable) image.onProgress(Math.round(100 * event.loaded / event.total)); };
    xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new Error("Image transfer interrupted. Retry Save with the same selected image."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { image.onProgress(100); resolve(); }
      else {
        let message = `Image upload HTTP ${xhr.status}; original retained. Retry Save.`;
        try { const body = JSON.parse(xhr.responseText); if (typeof body.error === "string") message = body.error; } catch { /* fixed fallback */ }
        reject(new Error(message));
      }
    };
    xhr.send(image.file);
  });
}
