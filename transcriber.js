/**
 * AirSync Suite - Offline Transcriber Module
 */

class TranscriberManager {
  constructor() {
    this.worker = null;
    this.isModelLoaded = false;
    this.isTranscribing = false;
    this.isRecording = false;
    
    // Recording state
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.recordInterval = null;
    this.recordDuration = 0;

    // Transcription output cache
    this.lastResult = null;

    // DOM Elements
    this.dom = {
      modelSelect: document.getElementById('model-select'),
      initEngineBtn: document.getElementById('init-engine-btn'),
      engineStatusBadge: document.getElementById('engine-status-badge'),
      engineStatusText: document.getElementById('engine-status-text'),
      
      // Progress Bar
      modelProgressCard: document.getElementById('model-progress-card'),
      modelProgressBar: document.getElementById('model-progress-bar'),
      modelProgressPercent: document.getElementById('model-progress-percent'),
      modelProgressText: document.getElementById('model-progress-text'),
      
      // Audio actions
      audioDropzone: document.getElementById('audio-dropzone'),
      audioFileInput: document.getElementById('audio-file-input'),
      recordAudioBtn: document.getElementById('record-audio-btn'),
      recordBtnLabel: document.getElementById('record-btn-label'),
      recordIndicator: document.getElementById('record-indicator'),
      
      // Results
      resultPlaceholder: document.getElementById('transcription-result-placeholder'),
      resultCard: document.getElementById('transcription-result-card'),
      transcriptText: document.getElementById('transcript-text'),
      
      // Export actions
      copyBtn: document.getElementById('copy-transcript-btn'),
      downloadTxtBtn: document.getElementById('download-txt-btn'),
      downloadSrtBtn: document.getElementById('download-srt-btn'),
      
      // Active state overlay
      transcribeLoader: document.getElementById('transcribe-loader'),
      transcribeLoaderText: document.getElementById('transcribe-loader-text')
    };

    this.init();
  }

  init() {
    this.setupWorker();
    this.setupEventListeners();
  }

  setupWorker() {
    // Instantiate Web Worker as ES Module
    this.worker = new Worker('transcriber-worker.js', { type: 'module' });
    
    this.worker.onmessage = (e) => {
      const { type, data } = e.data;

      switch (type) {
        case 'status':
          this.updateLoaderText(data);
          break;
          
        case 'progress':
          this.showModelProgress(data.file, data.progress);
          break;
          
        case 'ready':
          this.handleModelReady();
          break;
          
        case 'result':
          this.handleTranscriptionResult(data);
          break;
          
        case 'error':
          this.handleError(data);
          break;
      }
    };
  }

