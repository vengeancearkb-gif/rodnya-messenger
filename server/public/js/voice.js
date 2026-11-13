// Voice Messages Recording and Playback Manager
class VoiceManager {
  constructor() {
    this.mediaRecorder = null;
    this.mediaStream = null;
    this.audioChunks = [];
    this.recordingStartTime = 0;
    this.recordingTimerInterval = null;
    this.isRecording = false;

    this.initDOM();
  }

  initDOM() {
    this.btnRecordVoice = document.getElementById('btn-record-voice');
    this.voiceBanner = document.getElementById('voice-recording-banner');
    this.recordingTimer = document.getElementById('recording-timer');
    this.btnCancelVoice = document.getElementById('btn-cancel-voice');
    this.btnSendVoice = document.getElementById('btn-send-voice');

    this.btnRecordVoice.addEventListener('click', () => this.startRecording());
    this.btnCancelVoice.addEventListener('click', () => this.cancelRecording());
    this.btnSendVoice.addEventListener('click', () => this.stopAndSendRecording());
  }

  async startRecording() {
    if (this.isRecording) return;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      this.audioChunks = [];
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/aac'
      ];
      let selectedMime = '';
      for (const mime of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mime)) {
          selectedMime = mime;
          break;
        }
      }

      const options = selectedMime ? { mimeType: selectedMime } : {};
      this.mediaRecorder = new MediaRecorder(this.mediaStream, options);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      // Handle unexpected interruptions (e.g. GSM incoming call, device error)
      this.mediaRecorder.onerror = (e) => {
        console.warn('MediaRecorder error:', e);
        this.cancelRecording();
      };

      // Listen to track ended event (mic unplugged or revoked by OS)
      this.mediaStream.getAudioTracks().forEach(track => {
        track.onended = () => {
          if (this.isRecording) {
            this.cancelRecording();
            if (window.messengerApp && window.messengerApp.showDialog) {
              window.messengerApp.showDialog('Запись прервана системой');
            }
          }
        };
      });

      this.mediaRecorder.start(100);
      this.isRecording = true;
      this.recordingStartTime = Date.now();

      // UI updates
      this.voiceBanner.classList.remove('hidden');
      this.recordingTimer.textContent = '00:00';

      this.recordingTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        this.recordingTimer.textContent = `${mins}:${secs}`;
      }, 1000);
    } catch (err) {
      if (window.messengerApp && window.messengerApp.showDialog) {
        window.messengerApp.showDialog('Не удалось получить доступ к микрофону: ' + (err.message || err.name));
      } else {
        alert('Не удалось получить доступ к микрофону: ' + (err.message || err.name));
      }
    }
  }

  cancelRecording() {
    if (!this.isRecording && !this.mediaRecorder) return;
    this.isRecording = false;

    if (this.recordingTimerInterval) {
      clearInterval(this.recordingTimerInterval);
      this.recordingTimerInterval = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {}
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.voiceBanner.classList.add('hidden');
  }

  async stopAndSendRecording() {
    if (!this.isRecording || !this.mediaRecorder) return;
    this.isRecording = false;

    const durationSeconds = Math.max(1, Math.round((Date.now() - this.recordingStartTime) / 1000));

    if (this.recordingTimerInterval) {
      clearInterval(this.recordingTimerInterval);
      this.recordingTimerInterval = null;
    }

    this.voiceBanner.classList.add('hidden');

    return new Promise((resolve) => {
      const recorder = this.mediaRecorder;
      const stream = this.mediaStream;

      recorder.onstop = async () => {
        try {
          if (stream) {
            stream.getTracks().forEach(track => track.stop());
          }

          const mime = recorder.mimeType || 'audio/webm';
          const ext = mime.includes('ogg') ? '.ogg' : (mime.includes('mp4') ? '.mp4' : '.webm');
          const audioBlob = new Blob(this.audioChunks, { type: mime });

          // Upload audio to server with authentication
          const formData = new FormData();
          formData.append('file', audioBlob, `voice_${Date.now()}${ext}`);

          const serverUrl = window.messengerApp.serverUrl || '';
          const token = window.messengerApp.token || '';
          const response = await fetch(`${serverUrl}/api/upload`, {
            method: 'POST',
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            body: formData
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Upload failed');
          }
          const data = await response.json();

          // Send message via socket
          if (window.messengerApp.socket) {
            window.messengerApp.socket.emit('send-message', {
              type: 'voice',
              fileUrl: data.url,
              fileName: data.filename,
              duration: durationSeconds
            });
          }

          resolve();
        } catch (err) {
          console.error('Failed to send voice message:', err);
          if (window.messengerApp && window.messengerApp.showDialog) {
            window.messengerApp.showDialog('Ошибка отправки голосового сообщения: ' + err.message);
          } else {
            alert('Ошибка отправки голосового сообщения: ' + err.message);
          }
          resolve();
        } finally {
          this.mediaRecorder = null;
          this.mediaStream = null;
          this.audioChunks = [];
        }
      };

      try {
        recorder.stop();
      } catch (e) {
        this.cancelRecording();
        resolve();
      }
    });
  }

  // Format seconds to mm:ss
  static formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
}

window.voiceManager = new VoiceManager();
