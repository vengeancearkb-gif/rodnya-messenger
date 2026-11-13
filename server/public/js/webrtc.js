// WebRTC 1-on-1 Audio Call Manager (Optimized for Mobile & International Traversal)
class CallManager {
  constructor() {
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.currentCallTarget = null;
    this.pendingOffer = null;
    this.iceCandidatesQueue = [];
    this.localCandidates = [];
    this.callTimerInterval = null;
    this.outgoingRingingTimeout = null;
    this.incomingRingingTimeout = null;
    this.callSeconds = 0;
    this.isMuted = false;
    this.isCaller = false;
    this.iceRestartAttempted = false;

    // High quality public STUN & TURN servers for international NAT traversal (including mobile 4G/5G)
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.relay.metered.ca:80' },
        {
          urls: 'turn:turn.evan-brass.net:3478',
          username: 'user',
          credential: 'password'
        },
        {
          urls: 'turn:turn.evan-brass.net:3478?transport=tcp',
          username: 'user',
          credential: 'password'
        }
      ],
      iceCandidatePoolSize: 10
    };

    this.initDOM();
  }

  initDOM() {
    this.callScreen = document.getElementById('call-screen');
    this.callContactName = document.getElementById('call-contact-name');
    this.callStatusLabel = document.getElementById('call-status-label');
    this.callTimer = document.getElementById('call-timer');
    this.btnUnmuteCall = document.getElementById('btn-unmute-call');
    this.btnToggleMic = document.getElementById('btn-toggle-mic');
    this.btnEndCall = document.getElementById('btn-end-call');

    this.incomingDialog = document.getElementById('incoming-call-dialog');
    this.incomingCallerName = document.getElementById('incoming-caller-name');
    this.btnAcceptCall = document.getElementById('btn-accept-call');
    this.btnRejectCall = document.getElementById('btn-reject-call');

    this.remoteAudio = document.getElementById('remote-audio');

    // Attach listeners
    this.btnToggleMic.addEventListener('click', () => this.toggleMic());
    this.btnEndCall.addEventListener('click', () => this.endCall(true));
    this.btnAcceptCall.addEventListener('click', () => this.acceptIncomingCall());
    this.btnRejectCall.addEventListener('click', () => this.rejectIncomingCall());

    if (this.btnUnmuteCall) {
      this.btnUnmuteCall.addEventListener('click', () => {
        this.unlockAndPlayAudio();
        this.btnUnmuteCall.classList.add('hidden');
      });
    }
  }

  clearTimeouts() {
    if (this.outgoingRingingTimeout) {
      clearTimeout(this.outgoingRingingTimeout);
      this.outgoingRingingTimeout = null;
    }
    if (this.incomingRingingTimeout) {
      clearTimeout(this.incomingRingingTimeout);
      this.incomingRingingTimeout = null;
    }
  }

  // Ensure remote audio element is unmuted and playing
  unlockAndPlayAudio() {
    if (!this.remoteAudio) return;
    this.remoteAudio.muted = false;
    this.remoteAudio.volume = 1.0;
    const playPromise = this.remoteAudio.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        if (this.btnUnmuteCall) this.btnUnmuteCall.classList.add('hidden');
      }).catch(err => {
        console.warn('Audio play request:', err);
        if (this.btnUnmuteCall) this.btnUnmuteCall.classList.remove('hidden');
      });
    }
  }

  // Get local mic stream safely
  async acquireMicrophone() {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
    } catch (e) {
      console.warn('Retrying getUserMedia with audio: true', e);
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
  }

  // Start outgoing audio call to a user
  async startCall(targetUserId, targetDisplayName, targetUsername) {
    if (this.peerConnection) return;
    const finalUsername = targetUsername || targetDisplayName || '';
    const finalDisplayName = targetDisplayName || targetUsername || 'Родственник';
    this.currentCallTarget = {
      id: targetUserId,
      name: finalDisplayName,
      username: finalUsername
    };
    this.iceCandidatesQueue = [];
    this.localCandidates = [];
    this.isCaller = true;
    this.iceRestartAttempted = false;
    this.clearTimeouts();

    // Pre-unlock audio element in user gesture context
    this.unlockAndPlayAudio();

    try {
      this.localStream = await this.acquireMicrophone();
    } catch (err) {
      if (window.messengerApp && window.messengerApp.showDialog) {
        window.messengerApp.showDialog('Ошибка доступа к микрофону: ' + (err.message || err.name));
      } else {
        alert('Ошибка доступа к микрофону: ' + (err.message || err.name));
      }
      return;
    }

    this.showCallScreen(finalDisplayName, 'Вызов...');
    this.createPeerConnection();

    // Add local audio tracks to peer connection
    this.localStream.getTracks().forEach(track => {
      track.enabled = true;
      this.peerConnection.addTrack(track, this.localStream);
    });

    try {
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      await this.peerConnection.setLocalDescription(offer);

      if (window.messengerApp && window.messengerApp.socket) {
        window.messengerApp.socket.emit('call-user', {
          targetUserId,
          targetUsername: finalUsername,
          offer
        });
      }

      // 35-second outgoing call timeout
      this.outgoingRingingTimeout = setTimeout(() => {
        this.callStatusLabel.textContent = 'Собеседник не отвечает';
        setTimeout(() => {
          this.endCall(true);
        }, 1500);
      }, 35000);
    } catch (err) {
      console.error('Error creating offer:', err);
      this.endCall(true);
    }
  }

  // Handle incoming call notification
  handleIncomingCall({ fromUserId, fromUsername, fromAvatar, targetUsername, offer }) {
    if (window.AndroidApp && window.AndroidApp.stopRinging) {
      window.AndroidApp.stopRinging();
    }

    if (this.peerConnection) {
      if (window.messengerApp && window.messengerApp.socket) {
        window.messengerApp.socket.emit('call-reject', {
          targetUserId: fromUserId,
          reason: 'Занят'
        });
      }
      return;
    }

    this.clearTimeouts();
    this.pendingOffer = { fromUserId, fromUsername, fromAvatar, targetUsername, offer };
    this.incomingCallerName.textContent = fromUsername || 'Родственник';

    const incomingAvatarBox = document.getElementById('incoming-avatar-box');
    if (incomingAvatarBox) {
      if (fromAvatar) {
        incomingAvatarBox.innerHTML = `<img src="${window.messengerApp.getFullMediaUrl(fromAvatar)}" alt="Avatar">`;
      } else {
        const letter = (fromUsername || 'Р').charAt(0).toUpperCase();
        incomingAvatarBox.innerHTML = `<span>${letter}</span>`;
      }
    }

    this.incomingDialog.classList.remove('hidden');
    window.soundManager.startRingtone();

    // 40-second incoming call timeout: dismiss automatically if ignored
    this.incomingRingingTimeout = setTimeout(() => {
      this.rejectIncomingCall();
    }, 40000);
  }

  // User presses Accept
  async acceptIncomingCall() {
    this.clearTimeouts();
    if (window.AndroidApp && window.AndroidApp.stopRinging) {
      window.AndroidApp.stopRinging();
    }
    window.soundManager.stopRingtone();
    this.incomingDialog.classList.add('hidden');

    // Pre-unlock audio in user gesture context
    this.unlockAndPlayAudio();

    if (!this.pendingOffer) return;
    const { fromUserId, fromUsername, fromAvatar, offer } = this.pendingOffer;
    this.currentCallTarget = {
      id: fromUserId,
      name: fromUsername,
      username: fromUsername,
      avatar: fromAvatar
    };
    this.pendingOffer = null;
    this.isCaller = false;
    this.iceRestartAttempted = false;
    this.localCandidates = [];

    try {
      this.localStream = await this.acquireMicrophone();
    } catch (err) {
      if (window.messengerApp && window.messengerApp.showDialog) {
        window.messengerApp.showDialog('Не удалось включить микрофон: ' + (err.message || err.name));
      } else {
        alert('Не удалось включить микрофон: ' + (err.message || err.name));
      }
      this.rejectIncomingCall();
      return;
    }

    this.showCallScreen(fromUsername, 'Соединение...', fromAvatar);
    this.createPeerConnection();

    this.localStream.getTracks().forEach(track => {
      track.enabled = true;
      this.peerConnection.addTrack(track, this.localStream);
    });

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      // Drain queued ICE candidates strictly AFTER local description answer is set!
      await this.drainIceCandidates();

      if (window.messengerApp && window.messengerApp.socket) {
        window.messengerApp.socket.emit('call-answer', {
          targetUserId: fromUserId,
          answer
        });
      }
    } catch (err) {
      console.error('Error answering call:', err);
      this.endCall(true);
    }
  }

  // User presses Reject
  rejectIncomingCall() {
    this.clearTimeouts();
    if (window.AndroidApp && window.AndroidApp.stopRinging) {
      window.AndroidApp.stopRinging();
    }
    window.soundManager.stopRingtone();
    this.incomingDialog.classList.add('hidden');

    if (this.pendingOffer) {
      if (window.messengerApp && window.messengerApp.socket) {
        window.messengerApp.socket.emit('call-reject', {
          targetUserId: this.pendingOffer.fromUserId,
          reason: 'Отклонён'
        });
      }
      this.pendingOffer = null;
    }
    this.iceCandidatesQueue = [];
    this.localCandidates = [];
  }

  // Remote party answered our call
  async handleCallAnswered({ fromUserId, answer }) {
    this.clearTimeouts();
    if (!this.peerConnection) return;
    if (fromUserId && this.currentCallTarget) {
      this.currentCallTarget.id = fromUserId;
    }
    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      await this.drainIceCandidates();

      // RE-EMIT ALL GATHERED LOCAL CANDIDATES DIRECTLY TO CONFIRMED CALLEE SOCKET!
      if (this.localCandidates && this.localCandidates.length > 0) {
        for (const cand of this.localCandidates) {
          window.messengerApp.socket.emit('ice-candidate', {
            targetUserId: fromUserId,
            targetUsername: this.currentCallTarget ? this.currentCallTarget.username : '',
            candidate: cand
          });
        }
      }
    } catch (err) {
      console.error('Error setting remote answer:', err);
    }
  }

  // Remote party rejected or was busy
  handleCallRejected({ fromUserId, reason }) {
    this.clearTimeouts();
    window.soundManager.stopRingtone();
    this.callStatusLabel.textContent = reason || 'Вызов завершён';
    setTimeout(() => {
      this.endCall(false);
    }, 1500);
  }

  // ICE Candidate received
  async handleIceCandidate({ fromUserId, candidate }) {
    if (!candidate) return;

    if (this.peerConnection && this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('Error adding ICE candidate:', e);
      }
    } else {
      // Queue until remoteDescription is set!
      this.iceCandidatesQueue.push(candidate);
    }
  }

  async drainIceCandidates() {
    while (this.iceCandidatesQueue.length > 0) {
      const candidate = this.iceCandidatesQueue.shift();
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('Error adding queued ICE candidate:', e);
      }
    }
  }

  // Setup RTCPeerConnection and event handlers
  createPeerConnection() {
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.localCandidates.push(event.candidate);
        if (this.currentCallTarget && window.messengerApp && window.messengerApp.socket) {
          window.messengerApp.socket.emit('ice-candidate', {
            targetUserId: this.currentCallTarget.id,
            targetUsername: this.currentCallTarget.username || '',
            candidate: event.candidate
          });
        }
      }
    };

    // When remote audio track arrives:
    this.peerConnection.ontrack = (event) => {
      console.log('Received remote audio track:', event.track);

      let stream = null;
      if (event.streams && event.streams[0]) {
        stream = event.streams[0];
      } else if (event.track) {
        stream = new MediaStream([event.track]);
      }

      if (stream) {
        this.remoteStream = stream;
        this.remoteAudio.srcObject = stream;
        this.unlockAndPlayAudio();

        setTimeout(() => {
          if (this.remoteAudio.paused && this.btnUnmuteCall) {
            this.btnUnmuteCall.classList.remove('hidden');
          }
        }, 1000);
      }
    };

    const updateConnectionStatus = () => {
      if (!this.peerConnection) return;
      const state = this.peerConnection.connectionState;
      const iceState = this.peerConnection.iceConnectionState;
      console.log('WebRTC connection state:', state, 'ICE:', iceState);

      if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
        this.clearTimeouts();
        this.callStatusLabel.textContent = 'Идёт разговор';
        this.unlockAndPlayAudio();
        this.startCallTimer();
      } else if (iceState === 'checking') {
        this.callStatusLabel.textContent = 'Установка защищённого соединения...';
      } else if (state === 'failed' || iceState === 'failed') {
        if (this.peerConnection && this.isCaller && !this.iceRestartAttempted) {
          this.iceRestartAttempted = true;
          this.callStatusLabel.textContent = 'Переподключение связи...';
          this.restartIce();
        } else {
          this.callStatusLabel.textContent = 'Ошибка P2P соединения';
        }
      } else if (state === 'disconnected' || iceState === 'disconnected') {
        this.callStatusLabel.textContent = 'Переподключение связи...';
      } else if (state === 'closed') {
        this.endCall(false);
      }
    };

    this.peerConnection.onconnectionstatechange = updateConnectionStatus;
    this.peerConnection.oniceconnectionstatechange = updateConnectionStatus;
  }

  async restartIce() {
    if (!this.peerConnection || !this.currentCallTarget) return;
    try {
      const offer = await this.peerConnection.createOffer({ iceRestart: true });
      await this.peerConnection.setLocalDescription(offer);
      if (window.messengerApp && window.messengerApp.socket) {
        window.messengerApp.socket.emit('call-user', {
          targetUserId: this.currentCallTarget.id,
          targetUsername: this.currentCallTarget.username,
          offer
        });
      }
    } catch (e) {
      console.warn('ICE restart error:', e);
    }
  }

  // Toggle local microphone mute
  toggleMic() {
    if (!this.localStream) return;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });

    if (this.isMuted) {
      this.btnToggleMic.classList.add('muted');
    } else {
      this.btnToggleMic.classList.remove('muted');
    }
  }

  // Start in-call duration timer
  startCallTimer() {
    if (this.callTimerInterval) return; // Already running
    this.callSeconds = 0;
    this.callTimer.textContent = '00:00';

    this.callTimerInterval = setInterval(() => {
      this.callSeconds++;
      const mins = String(Math.floor(this.callSeconds / 60)).padStart(2, '0');
      const secs = String(this.callSeconds % 60).padStart(2, '0');
      this.callTimer.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  showCallScreen(contactName, status, avatarUrl) {
    this.callContactName.textContent = contactName || 'Аудиозвонок';
    this.callStatusLabel.textContent = status || '';
    this.callTimer.textContent = '00:00';
    this.isMuted = false;
    this.btnToggleMic.classList.remove('muted');

    const callAvatarBox = document.getElementById('call-avatar-box');
    if (callAvatarBox) {
      if (avatarUrl) {
        callAvatarBox.innerHTML = `<img src="${window.messengerApp.getFullMediaUrl(avatarUrl)}" alt="Avatar"><div class="call-ripple"></div>`;
      } else {
        const letter = (contactName || 'Р').charAt(0).toUpperCase();
        callAvatarBox.innerHTML = `<span id="call-avatar-letter">${letter}</span><div class="call-ripple"></div>`;
      }
    }

    if (this.btnUnmuteCall) this.btnUnmuteCall.classList.add('hidden');
    this.callScreen.classList.remove('hidden');
  }

  // End call
  endCall(notifyPeer = true) {
    this.clearTimeouts();
    if (window.AndroidApp && window.AndroidApp.stopRinging) {
      window.AndroidApp.stopRinging();
    }
    window.soundManager.stopRingtone();
    window.soundManager.playEndCallSound();

    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }

    if (notifyPeer && this.currentCallTarget) {
      if (window.messengerApp && window.messengerApp.socket) {
        window.messengerApp.socket.emit('call-end', {
          targetUserId: this.currentCallTarget.id,
          targetUsername: this.currentCallTarget.username || ''
        });
      }
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.remoteAudio) {
      this.remoteAudio.pause();
      this.remoteAudio.srcObject = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.iceCandidatesQueue = [];
    this.localCandidates = [];
    this.currentCallTarget = null;
    this.pendingOffer = null;
    this.isCaller = false;
    this.iceRestartAttempted = false;
    if (this.btnUnmuteCall) this.btnUnmuteCall.classList.add('hidden');
    this.callScreen.classList.add('hidden');
    this.incomingDialog.classList.add('hidden');
  }
}

window.callManager = new CallManager();

window.handleNativeIncomingCall = function(data, autoAnswer) {
  if (!window.callManager || !data) return;
  console.log('Received native incoming call:', data, 'autoAnswer:', autoAnswer);
  window.callManager.handleIncomingCall(data);
  if (autoAnswer) {
    setTimeout(() => {
      window.callManager.acceptIncomingCall();
    }, 400);
  }
};
