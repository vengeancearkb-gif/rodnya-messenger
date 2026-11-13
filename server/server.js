const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// Enable CORS and JSON parsing
app.use(cors({ origin: '*' }));
app.use(express.json());

// Directories
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const USERS_FILE = path.join(dataDir, 'users.json');
const MESSAGES_FILE = path.join(dataDir, 'messages.json');

// Serve uploaded files with strict security headers (prevent Stored XSS)
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; media-src 'self'; img-src 'self' data:;");
  next();
}, express.static(uploadsDir));

// Serve client static files
const publicDir = path.join(__dirname, 'public');
const clientDir = path.join(__dirname, '..', 'client');

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
}

// Guaranteed root and SPA route fallback so "Cannot GET /" NEVER happens!
app.get('/', (req, res) => {
  const publicIndex = path.join(publicDir, 'index.html');
  const clientIndex = path.join(clientDir, 'index.html');
  if (fs.existsSync(publicIndex)) return res.sendFile(publicIndex);
  if (fs.existsSync(clientIndex)) return res.sendFile(clientIndex);
  res.status(404).send('Messenger client not found');
});

// ================= Persistent Storage Helpers =================
function loadJson(file, defaultValue) {
  try {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error reading ${file}:`, err);
  }
  return defaultValue;
}

function saveJson(file, data) {
  try {
    const tempFile = `${file}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, file);
  } catch (err) {
    console.error(`Error saving ${file}:`, err);
  }
}

// In-memory caches backed by disk
const usersMap = new Map(); // username (lowercase) -> user object
const tokensMap = new Map(); // token -> username
const rawUsers = loadJson(USERS_FILE, []);
rawUsers.forEach(u => {
  // Ensure data structure compatibility
  if (!Array.isArray(u.deviceSecrets)) {
    u.deviceSecrets = [];
  }
  usersMap.set(u.username.toLowerCase(), u);
  if (u.token) {
    tokensMap.set(u.token, u.username.toLowerCase());
  }
});

function persistUsers() {
  saveJson(USERS_FILE, Array.from(usersMap.values()));
}

const roomHistory = new Map(); // roomId -> array of messages
const rawMessages = loadJson(MESSAGES_FILE, {});
for (const [roomId, msgs] of Object.entries(rawMessages)) {
  roomHistory.set(roomId, msgs);
}

// Debounced message persistence (prevents disk thrashing and event loop blocking)
let persistMessagesTimer = null;
function persistMessages() {
  if (persistMessagesTimer) return;
  persistMessagesTimer = setTimeout(() => {
    persistMessagesTimer = null;
    const obj = {};
    for (const [roomId, msgs] of roomHistory.entries()) {
      obj[roomId] = msgs.slice(-300); // keep last 300
    }
    saveJson(MESSAGES_FILE, obj);
  }, 1000);
}

// Clean up orphaned tokens periodically
function pruneTokens() {
  const validUsers = new Set(Array.from(usersMap.keys()));
  for (const [token, username] of tokensMap.entries()) {
    if (!validUsers.has(username)) {
      tokensMap.delete(token);
    }
  }
}
setInterval(pruneTokens, 3600000);

// ================= Password & Auth Helpers =================
function hashPasswordAsync(password, salt, iterations = 100000) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 64, 'sha512', (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey.toString('hex'));
    });
  });
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

async function verifyPassword(password, user) {
  if (!password || !user || !user.passwordHash || !user.salt) return false;
  const iterations = user.hashIterations || 1000; // backward-compat with legacy 1,000 hashes
  const candidate = await hashPasswordAsync(password, user.salt, iterations);
  const bufCandidate = Buffer.from(candidate, 'hex');
  const bufExpected = Buffer.from(user.passwordHash, 'hex');
  if (bufCandidate.length !== bufExpected.length) return false;
  const isMatch = crypto.timingSafeEqual(bufCandidate, bufExpected);

  // Upgrade legacy hash to 100,000 iterations automatically upon successful login
  if (isMatch && iterations < 100000) {
    user.hashIterations = 100000;
    user.passwordHash = await hashPasswordAsync(password, user.salt, 100000);
    persistUsers();
  }
  return isMatch;
}

function verifyDeviceSecret(secret, user) {
  if (!secret || !user || !Array.isArray(user.deviceSecrets)) return false;
  const hashed = hashSecret(secret);
  return user.deviceSecrets.includes(hashed);
}

