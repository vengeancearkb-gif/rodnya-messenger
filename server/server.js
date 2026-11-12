const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Enable CORS for all origins
app.use(cors({ origin: '*' }));
app.use(express.json());

// Uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// Serve client static files if client folder exists
const clientDir = path.join(__dirname, '..', 'client');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
}

// Configure Multer for file/voice/image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const safeName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max file size
});

// Upload API endpoint
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Setup Socket.IO with aggressive heartbeat for mobile network stability
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000, // 10s ping for fast connection loss detection
  pingTimeout: 5000,   // 5s timeout to trigger quick reconnect
  maxHttpBufferSize: 1e7 // 10MB
});

// In-memory message history (per room, up to 300 messages)
const roomHistory = new Map();
// Online users map: socket.id -> { username, roomId, socketId, inCall }
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
        inCall: user.inCall || false
      });
    }
  }
  return users;
}

io.on('connection', (socket) => {
  let currentUser = null;

  // User joins a room / family space
  socket.on('join-room', ({ username, roomId }) => {
    const cleanRoomId = (roomId || 'family').trim().toLowerCase();
    const cleanUsername = (username || 'Аноним').trim();

    currentUser = {
      socketId: socket.id,
      username: cleanUsername,
      roomId: cleanRoomId,
      inCall: false
    };

    socket.join(cleanRoomId);
    onlineUsers.set(socket.id, currentUser);

    // Send existing history to the joined user
    const history = getRoomHistory(cleanRoomId);
    socket.emit('room-history', history);

    // Notify everyone in the room about online users
    io.to(cleanRoomId).emit('users-update', getRoomUsers(cleanRoomId));

    // Emit system notice
    socket.to(cleanRoomId).emit('user-joined', {
      username: cleanUsername,
      id: socket.id,
      time: new Date().toISOString()
    });
  });

  // Sending a message (text, voice, photo, file)
  socket.on('send-message', (data) => {
    if (!currentUser) return;

    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      roomId: currentUser.roomId,
      senderId: socket.id,
      senderName: currentUser.username,
      type: data.type || 'text', // 'text', 'voice', 'image', 'file'
      text: data.text || '',
      fileUrl: data.fileUrl || null,
      fileName: data.fileName || null,
      fileSize: data.fileSize || null,
      duration: data.duration || null, // for voice messages
      timestamp: Date.now()
    };

    // Store in history
    const history = getRoomHistory(currentUser.roomId);
    history.push(message);
    if (history.length > 300) {
      history.shift();
    }

    // Broadcast to everyone in room including sender (for confirmation)
    io.to(currentUser.roomId).emit('new-message', message);
  });

  // Typing indicator
  socket.on('typing', (isTyping) => {
    if (!currentUser) return;
    socket.to(currentUser.roomId).emit('user-typing', {
      username: currentUser.username,
      id: socket.id,
      isTyping: !!isTyping
    });
  });

  // ================= WebRTC Audio Calling =================
  // Initiate Call
  socket.on('call-user', ({ targetUserId, offer }) => {
    if (!currentUser) return;
    const target = onlineUsers.get(targetUserId);

    if (!target) {
      return socket.emit('call-error', { message: 'Пользователь не в сети' });
    }

    if (target.inCall) {
      return socket.emit('call-busy', { targetUserId, message: 'Пользователь занят другим звонком' });
    }

    currentUser.inCall = true;
    io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));

    io.to(targetUserId).emit('call-incoming', {
      fromUserId: socket.id,
      fromUsername: currentUser.username,
      offer
    });
  });

  // Call Answered
  socket.on('call-answer', ({ targetUserId, answer }) => {
    if (!currentUser) return;
    currentUser.inCall = true;
    io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));

    io.to(targetUserId).emit('call-answered', {
      fromUserId: socket.id,
      answer
    });
  });

  // Reject / Cancel Call
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

  // End Call
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

  // WebRTC ICE Candidate relay
  socket.on('ice-candidate', ({ targetUserId, candidate }) => {
    io.to(targetUserId).emit('ice-candidate', {
      fromUserId: socket.id,
      candidate
    });
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    if (currentUser) {
      onlineUsers.delete(socket.id);
      io.to(currentUser.roomId).emit('users-update', getRoomUsers(currentUser.roomId));
      socket.to(currentUser.roomId).emit('user-left', {
        username: currentUser.username,
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
  console.log(`===============================================`);
});