  setupEventListeners() {
    // Load Model Engine
    if (this.dom.initEngineBtn) {
      this.dom.initEngineBtn.addEventListener('click', () => this.loadModel());
    }

    // Audio dropzone triggers
    if (this.dom.audioDropzone) {
      this.dom.audioDropzone.addEventListener('click', () => {
        if (!this.isModelLoaded) {
          alert('Please initialize the AI Engine first.');
          return;
        }
        if (this.isTranscribing) return;
        this.dom.audioFileInput.click();
      });

      this.dom.audioFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          this.processAudioFile(e.target.files[0]);
        }
      });

      // Drag and drop styles
      ['dragenter', 'dragover'].forEach(eventName => {
        this.dom.audioDropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (this.isModelLoaded && !this.isTranscribing) {
            this.dom.audioDropzone.classList.add('border-indigo-500', 'bg-indigo-500/[0.04]');
          }
        }, false);
      });

      ['dragleave', 'drop'].forEach(eventName => {
        this.dom.audioDropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.dom.audioDropzone.classList.remove('border-indigo-500', 'bg-indigo-500/[0.04]');
        }, false);
      });

      this.dom.audioDropzone.addEventListener('drop', (e) => {
        if (!this.isModelLoaded) {
          alert('Please initialize the AI Engine first.');
          return;
        }
        if (this.isTranscribing) return;
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
          this.processAudioFile(files[0]);
        }
      });
    }

    // Microphone toggle
    if (this.dom.recordAudioBtn) {
      this.dom.recordAudioBtn.addEventListener('click', () => this.toggleMicrophoneRecord());
    }

    // Action buttons
    if (this.dom.copyBtn) {
      this.dom.copyBtn.addEventListener('click', () => this.copyTranscriptToClipboard());
    }
    if (this.dom.downloadTxtBtn) {
      this.dom.downloadTxtBtn.addEventListener('click', () => this.downloadTxt());
    }
    if (this.dom.downloadSrtBtn) {
      this.dom.downloadSrtBtn.addEventListener('click', () => this.downloadSrt());
    }
  }

  /**
   * Request model initialization inside the worker
   */
  loadModel() {
    const selectedModel = this.dom.modelSelect.value;
    
    // UI state updates
    this.dom.initEngineBtn.disabled = true;
    this.dom.initEngineBtn.textContent = 'Loading...';
    
    this.dom.engineStatusBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-550 border border-indigo-500/20';
    this.dom.engineStatusBadge.textContent = 'Loading';
    if (this.dom.engineStatusText) this.dom.engineStatusText.textContent = 'Connecting to Hugging Face...';
    
    this.dom.modelProgressCard.classList.remove('hidden');
    this.showModelProgress('Requesting model weights...', 0);

    this.worker.postMessage({
      type: 'load',
      data: { modelName: selectedModel }
    });
  }

  showModelProgress(fileName, progress) {
    if (this.dom.modelProgressBar) {
      this.dom.modelProgressBar.style.width = `${progress}%`;
    }
    if (this.dom.modelProgressPercent) {
      this.dom.modelProgressPercent.textContent = `${progress}%`;
    }
    if (this.dom.modelProgressText) {
      this.dom.modelProgressText.textContent = `Downloading ${fileName}...`;
    }
  }

  handleModelReady() {
    this.isModelLoaded = true;
    
    // Status text details
    const selectedText = this.dom.modelSelect.options[this.dom.modelSelect.selectedIndex].text;
    
    this.dom.engineStatusBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20';
    this.dom.engineStatusBadge.textContent = 'Active';
    if (this.dom.engineStatusText) {
      this.dom.engineStatusText.textContent = `Local Engine: ${selectedText.split(' (')[0]}`;
    }

    this.dom.initEngineBtn.classList.add('hidden');
    this.dom.modelProgressCard.classList.add('hidden');
    this.dom.audioDropzone.classList.remove('opacity-50', 'pointer-events-none');
    this.dom.recordAudioBtn.classList.remove('opacity-50', 'pointer-events-none');
  }

  /**
   * Resampling and audio decoding pipeline (Main thread)
   */
  async processAudioFile(file) {
    if (this.isTranscribing) return;
    
    // Check constraints
    if (file.size > 200 * 1024 * 1024) {
      alert('Files above 200MB are blocked to avoid browser RAM crashes. Please split your file.');
      return;
    }

    this.startTranscribeLoader('Decoding file audio data...');

    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await file.arrayBuffer();
      
      this.updateLoaderText('Resampling audio track to 16kHz mono...');
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      // Resample to 16kHz
      const offlineCtx = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        Math.round(audioBuffer.duration * 16000),
        16000
      );
      
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start();
      
      const resampledBuffer = await offlineCtx.startRendering();
      
      // Convert to mono (merge channels if stereo)
      const numChannels = resampledBuffer.numberOfChannels;
      const length = resampledBuffer.length;
      let audioData;

      if (numChannels === 1) {
        audioData = resampledBuffer.getChannelData(0);
      } else {
        const left = resampledBuffer.getChannelData(0);
        const right = resampledBuffer.getChannelData(1);
        audioData = new Float32Array(length);
        for (let i = 0; i < length; i++) {
          audioData[i] = (left[i] + right[i]) / 2;
        }
      }

      this.updateLoaderText('Sending buffer to AI inference worker...');
      this.worker.postMessage({
        type: 'transcribe',
        data: { audio: audioData }
      });
      
    } catch (error) {
      console.error(error);
      this.handleError(`Failed to extract audio track: ${error.message}`);
    }
  }

  /**
   * Microphone Recording logic
   */
  async toggleMicrophoneRecord() {
    if (!this.isModelLoaded) return;
    
    if (this.isRecording) {
      this.stopMicrophoneRecord();
    } else {
      this.startMicrophoneRecord();
    }
  }

  async startMicrophoneRecord() {
    this.audioChunks = [];
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
        this.processAudioFile(audioBlob);
        
        // Stop stream tracks
        stream.getTracks().forEach(track => track.stop());
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.recordDuration = 0;
      
      // UI updates
      this.dom.recordIndicator.classList.remove('hidden');
      this.dom.recordIndicator.classList.add('animate-pulse');
      this.dom.recordBtnLabel.textContent = 'Stop Recording (00:00)';
      
      this.recordInterval = setInterval(() => {
        this.recordDuration++;
        const mins = String(Math.floor(this.recordDuration / 60)).padStart(2, '0');
        const secs = String(this.recordDuration % 60).padStart(2, '0');
        this.dom.recordBtnLabel.textContent = `Stop Recording (${mins}:${secs})`;
        
        // Limit max recording to 10 minutes to prevent high memory usage
        if (this.recordDuration >= 600) {
          this.stopMicrophoneRecord();
        }
      }, 1000);

      this.dom.recordAudioBtn.classList.remove('bg-white', 'dark:bg-slate-900', 'border-slate-200');
      this.dom.recordAudioBtn.classList.add('bg-rose-500/10', 'border-rose-500/50', 'text-rose-500');

    } catch (err) {
      console.error('Mic access denied:', err);
      alert('Microphone access denied or unsupported.');
    }
  }

  stopMicrophoneRecord() {
    if (!this.isRecording || !this.mediaRecorder) return;
    
    clearInterval(this.recordInterval);
    this.mediaRecorder.stop();
    this.isRecording = false;

    // Reset button design
    this.dom.recordIndicator.classList.add('hidden');
    this.dom.recordIndicator.classList.remove('animate-pulse');
    this.dom.recordBtnLabel.textContent = 'Record Live Audio';
    this.dom.recordAudioBtn.classList.add('bg-white', 'dark:bg-slate-900', 'border-slate-200');
    this.dom.recordAudioBtn.classList.remove('bg-rose-500/10', 'border-rose-500/50', 'text-rose-500');
  }

  /**
   * Handle Transcription results
   */
  handleTranscriptionResult(result) {
    this.lastResult = result;
    this.stopTranscribeLoader();

    if (this.dom.resultPlaceholder) this.dom.resultPlaceholder.classList.add('hidden');
    if (this.dom.resultCard) this.dom.resultCard.classList.remove('hidden');

    if (this.dom.transcriptText) {
      // Print formatted segments
      const text = result.text.trim();
      this.dom.transcriptText.innerHTML = text;
    }
  }

  startTranscribeLoader(statusText) {
    this.isTranscribing = true;
    if (this.dom.transcribeLoader) {
      this.dom.transcribeLoader.classList.remove('hidden');
    }
    this.updateLoaderText(statusText);
  }

  updateLoaderText(text) {
    if (this.dom.transcribeLoaderText) {
      this.dom.transcribeLoaderText.textContent = text;
    }
  }

  stopTranscribeLoader() {
    this.isTranscribing = false;
    if (this.dom.transcribeLoader) {
      this.dom.transcribeLoader.classList.add('hidden');
    }
  }

  handleError(errorMessage) {
    this.stopTranscribeLoader();
    this.stopMicrophoneRecord();
    alert(errorMessage);
    
    // Reset load button
    this.dom.initEngineBtn.disabled = false;
    this.dom.initEngineBtn.textContent = 'Initialize Engine';
    this.dom.engineStatusBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20';
    this.dom.engineStatusBadge.textContent = 'Not Loaded';
  }

  /**
   * Action Exports
   */
  copyTranscriptToClipboard() {
    if (!this.lastResult) return;
    navigator.clipboard.writeText(this.lastResult.text.trim()).then(() => {
      alert('Transcript copied to clipboard!');
    });
  }

  downloadTxt() {
    if (!this.lastResult) return;
    const blob = new Blob([this.lastResult.text.trim()], { type: 'text/plain;charset=utf-8' });
    this.triggerFileDownload(blob, 'transcript.txt');
  }

  downloadSrt() {
    if (!this.lastResult || !this.lastResult.chunks) return;
    
    let srtText = '';
    this.lastResult.chunks.forEach((chunk, index) => {
      const id = index + 1;
      const start = chunk.timestamp[0];
      const end = chunk.timestamp[1] !== null ? chunk.timestamp[1] : start + 3; // Default 3s if no end
      
      const timeStr = `${this.formatSrtTime(start)} --> ${this.formatSrtTime(end)}`;
      srtText += `${id}\n${timeStr}\n${chunk.text.trim()}\n\n`;
    });

    const blob = new Blob([srtText], { type: 'text/srt;charset=utf-8' });
    this.triggerFileDownload(blob, 'transcript.srt');
  }

  triggerFileDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  formatSrtTime(seconds) {
    if (seconds === null || seconds === undefined) return '00:00:00,000';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    
    const pad = (num, size = 2) => String(num).padStart(size, '0');
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`;
  }
}

// Attach to window
window.Transcriber = new TranscriberManager();