function addDeviceSecret(user, secret) {
  if (!user || !secret) return;
  if (!Array.isArray(user.deviceSecrets)) {
    user.deviceSecrets = [];
  }
  const hashed = hashSecret(secret);
  if (!user.deviceSecrets.includes(hashed)) {
    user.deviceSecrets.push(hashed);
    if (user.deviceSecrets.length > 10) {
      user.deviceSecrets.shift(); // keep max 10 devices
    }
  }
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateDeviceSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function getUserByToken(token) {
  if (!token) return null;
  const username = tokensMap.get(token);
  if (!username) return null;
  return usersMap.get(username) || null;
}

function sanitizeUser(u) {
  if (!u) return null;
  const { salt, passwordHash, hashIterations, deviceSecrets, ...clean } = u;
  return clean;
}

// ================= Multer File Upload Configuration =================
const ALLOWED_EXTENSIONS = new Set([
  // Images
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp',
  // Audio
  '.mp3', '.ogg', '.wav', '.webm', '.m4a', '.aac', '.flac',
  // Documents & Archives
  '.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.tar', '.gz'
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    let ext = (path.extname(file.originalname) || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      ext = '.bin';
    }
    const safeName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    const blocked = ['.html', '.htm', '.svg', '.xml', '.js', '.mjs', '.php', '.sh', '.exe', '.bat'];
    if (blocked.includes(ext)) {
      return cb(new Error('Загрузка HTML, SVG и исполняемых скриптов запрещена'));
    }
    cb(null, true);
  }
});

// Middleware: Require Bearer authentication for uploads
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || req.query.token;
  const user = getUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Необходима авторизация для загрузки файлов' });
  }
  req.user = user;
  next();
}

// Upload endpoint with JSON error handler
app.post('/api/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Файл слишком большой. Максимальный размер 50 МБ.' });
      }
      return res.status(400).json({ error: err.message || 'Ошибка загрузки файла' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не был выбран' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({
      url: fileUrl,
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  });
});

// ================= Authentication & Profile REST API =================

