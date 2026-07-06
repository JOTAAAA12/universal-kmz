const { app, BrowserWindow, Menu, nativeImage } = require('electron');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

app.setName('Universal KMZ');

let mainWindow = null;
let serverProcess = null;
let shuttingDown = false;

function resolveAppPath(...segments) {
  const candidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', ...segments),
    path.join(app.getAppPath(), ...segments),
    path.join(process.resourcesPath || '', 'app.asar', ...segments),
    path.join(process.resourcesPath || '', 'app', ...segments),
    path.join(process.cwd(), ...segments)
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function resolveIcon() {
  const candidates = [
    resolveAppPath('electron', 'icon.png'),
    resolveAppPath('electron', 'icon.svg')
  ];
  const iconPath = candidates.find(candidate => fs.existsSync(candidate));
  return iconPath ? nativeImage.createFromPath(iconPath) : undefined;
}

function ensureUserDataDirs() {
  const userData = app.getPath('userData');
  const cnefeDir = path.join(userData, 'cnefe');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(cnefeDir, { recursive: true });
  process.env.GEOCODE_CACHE_DIR = userData;
  process.env.CNEFE_DIR = cnefeDir;
  return { userData, cnefeDir };
}

function getFreePort(start = 3000, end = 3010) {
  return new Promise((resolve, reject) => {
    const tryPort = port => {
      if (port > end) {
        reject(new Error(`Nenhuma porta livre encontrada entre ${start} e ${end}.`));
        return;
      }
      const tester = net.createServer()
        .once('error', () => tryPort(port + 1))
        .once('listening', () => {
          tester.close(() => resolve(port));
        })
        .listen(port, '127.0.0.1');
    };
    tryPort(start);
  });
}

function waitForServer(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get({ hostname: '127.0.0.1', port, path: '/', timeout: 1500 }, res => {
        res.resume();
        resolve();
      });
      req.on('timeout', () => req.destroy());
      req.on('error', error => {
        if (Date.now() >= deadline) {
          reject(new Error(`Servidor local nao respondeu na porta ${port}: ${error.message}`));
          return;
        }
        setTimeout(poll, 300);
      });
    };
    poll();
  });
}

async function startEmbeddedServer(port) {
  const serverPath = resolveAppPath('dist', 'server.cjs');
  if (!fs.existsSync(serverPath)) {
    throw new Error(`Bundle do servidor nao encontrado: ${serverPath}`);
  }
  serverProcess = fork(serverPath, [], {
    cwd: app.isPackaged ? path.dirname(process.execPath) : app.getAppPath(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port)
    },
    stdio: app.isPackaged ? 'ignore' : 'inherit'
  });
  serverProcess.once('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`Servidor local encerrou inesperadamente (code=${code}, signal=${signal}).`);
    }
  });
  await waitForServer(port);
}

function createMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Recarregar', role: 'reload' },
        ...(app.isPackaged ? [] : [{ label: 'DevTools', role: 'toggleDevTools' }]),
        { type: 'separator' },
        { label: 'Sair', role: 'quit' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(port) {
  const icon = resolveIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolveAppPath('electron', 'preload.cjs')
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

function stopServer() {
  shuttingDown = true;
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
  serverProcess = null;
}

app.whenReady().then(async () => {
  ensureUserDataDirs();
  createMenu();
  const port = await getFreePort();
  await startEmbeddedServer(port);
  await createWindow(port);
});

app.on('window-all-closed', () => {
  stopServer();
  app.quit();
});

app.on('before-quit', stopServer);
