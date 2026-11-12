// Core Messenger Application Logic
class MessengerApp {
  constructor() {
    this.socket = null;
    this.username = localStorage.getItem('family_username') || '';
    this.roomId = localStorage.getItem('family_room') || 'semya';
    this.serverUrl = localStorage.getItem('family_server_url') || 'https://rodnya-messenger.onrender.com';
    this.onlineMembers = [];
    this.pingInterval = null;

    this.initDOM();
    this.checkAutoLogin();
  }

  initDOM() {
    // Screens
    this.loginScreen = document.getElementById('login-screen');
    this.appScreen = document.getElementById('app-screen');
    this.loginForm = document.getElementById('login-form');
    this.usernameInput = document.getElementById('username-input');
    this.roomInput = document.getElementById('room-input');
    this.serverInput = document.getElementById('server-input');

    // Header & Info
    this.roomTitle = document.getElementById('room-title');
    this.connectionStatus = document.getElementById('connection-status');
    this.pingBadge = document.getElementById('ping-badge');
    this.btnToggleMembers = document.getElementById('btn-toggle-members');
    this.btnQuickCall = document.getElementById('btn-quick-call');
    this.btnSettings = document.getElementById('btn-settings');

    // Drawer
    this.drawer = document.getElementById('members-drawer');
    this.drawerBackdrop = document.getElementById('drawer-backdrop');
    this.btnCloseDrawer = document.getElementById('btn-close-drawer');
    this.membersList = document.getElementById('members-list');

    // Chat
    this.chatMessages = document.getElementById('chat-messages');
    this.messageInput = document.getElementById('message-input');
    this.btnSend = document.getElementById('btn-send');
    this.btnAttach = document.getElementById('btn-attach');
    this.fileInput = document.getElementById('file-input');
    this.typingIndicator = document.getElementById('typing-indicator');

    // Modals
    this.imageModal = document.getElementById('image-modal');
    this.modalImage = document.getElementById('modal-image');
    this.modalDownload = document.getElementById('modal-download');
    this.modalClose = document.getElementById('modal-close');
    this.modalBackdrop = document.getElementById('modal-backdrop');

    this.settingsModal = document.getElementById('settings-modal');
    this.settingsServerUrl = document.getElementById('settings-server-url');
    this.settingsUsername = document.getElementById('settings-username');
    this.settingsRoom = document.getElementById('settings-room');
    this.btnSaveSettings = document.getElementById('btn-save-settings');
    this.btnLogout = document.getElementById('btn-logout');
    this.settingsClose = document.getElementById('settings-close');
    this.settingsBackdrop = document.getElementById('settings-backdrop');

    // Bind event listeners
    this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    this.btnSend.addEventListener('click', () => this.sendMessage());

    // Enter to send (Shift+Enter for newline)
    this.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Auto-grow textarea
    this.messageInput.addEventListener('input', () => {
      this.messageInput.style.height = 'auto';
      this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 120) + 'px';
      this.notifyTyping();
    });

    // Drawer
    this.btnToggleMembers.addEventListener('click', () => this.toggleDrawer(true));
    this.btnCloseDrawer.addEventListener('click', () => this.toggleDrawer(false));
    this.drawerBackdrop.addEventListener('click', () => this.toggleDrawer(false));

    // File attachments
    this.btnAttach.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

    // Quick call (call first available member)
    this.btnQuickCall.addEventListener('click', () => this.handleQuickCall());

    // Modals
    this.modalClose.addEventListener('click', () => this.closeImageModal());
    this.modalBackdrop.addEventListener('click', () => this.closeImageModal());

