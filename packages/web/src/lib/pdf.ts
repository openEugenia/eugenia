/** Converts a PDF to text with pdf.js, loaded on demand (§8.1). */

export interface PdfText {
  text: string;
  pages: number;
}

export async function pdfToText(file: Blob): Promise<PdfText> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const document = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= document.numPages; n++) {
    const page = await document.getPage(n);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str;
      if (item.hasEOL) text += "\n";
    }
    pages.push(text);
    page.cleanup();
  }
  const pageCount = document.numPages;
  await task.destroy();
  const text = pages
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/(\w)-\n(\w)/g, "$1$2")
    .replace(/([^\n.!?:;])\n(?=[a-zà-ÿ])/g, "$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, pages: pageCount };
}
