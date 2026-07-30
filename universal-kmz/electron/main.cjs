const { app, BrowserWindow, Menu, dialog, nativeImage, shell } = require('electron');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

app.setName('Universal KMZ');

let mainWindow = null;
let serverProcess = null;
let shuttingDown = false;
let serverPort = null;
let serverReady = false;
let serverRestartAttempted = false;
let serverLogPath = '';
let serverLogBytes = 0;

// Limite simples para o log não crescer sem teto: ao estourar, o arquivo é reiniciado.
const SERVER_LOG_MAX_BYTES = 2 * 1024 * 1024;

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
  const logsDir = path.join(userData, 'logs');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(cnefeDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  process.env.GEOCODE_CACHE_DIR = userData;
  process.env.CNEFE_DIR = cnefeDir;
  serverLogPath = path.join(logsDir, 'servidor.log');
  serverLogBytes = fs.existsSync(serverLogPath) ? fs.statSync(serverLogPath).size : 0;
  return { userData, cnefeDir, logsDir };
}

function appendServerLog(stream, data) {
  if (!serverLogPath) return;
  const message = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  const entry = `[${new Date().toISOString()}] [${stream}] ${message}`;
  const entryBytes = Buffer.byteLength(entry, 'utf8');

  if (serverLogBytes + entryBytes > SERVER_LOG_MAX_BYTES) {
    const header = `[${new Date().toISOString()}] [log] Log reiniciado ao passar de ${SERVER_LOG_MAX_BYTES} bytes.\n`;
    try {
      fs.writeFileSync(serverLogPath, header, 'utf8');
      serverLogBytes = Buffer.byteLength(header, 'utf8');
    } catch (error) {
      console.error(`Não foi possível reiniciar o log do servidor: ${error.message}`);
      return;
    }
  }

  serverLogBytes += entryBytes;
  fs.appendFile(serverLogPath, entry, error => {
    if (error) {
      console.error(`Não foi possível gravar o log do servidor: ${error.message}`);
    }
  });
}

function exitWithError(title, error) {
  const details = error instanceof Error ? error.message : String(error);
  console.error(`${title}: ${details}`);
  dialog.showErrorBox(
    title,
    `${details}\n\nConsulte o log em ${serverLogPath || 'a pasta de dados do aplicativo'} e tente novamente.`
  );
  app.exit(1);
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

function waitForServer(port, timeoutMs = 30000, getExitError = () => null) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const exitError = getExitError();
      if (exitError) {
        reject(exitError);
        return;
      }
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
  serverReady = false;
  let exitError = null;
  const child = fork(serverPath, [], {
    cwd: app.isPackaged ? path.dirname(process.execPath) : app.getAppPath(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  serverProcess = child;
  child.stdout?.on('data', data => appendServerLog('stdout', data));
  child.stderr?.on('data', data => appendServerLog('stderr', data));
  child.once('exit', (code, signal) => {
    const unexpectedExit = new Error(`Servidor local encerrou inesperadamente (código=${code}, sinal=${signal || 'nenhum'}).`);
    appendServerLog('processo', `${unexpectedExit.message}\n`);
    if (serverProcess === child) {
      serverProcess = null;
    }
    if (shuttingDown) return;
    if (!serverReady) {
      exitError = unexpectedExit;
      return;
    }

    serverReady = false;
    if (serverRestartAttempted) {
      exitWithError('Servidor local indisponível', unexpectedExit);
      return;
    }

    serverRestartAttempted = true;
    void restartEmbeddedServer(unexpectedExit);
  });
  await waitForServer(port, 30000, () => exitError);
  serverReady = true;
}

async function restartEmbeddedServer(cause) {
  appendServerLog('processo', `Tentando reiniciar o servidor após falha: ${cause.message}\n`);
  try {
    await startEmbeddedServer(serverPort);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reloadIgnoringCache();
    }
  } catch (error) {
    if (!shuttingDown) {
      exitWithError('Não foi possível reiniciar o servidor local', error);
    }
  }
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
  const localOrigin = `http://127.0.0.1:${port}`;
  const isLocalOrigin = url => {
    try {
      return new URL(url).origin === localOrigin;
    } catch {
      return false;
    }
  };
  const openExternalHttpUrl = url => {
    try {
      const target = new URL(url);
      if (target.protocol === 'http:' || target.protocol === 'https:') {
        void shell.openExternal(target.toString()).catch(error => {
          console.error(`Não foi possível abrir o link externo: ${error.message}`);
        });
      }
    } catch {
      // URLs inválidas e protocolos não HTTP(S) permanecem bloqueados.
    }
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isLocalOrigin(url)) {
      openExternalHttpUrl(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isLocalOrigin(url)) {
      event.preventDefault();
      openExternalHttpUrl(url);
    }
  });
  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

function stopServer() {
  shuttingDown = true;
  serverReady = false;
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
  serverProcess = null;
}

app.whenReady()
  .then(async () => {
    ensureUserDataDirs();
    createMenu();
    serverPort = await getFreePort();
    await startEmbeddedServer(serverPort);
    await createWindow(serverPort);
  })
  .catch(error => {
    exitWithError('Não foi possível iniciar o Universal KMZ', error);
  });

app.on('window-all-closed', () => {
  stopServer();
  app.quit();
});

app.on('before-quit', stopServer);
