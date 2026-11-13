// Core Messenger Application with User Profiles & Authentication
class MessengerApp {
  constructor() {
    this.socket = null;
    this.token = localStorage.getItem('family_token') || null;
    this.deviceSecret = localStorage.getItem('family_device_secret') || null;
    this.user = JSON.parse(localStorage.getItem('family_user') || 'null');
    this.roomId = localStorage.getItem('family_room') || 'semya';
    this.serverUrl = localStorage.getItem('family_server_url') || 'https://rodnya-messenger.onrender.com';
    this.onlineMembers = [];
    this.pingInterval = null;
    this.typingTimeout = null;
    this.typingHideTimeout = null;
    this.currentVoice = null; // { url, audio, buttonEl }

    // Temporary avatar upload state
    this.regAvatarUrl = null;
    this.editAvatarUrl = null;

    this.initDOM();
    this.initProfileFromNative().then(() => {
      this.checkAutoLogin();
    });
  }

  initDOM() {
    // Screens
    this.loginScreen = document.getElementById('login-screen');
    this.appScreen = document.getElementById('app-screen');

    // Auth Tabs
    this.tabLoginBtn = document.getElementById('tab-login-btn');
    this.tabRegisterBtn = document.getElementById('tab-register-btn');
    this.authAlert = document.getElementById('auth-alert');

    // Forms
    this.loginForm = document.getElementById('login-form');
    this.loginUsername = document.getElementById('login-username');
    this.loginPassword = document.getElementById('login-password');
    this.loginRoom = document.getElementById('login-room');
    this.loginServerUrl = document.getElementById('login-server-url');

    this.registerForm = document.getElementById('register-form');
    this.regDisplayName = document.getElementById('reg-displayname');
    this.regUsername = document.getElementById('reg-username');
    this.regPassword = document.getElementById('reg-password');
    this.regBio = document.getElementById('reg-bio');
    this.regRoom = document.getElementById('reg-room');
    this.regServerUrl = document.getElementById('reg-server-url');
    this.regAvatarPreview = document.getElementById('reg-avatar-preview');
    this.regAvatarLetter = document.getElementById('reg-avatar-letter');
    this.regAvatarBtn = document.getElementById('reg-avatar-btn');
    this.regAvatarInput = document.getElementById('reg-avatar-input');

    // Header & Info
    this.btnMyProfile = document.getElementById('btn-my-profile');
    this.headerAvatarLetter = document.getElementById('header-avatar-letter');
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

    // Modals: My Profile
    this.myProfileModal = document.getElementById('my-profile-modal');
    this.myProfileBackdrop = document.getElementById('my-profile-backdrop');
    this.myProfileClose = document.getElementById('my-profile-close');
    this.myProfileUsernameTag = document.getElementById('my-profile-username-tag');
    this.editDisplayName = document.getElementById('edit-displayname');
    this.editBio = document.getElementById('edit-bio');
    this.editAvatarPreview = document.getElementById('edit-avatar-preview');
    this.editAvatarLetter = document.getElementById('edit-avatar-letter');
    this.editAvatarBtn = document.getElementById('edit-avatar-btn');
    this.editAvatarInput = document.getElementById('edit-avatar-input');
    this.btnSaveProfile = document.getElementById('btn-save-profile');
    this.btnLogout = document.getElementById('btn-logout');

    // Modals: View Other User Profile
    this.userProfileModal = document.getElementById('user-profile-modal');
    this.userProfileBackdrop = document.getElementById('user-profile-backdrop');
    this.userProfileClose = document.getElementById('user-profile-close');
    this.viewProfileAvatarBox = document.getElementById('view-profile-avatar-box');
    this.viewProfileLetter = document.getElementById('view-profile-letter');
    this.viewProfileName = document.getElementById('view-profile-name');
    this.viewProfileUsername = document.getElementById('view-profile-username');
    this.viewProfileOnline = document.getElementById('view-profile-online');
    this.viewProfileBio = document.getElementById('view-profile-bio');
    this.btnProfileCall = document.getElementById('btn-profile-call');
    this.btnProfileMessage = document.getElementById('btn-profile-message');

    // Modals: Settings & Image
    this.settingsModal = document.getElementById('settings-modal');
    this.settingsServerUrl = document.getElementById('settings-server-url');
    this.settingsRoom = document.getElementById('settings-room');
    this.btnSaveSettings = document.getElementById('btn-save-settings');
    this.settingsClose = document.getElementById('settings-close');
    this.settingsBackdrop = document.getElementById('settings-backdrop');

    this.imageModal = document.getElementById('image-modal');
    this.modalImage = document.getElementById('modal-image');
    this.modalDownload = document.getElementById('modal-download');
    this.modalClose = document.getElementById('modal-close');
    this.modalBackdrop = document.getElementById('modal-backdrop');

    this.bindEvents();
  }

