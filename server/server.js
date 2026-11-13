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

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// Serve client static files
const publicDir = path.join(__dirname, 'public');
const clientDir = path.join(__dirname, '..', 'client');

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
} else if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
}

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

function persistMessages() {
  const obj = {};
  for (const [roomId, msgs] of roomHistory.entries()) {
    obj[roomId] = msgs.slice(-300); // keep last 300
  }
  saveJson(MESSAGES_FILE, obj);
}

// ================= Password & Auth Helpers =================
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

function generateToken() {
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
  const { salt, passwordHash, ...clean } = u;
  return clean;
}

// ================= Configure Multer for Uploads =================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const safeName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Upload endpoint (for files, voice recordings and profile avatars)
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    url: fileUrl,
    filename: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

// ================= Authentication & Profile REST API =================

// Register a new profile
app.post('/api/auth/register', (req, res) => {
  let { username, password, displayName, avatar, bio } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }

  username = username.trim();
  const cleanUsername = username.toLowerCase();

  if (cleanUsername.length < 2 || cleanUsername.length > 30) {
    return res.status(400).json({ error: 'Логин должен содержать от 2 до 30 символов' });
  }

  if (usersMap.has(cleanUsername)) {
    return res.status(400).json({ error: 'Пользователь с таким логином уже существует. Выберите другой или войдите.' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const token = generateToken();

  const newUser = {
    id: `u_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    username: cleanUsername,
    displayName: (displayName && displayName.trim()) ? displayName.trim() : username,
    avatar: avatar || null,
    bio: (bio && bio.trim()) ? bio.trim() : 'На связи',
    salt,
    passwordHash,
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
    user: sanitizeUser(newUser)
  });
});

// Login to existing profile
app.post('/api/auth/login', (req, res) => {
  let { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Введите логин и пароль' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const user = usersMap.get(cleanUsername);

  if (!user) {
    return res.status(400).json({ error: 'Пользователь с таким логином не найден' });
  }

  const checkHash = hashPassword(password, user.salt);
  if (checkHash !== user.passwordHash) {
    return res.status(400).json({ error: 'Неверный пароль или PIN-код' });
  }

  // Generate new token
  const token = generateToken();
  user.token = token;
  user.lastSeen = new Date().toISOString();
  tokensMap.set(token, cleanUsername);
  persistUsers();

  res.json({
    ok: true,
    token,
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
  res.json({ status: 'ok', time: new Date().toISOString(), usersCount: usersMap.size });
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
  pingInterval: 10000,
  pingTimeout: 5000,
  maxHttpBufferSize: 1e7
});

// Online users map: socket.id -> { socketId, username, displayName, avatar, bio, roomId, inCall }
const onlineUsers = new Map();

function getRoomHistory(roomId) {
  if (!roomHistory.has(roomId)) {
    roomHistory.set(roomId, []);
  }
  return roomHistory.get(roomId);
}

function getRoomUsers(roomId) {
  const users = [];
  for (const [id, user] of onlineUsers.entries()) {
    if (user.roomId === roomId) {
      users.push({
        id: user.socketId,
        username: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar || null,
        bio: user.bio || '',
        inCall: user.inCall || false
      });
    }
  }
  return users;
}

io.on('connection', (socket) => {
  let currentUser = null;

  // User joins a room / family space
  socket.on('join-room', ({ token, username, displayName, avatar, bio, roomId }) => {
    const cleanRoomId = (roomId || 'semya').trim().toLowerCase();

    // Check if authenticated user by token
    const dbUser = getUserByToken(token);
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
      inCall: false
    };

    socket.join(cleanRoomId);
    onlineUsers.set(socket.id, currentUser);

    // Send existing room history to joined user
    const history = getRoomHistory(cleanRoomId);
    socket.emit('room-history', history);

    // Notify room of online users list
    io.to(cleanRoomId).emit('users-update', getRoomUsers(cleanRoomId));

    // Emit system notice
    socket.to(cleanRoomId).emit('user-joined', {
      username: currentUser.displayName || currentUser.username,
      id: socket.id,
      time: new Date().toISOString()
    });
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
  socket.on('call-user', ({ targetUserId, offer }) => {
    if (!currentUser) return;
    const target = onlineUsers.get(targetUserId);

    if (!target) {
      return socket.emit('call-error', { message: 'Собеседник не в сети' });
    }

    if (target.inCall) {
      return socket.emit('call-busy', { targetUserId, message: 'Собеседник занят другим звонком' });
    }

    currentUser.inCall = true;
    io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));

    io.to(targetUserId).emit('call-incoming', {
      fromUserId: socket.id,
      fromUsername: currentUser.displayName || currentUser.username,
      fromAvatar: currentUser.avatar || null,
      offer
    });
  });

  socket.on('call-answer', ({ targetUserId, answer }) => {
    if (!currentUser) return;
    currentUser.inCall = true;
    io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));

    io.to(targetUserId).emit('call-answered', {
      fromUserId: socket.id,
      answer
    });
  });

  socket.on('call-reject', ({ targetUserId, reason }) => {
    if (currentUser) {
      currentUser.inCall = false;
      io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));
    }
    const target = onlineUsers.get(targetUserId);
    if (target) {
      target.inCall = false;
      io.to(target.roomId).emit('users-update', getRoomUsers(target.roomId));
    }

    io.to(targetUserId).emit('call-rejected', {
      fromUserId: socket.id,
      reason: reason || 'Отклонён'
    });
  });

  socket.on('call-end', ({ targetUserId }) => {
    if (currentUser) {
      currentUser.inCall = false;
      io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));
    }
    const target = onlineUsers.get(targetUserId);
    if (target) {
      target.inCall = false;
      io.to(target.roomId).emit('users-update', getRoomUsers(target.roomId));
    }

    if (targetUserId) {
      io.to(targetUserId).emit('call-ended', { fromUserId: socket.id });
    }
  });

  socket.on('ice-candidate', ({ targetUserId, candidate }) => {
    io.to(targetUserId).emit('ice-candidate', {
      fromUserId: socket.id,
      candidate
    });
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      onlineUsers.delete(socket.id);
      io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));
      socket.to(currentUser.roomId).emit('user-left', {
        username: currentUser.displayName || currentUser.username,
        id: socket.id,
        time: new Date().toISOString()
      });
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
