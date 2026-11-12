// WebRTC 1-on-1 Audio Call Manager
class CallManager {
  constructor() {
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.currentCallTarget = null;
    this.pendingOffer = null;
    this.callTimerInterval = null;
    this.callSeconds = 0;
    this.isMuted = false;

    // High quality public STUN servers for international NAT traversal
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
      ]
    };

    this.initDOM();
  }

  initDOM() {
    this.callScreen = document.getElementById('call-screen');
    this.callContactName = document.getElementById('call-contact-name');
    this.callStatusLabel = document.getElementById('call-status-label');
    this.callTimer = document.getElementById('call-timer');
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
  }

  // Start outgoing audio call to a user
  async startCall(targetUserId, targetUsername) {
    if (this.peerConnection) return;
    this.currentCallTarget = { id: targetUserId, name: targetUsername };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
    } catch (err) {
      alert('Ошибка доступа к микрофону: ' + (err.message || err.name));
      return;
    }

    this.showCallScreen(targetUsername, 'Вызов близких...');
    this.createPeerConnection();

    // Add local audio tracks to peer connection
    this.localStream.getTracks().forEach(track => {
      this.peerConnection.addTrack(track, this.localStream);
    });

    try {
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      await this.peerConnection.setLocalDescription(offer);

      window.messengerApp.socket.emit('call-user', {
        targetUserId,
        offer
      });
    } catch (err) {
      console.error('Error creating offer:', err);
      this.endCall(true);
    }
  }

  // Handle incoming call notification
  handleIncomingCall({ fromUserId, fromUsername, offer }) {
    if (this.peerConnection) {
      // Busy
      window.messengerApp.socket.emit('call-reject', {
        targetUserId: fromUserId,
        reason: 'Занят'
      });
      return;
    }

    this.pendingOffer = { fromUserId, fromUsername, offer };
    this.incomingCallerName.textContent = fromUsername || 'Родственник';
    this.incomingDialog.classList.remove('hidden');
    window.soundManager.startRingtone();
  }

  // User presses Accept
  async acceptIncomingCall() {
    window.soundManager.stopRingtone();
    this.incomingDialog.classList.add('hidden');

    if (!this.pendingOffer) return;
    const { fromUserId, fromUsername, offer } = this.pendingOffer;
    this.currentCallTarget = { id: fromUserId, name: fromUsername };
    this.pendingOffer = null;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
    } catch (err) {
      alert('Не удалось включить микрофон: ' + (err.message || err.name));
      this.rejectIncomingCall();
      return;
    }

    this.showCallScreen(fromUsername, 'Соединение...');
    this.createPeerConnection();

    this.localStream.getTracks().forEach(track => {
      this.peerConnection.addTrack(track, this.localStream);
    });

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      window.messengerApp.socket.emit('call-answer', {
        targetUserId: fromUserId,
        answer
      });

      this.startCallTimer();
      this.callStatusLabel.textContent = 'Идёт разговор';
    } catch (err) {
      console.error('Error answering call:', err);
      this.endCall(true);
    }
  }

  // User presses Reject
  rejectIncomingCall() {
    window.soundManager.stopRingtone();
    this.incomingDialog.classList.add('hidden');

    if (this.pendingOffer) {
      window.messengerApp.socket.emit('call-reject', {
        targetUserId: this.pendingOffer.fromUserId,
        reason: 'Отклонён'
      });
      this.pendingOffer = null;
    }
  }

  // Remote party answered our call
  async handleCallAnswered({ fromUserId, answer }) {
    if (!this.peerConnection) return;
    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      this.startCallTimer();
      this.callStatusLabel.textContent = 'Идёт разговор';
    } catch (err) {
      console.error('Error setting remote answer:', err);
    }
  }

  // Remote party rejected or was busy
  handleCallRejected({ fromUserId, reason }) {
    window.soundManager.stopRingtone();
    this.callStatusLabel.textContent = reason || 'Вызов завершён';
    setTimeout(() => {
      this.endCall(false);
    }, 1500);
  }

  // ICE Candidate received
  async handleIceCandidate({ fromUserId, candidate }) {
    if (this.peerConnection && candidate) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('Error adding ICE candidate:', e);
      }
    }
  }

  // Setup RTCPeerConnection and event handlers
  createPeerConnection() {
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.currentCallTarget) {
        window.messengerApp.socket.emit('ice-candidate', {
          targetUserId: this.currentCallTarget.id,
          candidate: event.candidate
        });
      }
    };

    this.peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteAudio.srcObject = event.streams[0];
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      if (!this.peerConnection) return;
      const state = this.peerConnection.connectionState;
      if (state === 'connected') {
        this.callStatusLabel.textContent = 'Соединено (HD Голос)';
      } else if (state === 'disconnected' || state === 'failed') {
        this.callStatusLabel.textContent = 'Связь потеряна...';
      } else if (state === 'closed') {
        this.endCall(false);
      }
    };
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
    this.callSeconds = 0;
    this.callTimer.textContent = '00:00';
    if (this.callTimerInterval) clearInterval(this.callTimerInterval);

    this.callTimerInterval = setInterval(() => {
      this.callSeconds++;
      const mins = String(Math.floor(this.callSeconds / 60)).padStart(2, '0');
      const secs = String(this.callSeconds % 60).padStart(2, '0');
      this.callTimer.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  showCallScreen(contactName, status) {
    this.callContactName.textContent = contactName || 'Аудиозвонок';
    this.callStatusLabel.textContent = status || '';
    this.callTimer.textContent = '00:00';
    this.isMuted = false;
    this.btnToggleMic.classList.remove('muted');
    this.callScreen.classList.remove('hidden');
  }

  // End call
  endCall(notifyPeer = true) {
    window.soundManager.stopRingtone();
    window.soundManager.playEndCallSound();

    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }

    if (notifyPeer && this.currentCallTarget) {
      window.messengerApp.socket.emit('call-end', {
        targetUserId: this.currentCallTarget.id
      });
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.currentCallTarget = null;
    this.pendingOffer = null;
    this.callScreen.classList.add('hidden');
    this.incomingDialog.classList.add('hidden');
  }
}

window.callManager = new CallManager();