// Register a new profile
app.post('/api/auth/register', async (req, res) => {
  let { username, password, displayName, avatar, bio } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }

  username = username.trim();
  const cleanUsername = username.toLowerCase();

  if (cleanUsername.length < 2 || cleanUsername.length > 30) {
    return res.status(400).json({ error: 'Логин должен содержать от 2 до 30 символов' });
  }

  if (password.length < 3) {
    return res.status(400).json({ error: 'Пароль должен содержать не менее 3 символов' });
  }

  if (usersMap.has(cleanUsername)) {
    const existingUser = usersMap.get(cleanUsername);
    if (existingUser && existingUser.passwordHash) {
      const match = await verifyPassword(password, existingUser);
      if (match) {
        const token = generateToken();
        const deviceSecret = generateDeviceSecret();
        existingUser.token = token;
        addDeviceSecret(existingUser, deviceSecret);
        if (displayName && displayName.trim()) existingUser.displayName = displayName.trim();
        if (avatar) existingUser.avatar = avatar;
        if (bio && bio.trim()) existingUser.bio = bio.trim();
        existingUser.lastSeen = new Date().toISOString();
        tokensMap.set(token, cleanUsername);
        persistUsers();
        return res.json({
          ok: true,
          token,
          deviceSecret,
          user: sanitizeUser(existingUser)
        });
      }
    }
    return res.status(400).json({ error: 'Пользователь с таким логином уже существует. Выберите другой или перейдите на вкладку «Вход».' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = await hashPasswordAsync(password, salt, 100000);
  const token = generateToken();
  const deviceSecret = generateDeviceSecret();

  const newUser = {
    id: `u_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    username: cleanUsername,
    displayName: (displayName && displayName.trim()) ? displayName.trim() : username,
    avatar: avatar || null,
    bio: (bio && bio.trim()) ? bio.trim() : 'На связи',
    salt,
    passwordHash,
    hashIterations: 100000,
    deviceSecrets: [hashSecret(deviceSecret)],
    token,
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString()
  };

  usersMap.set(cleanUsername, newUser);
  tokensMap.set(token, cleanUsername);
  persistUsers();

  res.json({
    ok: true,
    token,
    deviceSecret,
    user: sanitizeUser(newUser)
  });
});

// Login to existing profile
app.post('/api/auth/login', async (req, res) => {
  let { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Введите логин и пароль' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const user = usersMap.get(cleanUsername);

  if (!user) {
    return res.status(400).json({ error: 'Пользователь с таким логином не найден' });
  }

  const match = await verifyPassword(password, user);
  if (!match) {
    return res.status(400).json({ error: 'Неверный пароль или PIN-код' });
  }

  // Issue new token and deviceSecret
  const token = generateToken();
  const deviceSecret = generateDeviceSecret();
  user.token = token;
  addDeviceSecret(user, deviceSecret);
  user.lastSeen = new Date().toISOString();
  tokensMap.set(token, cleanUsername);
  persistUsers();

  res.json({
    ok: true,
    token,
    deviceSecret,
    user: sanitizeUser(user)
  });
});

// Check current user session
app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || req.query.token;
  const user = getUserByToken(token);

  if (!user) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  res.json({ ok: true, user: sanitizeUser(user) });
});

// Restore or self-heal user session from client storage
app.post('/api/auth/restore-session', async (req, res) => {
  let { username, password, deviceSecret, displayName, avatar, bio } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Логин обязателен' });
  }

  const cleanUsername = username.trim().toLowerCase();
  let user = usersMap.get(cleanUsername);

  if (user) {
    // STRICT AUTH CHECK: Must verify deviceSecret OR valid password. NEVER allow empty bypass!
    const validSecret = deviceSecret && verifyDeviceSecret(deviceSecret, user);
    const validPassword = password && (await verifyPassword(password, user));

    if (!validSecret && !validPassword) {
      return res.status(401).json({ error: 'Сессия истекла или неверный пароль. Войдите снова.' });
    }

    if (displayName && displayName.trim()) user.displayName = displayName.trim();
    if (avatar) user.avatar = avatar;
    if (bio && bio.trim()) user.bio = bio.trim();
    user.lastSeen = new Date().toISOString();
  } else {
    // Recreate user on server (self-healing after Render container reset)
    // Strictly requires password to prevent taking over arbitrary usernames!
    if (!password || password.length < 3) {
      return res.status(401).json({ error: 'Сессия истекла. Войдите с паролем для восстановления.' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = await hashPasswordAsync(password, salt, 100000);
    user = {
      id: `u_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      username: cleanUsername,
      displayName: (displayName && displayName.trim()) ? displayName.trim() : cleanUsername,
      avatar: avatar || null,
      bio: (bio && bio.trim()) ? bio.trim() : 'На связи',
      salt,
      passwordHash,
      hashIterations: 100000,
      deviceSecrets: [],
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };
    usersMap.set(cleanUsername, user);
  }

  const token = generateToken();
  user.token = token;
  tokensMap.set(token, cleanUsername);

  let returnDeviceSecret = deviceSecret;
  if (!returnDeviceSecret || !verifyDeviceSecret(returnDeviceSecret, user)) {
    returnDeviceSecret = generateDeviceSecret();
    addDeviceSecret(user, returnDeviceSecret);
  }

  persistUsers();

  res.json({
    ok: true,
    token,
    deviceSecret: returnDeviceSecret,
    user: sanitizeUser(user)
  });
});

// Update own profile (name, avatar, bio)
app.post('/api/profile/update', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || req.body.token;
  const user = getUserByToken(token);

  if (!user) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  const { displayName, avatar, bio } = req.body;

  if (displayName !== undefined && displayName.trim()) {
    user.displayName = displayName.trim();
  }
  if (avatar !== undefined) {
    user.avatar = avatar;
  }
  if (bio !== undefined) {
    user.bio = bio.trim();
  }

  user.lastSeen = new Date().toISOString();
  persistUsers();

  // Notify connected sockets of profile change
  const clean = sanitizeUser(user);
  for (const [socketId, onlineUser] of onlineUsers.entries()) {
    if (onlineUser.username.toLowerCase() === user.username.toLowerCase()) {
      onlineUser.displayName = clean.displayName;
      onlineUser.avatar = clean.avatar;
      onlineUser.bio = clean.bio;
      io.to(onlineUser.roomId).emit('users-update', getRoomUsers(onlineUser.roomId));
    }
  }

  res.json({ ok: true, user: clean });
});