  // Custom In-App Modal Dialog (eliminates https://localhost says:)
  showDialog(message, title = 'Родня') {
    return new Promise((resolve) => {
      const modal = document.getElementById('dialog-modal');
      const titleEl = document.getElementById('dialog-title');
      const msgEl = document.getElementById('dialog-message');
      const btnOk = document.getElementById('dialog-btn-ok');
      const btnCancel = document.getElementById('dialog-btn-cancel');
      const backdrop = document.getElementById('dialog-backdrop');

      if (!modal) {
        alert(message);
        return resolve(true);
      }

      titleEl.textContent = title;
      msgEl.textContent = message;
      btnCancel.style.display = 'none';

      const cleanup = () => {
        modal.classList.add('hidden');
        btnOk.removeEventListener('click', onOk);
        backdrop.removeEventListener('click', onOk);
      };

      const onOk = () => {
        cleanup();
        resolve(true);
      };

      btnOk.addEventListener('click', onOk);
      backdrop.addEventListener('click', onOk);
      modal.classList.remove('hidden');
    });
  }

  showConfirm(message, title = 'Родня') {
    return new Promise((resolve) => {
      const modal = document.getElementById('dialog-modal');
      const titleEl = document.getElementById('dialog-title');
      const msgEl = document.getElementById('dialog-message');
      const btnOk = document.getElementById('dialog-btn-ok');
      const btnCancel = document.getElementById('dialog-btn-cancel');
      const backdrop = document.getElementById('dialog-backdrop');

      if (!modal) {
        return resolve(confirm(message));
      }

      titleEl.textContent = title;
      msgEl.textContent = message;
      btnCancel.style.display = 'inline-block';

      const cleanup = () => {
        modal.classList.add('hidden');
        btnOk.removeEventListener('click', onOk);
        btnCancel.removeEventListener('click', onCancel);
        backdrop.removeEventListener('click', onCancel);
      };

      const onOk = () => {
        cleanup();
        resolve(true);
      };

      const onCancel = () => {
        cleanup();
        resolve(false);
      };

      btnOk.addEventListener('click', onOk);
      btnCancel.addEventListener('click', onCancel);
      backdrop.addEventListener('click', onCancel);
      modal.classList.remove('hidden');
    });
  }

  bindEvents() {
    // Auth Tabs
    this.tabLoginBtn.addEventListener('click', () => this.switchAuthTab('login'));
    this.tabRegisterBtn.addEventListener('click', () => this.switchAuthTab('register'));

    // Forms
    this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    this.registerForm.addEventListener('submit', (e) => this.handleRegister(e));

    // Avatar pickers
    const triggerRegAvatar = () => this.regAvatarInput.click();
    this.regAvatarBtn.addEventListener('click', triggerRegAvatar);
    this.regAvatarPreview.addEventListener('click', triggerRegAvatar);
    this.regAvatarInput.addEventListener('change', (e) => this.uploadAvatar(e, 'reg'));

    const triggerEditAvatar = () => this.editAvatarInput.click();
    this.editAvatarBtn.addEventListener('click', triggerEditAvatar);
    this.editAvatarPreview.addEventListener('click', triggerEditAvatar);
    this.editAvatarInput.addEventListener('change', (e) => this.uploadAvatar(e, 'edit'));

    // Messages
    this.btnSend.addEventListener('click', () => this.sendMessage());
    this.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.messageInput.addEventListener('input', () => {
      this.messageInput.style.height = 'auto';
      this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 120) + 'px';
      this.notifyTyping();
    });

