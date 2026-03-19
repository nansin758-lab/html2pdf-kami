const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { convertHtmlToPdf } = require('./converter');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 580,
    height: 460,
    resizable: false,
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#1a1a2e',
    titleBarStyle: 'default',
    title: 'HTML2PDF Kami',
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

// Handle file picker dialog
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 HTML 文件',
    filters: [
      { name: 'HTML Files', extensions: ['html', 'htm'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

// Handle HTML to PDF conversion
ipcMain.handle('convert-to-pdf', async (event, htmlFilePath) => {
  try {
    const parsed = path.parse(htmlFilePath);
    const outputPdf = path.join(parsed.dir, `${parsed.name}.pdf`);

    await convertHtmlToPdf(htmlFilePath, outputPdf);

    return { success: true, outputPath: outputPdf };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