// Get public profile of another user
app.get('/api/profile/:username', (req, res) => {
  const cleanUsername = (req.params.username || '').toLowerCase();
  const user = usersMap.get(cleanUsername);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  // Check if online
  let isOnline = false;
  let inCall = false;
  for (const online of onlineUsers.values()) {
    if (online.username.toLowerCase() === cleanUsername) {
      isOnline = true;
      inCall = online.inCall;
      break;
    }
  }

  res.json({
    ok: true,
    user: {
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      isOnline,
      inCall,
      lastSeen: user.lastSeen
    }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), usersCount: usersMap.size, onlineCount: onlineUsers.size });
});

app.get('/api/debug/users', (req, res) => {
  const list = [];
  for (const [sId, u] of onlineUsers.entries()) {
    list.push({
      socketId: sId,
      username: u.username,
      displayName: u.displayName,
      roomId: u.roomId,
      inCall: u.inCall,
      isNativeBackground: u.isNativeBackground || false
    });
  }
  res.json({ count: list.length, users: list });
});

// SPA Fallback: serve index.html for all non-API GET requests
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) {
    return next();
  }
  const publicIndex = path.join(publicDir, 'index.html');
  if (fs.existsSync(publicIndex)) {
    return res.sendFile(publicIndex);
  }
  const clientIndex = path.join(clientDir, 'index.html');
  if (fs.existsSync(clientIndex)) {
    return res.sendFile(clientIndex);
  }
  next();
});

// ================= Setup Socket.IO =================
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 25000,
  pingTimeout: 20000, // Mobile-friendly timeout to prevent disconnects on 3G/4G
  maxHttpBufferSize: 1e7
});

// Online users map: socket.id -> { socketId, username, displayName, avatar, bio, roomId, inCall, isNativeBackground }
const onlineUsers = new Map();

// Active call pairs: socket.id -> { peerSocketId, roomId }
const activeCallPairs = new Map();

// Pending ICE candidates buffer for ringing calls: callerSocketId -> Array<candidate>
const pendingCallCandidates = new Map();

function getRoomHistory(roomId) {
  if (!roomHistory.has(roomId)) {
    roomHistory.set(roomId, []);
  }
  return roomHistory.get(roomId);
}

function getRoomUsers(roomId) {
  const usersMapResult = new Map();
  for (const [id, user] of onlineUsers.entries()) {
    if (user.roomId === roomId) {
      const existing = usersMapResult.get(user.username.toLowerCase());
      if (!existing) {
        usersMapResult.set(user.username.toLowerCase(), {
          id: user.socketId,
          username: user.username,
          displayName: user.displayName || user.username,
          avatar: user.avatar || null,
          bio: user.bio || '',
          inCall: user.inCall || false,
          isNativeBackground: user.isNativeBackground || false
        });
      } else {
        if (user.inCall) existing.inCall = true;
        // Prefer foreground interactive session for direct call target ID
        if (!user.isNativeBackground && existing.isNativeBackground) {
          existing.id = user.socketId;
          existing.isNativeBackground = false;
        }
      }
    }
  }
  return Array.from(usersMapResult.values());
}

