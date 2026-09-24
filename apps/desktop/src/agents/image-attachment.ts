/**
 * Makes an image small enough to attach. The daemon accepts at most 1 MB per attachment, and a
 * pasted screenshot is often several times that, so images are re-encoded instead of refused:
 * lossless PNG when it fits, otherwise JPEG, shrinking until it does. Text in screenshots stays
 * legible far longer under JPEG at full size than under aggressive downscaling, hence the order.
 */
export const ATTACHMENT_LIMIT_BYTES = 1024 * 1024;

export interface EncodeAttempt {
  type: "image/png" | "image/jpeg";
  quality?: number;
  width: number;
  height: number;
}

/** Encodings to try, best first. Pure, so the order can be tested without a canvas. */
export function encodeAttempts(width: number, height: number): EncodeAttempt[] {
  const attempts: EncodeAttempt[] = [{ type: "image/png", width, height }];
  let scale = 1;
  // Stop around 480px on the long edge; anything smaller is not worth sending.
  while (Math.max(width, height) * scale >= 480) {
    attempts.push({
      type: "image/jpeg",
      quality: scale === 1 ? 0.9 : 0.85,
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    });
    scale *= 0.75;
  }
  return attempts;
}

/** A pasted image that fits the attachment limit, or an error explaining that it cannot. */
export async function fitImage(
  source: ImageData | ImageBitmap,
  baseName: string,
  limit = ATTACHMENT_LIMIT_BYTES,
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not read the image");
  if (source instanceof ImageData) context.putImageData(source, 0, 0);
  else context.drawImage(source, 0, 0);
  for (const attempt of encodeAttempts(source.width, source.height)) {
    let target = canvas;
    if (attempt.width !== canvas.width || attempt.height !== canvas.height) {
      target = document.createElement("canvas");
      target.width = attempt.width;
      target.height = attempt.height;
      const scaled = target.getContext("2d");
      if (!scaled) continue;
      scaled.imageSmoothingQuality = "high";
      scaled.drawImage(canvas, 0, 0, attempt.width, attempt.height);
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      target.toBlob(resolve, attempt.type, attempt.quality),
    );
    if (blob && blob.size <= limit)
      return new File([blob], `${baseName}.${attempt.type === "image/png" ? "png" : "jpg"}`, {
        type: attempt.type,
      });
  }
  throw new Error("This image is too large to attach, even when shrunk.");
}

/** Oversized still images are shrunk; everything else is returned untouched for the size check. */
export async function fitImageFile(file: File, limit = ATTACHMENT_LIMIT_BYTES): Promise<File> {
  if (file.size <= limit || !/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) return file;
  const bitmap = await createImageBitmap(file);
  try {
    return await fitImage(bitmap, file.name.replace(/\.[^.]+$/, "") || "image", limit);
  } finally {
    bitmap.close();
  }
}
