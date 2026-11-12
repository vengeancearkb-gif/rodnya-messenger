// Voice Messages Recording and Playback Manager
class VoiceManager {
  constructor() {
    this.mediaRecorder = null;
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
      const stream = await navigator.mediaDevices.getUserMedia({
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
      this.mediaRecorder = new MediaRecorder(stream, options);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

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
      alert('Не удалось получить доступ к микрофону: ' + (err.message || err.name));
    }
  }

  cancelRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (this.recordingTimerInterval) {
      clearInterval(this.recordingTimerInterval);
      this.recordingTimerInterval = null;
    }

    if (this.mediaRecorder) {
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
      this.mediaRecorder.stop();
      this.mediaRecorder = null;
    }

    this.audioChunks = [];
    this.voiceBanner.classList.add('hidden');
  }

  async stopAndSendRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;

    const durationSeconds = Math.max(1, Math.round((Date.now() - this.recordingStartTime) / 1000));

    if (this.recordingTimerInterval) {
      clearInterval(this.recordingTimerInterval);
      this.recordingTimerInterval = null;
    }

    this.voiceBanner.classList.add('hidden');

    return new Promise((resolve) => {
      this.mediaRecorder.onstop = async () => {
        try {
          const mime = this.mediaRecorder.mimeType || 'audio/webm';
          const ext = mime.includes('ogg') ? '.ogg' : (mime.includes('mp4') ? '.mp4' : '.webm');
          const audioBlob = new Blob(this.audioChunks, { type: mime });

          // Release mic tracks
          this.mediaRecorder.stream.getTracks().forEach(track => track.stop());

          // Upload audio to server
          const formData = new FormData();
          formData.append('file', audioBlob, `voice_${Date.now()}${ext}`);

          const serverUrl = window.messengerApp.serverUrl || '';
          const response = await fetch(`${serverUrl}/api/upload`, {
            method: 'POST',
            body: formData
          });

          if (!response.ok) throw new Error('Upload failed');
          const data = await response.json();

          // Send message via socket
          window.messengerApp.socket.emit('send-message', {
            type: 'voice',
            fileUrl: data.url,
            fileName: data.filename,
            duration: durationSeconds
          });

          resolve();
        } catch (err) {
          console.error('Failed to send voice message:', err);
          alert('Ошибка отправки голосового сообщения');
          resolve();
        }
      };

      this.mediaRecorder.stop();
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
