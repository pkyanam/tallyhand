const MAX_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.85;

function dataUrlByteLength(dataUrl: string): number {
  const idx = dataUrl.indexOf(",");
  if (idx < 0) return 0;
  const b64 = dataUrl.slice(idx + 1);
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Load an image file, downscale so the longest edge is ≤ maxLongEdge, export as JPEG data URL.
 */
export async function resizeImageToJpegDataUrl(
  file: File,
  maxLongEdge = MAX_LONG_EDGE,
): Promise<{ dataUrl: string; warnLarge: boolean }> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    let { width, height } = bitmap;
    const longEdge = Math.max(width, height);
    if (longEdge > maxLongEdge) {
      const scale = maxLongEdge / longEdge;
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not use canvas.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const bytes = dataUrlByteLength(dataUrl);
    const warnLarge = bytes > 500 * 1024;
    return { dataUrl, warnLarge };
  } finally {
    bitmap.close();
  }
}
