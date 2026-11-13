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
    const existingUser = usersMap.get(cleanUsername);
    if (existingUser && password && existingUser.passwordHash) {
      const checkHash = hashPassword(password, existingUser.salt);
      if (checkHash === existingUser.passwordHash) {
        const token = generateToken();
        existingUser.token = token;
        if (displayName && displayName.trim()) existingUser.displayName = displayName.trim();
        if (avatar) existingUser.avatar = avatar;
        if (bio && bio.trim()) existingUser.bio = bio.trim();
        existingUser.lastSeen = new Date().toISOString();
        tokensMap.set(token, cleanUsername);
        persistUsers();
        return res.json({
          ok: true,
          token,
          user: sanitizeUser(existingUser)
        });
      }
    }
    return res.status(400).json({ error: 'Пользователь с таким логином уже существует. Выберите другой или перейдите на вкладку «Вход».' });
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

// Restore or self-heal user session from client storage
app.post('/api/auth/restore-session', (req, res) => {
  let { username, password, displayName, avatar, bio, roomId } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Логин обязателен' });
  }

  const cleanUsername = username.trim().toLowerCase();
  let user = usersMap.get(cleanUsername);

  if (user) {
    // If password is set on user record, verify it
    if (password && user.passwordHash) {
      const checkHash = hashPassword(password, user.salt);
      if (checkHash !== user.passwordHash) {
        return res.status(401).json({ error: 'Неверный пароль' });
      }
    }
    if (displayName && displayName.trim()) user.displayName = displayName.trim();
    if (avatar) user.avatar = avatar;
    if (bio && bio.trim()) user.bio = bio.trim();
    user.lastSeen = new Date().toISOString();
  } else {
    // Recreate user on server (self-healing after Render container reset)
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = password ? hashPassword(password, salt) : '';
    user = {
      id: `u_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      username: cleanUsername,
      displayName: (displayName && displayName.trim()) ? displayName.trim() : cleanUsername,
      avatar: avatar || null,
      bio: (bio && bio.trim()) ? bio.trim() : 'На связи',
      salt,
      passwordHash,
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };
    usersMap.set(cleanUsername, user);
  }

  const token = generateToken();
  user.token = token;
  tokensMap.set(token, cleanUsername);
  persistUsers();

  res.json({
    ok: true,
    token,
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
  const usersMap = new Map();
  for (const [id, user] of onlineUsers.entries()) {
    if (user.roomId === roomId) {
      const existing = usersMap.get(user.username.toLowerCase());
      if (!existing) {
        usersMap.set(user.username.toLowerCase(), {
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
        // Prefer foreground / web session for direct call target ID
        if (!user.isNativeBackground && existing.isNativeBackground) {
          existing.id = user.socketId;
          existing.isNativeBackground = false;
        }
      }
    }
  }
  return Array.from(usersMap.values());
}

io.on('connection', (socket) => {
  let currentUser = null;

  // User joins a room / family space
  socket.on('join-room', ({ token, username, displayName, avatar, bio, password, roomId, isNativeBackground }) => {
    const cleanRoomId = (roomId || 'semya').trim().toLowerCase();

    // Check if authenticated user by token
    let dbUser = getUserByToken(token);

    // If token wasn't found (server restarted or client reconnecting), search by username
    if (!dbUser && username && username !== 'Гость' && username !== 'android') {
      const cleanUsername = username.trim().toLowerCase();
      dbUser = usersMap.get(cleanUsername);

      if (!dbUser) {
        // Self-heal: recreate user record on the server so room immediately has this user!
        const salt = crypto.randomBytes(16).toString('hex');
        const tokenToSave = token || generateToken();
        const passwordHash = password ? hashPassword(password, salt) : '';
        dbUser = {
          id: `u_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          username: cleanUsername,
          displayName: (displayName && displayName.trim()) ? displayName.trim() : cleanUsername,
          avatar: avatar || null,
          bio: (bio && bio.trim()) ? bio.trim() : 'На связи',
          salt,
          passwordHash,
          token: tokenToSave,
          createdAt: new Date().toISOString(),
          lastSeen: new Date().toISOString()
        };
        usersMap.set(cleanUsername, dbUser);
        tokensMap.set(tokenToSave, cleanUsername);
        persistUsers();
      } else {
        if (displayName && displayName.trim()) dbUser.displayName = displayName.trim();
        if (avatar) dbUser.avatar = avatar;
        if (bio && bio.trim()) dbUser.bio = bio.trim();
        if (token) {
          dbUser.token = token;
          tokensMap.set(token, cleanUsername);
        }
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

    // Find all sockets for target user
    let targetSockets = [];
    if (targetUsername && targetUsername.trim() !== '') {
      const cleanTarget = targetUsername.trim().toLowerCase();
      for (const [sId, u] of onlineUsers.entries()) {
        if (u.username.toLowerCase() === cleanTarget && sId !== socket.id) {
          targetSockets.push({ socketId: sId, user: u });
        }
      }
    }

    if (targetSockets.length === 0 && targetUserId) {
      const directTarget = onlineUsers.get(targetUserId);
      if (directTarget) {
        for (const [sId, u] of onlineUsers.entries()) {
          if (u.username.toLowerCase() === directTarget.username.toLowerCase() && sId !== socket.id) {
            targetSockets.push({ socketId: sId, user: u });
          }
        }
      }
    }

    if (targetSockets.length === 0) {
      return socket.emit('call-error', { message: 'Собеседник не в сети' });
    }

    currentUser.inCall = true;
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
    io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));

    io.to(targetUserId).emit('call-answered', {
      fromUserId: socket.id,
      answer
    });
  });

  socket.on('call-reject', ({ targetUserId, reason }) => {
    if (currentUser) {
      currentUser.inCall = false;
      for (const [sId, u] of onlineUsers.entries()) {
        if (u.username.toLowerCase() === currentUser.username.toLowerCase()) {
          u.inCall = false;
        }
      }
      io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));
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
    if (currentUser) {
      currentUser.inCall = false;
      for (const [sId, u] of onlineUsers.entries()) {
        if (u.username.toLowerCase() === currentUser.username.toLowerCase()) {
          u.inCall = false;
        }
      }
      io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));
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
      io.to(t.socketId).emit('call-ended', { fromUserId: socket.id });
    }
    if (targetSockets.length > 0) {
      io.to(targetSockets[0].user.roomId).emit('users-update', getRoomUsers(targetSockets[0].user.roomId));
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