    this.btnSettings.addEventListener('click', () => this.openSettings());
    this.settingsClose.addEventListener('click', () => this.closeSettings());
    this.settingsBackdrop.addEventListener('click', () => this.closeSettings());
    this.btnSaveSettings.addEventListener('click', () => this.saveSettings());
    this.btnLogout.addEventListener('click', () => this.logout());
  }

  checkAutoLogin() {
    if (this.username && this.roomId) {
      this.usernameInput.value = this.username;
      this.roomInput.value = this.roomId;
      this.serverInput.value = this.serverUrl;
      this.connect();
    } else {
      this.serverInput.value = this.serverUrl || 'https://rodnya-messenger.onrender.com';
    }
  }

  handleLogin(e) {
    e.preventDefault();
    this.username = this.usernameInput.value.trim();
    this.roomId = this.roomInput.value.trim().toLowerCase();
    this.serverUrl = this.serverInput.value.trim();

    if (!this.username) return;

    localStorage.setItem('family_username', this.username);
    localStorage.setItem('family_room', this.roomId);
    localStorage.setItem('family_server_url', this.serverUrl);

    this.connect();
  }

  connect() {
    this.loginScreen.classList.remove('active');
    this.appScreen.classList.add('active');
    this.roomTitle.textContent = `Комната: ${this.roomId.toUpperCase()}`;

    let socketEndpoint = this.serverUrl;
    if (!socketEndpoint || socketEndpoint.trim() === '') {
      socketEndpoint = window.location.origin.includes('http') ? window.location.origin : 'http://localhost:3000';
    }

    if (this.socket) {
      this.socket.disconnect();
    }

    console.log('Connecting to server:', socketEndpoint);
    this.updateStatus('connecting', 'Подключение...');

    this.socket = io(socketEndpoint, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000
    });

    this.setupSocketEvents();
    this.startPingMonitor();
  }

  setupSocketEvents() {
    this.socket.on('connect', () => {
      this.updateStatus('online', 'В сети');
      this.socket.emit('join-room', {
        username: this.username,
        roomId: this.roomId
      });
    });

    this.socket.on('disconnect', () => {
      this.updateStatus('offline', 'Переподключение...');
    });

    this.socket.on('connect_error', () => {
      this.updateStatus('offline', 'Нет связи с сервером');
    });

    this.socket.on('users-update', (users) => {
      this.onlineMembers = users;
      this.renderMembersList(users);
    });

    this.socket.on('user-joined', ({ username }) => {
      this.renderSystemNotice(`${username} вошёл(ла) в чат`);
    });

    this.socket.on('user-left', ({ username }) => {
      this.renderSystemNotice(`${username} вышел(ла) из чата`);
    });

    this.socket.on('room-history', (messages) => {
      this.chatMessages.innerHTML = '';
      const welcome = document.createElement('div');
      welcome.className = 'system-welcome';
      welcome.innerHTML = `
        <div class="welcome-badge">🔒 Семейная комната: ${this.roomId}</div>
        <p>Связь защищена прямым шифрованием. Все сообщения доставляются мгновенно.</p>
      `;
      this.chatMessages.appendChild(welcome);

      messages.forEach(msg => this.renderMessage(msg, false));
      this.scrollToBottom();
    });

    this.socket.on('new-message', (message) => {
      const isMine = message.senderName === this.username;
      this.renderMessage(message, true);
      this.scrollToBottom();

      if (!isMine) {
        window.soundManager.playMessageNotification();
      }
    });

    this.socket.on('user-typing', ({ username, isTyping }) => {
      if (isTyping) {
        this.typingIndicator.querySelector('.typing-text').textContent = `${username} печатает...`;
        this.typingIndicator.classList.remove('hidden');
      } else {
        this.typingIndicator.classList.add('hidden');
      }
    });

    // WebRTC Signaling Events
    this.socket.on('call-incoming', (data) => window.callManager.handleIncomingCall(data));
    this.socket.on('call-answered', (data) => window.callManager.handleCallAnswered(data));
    this.socket.on('call-rejected', (data) => window.callManager.handleCallRejected(data));
    this.socket.on('call-ended', (data) => window.callManager.endCall(false));
    this.socket.on('ice-candidate', (data) => window.callManager.handleIceCandidate(data));
    this.socket.on('call-busy', (data) => alert(data.message || 'Собеседник занят другим звонком'));
    this.socket.on('call-error', (data) => alert(data.message || 'Ошибка соединения'));
  }

  startPingMonitor() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.socket && this.socket.connected) {
        const start = Date.now();
        this.socket.volatile.emit('ping-check', () => {
          const latency = Date.now() - start;
          this.pingBadge.textContent = `${latency} ms`;
        });
      }
    }, 4000);
  }

  updateStatus(state, text) {
    const dot = this.connectionStatus.querySelector('.status-dot');
    const textEl = this.connectionStatus.querySelector('.status-text');

    dot.className = `status-dot ${state}`;
    textEl.textContent = text;
  }

  sendMessage() {
    const text = this.messageInput.value.trim();
    if (!text || !this.socket) return;

    this.socket.emit('send-message', {
      type: 'text',
      text
    });

    this.messageInput.value = '';
    this.messageInput.style.height = 'auto';
    this.notifyTyping(false);
  }

  notifyTyping(isTyping = true) {
    if (!this.socket) return;
    this.socket.emit('typing', isTyping);

    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    if (isTyping) {
      this.typingTimeout = setTimeout(() => {
        this.socket.emit('typing', false);
      }, 2000);
    }
  }

  async handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const formData = new FormData();
    formData.append('file', file);

    try {
      this.renderSystemNotice(`Загрузка файла ${file.name}...`);
      const serverUrl = this.serverUrl || '';
      const res = await fetch(`${serverUrl}/api/upload`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error('Upload error');
      const data = await res.json();

      this.socket.emit('send-message', {
        type: isImage ? 'image' : 'file',
        fileUrl: data.url,
        fileName: file.name,
        fileSize: this.formatBytes(file.size)
      });
    } catch (err) {
      alert('Ошибка при отправке файла: ' + err.message);
    } finally {
      this.fileInput.value = '';
    }
  }

  renderMessage(msg, animate = true) {
    const isMine = msg.senderName === this.username;
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isMine ? 'message-outgoing' : 'message-incoming'}`;

    let contentHtml = '';

    // Sender name for incoming
    if (!isMine) {
      contentHtml += `<div class="message-sender">${this.escapeHtml(msg.senderName)}</div>`;
    }

    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Render by type
    if (msg.type === 'text') {
      contentHtml += `<div class="message-text">${this.formatText(msg.text)}</div>`;
    } else if (msg.type === 'image') {
      const fullUrl = this.getFullMediaUrl(msg.fileUrl);
      contentHtml += `
        <img class="message-image" src="${fullUrl}" alt="Фото" onclick="window.messengerApp.openImageModal('${fullUrl}')" loading="lazy">
      `;
    } else if (msg.type === 'voice') {
      const fullUrl = this.getFullMediaUrl(msg.fileUrl);
      const durationStr = VoiceManager.formatTime(msg.duration || 0);
      contentHtml += `
        <div class="voice-player">
          <button class="voice-play-btn" onclick="window.messengerApp.toggleVoicePlay(this, '${fullUrl}')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </button>
          <div class="voice-wave">
            <span class="voice-wave-bar" style="height: 40%"></span>
            <span class="voice-wave-bar" style="height: 80%"></span>
            <span class="voice-wave-bar" style="height: 60%"></span>
            <span class="voice-wave-bar" style="height: 100%"></span>
            <span class="voice-wave-bar" style="height: 50%"></span>
            <span class="voice-wave-bar" style="height: 75%"></span>
            <span class="voice-wave-bar" style="height: 35%"></span>
          </div>
          <span class="voice-duration">${durationStr}</span>
        </div>
      `;
    } else if (msg.type === 'file') {
      const fullUrl = this.getFullMediaUrl(msg.fileUrl);
      contentHtml += `
        <a class="message-file" href="${fullUrl}" target="_blank" download="${this.escapeHtml(msg.fileName || 'file')}">
          <span class="file-icon">📄</span>
          <div class="file-details">
            <span class="file-name">${this.escapeHtml(msg.fileName || 'Файл')}</span>
            <span class="file-size">${msg.fileSize || ''}</span>
          </div>
        </a>
      `;
    }

    contentHtml += `
      <div class="message-meta">
        <span>${timeStr}</span>
        ${isMine ? '<span>✓</span>' : ''}
      </div>
    `;

    bubble.innerHTML = contentHtml;
    this.chatMessages.appendChild(bubble);
  }

  toggleVoicePlay(buttonEl, audioUrl) {
    if (this.currentAudio && !this.currentAudio.paused) {
      this.currentAudio.pause();
      if (this.currentPlayBtn) {
        this.currentPlayBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
      }
      if (this.currentPlayBtn === buttonEl) {
        this.currentAudio = null;
        this.currentPlayBtn = null;
        return;
      }
    }

    const audio = new Audio(audioUrl);
    this.currentAudio = audio;
    this.currentPlayBtn = buttonEl;

    buttonEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';

    audio.onended = () => {
      buttonEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
      this.currentAudio = null;
      this.currentPlayBtn = null;
    };

    audio.play().catch(e => console.warn('Audio play error:', e));
  }

  renderSystemNotice(text) {
    const notice = document.createElement('div');
    notice.className = 'system-notice';
    notice.textContent = text;
    this.chatMessages.appendChild(notice);
    this.scrollToBottom();
  }

  renderMembersList(users) {
    this.membersList.innerHTML = '';
    const otherUsers = users.filter(u => u.username !== this.username);

    if (otherUsers.length === 0) {
      this.membersList.innerHTML = '<p style="color: var(--text-muted); font-size: 13px; text-align: center; margin-top: 20px;">Пока никто из родных не подключился.<br>Поделитесь с ними кодом комнаты: <b>' + this.roomId + '</b></p>';
      return;
    }

    otherUsers.forEach(user => {
      const item = document.createElement('div');
      item.className = 'member-item';
      item.innerHTML = `
        <div class="member-info">
          <div class="member-avatar">${user.username.charAt(0).toUpperCase()}</div>
          <div>
            <div class="member-name">${this.escapeHtml(user.username)}</div>
            <span style="font-size: 11px; color: ${user.inCall ? 'var(--warning)' : 'var(--success)'};">
              ${user.inCall ? '● в звонке' : '● на связи'}
            </span>
          </div>
        </div>
        <button class="member-call-btn" onclick="window.callManager.startCall('${user.id}', '${this.escapeHtml(user.username)}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
          Звонок
        </button>
      `;
      this.membersList.appendChild(item);
    });
  }

  handleQuickCall() {
    const available = this.onlineMembers.find(u => u.username !== this.username && !u.inCall);
    if (!available) {
      alert('Никого из родственников сейчас нет в сети или все заняты разговором.');
      return;
    }
    window.callManager.startCall(available.id, available.username);
  }

  toggleDrawer(open) {
    if (open) {
      this.drawer.classList.add('open');
      this.drawerBackdrop.classList.add('open');
    } else {
      this.drawer.classList.remove('open');
      this.drawerBackdrop.classList.remove('open');
    }
  }

  openImageModal(url) {
    this.modalImage.src = url;
    this.modalDownload.href = url;
    this.imageModal.classList.remove('hidden');
  }

  closeImageModal() {
    this.imageModal.classList.add('hidden');
    this.modalImage.src = '';
  }

  openSettings() {
    this.settingsServerUrl.value = this.serverUrl;
    this.settingsUsername.value = this.username;
    this.settingsRoom.value = this.roomId;
    this.settingsModal.classList.remove('hidden');
  }

  closeSettings() {
    this.settingsModal.classList.add('hidden');
  }

  saveSettings() {
    this.serverUrl = this.settingsServerUrl.value.trim();
    this.username = this.settingsUsername.value.trim();
    this.roomId = this.settingsRoom.value.trim().toLowerCase();

    localStorage.setItem('family_server_url', this.serverUrl);
    localStorage.setItem('family_username', this.username);
    localStorage.setItem('family_room', this.roomId);

    this.closeSettings();
    this.connect();
  }

  logout() {
    localStorage.removeItem('family_username');
    localStorage.removeItem('family_room');
    location.reload();
  }

  scrollToBottom() {
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  getFullMediaUrl(path) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const base = this.serverUrl || window.location.origin;
    return `${base.replace(/\/$/, '')}${path}`;
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  escapeHtml(str) {
    return (str || '').replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  formatText(text) {
    const escaped = this.escapeHtml(text);
    // Convert links
    return escaped.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color: #93c5fd; text-decoration: underline;">$1</a>');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.messengerApp = new MessengerApp();
});
