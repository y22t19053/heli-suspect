'use strict';
/* 合理怀疑 · 桌面版启动器
 * 做三件事：
 *  1. 在本机起一个只给这台机器/局域网用的 Node 服务器；
 *  2. 用 Electron 打开本地页面；
 *  3. 房间快照写到 userData（asar 内只读）。
 * 不依赖外部服务，双击即玩；联机时这台电脑就是主机。
 */
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const net = require('net');
const http = require('http');

let mainWindow = null;
let serverStarted = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function findFreePort(preferred) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const probe = net.createServer();
      probe.once('error', () => tryPort(port + 1));
      probe.once('listening', () => probe.close(() => resolve(port)));
      probe.listen(port, '0.0.0.0');
    };
    tryPort(preferred);
  });
}

function waitHealth(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) return reject(new Error('本地服务器启动超时'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

async function bootServer() {
  if (serverStarted) return Number(process.env.PORT);
  const port = await findFreePort(Number(process.env.HELI_PORT) || 3000);
  process.env.PORT = String(port);
  process.env.SNAPSHOT_DIR = app.getPath('userData');
  process.env.NODE_ENV = 'production';
  // require 会执行 server.listen；静态资源、Socket.IO 都在这个进程里
  require(path.join(__dirname, '..', 'server.js'));
  serverStarted = true;
  await waitHealth(port, 20000);
  return port;
}

function createWindow(port) {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0E0F1A',
    show: false,
    autoHideMenuBar: true,
    title: '合理怀疑 · 世纪审判',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadURL('http://127.0.0.1:' + port + '/');
  mainWindow.setTitle('合理怀疑 · 世纪审判   本地服务器 :' + port);
}

app.whenReady().then(async () => {
  try {
    const port = await bootServer();
    createWindow(port);
  } catch (err) {
    dialog.showErrorBox('启动失败', '本地服务器没有起来：\n' + (err && err.message ? err.message : err));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
