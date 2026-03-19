const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;
const DEVICE_SCALE = 2;

/**
 * Convert HTML to PDF using Electron's BrowserWindow for rendering.
 * Uses screenshot-based approach to preserve all CSS effects.
 */
async function convertHtmlToPdf(htmlFilePath, outputPdfPath) {
  const absoluteHtml = path.resolve(htmlFilePath);
  if (!fs.existsSync(absoluteHtml)) {
    throw new Error(`File not found: ${absoluteHtml}`);
  }

  // Create a hidden window for rendering the HTML
  const renderWin = new BrowserWindow({
    width: SLIDE_WIDTH,
    height: SLIDE_HEIGHT,
    show: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
    enableLargerThanScreen: true,
  });

  // Set device scale factor for high-res screenshots
  renderWin.webContents.setZoomFactor(1);

  try {
    // Load the HTML file
    await renderWin.loadFile(absoluteHtml);

    // Wait for fonts and rendering
    await renderWin.webContents.executeJavaScript('document.fonts.ready');
    await new Promise(r => setTimeout(r, 1000)); // Extra wait for rendering

    // Detect slide-based layout or full-page
    const slideInfo = await renderWin.webContents.executeJavaScript(`
      (function() {
        const slides = document.querySelectorAll('.slide');
        if (slides.length > 0) {
          return {
            mode: 'slides',
            count: slides.length,
            rects: Array.from(slides).map(s => {
              const r = s.getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width, height: r.height };
            })
          };
        }
        const body = document.body;
        const html = document.documentElement;
        return {
          mode: 'fullpage',
          width: Math.max(body.scrollWidth, html.scrollWidth, ${SLIDE_WIDTH}),
          height: Math.max(body.scrollHeight, html.scrollHeight)
        };
      })();
    `);

    let slideImages = [];
    let pageWidth, pageHeight;

    if (slideInfo.mode === 'slides') {
      pageWidth = Math.round(slideInfo.rects[0].width);
      pageHeight = Math.round(slideInfo.rects[0].height);

      // Resize window to full content height so all slides are rendered
      const totalHeight = slideInfo.rects[slideInfo.count - 1].y + slideInfo.rects[slideInfo.count - 1].height + 100;
      renderWin.setSize(SLIDE_WIDTH, Math.ceil(totalHeight));
      await new Promise(r => setTimeout(r, 500));

      // Capture each slide
      for (let i = 0; i < slideInfo.count; i++) {
        const rect = slideInfo.rects[i];
        const image = await renderWin.webContents.capturePage({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
        slideImages.push(image.toPNG());
      }
    } else {
      // Full page mode
      pageWidth = Math.min(slideInfo.width, SLIDE_WIDTH);
      pageHeight = SLIDE_HEIGHT;
      renderWin.setSize(pageWidth, slideInfo.height);
      await new Promise(r => setTimeout(r, 500));

      const totalPages = Math.ceil(slideInfo.height / SLIDE_HEIGHT);
      for (let i = 0; i < totalPages; i++) {
        const clipH = Math.min(SLIDE_HEIGHT, slideInfo.height - i * SLIDE_HEIGHT);
        const image = await renderWin.webContents.capturePage({
          x: 0,
          y: i * SLIDE_HEIGHT,
          width: pageWidth,
          height: clipH,
        });
        slideImages.push(image.toPNG());
      }
    }

    // Now assemble screenshots into a PDF using a second hidden window
    const pdfWin = new BrowserWindow({
      width: pageWidth,
      height: pageHeight,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const tempHtmlPath = path.join(os.tmpdir(), `html2pdf_temp_${Date.now()}_${Math.random().toString(36).substring(2)}.html`);
    let tempFileCreated = false;

    try {
      // Convert PNGs to base64
      const imagesBase64 = slideImages.map(
        buf => `data:image/png;base64,${buf.toString('base64')}`
      );

      const pdfHtml = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; }
  body { background: white; }
  .page {
    width: ${pageWidth}px;
    height: ${pageHeight}px;
    page-break-after: always;
    overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }
  .page img {
    width: ${pageWidth}px;
    height: ${pageHeight}px;
    display: block;
  }
</style>
</head>
<body>
${imagesBase64.map(src => `<div class="page"><img src="${src}"></div>`).join('\n')}
</body>
</html>`;

      fs.writeFileSync(tempHtmlPath, pdfHtml, 'utf8');
      tempFileCreated = true;

      await pdfWin.loadFile(tempHtmlPath);
      await new Promise(r => setTimeout(r, 1000));

      // Generate PDF
      const pdfData = await pdfWin.webContents.printToPDF({
        pageSize: { width: pageWidth * 25.4 / 96, height: pageHeight * 25.4 / 96 },
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        preferCSSPageSize: false,
      });

      fs.writeFileSync(outputPdfPath, pdfData);
    } finally {
      if (tempFileCreated && fs.existsSync(tempHtmlPath)) {
        try { fs.unlinkSync(tempHtmlPath); } catch (e) {}
      }
      pdfWin.destroy();
    }
  } finally {
    renderWin.destroy();
  }

  return outputPdfPath;
}

module.exports = { convertHtmlToPdf };