    // Event delegation on Chat Messages (safe, prevents unescaped onclick XSS)
    this.chatMessages.addEventListener('click', (e) => {
      const profileTarget = e.target.closest('[data-action="view-profile"]');
      if (profileTarget) {
        const username = profileTarget.dataset.username;
        if (username) this.viewUserProfile(username);
        return;
      }

      const imgTarget = e.target.closest('[data-action="open-image"]');
      if (imgTarget) {
        const url = imgTarget.dataset.url;
        if (url) this.openImageModal(url);
        return;
      }

      const voiceTarget = e.target.closest('[data-action="toggle-voice"]');
      if (voiceTarget) {
        const url = voiceTarget.dataset.url;
        if (url) this.toggleVoicePlay(voiceTarget, url);
        return;
      }
    });

    // Event delegation on Members List
    this.membersList.addEventListener('click', (e) => {
      const callBtn = e.target.closest('[data-action="start-call"]');
      if (callBtn) {
        const id = callBtn.dataset.id;
        const name = callBtn.dataset.name;
        const username = callBtn.dataset.username;
        window.callManager.startCall(id, name, username);
        return;
      }

      const profileInfo = e.target.closest('[data-action="view-profile"]');
      if (profileInfo) {
        const username = profileInfo.dataset.username;
        if (username) this.viewUserProfile(username);
        return;
      }
    });

    // Drawer
    this.btnToggleMembers.addEventListener('click', () => this.toggleDrawer(true));
    this.btnCloseDrawer.addEventListener('click', () => this.toggleDrawer(false));
    this.drawerBackdrop.addEventListener('click', () => this.toggleDrawer(false));

    // File attachments
    this.btnAttach.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

    // Quick call
    this.btnQuickCall.addEventListener('click', () => this.handleQuickCall());

    // Profile modals
    this.btnMyProfile.addEventListener('click', () => this.openMyProfile());
    this.myProfileClose.addEventListener('click', () => this.closeMyProfile());
    this.myProfileBackdrop.addEventListener('click', () => this.closeMyProfile());
    this.btnSaveProfile.addEventListener('click', () => this.saveMyProfile());
    this.btnLogout.addEventListener('click', () => this.logout());

    this.userProfileClose.addEventListener('click', () => this.closeUserProfile());
    this.userProfileBackdrop.addEventListener('click', () => this.closeUserProfile());

    // Settings modal
    this.btnSettings.addEventListener('click', () => this.openSettings());
    this.settingsClose.addEventListener('click', () => this.closeSettings());
    this.settingsBackdrop.addEventListener('click', () => this.closeSettings());
    this.btnSaveSettings.addEventListener('click', () => this.saveSettings());

