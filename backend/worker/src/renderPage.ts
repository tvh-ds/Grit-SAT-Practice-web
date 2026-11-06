/**
 * Render one PDF page as a PNG buffer.
 *
 * Primary backend is muPDF (WASM): it rasterizes every page — including
 * image-heavy ones that crash the napi-rs canvas/pdfjs pipeline — and is used
 * for OCR source images and stimuli screenshots. pdfjs is kept as a fallback
 * if muPDF fails to load a document.
 */
export async function renderPagePng(pdfBuffer: Uint8Array, pageNumber: number, scale = 2): Promise<Buffer> {
  try {
    return await renderPagePngMupdf(pdfBuffer, pageNumber, scale);
  } catch {
    return renderPagePngPdfjs(pdfBuffer, pageNumber, scale);
  }
}

async function renderPagePngMupdf(pdfBuffer: Uint8Array, pageNumber: number, scale: number): Promise<Buffer> {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(new Uint8Array(pdfBuffer), "application/pdf");
  try {
    const page = doc.loadPage(pageNumber - 1);
    const bounds = page.getBounds();
    const width = Math.ceil((bounds[2] - bounds[0]) * scale);
    const height = Math.ceil((bounds[3] - bounds[1]) * scale);
    if (width <= 0 || height <= 0 || width * height > 40_000_000) throw new Error("PDF page exceeds the safe rendering size");
    const matrix = mupdf.Matrix.scale(scale, scale);
    // alpha=false -> opaque white background, matching previous pdfjs output.
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
    try {
      return Buffer.from(pixmap.asPNG());
    } finally {
      (pixmap as unknown as { _drop?: () => void })._drop?.();
    }
  } finally {
    (doc as unknown as { _drop?: () => void })._drop?.();
  }
}

async function renderPagePngPdfjs(pdfBuffer: Uint8Array, pageNumber: number, scale: number): Promise<Buffer> {
  const { installPdfGlobals } = await import("./pdfPolyfills");
  const { createCanvas } = await import("@napi-rs/canvas");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  installPdfGlobals();
  const doc = await getDocument({ data: pdfBuffer.slice() }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  if (viewport.width * viewport.height > 40_000_000) { await doc.destroy(); throw new Error("PDF page exceeds the safe rendering size"); }
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return Buffer.from(await canvas.encode("png"));
}
