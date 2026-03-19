#!/usr/bin/env node

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

// ===== Configuration =====
const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;
const DEVICE_SCALE = 2; // 2x for retina-quality screenshots

/**
 * Find the bundled Chromium path.
 * When packaged as EXE, Chromium is in a 'chrome' folder next to the EXE.
 * In development, use the system-installed Chrome.
 */
function findChromePath() {
  // 1. Check for bundled chrome next to the executable
  const exeDir = path.dirname(process.execPath);
  const possiblePaths = [
    // Bundled with EXE (Windows)
    path.join(exeDir, 'chrome-win', 'chrome.exe'),
    path.join(exeDir, 'chrome', 'chrome.exe'),
    // Development on macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    // Development on Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    // Development on Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ];

  for (const chromePath of possiblePaths) {
    if (fs.existsSync(chromePath)) {
      return chromePath;
    }
  }

  return null;
}

/**
 * Convert an HTML file to PDF using screenshot-based approach.
 * This preserves all CSS effects including -webkit-background-clip: text,
 * gradients, shadows, emoji, etc.
 */
async function htmlToPdf(inputHtml, outputPdf) {
  const chromePath = findChromePath();
  if (!chromePath) {
    console.error('Error: Could not find Chrome/Chromium.');
    console.error('Please ensure Chrome is installed, or place chrome-win/ folder next to this executable.');
    process.exit(1);
  }

  console.log(`Using Chrome: ${chromePath}`);
  console.log(`Input: ${inputHtml}`);
  console.log(`Output: ${outputPdf}`);
  console.log('');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--font-render-hinting=none',
      '--disable-lcd-text',
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: SLIDE_WIDTH,
    height: SLIDE_HEIGHT,
    deviceScaleFactor: DEVICE_SCALE
  });

  console.log('Loading HTML file...');
  const fileUrl = `file://${path.resolve(inputHtml)}`;
  await page.goto(fileUrl, {
    waitUntil: 'networkidle0',
    timeout: 60000
  });

  // Wait for web fonts
  await page.evaluateHandle('document.fonts.ready');

  // Detect slides: look for .slide elements, or fall back to full-page mode
  const slideInfo = await page.evaluate(() => {
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
    // Full page mode: get the page dimensions
    const body = document.body;
    const html = document.documentElement;
    return {
      mode: 'fullpage',
      width: Math.max(body.scrollWidth, html.scrollWidth),
      height: Math.max(body.scrollHeight, html.scrollHeight)
    };
  });

  const tmpDir = path.join(path.dirname(outputPdf), '.html2pdf_tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  let slideImages = [];
  let pageWidth, pageHeight;

  if (slideInfo.mode === 'slides') {
    console.log(`Found ${slideInfo.count} slides. Capturing...`);
    pageWidth = slideInfo.rects[0].width;
    pageHeight = slideInfo.rects[0].height;

    for (let i = 0; i < slideInfo.count; i++) {
      const imgPath = path.join(tmpDir, `slide_${i}.png`);
      await page.screenshot({
        path: imgPath,
        clip: slideInfo.rects[i],
        type: 'png',
      });
      slideImages.push(imgPath);
      console.log(`  Captured slide ${i + 1}/${slideInfo.count}`);
    }
  } else {
    // Full page: capture viewport-sized chunks
    console.log(`Full page mode (${slideInfo.width}x${slideInfo.height}). Capturing...`);
    pageWidth = SLIDE_WIDTH;
    pageHeight = SLIDE_HEIGHT;
    const totalPages = Math.ceil(slideInfo.height / SLIDE_HEIGHT);

    for (let i = 0; i < totalPages; i++) {
      const imgPath = path.join(tmpDir, `page_${i}.png`);
      const clipHeight = Math.min(SLIDE_HEIGHT, slideInfo.height - i * SLIDE_HEIGHT);
      await page.screenshot({
        path: imgPath,
        clip: {
          x: 0,
          y: i * SLIDE_HEIGHT,
          width: pageWidth,
          height: clipHeight
        },
        type: 'png',
      });
      slideImages.push(imgPath);
      console.log(`  Captured page ${i + 1}/${totalPages}`);
    }
  }

  // Assemble PDF
  console.log('Assembling PDF...');
  const pdfPage = await browser.newPage();

  const imagesBase64 = slideImages.map(imgPath => {
    const data = fs.readFileSync(imgPath);
    return `data:image/png;base64,${data.toString('base64')}`;
  });

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

  await pdfPage.setContent(pdfHtml, { waitUntil: 'networkidle0' });

  await pdfPage.pdf({
    path: outputPdf,
    width: `${pageWidth}px`,
    height: `${pageHeight}px`,
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    preferCSSPageSize: false,
  });

  // Cleanup
  slideImages.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
  try { fs.rmdirSync(tmpDir); } catch(e) {}

  await browser.close();

  const stats = fs.statSync(outputPdf);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
  console.log('');
  console.log(`✅ PDF saved successfully! (${sizeMB} MB)`);
  console.log(`   ${outputPdf}`);
}

// ===== CLI Entry Point =====
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('html2pdf-kami v1.0.0');
    console.log('');
    console.log('Usage: html2pdf-kami <input.html> [output.pdf]');
    console.log('');
    console.log('  Converts HTML files to PDF with maximum visual fidelity.');
    console.log('  Supports slide-based layouts (1280x720) and full-page HTML.');
    console.log('');
    console.log('  If output path is not specified, the PDF will be created');
    console.log('  in the same directory as the input file.');
    console.log('');
    console.log('Tips:');
    console.log('  - On Windows, you can drag & drop an HTML file onto the EXE');
    console.log('  - All CSS effects (gradients, shadows, emoji) are preserved');
    console.log('');

    // If on Windows and no args, pause so the console window stays open
    if (process.platform === 'win32') {
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('Press Enter to exit...', () => { rl.close(); process.exit(0); });
    } else {
      process.exit(0);
    }
    return;
  }

  const inputHtml = path.resolve(args[0]);

  if (!fs.existsSync(inputHtml)) {
    console.error(`Error: File not found: ${inputHtml}`);
    process.exit(1);
  }

  if (!inputHtml.toLowerCase().endsWith('.html') && !inputHtml.toLowerCase().endsWith('.htm')) {
    console.warn(`Warning: Input file does not have .html extension: ${inputHtml}`);
  }

  // Output path: either specified, or same dir as input with .pdf extension
  let outputPdf;
  if (args.length >= 2) {
    outputPdf = path.resolve(args[1]);
  } else {
    const parsed = path.parse(inputHtml);
    outputPdf = path.join(parsed.dir, `${parsed.name}.pdf`);
  }

  htmlToPdf(inputHtml, outputPdf).catch(err => {
    console.error('');
    console.error('Conversion failed:', err.message);
    if (process.platform === 'win32') {
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('Press Enter to exit...', () => { rl.close(); process.exit(1); });
    } else {
      process.exit(1);
    }
  });
}

main();