    // Image modal
    this.modalClose.addEventListener('click', () => this.closeImageModal());
    this.modalBackdrop.addEventListener('click', () => this.closeImageModal());
  }

  switchAuthTab(tab) {
    this.hideAlert();
    if (tab === 'login') {
      this.tabLoginBtn.classList.add('active');
      this.tabRegisterBtn.classList.remove('active');
      this.loginForm.classList.remove('hidden');
      this.registerForm.classList.add('hidden');
    } else {
      this.tabRegisterBtn.classList.add('active');
      this.tabLoginBtn.classList.remove('active');
      this.registerForm.classList.remove('hidden');
      this.loginForm.classList.add('hidden');
    }
  }

  showAlert(msg, isError = true) {
    this.authAlert.className = `alert-box visible ${isError ? 'alert-error' : 'alert-success'}`;
    this.authAlert.textContent = msg;
  }

  hideAlert() {
    this.authAlert.className = 'alert-box';
    this.authAlert.textContent = '';
  }

  // Read permanent native profile from Android SharedPreferences if available
  async initProfileFromNative() {
    if (window.AndroidApp && window.AndroidApp.getSavedProfile) {
      try {
        const raw = window.AndroidApp.getSavedProfile();
        if (raw && raw.length > 5) {
          const nativeData = JSON.parse(raw);
          if (nativeData.username) {
            if (!this.user || !this.user.username) {
              this.user = {
                username: nativeData.username,
                displayName: nativeData.displayName || nativeData.username,
                avatar: nativeData.avatar || null,
                bio: nativeData.bio || 'На связи'
              };
            }
            if (nativeData.token) this.token = nativeData.token;
            if (nativeData.deviceSecret) this.deviceSecret = nativeData.deviceSecret;
            if (nativeData.roomId) this.roomId = nativeData.roomId;
            if (nativeData.serverUrl) this.serverUrl = nativeData.serverUrl;

            localStorage.setItem('family_user', JSON.stringify(this.user));
            if (this.token) localStorage.setItem('family_token', this.token);
            if (this.deviceSecret) localStorage.setItem('family_device_secret', this.deviceSecret);
            localStorage.setItem('family_room', this.roomId);
            localStorage.setItem('family_server_url', this.serverUrl);
          }
        }
      } catch (e) {
        console.warn('Could not read native profile:', e);
      }
    }
  }

  // Compress avatar image into durable data URL that survives all server redeploys and APK updates
  compressAvatar(file, maxSize = 256, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > maxSize) {
              height = Math.round((height * maxSize) / width);
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width = Math.round((width * maxSize) / height);
              height = maxSize;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Не удалось загрузить файл'));
      reader.readAsDataURL(file);
    });
  }

  // Avatar Upload Helper (converts to permanent compressed data URL)
  async uploadAvatar(e, type) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const dataUrl = await this.compressAvatar(file, 256, 0.85);

      if (type === 'reg') {
        this.regAvatarUrl = dataUrl;
        this.regAvatarPreview.innerHTML = `<img src="${dataUrl}" alt="Аватар"><div class="avatar-badge-btn">📷</div>`;
      } else {
        this.editAvatarUrl = dataUrl;
        this.editAvatarPreview.innerHTML = `<img src="${dataUrl}" alt="Аватар"><div class="avatar-badge-btn">📷</div>`;
      }
    } catch (err) {
      this.showDialog('Не удалось обработать фото: ' + err.message);
    }
  }

  // Auto Login Check with Device Secret Persistence
  async checkAutoLogin() {
    if (this.user && this.user.username) {
      // 1. Try existing token
      if (this.token) {
        try {
          const res = await fetch(`${this.serverUrl}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${this.token}` }
          });
          if (res.ok) {
            const data = await res.json();
            this.user = data.user;
            this.saveAllCredentials();
            this.enterMessenger();
            return;
          }
        } catch (e) {
          console.warn('Auto-login verification failed:', e);
        }
      }

      // 2. Token invalid or expired -> Restore session using deviceSecret
      if (this.deviceSecret) {
        try {
          const res = await fetch(`${this.serverUrl}/api/auth/restore-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: this.user.username,
              deviceSecret: this.deviceSecret,
              displayName: this.user.displayName || this.user.username,
              avatar: this.user.avatar || null,
              bio: this.user.bio || 'На связи',
              roomId: this.roomId || 'semya'
            })
          });

          if (res.ok) {
            const data = await res.json();
            this.token = data.token;
            if (data.deviceSecret) this.deviceSecret = data.deviceSecret;
            this.user = data.user;
            this.saveAllCredentials();
            this.enterMessenger();
            return;
          }
        } catch (e) {
          console.warn('Session restoration failed:', e);
        }
      }
    }

    // Default values in inputs if not logged in
    this.loginServerUrl.value = this.serverUrl;
    this.regServerUrl.value = this.serverUrl;
    this.loginRoom.value = this.roomId;
    this.regRoom.value = this.roomId;
  }

  // Handle Registration
  async handleRegister(e) {
    e.preventDefault();
    this.hideAlert();

    const submitBtn = this.registerForm.querySelector('button[type="submit"]');
    const origText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Создание...';

    const displayName = this.regDisplayName.value.trim();
    const username = this.regUsername.value.trim().toLowerCase();
    const password = this.regPassword.value;
    const bio = this.regBio.value.trim();
    this.roomId = this.regRoom.value.trim().toLowerCase() || 'semya';
    this.serverUrl = this.regServerUrl.value.trim() || 'https://rodnya-messenger.onrender.com';

    if (!displayName || !username || !password) {
      this.showAlert('Заполните все обязательные поля');
      submitBtn.disabled = false;
      submitBtn.textContent = origText;
      return;
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          username,
          password,
          avatar: this.regAvatarUrl,
          bio
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка при создании профиля');
      }

      this.token = data.token;
      this.deviceSecret = data.deviceSecret;
      this.user = data.user;
      this.saveAllCredentials();
      this.enterMessenger();
    } catch (err) {
      this.showAlert(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = origText;
    }
  }

  // Handle Login
  async handleLogin(e) {
    e.preventDefault();
    this.hideAlert();

    const submitBtn = this.loginForm.querySelector('button[type="submit"]');
    const origText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Вход...';

    const username = this.loginUsername.value.trim().toLowerCase();
    const password = this.loginPassword.value;
    this.roomId = this.loginRoom.value.trim().toLowerCase() || 'semya';
    this.serverUrl = this.loginServerUrl.value.trim() || 'https://rodnya-messenger.onrender.com';

    if (!username || !password) {
      this.showAlert('Введите логин и пароль');
      submitBtn.disabled = false;
      submitBtn.textContent = origText;
      return;
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка входа');
      }

      this.token = data.token;
      this.deviceSecret = data.deviceSecret;
      this.user = data.user;
      this.saveAllCredentials();
      this.enterMessenger();
    } catch (err) {
      this.showAlert(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = origText;
    }
  }

  saveAllCredentials() {
    if (this.token) localStorage.setItem('family_token', this.token);
    if (this.deviceSecret) localStorage.setItem('family_device_secret', this.deviceSecret);
    if (this.user) localStorage.setItem('family_user', JSON.stringify(this.user));
    if (this.roomId) localStorage.setItem('family_room', this.roomId);
    if (this.serverUrl) localStorage.setItem('family_server_url', this.serverUrl);
    localStorage.removeItem('family_password'); // Never store plaintext passwords!

    if (window.AndroidApp && window.AndroidApp.saveProfile) {
      try {
        const profileData = {
          serverUrl: this.serverUrl || 'https://rodnya-messenger.onrender.com',
          token: this.token || '',
          deviceSecret: this.deviceSecret || '',
          roomId: this.roomId || 'semya',
          username: this.user ? this.user.username : '',
          displayName: this.user ? (this.user.displayName || this.user.username) : '',
          avatar: this.user ? (this.user.avatar || '') : '',
          bio: this.user ? (this.user.bio || '') : ''
        };
        window.AndroidApp.saveProfile(JSON.stringify(profileData));
      } catch (e) {
        console.error('Error saving profile to AndroidApp:', e);
      }
    }
  }

  syncNativeCredentials() {
    this.saveAllCredentials();
  }

  enterMessenger() {
    this.loginScreen.classList.remove('active');
    this.appScreen.classList.add('active');

    this.roomTitle.textContent = `Комната: ${this.roomId.toUpperCase()}`;
    this.updateHeaderAvatar();
    this.syncNativeCredentials();
    this.connect();

    // Check if app was opened by native incoming call notification
    if (window.AndroidApp && window.AndroidApp.getPendingCallData) {
      try {
        const raw = window.AndroidApp.getPendingCallData();
        const auto = window.AndroidApp.shouldAutoAnswer ? window.AndroidApp.shouldAutoAnswer() : false;
        if (raw && raw.length > 2) {
          const callData = JSON.parse(raw);
          if (window.handleNativeIncomingCall) {
            window.handleNativeIncomingCall(callData, auto);
          }
        }
      } catch (e) {
        console.error('Error checking native pending call:', e);
      }
    }
  }

  updateHeaderAvatar() {
    if (!this.user) return;
    if (this.user.avatar) {
      const url = this.getFullMediaUrl(this.user.avatar);
      this.btnMyProfile.innerHTML = `<img src="${url}" alt="Аватар">`;
    } else {
      const letter = (this.user.displayName || this.user.username || 'Я').charAt(0).toUpperCase();
      this.btnMyProfile.innerHTML = `<span id="header-avatar-letter">${letter}</span>`;
    }
  }

  connect() {
    let socketEndpoint = this.serverUrl;
    if (!socketEndpoint || socketEndpoint.trim() === '') {
      socketEndpoint = window.location.origin.includes('http') ? window.location.origin : 'https://rodnya-messenger.onrender.com';
    }

    if (this.socket) {
      this.socket.disconnect();
    }

    console.log('Connecting socket to:', socketEndpoint);
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
        token: this.token,
        deviceSecret: this.deviceSecret,
        username: this.user ? this.user.username : 'Гость',
        displayName: this.user ? (this.user.displayName || this.user.username) : 'Гость',
        avatar: this.user ? this.user.avatar : null,
        bio: this.user ? this.user.bio : '',
        roomId: this.roomId
      });
    });

    this.socket.on('session-token', ({ token }) => {
      if (token) {
        this.token = token;
        localStorage.setItem('family_token', token);
        this.saveAllCredentials();
      }
    });

    this.socket.on('auth-error', async ({ message }) => {
      await this.showDialog(message || 'Требуется повторный вход в систему');
      this.logout(false);
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
        <p>Сообщения и звонки защищены прямым сквозным каналом.</p>
      `;
      this.chatMessages.appendChild(welcome);

      messages.forEach(msg => this.renderMessage(msg, false));
      this.scrollToBottom();
    });

    this.socket.on('new-message', (message) => {
      const isMine = this.user && (message.senderUsername === this.user.username || message.senderName === this.user.displayName);
      this.renderMessage(message, true);
      this.scrollToBottom();

      if (!isMine) {
        window.soundManager.playMessageNotification();
      }
    });

    this.socket.on('user-typing', ({ username, isTyping }) => {
      if (this.typingHideTimeout) clearTimeout(this.typingHideTimeout);
      if (isTyping) {
        this.typingIndicator.querySelector('.typing-text').textContent = `${username} печатает...`;
        this.typingIndicator.classList.remove('hidden');
        // Auto-hide indicator after 3.5s in case user dropped connection
        this.typingHideTimeout = setTimeout(() => {
          this.typingIndicator.classList.add('hidden');
        }, 3500);
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
    this.socket.on('call-busy', (data) => this.showDialog(data.message || 'Собеседник занят другим звонком'));
    this.socket.on('call-error', (data) => this.showDialog(data.message || 'Ошибка соединения'));
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

    // Client-side file size check (50MB)
    if (file.size > 50 * 1024 * 1024) {
      this.showDialog('Файл слишком большой. Максимальный размер 50 МБ.');
      this.fileInput.value = '';
      return;
    }

    const isImage = file.type.startsWith('image/');
    const formData = new FormData();
    formData.append('file', file);

    const tempNotice = document.createElement('div');
    tempNotice.className = 'system-notice';
    tempNotice.textContent = `Загрузка ${file.name}...`;
    this.chatMessages.appendChild(tempNotice);
    this.scrollToBottom();

    try {
      const res = await fetch(`${this.serverUrl}/api/upload`, {
        method: 'POST',
        headers: this.token ? { 'Authorization': `Bearer ${this.token}` } : {},
        body: formData
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки файла');

      this.socket.emit('send-message', {
        type: isImage ? 'image' : 'file',
        fileUrl: data.url,
        fileName: file.name,
        fileSize: this.formatBytes(file.size)
      });
    } catch (err) {
      this.showDialog('Ошибка при отправке: ' + err.message);
    } finally {
      if (tempNotice.parentNode) {
        tempNotice.remove();
      }
      this.fileInput.value = '';
    }
  }

  renderMessage(msg) {
    const isMine = this.user && (msg.senderUsername === this.user.username || msg.senderName === this.user.displayName);
    const row = document.createElement('div');
    row.className = `message-row ${isMine ? 'outgoing' : 'incoming'}`;

    // Sender Avatar circle
    let avatarHtml = '';
    if (!isMine) {
      const avatarSrc = msg.senderAvatar ? this.getFullMediaUrl(msg.senderAvatar) : null;
      const initial = (msg.senderName || 'Р').charAt(0).toUpperCase();
      avatarHtml = `
        <div class="message-avatar-circle" data-action="view-profile" data-username="${this.escapeHtml(msg.senderUsername || '')}" title="${this.escapeHtml(msg.senderName)}">
          ${avatarSrc ? `<img src="${avatarSrc}" alt="Avatar">` : initial}
        </div>
      `;
    }

    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isMine ? 'message-outgoing' : 'message-incoming'}`;

    let contentHtml = '';
    if (!isMine) {
      contentHtml += `<div class="message-sender" data-action="view-profile" data-username="${this.escapeHtml(msg.senderUsername || '')}">${this.escapeHtml(msg.senderName)}</div>`;
    }

    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (msg.type === 'text') {
      contentHtml += `<div class="message-text">${this.formatText(msg.text)}</div>`;
    } else if (msg.type === 'image') {
      const fullUrl = this.getFullMediaUrl(msg.fileUrl);
      contentHtml += `<img class="message-image" src="${fullUrl}" alt="Фото" data-action="open-image" data-url="${fullUrl}" loading="lazy">`;
    } else if (msg.type === 'voice') {
      const fullUrl = this.getFullMediaUrl(msg.fileUrl);
      const durationStr = VoiceManager.formatTime(msg.duration || 0);
      contentHtml += `
        <div class="voice-player">
          <button class="voice-play-btn" data-action="toggle-voice" data-url="${fullUrl}">
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
    row.innerHTML = avatarHtml;
    row.appendChild(bubble);

    this.chatMessages.appendChild(row);
  }

  toggleVoicePlay(buttonEl, audioUrl) {
    if (this.currentVoice && this.currentVoice.url === audioUrl) {
      if (this.currentVoice.audio.paused) {
        this.currentVoice.audio.play().catch(() => {});
        buttonEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
      } else {
        this.currentVoice.audio.pause();
        buttonEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
      }
      return;
    }

    // New audio track: stop previous playing note
    if (this.currentVoice) {
      this.currentVoice.audio.pause();
      if (this.currentVoice.buttonEl) {
        this.currentVoice.buttonEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
      }
      this.currentVoice = null;
    }

    const audio = new Audio(audioUrl);
    this.currentVoice = { url: audioUrl, audio, buttonEl };

    buttonEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';

    audio.onended = () => {
      buttonEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
      this.currentVoice = null;
    };

    audio.play().catch(e => {
      console.warn('Audio play error:', e);
      buttonEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
      this.currentVoice = null;
    });
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
    const otherUsers = users.filter(u => !this.user || u.username !== this.user.username);

    if (otherUsers.length === 0) {
      this.membersList.innerHTML = '<p style="color: var(--text-muted); font-size: 13px; text-align: center; margin-top: 20px;">Пока никто из родных не подключился.<br>Поделитесь кодом комнаты: <b>' + this.escapeHtml(this.roomId) + '</b></p>';
      return;
    }

    otherUsers.forEach(user => {
      const item = document.createElement('div');
      item.className = 'member-item';

      const avatarSrc = user.avatar ? this.getFullMediaUrl(user.avatar) : null;
      const initial = (user.displayName || user.username || 'Р').charAt(0).toUpperCase();

      item.innerHTML = `
        <div class="member-info" data-action="view-profile" data-username="${this.escapeHtml(user.username)}">
          <div class="member-avatar">
            ${avatarSrc ? `<img src="${avatarSrc}" alt="Avatar">` : initial}
          </div>
          <div class="member-texts">
            <div class="member-name">${this.escapeHtml(user.displayName || user.username)}</div>
            <span class="member-status-sub" style="color: ${user.inCall ? 'var(--warning)' : 'var(--success)'};">
              ${user.inCall ? '● в звонке' : (user.bio ? this.escapeHtml(user.bio) : '● в сети')}
            </span>
          </div>
        </div>
        <button class="member-call-btn" data-action="start-call" data-id="${this.escapeHtml(user.id)}" data-name="${this.escapeHtml(user.displayName || user.username)}" data-username="${this.escapeHtml(user.username)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
          Звонок
        </button>
      `;
      this.membersList.appendChild(item);
    });
  }

  handleQuickCall() {
    const available = this.onlineMembers.find(u => (!this.user || u.username !== this.user.username) && !u.inCall);
    if (!available) {
      this.showDialog('Никого из родственников сейчас нет в сети или все заняты разговором.');
      return;
    }
    window.callManager.startCall(available.id, available.displayName || available.username, available.username);
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

  // ================= Profile Modals =================
  openMyProfile() {
    if (!this.user) return;
    this.myProfileUsernameTag.textContent = `@${this.user.username}`;
    this.editDisplayName.value = this.user.displayName || '';
    this.editBio.value = this.user.bio || '';
    this.editAvatarUrl = this.user.avatar;

    if (this.user.avatar) {
      const url = this.getFullMediaUrl(this.user.avatar);
      this.editAvatarPreview.innerHTML = `<img src="${url}" alt="Аватар"><div class="avatar-badge-btn">📷</div>`;
    } else {
      const letter = (this.user.displayName || 'Я').charAt(0).toUpperCase();
      this.editAvatarPreview.innerHTML = `<span>${letter}</span><div class="avatar-badge-btn">📷</div>`;
    }

    this.myProfileModal.classList.remove('hidden');
  }

  closeMyProfile() {
    this.myProfileModal.classList.add('hidden');
  }

  async saveMyProfile() {
    const displayName = this.editDisplayName.value.trim();
    const bio = this.editBio.value.trim();

    try {
      const res = await fetch(`${this.serverUrl}/api/profile/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          displayName,
          bio,
          avatar: this.editAvatarUrl
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка обновления профиля');

      this.user = data.user;
      localStorage.setItem('family_user', JSON.stringify(this.user));
      this.syncNativeCredentials();
      this.updateHeaderAvatar();
      this.closeMyProfile();
      this.showDialog('Профиль успешно обновлен!');
    } catch (err) {
      this.showDialog(err.message);
    }
  }

  async viewUserProfile(username) {
    if (!username) return;
    if (this.user && username === this.user.username) {
      return this.openMyProfile();
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/profile/${encodeURIComponent(username)}`);
      if (!res.ok) throw new Error('Профиль не найден');
      const data = await res.json();
      const u = data.user;

      this.viewProfileName.textContent = u.displayName || u.username;
      this.viewProfileUsername.textContent = `@${u.username}`;
      this.viewProfileBio.textContent = u.bio || 'Статус не указан';
      this.viewProfileOnline.innerHTML = u.isOnline ? '<span style="color: var(--success)">● В сети</span>' : '<span style="color: var(--text-muted)">○ Не в сети</span>';

      if (u.avatar) {
        this.viewProfileAvatarBox.innerHTML = `<img src="${this.getFullMediaUrl(u.avatar)}" alt="Avatar">`;
      } else {
        const letter = (u.displayName || u.username || 'Р').charAt(0).toUpperCase();
        this.viewProfileAvatarBox.innerHTML = `<span>${letter}</span>`;
      }

      // Actions
      this.btnProfileCall.onclick = () => {
        this.closeUserProfile();
        const onlineUser = this.onlineMembers.find(m => m.username === u.username);
        if (onlineUser) {
          window.callManager.startCall(onlineUser.id, u.displayName || u.username, u.username);
        } else {
          this.showDialog('Родственник сейчас не в сети для звонка');
        }
      };

      this.btnProfileMessage.onclick = () => {
        this.closeUserProfile();
        this.messageInput.focus();
      };

      this.userProfileModal.classList.remove('hidden');
    } catch (err) {
      this.showDialog('Не удалось открыть профиль: ' + err.message);
    }
  }

  closeUserProfile() {
    this.userProfileModal.classList.add('hidden');
  }

  // ================= Settings & Logout =================
  openSettings() {
    this.settingsServerUrl.value = this.serverUrl;
    this.settingsRoom.value = this.roomId;
    this.settingsModal.classList.remove('hidden');
  }

  closeSettings() {
    this.settingsModal.classList.add('hidden');
  }

  saveSettings() {
    this.serverUrl = this.settingsServerUrl.value.trim();
    this.roomId = this.settingsRoom.value.trim().toLowerCase();

    localStorage.setItem('family_server_url', this.serverUrl);
    localStorage.setItem('family_room', this.roomId);
    this.roomTitle.textContent = `Комната: ${this.roomId.toUpperCase()}`;

    this.syncNativeCredentials();
    this.closeSettings();
    this.connect();
  }

  async logout(askConfirmation = true) {
    if (askConfirmation) {
      const confirmed = await this.showConfirm('Вы уверены, что хотите выйти из аккаунта на этом устройстве? Вы сможете войти снова в любой момент!');
      if (!confirmed) return;
    }

    localStorage.removeItem('family_token');
    localStorage.removeItem('family_device_secret');
    localStorage.removeItem('family_user');
    localStorage.removeItem('family_password');

    this.token = null;
    this.deviceSecret = null;
    this.user = null;

    if (window.AndroidApp && window.AndroidApp.clearCredentials) {
      try {
        window.AndroidApp.clearCredentials();
      } catch (e) {}
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.appScreen.classList.remove('active');
    this.loginScreen.classList.add('active');
    this.switchAuthTab('login');
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

  scrollToBottom() {
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  getFullMediaUrl(path) {
    if (!path) return '';
    if (path.startsWith('data:') || path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:')) {
      return path;
    }
    const base = this.serverUrl || window.location.origin;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${base.replace(/\/$/, '')}${cleanPath}`;
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
    return escaped.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color: #93c5fd; text-decoration: underline;">$1</a>');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.messengerApp = new MessengerApp();
});