io.on('connection', (socket) => {
  let currentUser = null;

  // User joins a room / family space
  socket.on('join-room', async ({ token, deviceSecret, username, displayName, avatar, bio, roomId, isNativeBackground }) => {
    const cleanRoomId = (roomId || 'semya').trim().toLowerCase();

    // 1. Authenticate user by token
    let dbUser = getUserByToken(token);

    // 2. If token expired, verify with deviceSecret
    if (!dbUser && username && deviceSecret) {
      const cleanUsername = username.trim().toLowerCase();
      const candidate = usersMap.get(cleanUsername);
      if (candidate && verifyDeviceSecret(deviceSecret, candidate)) {
        dbUser = candidate;
        const newToken = generateToken();
        dbUser.token = newToken;
        tokensMap.set(newToken, cleanUsername);
        socket.emit('session-token', { token: newToken });
      }
    }

    // 3. Prevent unauthorized users from claiming registered usernames!
    if (!dbUser && username) {
      const cleanUsername = username.trim().toLowerCase();
      if (usersMap.has(cleanUsername)) {
        socket.emit('auth-error', { message: 'Требуется авторизация для этого профиля' });
        return;
      }
    }

    let finalUsername = dbUser ? dbUser.username : (username || 'Гость').trim();
    let finalDisplayName = dbUser ? dbUser.displayName : (displayName || finalUsername);
    let finalAvatar = dbUser ? dbUser.avatar : (avatar || null);
    let finalBio = dbUser ? dbUser.bio : (bio || '');

    if (dbUser) {
      dbUser.lastSeen = new Date().toISOString();
      persistUsers();
    }

    currentUser = {
      socketId: socket.id,
      username: finalUsername,
      displayName: finalDisplayName,
      avatar: finalAvatar,
      bio: finalBio,
      roomId: cleanRoomId,
      inCall: false,
      isNativeBackground: !!isNativeBackground
    };

    socket.join(cleanRoomId);
    onlineUsers.set(socket.id, currentUser);

    // Send existing room history to joined user
    const history = getRoomHistory(cleanRoomId);
    socket.emit('room-history', history);

    // Notify room of online users list
    io.to(cleanRoomId).emit('users-update', getRoomUsers(cleanRoomId));

    // Emit system notice only for interactive user connections
    if (!isNativeBackground) {
      socket.to(cleanRoomId).emit('user-joined', {
        username: currentUser.displayName || currentUser.username,
        id: socket.id,
        time: new Date().toISOString()
      });
    }
  });

  // Sending a message
  socket.on('send-message', (data) => {
    if (!currentUser) return;

    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      roomId: currentUser.roomId,
      senderId: socket.id,
      senderUsername: currentUser.username,
      senderName: currentUser.displayName || currentUser.username,
      senderAvatar: currentUser.avatar || null,
      type: data.type || 'text', // 'text', 'voice', 'image', 'file'
      text: data.text || '',
      fileUrl: data.fileUrl || null,
      fileName: data.fileName || null,
      fileSize: data.fileSize || null,
      duration: data.duration || null,
      timestamp: Date.now()
    };

    // Store in history and persist
    const history = getRoomHistory(currentUser.roomId);
    history.push(message);
    if (history.length > 300) {
      history.shift();
    }
    persistMessages();

    // Broadcast to everyone in room
    io.to(currentUser.roomId).emit('new-message', message);
  });

  // Typing indicator
  socket.on('typing', (isTyping) => {
    if (!currentUser) return;
    socket.to(currentUser.roomId).emit('user-typing', {
      username: currentUser.displayName || currentUser.username,
      id: socket.id,
      isTyping: !!isTyping
    });
  });

  // ================= WebRTC Audio Calling =================
  socket.on('call-user', ({ targetUserId, targetUsername, offer }) => {
    if (!currentUser) return;

    // Filter target sockets: match by username OR display name in the same room!
    let targetSockets = [];
    if (targetUsername && targetUsername.trim() !== '') {
      const cleanTarget = targetUsername.trim().toLowerCase();
      for (const [sId, u] of onlineUsers.entries()) {
        const matchesUser = u.username.toLowerCase() === cleanTarget;
        const matchesDisplay = u.displayName && u.displayName.trim().toLowerCase() === cleanTarget;
        if ((matchesUser || matchesDisplay) && sId !== socket.id && u.roomId === currentUser.roomId) {
          targetSockets.push({ socketId: sId, user: u });
        }
      }
    }

    if (targetSockets.length === 0 && targetUserId) {
      const directTarget = onlineUsers.get(targetUserId);
      if (directTarget && directTarget.roomId === currentUser.roomId) {
        for (const [sId, u] of onlineUsers.entries()) {
          if (u.username.toLowerCase() === directTarget.username.toLowerCase() && sId !== socket.id && u.roomId === currentUser.roomId) {
            targetSockets.push({ socketId: sId, user: u });
          }
        }
      }
    }

    if (targetSockets.length === 0) {
      return socket.emit('call-error', { message: 'Собеседник не найден или не в сети в этой комнате' });
    }

    // Only block if target is actively in an established call pair
    const isTargetBusy = targetSockets.some(t => activeCallPairs.has(t.socketId));
    if (isTargetBusy) {
      return socket.emit('call-busy', { message: 'Собеседник сейчас разговаривает' });
    }

    currentUser.inCall = true;
    pendingCallCandidates.set(socket.id, []);
    for (const t of targetSockets) {
      t.user.inCall = true;
    }
    io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));

    // Emit incoming call to all sockets of target (background service + active app)
    for (const t of targetSockets) {
      io.to(t.socketId).emit('call-incoming', {
        fromUserId: socket.id,
        fromUsername: currentUser.displayName || currentUser.username,
        fromAvatar: currentUser.avatar || null,
        targetUsername: t.user.username,
        offer
      });
    }
  });

  socket.on('call-answer', ({ targetUserId, answer }) => {
    if (!currentUser) return;
    currentUser.inCall = true;

    // Track active call pair
    activeCallPairs.set(socket.id, { peerSocketId: targetUserId, roomId: currentUser.roomId });
    activeCallPairs.set(targetUserId, { peerSocketId: socket.id, roomId: currentUser.roomId });

    io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));

    io.to(targetUserId).emit('call-answered', {
      fromUserId: socket.id,
      answer
    });

    // Flush any buffered caller candidates directly to this answering callee!
    if (pendingCallCandidates.has(targetUserId)) {
      const candidates = pendingCallCandidates.get(targetUserId);
      for (const cand of candidates) {
        io.to(socket.id).emit('ice-candidate', {
          fromUserId: targetUserId,
          candidate: cand
        });
      }
      pendingCallCandidates.delete(targetUserId);
    }
  });

  socket.on('call-reject', ({ targetUserId, reason }) => {
    pendingCallCandidates.delete(socket.id);
    if (targetUserId) pendingCallCandidates.delete(targetUserId);

    if (currentUser) {
      currentUser.inCall = false;
      for (const [sId, u] of onlineUsers.entries()) {
        if (u.username.toLowerCase() === currentUser.username.toLowerCase()) {
          u.inCall = false;
        }
      }
      activeCallPairs.delete(socket.id);
      io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));
    }

    if (targetUserId) {
      activeCallPairs.delete(targetUserId);
    }

    const directTarget = onlineUsers.get(targetUserId);
    if (directTarget) {
      for (const [sId, u] of onlineUsers.entries()) {
        if (u.username.toLowerCase() === directTarget.username.toLowerCase()) {
          u.inCall = false;
          io.to(sId).emit('call-rejected', {
            fromUserId: socket.id,
            reason: reason || 'Отклонён'
          });
        }
      }
      io.to(directTarget.roomId).emit('users-update', getRoomUsers(directTarget.roomId));
    } else if (targetUserId) {
      io.to(targetUserId).emit('call-rejected', {
        fromUserId: socket.id,
        reason: reason || 'Отклонён'
      });
    }
  });

  socket.on('call-end', ({ targetUserId, targetUsername }) => {
    pendingCallCandidates.delete(socket.id);
    if (targetUserId) pendingCallCandidates.delete(targetUserId);

    if (currentUser) {
      currentUser.inCall = false;
      for (const [sId, u] of onlineUsers.entries()) {
        if (u.username.toLowerCase() === currentUser.username.toLowerCase()) {
          u.inCall = false;
        }
      }
      activeCallPairs.delete(socket.id);
      io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));
    }

    if (targetUserId) {
      activeCallPairs.delete(targetUserId);
    }

    let targetSockets = [];
    if (targetUsername && targetUsername.trim() !== '') {
      const cleanTarget = targetUsername.trim().toLowerCase();
      for (const [sId, u] of onlineUsers.entries()) {
        if (u.username.toLowerCase() === cleanTarget) {
          targetSockets.push({ socketId: sId, user: u });
        }
      }
    }

    if (targetSockets.length === 0 && targetUserId) {
      const directTarget = onlineUsers.get(targetUserId);
      if (directTarget) {
        for (const [sId, u] of onlineUsers.entries()) {
          if (u.username.toLowerCase() === directTarget.username.toLowerCase()) {
            targetSockets.push({ socketId: sId, user: u });
          }
        }
      } else {
        io.to(targetUserId).emit('call-ended', { fromUserId: socket.id });
      }
    }

    for (const t of targetSockets) {
      t.user.inCall = false;
      activeCallPairs.delete(t.socketId);
      io.to(t.socketId).emit('call-ended', { fromUserId: socket.id });
    }
    if (targetSockets.length > 0) {
      io.to(targetSockets[0].user.roomId).emit('users-update', getRoomUsers(targetSockets[0].user.roomId));
    }
  });

  socket.on('ice-candidate', ({ targetUserId, targetUsername, candidate }) => {
    if (!candidate || !currentUser) return;

    // 1. If actively in a call pair, route directly to the active peer socket!
    if (activeCallPairs.has(socket.id)) {
      const pair = activeCallPairs.get(socket.id);
      return io.to(pair.peerSocketId).emit('ice-candidate', {
        fromUserId: socket.id,
        candidate
      });
    }

    // 2. If caller is gathering candidates before answer, buffer them!
    if (pendingCallCandidates.has(socket.id)) {
      pendingCallCandidates.get(socket.id).push(candidate);
    }

    // 3. Forward to target user sockets
    let targetSockets = [];
    if (targetUsername) {
      const cleanTarget = targetUsername.trim().toLowerCase();
      for (const [sId, u] of onlineUsers.entries()) {
        if (u.username.toLowerCase() === cleanTarget && sId !== socket.id) {
          targetSockets.push(sId);
        }
      }
    }
    if (targetSockets.length === 0 && targetUserId) {
      targetSockets.push(targetUserId);
    }

    for (const tId of targetSockets) {
      io.to(tId).emit('ice-candidate', {
        fromUserId: socket.id,
        candidate
      });
    }
  });

  // Relay live audio stream fallback if WebRTC P2P direct NAT traversal fails
  socket.on('call-audio-chunk', ({ targetUserId, targetUsername, chunk }) => {
    if (!chunk) return;
    if (activeCallPairs.has(socket.id)) {
      const pair = activeCallPairs.get(socket.id);
      return io.to(pair.peerSocketId).emit('call-audio-chunk', {
        fromUserId: socket.id,
        chunk
      });
    }
    if (targetUserId) {
      io.to(targetUserId).emit('call-audio-chunk', {
        fromUserId: socket.id,
        chunk
      });
    } else if (targetUsername) {
      const cleanTarget = targetUsername.trim().toLowerCase();
      for (const [sId, u] of onlineUsers.entries()) {
        if (u.username.toLowerCase() === cleanTarget && sId !== socket.id) {
          io.to(sId).emit('call-audio-chunk', {
            fromUserId: socket.id,
            chunk
          });
        }
      }
    }
  });

  socket.on('call-audio-relay-start', ({ targetUserId, targetUsername }) => {
    if (activeCallPairs.has(socket.id)) {
      const pair = activeCallPairs.get(socket.id);
      return io.to(pair.peerSocketId).emit('call-audio-relay-start', { fromUserId: socket.id });
    }
    if (targetUserId) {
      io.to(targetUserId).emit('call-audio-relay-start', { fromUserId: socket.id });
    } else if (targetUsername) {
      const cleanTarget = targetUsername.trim().toLowerCase();
      for (const [sId, u] of onlineUsers.entries()) {
        if (u.username.toLowerCase() === cleanTarget && sId !== socket.id) {
          io.to(sId).emit('call-audio-relay-start', { fromUserId: socket.id });
        }
      }
    }
  });

  socket.on('disconnect', () => {
    pendingCallCandidates.delete(socket.id);
    // If user was in an active call, notify the other peer immediately!
    if (activeCallPairs.has(socket.id)) {
      const pair = activeCallPairs.get(socket.id);
      activeCallPairs.delete(socket.id);
      activeCallPairs.delete(pair.peerSocketId);

      const peerUser = onlineUsers.get(pair.peerSocketId);
      if (peerUser) {
        peerUser.inCall = false;
      }
      io.to(pair.peerSocketId).emit('call-ended', { fromUserId: socket.id, reason: 'Собеседник отключился' });
    }

    if (currentUser) {
      onlineUsers.delete(socket.id);
      io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));
      if (!currentUser.isNativeBackground) {
        socket.to(currentUser.roomId).emit('user-left', {
          username: currentUser.displayName || currentUser.username,
          id: socket.id,
          time: new Date().toISOString()
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(` Messenger Server running on port ${PORT}`);
  console.log(` Local:   http://localhost:${PORT}`);
  console.log(` Network: http://0.0.0.0:${PORT}`);
  console.log(` Users stored: ${usersMap.size}`);
  console.log(`===============================================`);
});
