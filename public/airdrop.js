/**
 * AirSync Suite - WebRTC P2P AirDrop Module (Upgraded)
 */

class AirDropManager {
  constructor() {
    this.peer = null;
    this.conns = new Map(); // Map<peerId, { conn: DataConnection, device: string, accepted: boolean }>
    this.localId = null;
    
    // File Transfer State (Sender)
    this.sendingFile = null;
    this.sendOffset = 0;
    this.isSending = false;

    // File Transfer State (Receiver)
    this.incomingMetadata = null;
    this.receivedChunks = [];
    this.receivedSize = 0;
    
    // Stats tracking (updated per second)
    this.transferStartTime = 0;
    this.lastStatsTime = 0;
    this.lastBytesTransferred = 0;
    this.statsInterval = null;

    // DOM Elements
    this.dom = {
      localPeerId: document.getElementById('local-peer-id'),
      localQrCode: document.getElementById('local-qr-code'),
      remotePeerIdInput: document.getElementById('remote-peer-id-input'),
      connectPeerBtn: document.getElementById('connect-peer-btn'),
      connectionStatus: document.getElementById('connection-status'),
      connectionSubstatus: document.getElementById('connection-substatus'),
      fileDropzone: document.getElementById('file-dropzone'),
      fileInput: document.getElementById('file-input'),
      
      // Connected Devices UI
      devicesCountBadge: document.getElementById('devices-count-badge'),
      connectedDevicesList: document.getElementById('connected-devices-list'),
      noDevicesMsg: document.getElementById('no-devices-msg'),

      // Transfer Card Details
      transferCard: document.getElementById('transfer-card'),
      transferFileName: document.getElementById('transfer-file-name'),
      transferFileSize: document.getElementById('transfer-file-size'),
      transferProgressBar: document.getElementById('transfer-progress-bar'),
      transferPercentage: document.getElementById('transfer-percentage'),
      transferSpeed: document.getElementById('transfer-speed'),
      transferEta: document.getElementById('transfer-eta'),
      cancelTransferBtn: document.getElementById('cancel-transfer-btn'),
      
      // Incoming Modal
      incomingModal: document.getElementById('incoming-file-modal'),
      incomingText: document.getElementById('incoming-file-text'),
      acceptBtn: document.getElementById('accept-file-btn'),
      declineBtn: document.getElementById('decline-file-btn')
    };

    // Constants strictly set for maximum network speed and buffer flow control
    this.CHUNK_SIZE = 65536; // 64KB Slicing Chunk Size
    this.BUFFER_THRESHOLD_LOW = 1024 * 1024; // 1MB thresholdLow
    this.BUFFER_THRESHOLD_HIGH = 2 * 1024 * 1024; // 2MB thresholdHigh

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.initializePeer();
  }

  setupEventListeners() {
    // Manual pairing connection
    if (this.dom.connectPeerBtn) {
      this.dom.connectPeerBtn.addEventListener('click', () => {
        const code = this.dom.remotePeerIdInput.value.trim();
        if (code.length === 4 && /^\d+$/.test(code)) {
          this.connectToPeer(code);
        } else {
          alert('Please enter a valid 4-digit code.');
        }
      });
    }

    // Input code auto-formatting
    if (this.dom.remotePeerIdInput) {
      this.dom.remotePeerIdInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
      });
    }

    // Drag-and-drop events
    if (this.dom.fileDropzone) {
      this.dom.fileDropzone.addEventListener('click', () => {
        if (this.conns.size === 0) {
          alert('Please connect to a peer first before sending files.');
          return;
        }
        if (this.isSending) return;
        this.dom.fileInput.click();
      });

      this.dom.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          this.handleFileSelected(e.target.files[0]);
        }
      });

      ['dragenter', 'dragover'].forEach(eventName => {
        this.dom.fileDropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (this.conns.size > 0 && !this.isSending) {
            this.dom.fileDropzone.classList.add('border-indigo-500', 'bg-indigo-500/[0.04]');
          }
        }, false);
      });

      ['dragleave', 'drop'].forEach(eventName => {
        this.dom.fileDropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.dom.fileDropzone.classList.remove('border-indigo-500', 'bg-indigo-500/[0.04]');
        }, false);
      });

      this.dom.fileDropzone.addEventListener('drop', (e) => {
        if (this.conns.size === 0) {
          alert('Please connect to a peer first before sending files.');
          return;
        }
        if (this.isSending) return;
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
          this.handleFileSelected(files[0]);
        }
      });
    }

    // Modal buttons
    if (this.dom.acceptBtn) {
      this.dom.acceptBtn.addEventListener('click', () => this.acceptIncomingFile());
    }
    if (this.dom.declineBtn) {
      this.dom.declineBtn.addEventListener('click', () => this.declineIncomingFile());
    }

    // Cancel transfer
    if (this.dom.cancelTransferBtn) {
      this.dom.cancelTransferBtn.addEventListener('click', () => this.cancelTransfer());
    }
  }

  /**
   * Initialize PeerJS client with a random 4-digit code
   */
  initializePeer() {
    this.updateStatus('Initializing PeerJS...', 'Setting up secure P2P radio...');
    
    // Generate a 4-digit numeric code
    const code = Math.floor(1000 + Math.random() * 9000);
    this.localId = `airsync-${code}`;

    // Configure connection using Google's public STUN server
    this.peer = new Peer(this.localId, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      },
      debug: 1
    });

    this.peer.on('open', (id) => {
      const codeOnly = id.split('-')[1];
      this.updateStatus('Radar Active', 'Waiting for connection...');
      if (this.dom.localPeerId) {
        this.dom.localPeerId.textContent = codeOnly;
      }
      this.generatePairingQr(codeOnly);
      
      // Auto-fill connection if hash parameter is present (e.g. #airdrop?room=XXXX)
      this.checkUrlAutoConnect();
    });

    this.peer.on('connection', (connection) => {
      this.handleIncomingConnection(connection);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS error:', err.type, err);
      if (err.type === 'id-taken') {
        // Retry with another code on collision
        this.initializePeer();
      } else if (err.type === 'peer-unavailable') {
        alert('Target device not found. Please verify the 4-digit code.');
        this.updateStatus('Radar Active', 'Waiting for connection...');
      } else {
        this.updateStatus('Connection Error', 'Please check network and reload.');
      }
    });
  }

  generatePairingQr(code) {
    if (!this.dom.localQrCode) return;
    this.dom.localQrCode.innerHTML = '';
    
    const pairingUrl = `${window.location.origin}${window.location.pathname}#airdrop?room=${code}`;
    
    // Generate QR using global QRCode library
    if (typeof QRCode !== 'undefined') {
      new QRCode(this.dom.localQrCode, {
        text: pairingUrl,
        width: 128,
        height: 128,
        colorDark: document.documentElement.classList.contains('dark') ? '#ffffff' : '#0f172a',
        colorLight: 'transparent',
        correctLevel: QRCode.CorrectLevel.M
      });
      // Add visual styling adjustments to the generated image
      setTimeout(() => {
        const qrImg = this.dom.localQrCode.querySelector('img');
        if (qrImg) qrImg.classList.add('rounded-lg', 'bg-white', 'p-2');
      }, 50);
    }
  }

  checkUrlAutoConnect() {
    const hash = window.location.hash;
    const roomParam = hash.match(/[?&]room=(\d{4})/);
    if (roomParam && roomParam[1]) {
      const code = roomParam[1];
      this.dom.remotePeerIdInput.value = code;
      // Auto connect with delay to let layout load
      setTimeout(() => {
        this.connectToPeer(code);
      }, 300);
    }
  }

  /**
   * Connect to target peer by 4-digit room code
   */
  connectToPeer(code) {
    const targetPeerId = `airsync-${code}`;
    this.updateStatus('Connecting...', `Establishing handshake with peer ${code}`);
    
    const connection = this.peer.connect(targetPeerId, {
      reliable: true
    });
    
    this.handleIncomingConnection(connection);
  }

  /**
   * Parse local User Agent to get device details
   */
  getDeviceInfo() {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return "iPhone/iOS";
    if (/Android/.test(ua)) return "Android Device";
    if (/Macintosh/.test(ua)) return "Mac PC";
    if (/Windows/.test(ua)) return "Windows PC";
    if (/Linux/.test(ua)) return "Linux PC";
    return "Smart Device";
  }

  /**
   * Wire connection events
   */
  handleIncomingConnection(connection) {
    const peerId = connection.peer;
    
    // Save in map structure
    this.conns.set(peerId, {
      conn: connection,
      device: 'Connecting device...',
      accepted: false
    });

    connection.on('open', () => {
      // Send handshake information
      connection.send({
        type: 'handshake',
        device: this.getDeviceInfo()
      });

      // Configure low threshold for backpressure optimization (1MB)
      if (connection.dataChannel) {
        connection.dataChannel.bufferedAmountLowThreshold = this.BUFFER_THRESHOLD_LOW;
      }

      this.updateConnectedDevicesUI();
      this.dom.fileDropzone.classList.remove('opacity-50', 'pointer-events-none');
    });

    connection.on('data', (data) => {
      this.handleReceivedData(data, peerId);
    });

    connection.on('close', () => {
      this.conns.delete(peerId);
      this.updateConnectedDevicesUI();
      
      if (this.conns.size === 0) {
        this.updateStatus('Radar Active', 'All peers disconnected. Waiting for connections...');
        this.resetTransferState();
        this.dom.fileDropzone.classList.add('opacity-50', 'pointer-events-none');
      } else {
        const peerCode = peerId.split('-')[1];
        this.updateStatus('Devices Connected', `Device ${peerCode} left. ${this.conns.size} active devices.`);
      }
    });

    connection.on('error', (err) => {
      console.error(`Connection error with ${peerId}:`, err);
    });
  }

  updateConnectedDevicesUI() {
    if (this.dom.devicesCountBadge) {
      this.dom.devicesCountBadge.textContent = this.conns.size;
    }

    if (!this.dom.connectedDevicesList) return;

    // Reset list
    this.dom.connectedDevicesList.innerHTML = '';

    if (this.conns.size === 0) {
      if (this.dom.noDevicesMsg) {
        this.dom.connectedDevicesList.appendChild(this.dom.noDevicesMsg);
      } else {
        const li = document.createElement('li');
        li.className = 'text-center text-xs text-slate-400 dark:text-slate-550 py-2 italic';
        li.textContent = 'No devices connected';
        this.dom.connectedDevicesList.appendChild(li);
      }
      return;
    }

    this.conns.forEach((peerData, peerId) => {
      const code = peerId.split('-')[1];
      const li = document.createElement('li');
      li.className = 'flex items-center justify-between text-xs p-2.5 bg-slate-100/50 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40 rounded-xl shadow-sm transition-all';
      
      li.innerHTML = `
        <div class="flex flex-col">
          <span class="font-bold text-slate-700 dark:text-slate-350">Device ${code}</span>
          <span class="text-[9px] text-slate-400 dark:text-slate-500">${peerData.device}</span>
        </div>
        <span class="px-2 py-0.5 rounded text-[9px] font-bold bg-indigo-500/10 text-indigo-550 dark:text-indigo-400 border border-indigo-500/10">Active</span>
      `;
      this.dom.connectedDevicesList.appendChild(li);
    });

    // Update status bar text
    this.updateStatus('Devices Connected', `${this.conns.size} device(s) connected to local room.`);
  }

  updateStatus(title, subtitle) {
    if (this.dom.connectionStatus) this.dom.connectionStatus.textContent = title;
    if (this.dom.connectionSubstatus) this.dom.connectionSubstatus.textContent = subtitle;
  }

  /**
   * Handle Received Packets
   */
  handleReceivedData(packet, senderPeerId) {
    if (!packet || typeof packet !== 'object') return;

    switch (packet.type) {
      case 'handshake':
        const peerData = this.conns.get(senderPeerId);
        if (peerData) {
          peerData.device = packet.device;
          this.updateConnectedDevicesUI();
        }
        break;

      case 'meta':
        // Sender is offering a file
        this.incomingMetadata = { ...packet, sender: senderPeerId };
        this.receivedChunks = [];
        this.receivedSize = 0;
        
        // Show confirmation popup
        if (this.dom.incomingText && this.dom.incomingModal) {
          const sizeStr = this.formatBytes(packet.size);
          const peerCode = senderPeerId.split('-')[1];
          this.dom.incomingText.innerHTML = `Device <strong>${peerCode}</strong> wants to send:<br><span class="text-indigo-600 dark:text-indigo-400 font-semibold">${packet.name}</span> (${sizeStr})`;
          
          if (packet.size > 500 * 1024 * 1024) {
            this.dom.incomingText.innerHTML += `<br><span class="text-rose-500 text-[11px] mt-2 block">Warning: Files > 500MB may require high RAM on mobile devices.</span>`;
          }
          
          this.dom.incomingModal.classList.remove('hidden', 'opacity-0');
          this.dom.incomingModal.classList.add('flex');
        }
        break;

      case 'accept':
        // A peer accepted our file broadcast
        const receivingPeer = this.conns.get(senderPeerId);
        if (receivingPeer) {
          receivingPeer.accepted = true;
          this.updateStatus('Peer Accepted', 'Handshaking completed, starting broadcast...');
        }

        // Start streaming if we are ready and not streaming already
        if (this.isSending && this.sendingFile && !this.broadcastActive) {
          this.startBroadcastStream();
        }
        break;

      case 'decline':
        // A peer declined
        const declinerCode = senderPeerId.split('-')[1];
        alert(`Device ${declinerCode} declined the file transfer.`);
        
        const decliner = this.conns.get(senderPeerId);
        if (decliner) decliner.accepted = false;
        
        // If no accepted peers remain, stop transfer
        const hasAccepted = Array.from(this.conns.values()).some(p => p.accepted);
        if (!hasAccepted) {
          this.resetTransferState();
        }
        break;

      case 'chunk':
        // Accumulating chunks (Receiver side)
        if (this.incomingMetadata) {
          this.receivedChunks.push(packet.data);
          this.receivedSize += packet.data.byteLength;
          this.updateTransferProgress(this.receivedSize, this.incomingMetadata.size, false);
        }
        break;

      case 'done':
        // Transfer complete (Receiver side)
        if (this.incomingMetadata) {
          this.finalizeReceivedFile();
        }
        break;

      case 'cancel':
        alert('File transfer was cancelled by the peer.');
        this.resetTransferState();
        break;
    }
  }

  /**
   * File Selection Handling
   */
  handleFileSelected(file) {
    if (this.conns.size === 0) {
      alert('Please connect to a peer first.');
      return;
    }
    this.sendingFile = file;
    this.isSending = true;

    // Send metadata to ALL connected devices
    this.conns.forEach((peerData) => {
      peerData.accepted = false; // Reset accepted status for the new file
      try {
        peerData.conn.send({
          type: 'meta',
          name: file.name,
          size: file.size,
          mime: file.type
        });
      } catch (err) {
        console.error(`Failed to send meta to ${peerData.conn.peer}:`, err);
      }
    });

    // Display progress UI (Waiting for peer approval)
    this.showTransferCard(file.name, file.size, true);
  }

  /**
   * Action triggers from Confirmation Modal
   */
  acceptIncomingFile() {
    this.closeModal();
    if (!this.incomingMetadata) return;

    this.isSending = false; // We are receiver
    this.transferStartTime = Date.now();
    this.lastStatsTime = Date.now();
    this.lastBytesTransferred = 0;

    // Show Progress UI
    this.showTransferCard(this.incomingMetadata.name, this.incomingMetadata.size, false);

    // Send acceptance signal to the specific sender peer
    const senderPeer = this.conns.get(this.incomingMetadata.sender);
    if (senderPeer) {
      senderPeer.conn.send({ type: 'accept' });
      this.startStatsTimer(false);
    } else {
      alert('Connection to sender was lost.');
      this.resetTransferState();
    }
  }

  declineIncomingFile() {
    this.closeModal();
    if (!this.incomingMetadata) return;
    
    const senderPeer = this.conns.get(this.incomingMetadata.sender);
    if (senderPeer) {
      senderPeer.conn.send({ type: 'decline' });
    }
    this.incomingMetadata = null;
  }

  closeModal() {
    if (this.dom.incomingModal) {
      this.dom.incomingModal.classList.add('hidden', 'opacity-0');
      this.dom.incomingModal.classList.remove('flex');
    }
  }

  /**
   * Concurrently Stream File to ALL Accepted Peers
   * Employs strictly configured 64KB chunks and 2MB backpressure suspension logic
   */
  async startBroadcastStream() {
    this.broadcastActive = true;
    this.sendOffset = 0;
    this.transferStartTime = Date.now();
    this.lastStatsTime = Date.now();
    this.lastBytesTransferred = 0;
    
    this.startStatsTimer(true);

    const file = this.sendingFile;
    const fileReader = new FileReader();

    const readSlice = (offset) => {
      return new Promise((resolve, reject) => {
        const slice = file.slice(offset, offset + this.CHUNK_SIZE);
        fileReader.onload = (e) => resolve(e.target.result);
        fileReader.onerror = (err) => reject(err);
        fileReader.readAsArrayBuffer(slice);
      });
    };

    try {
      while (this.sendOffset < file.size && this.isSending) {
        // Find all peers who accepted the transfer
        const activePeers = Array.from(this.conns.values()).filter(p => p.accepted && p.conn.dataChannel);
        
        if (activePeers.length === 0) {
          console.warn("No active accepted peers to stream to.");
          break;
        }

        // Backpressure Flow Control: Pause reading from disk when ANY accepted peer's buffer exceeds 2MB
        const overflowPeers = activePeers.filter(p => p.conn.dataChannel.bufferedAmount > this.BUFFER_THRESHOLD_HIGH);
        
        if (overflowPeers.length > 0) {
          // Concurrently wait for all overflow data channels to trigger bufferedamountlow (which drops below 1MB)
          await Promise.all(overflowPeers.map(p => {
            return new Promise(resolve => {
              const onBufferedAmountLow = () => {
                p.conn.dataChannel.removeEventListener('bufferedamountlow', onBufferedAmountLow);
                resolve();
              };
              p.conn.dataChannel.addEventListener('bufferedamountlow', onBufferedAmountLow);
              
              // Safety timeout check (fires in case of browser event drops)
              setTimeout(() => {
                if (p.conn.dataChannel.bufferedAmount <= this.BUFFER_THRESHOLD_LOW) {
                  p.conn.dataChannel.removeEventListener('bufferedamountlow', onBufferedAmountLow);
                  resolve();
                }
              }, 40);
            });
          }));
        }

        // Read next 64KB chunk from file
        const chunk = await readSlice(this.sendOffset);
        
        // Broadcast slice to all accepted peers concurrently
        activePeers.forEach(p => {
          try {
            p.conn.send({
              type: 'chunk',
              data: chunk
            });
          } catch (err) {
            console.error(`Failed to send chunk to ${p.conn.peer}:`, err);
          }
        });

        this.sendOffset += chunk.byteLength;
        this.updateTransferProgress(this.sendOffset, file.size, true);
      }

      if (this.isSending) {
        // Signal complete
        this.conns.forEach(p => {
          if (p.accepted) {
            try {
              p.conn.send({ type: 'done' });
            } catch (err) {
              console.error(err);
            }
          }
        });

        this.updateStatus('Complete', 'File sent successfully');
        
        setTimeout(() => {
          this.resetTransferState();
        }, 3000);
      }

    } catch (error) {
      console.error('Broadcast stream error:', error);
      alert('An error occurred during file broadcast.');
      this.resetTransferState();
    } finally {
      this.broadcastActive = false;
    }
  }

  /**
   * Finalize Received File (Receiver Side)
   */
  finalizeReceivedFile() {
    const fileMetadata = this.incomingMetadata;
    const blob = new Blob(this.receivedChunks, { type: fileMetadata.mime || 'application/octet-stream' });
    
    // Auto download
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileMetadata.name;
    document.body.appendChild(a);
    a.click();
    
    // Cleanup URL reference
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 100);

    this.updateStatus('Complete', 'File downloaded successfully');
    
    setTimeout(() => {
      this.resetTransferState();
    }, 3000);
  }

  /**
   * Statistics Display and Progress Updater
   */
  updateTransferProgress(bytesTransferred, totalBytes, isSender) {
    const percent = Math.min(Math.round((bytesTransferred / totalBytes) * 100), 100);
    
    if (this.dom.transferProgressBar) {
      this.dom.transferProgressBar.style.width = `${percent}%`;
    }
    if (this.dom.transferPercentage) {
      this.dom.transferPercentage.textContent = `${percent}%`;
    }

    const directionText = isSender ? 'Sending' : 'Receiving';
    this.updateStatus(`${directionText} ${percent}%...`, `${this.formatBytes(bytesTransferred)} of ${this.formatBytes(totalBytes)}`);
  }

  /**
   * Stats calculation triggered strictly once per second
   */
  startStatsTimer(isSender) {
    this.stopStatsTimer();
    this.lastStatsTime = Date.now();
    this.lastBytesTransferred = 0;

    this.statsInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastStatsTime;
      if (elapsed <= 0) return;

      const bytesTransferred = isSender ? this.sendOffset : this.receivedSize;
      const totalBytes = isSender ? (this.sendingFile ? this.sendingFile.size : 0) : (this.incomingMetadata ? this.incomingMetadata.size : 0);
      
      const bytesInWindow = bytesTransferred - this.lastBytesTransferred;
      const speedBytesPerSec = (bytesInWindow / elapsed) * 1000;
      
      if (this.dom.transferSpeed) {
        this.dom.transferSpeed.textContent = `${this.formatSpeed(speedBytesPerSec)}`;
      }

      // ETA
      if (speedBytesPerSec > 0 && bytesTransferred < totalBytes) {
        const remainingBytes = totalBytes - bytesTransferred;
        const etaSeconds = Math.ceil(remainingBytes / speedBytesPerSec);
        if (this.dom.transferEta) {
          this.dom.transferEta.textContent = `ETA: ${this.formatTime(etaSeconds)}`;
        }
      } else {
        if (this.dom.transferEta) this.dom.transferEta.textContent = 'ETA: --';
      }

      this.lastStatsTime = now;
      this.lastBytesTransferred = bytesTransferred;
    }, 1000); // Strict 1-second calculations
  }

  stopStatsTimer() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  showTransferCard(fileName, fileSize, isSender) {
    if (this.dom.transferCard) {
      this.dom.transferCard.classList.remove('hidden');
    }
    if (this.dom.transferFileName) {
      this.dom.transferFileName.textContent = fileName;
    }
    if (this.dom.transferFileSize) {
      this.dom.transferFileSize.textContent = this.formatBytes(fileSize);
    }
    if (this.dom.transferProgressBar) {
      this.dom.transferProgressBar.style.width = '0%';
    }
    if (this.dom.transferPercentage) {
      this.dom.transferPercentage.textContent = '0%';
    }
    if (this.dom.transferSpeed) {
      this.dom.transferSpeed.textContent = 'Waiting for peer...';
    }
    if (this.dom.transferEta) {
      this.dom.transferEta.textContent = 'ETA: --';
    }
  }

  cancelTransfer() {
    this.conns.forEach(p => {
      try {
        p.conn.send({ type: 'cancel' });
      } catch (err) {
        console.error(err);
      }
    });
    this.resetTransferState();
  }

  resetTransferState() {
    this.stopStatsTimer();
    this.isSending = false;
    this.sendingFile = null;
    this.sendOffset = 0;
    this.incomingMetadata = null;
    this.receivedChunks = [];
    this.receivedSize = 0;
    this.broadcastActive = false;

    if (this.dom.transferCard) {
      this.dom.transferCard.classList.add('hidden');
    }
    if (this.dom.fileInput) {
      this.dom.fileInput.value = '';
    }
    
    this.conns.forEach(p => {
      p.accepted = false; // Reset accepts
    });

    if (this.conns.size > 0) {
      this.updateStatus('Devices Connected', `${this.conns.size} device(s) connected to local room.`);
    } else {
      this.updateStatus('Radar Active', 'Waiting for connection...');
    }
  }

  /**
   * Helper Formatting utilities
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatSpeed(bytesPerSec) {
    const mbps = (bytesPerSec * 8) / (1024 * 1024);
    const mbs = bytesPerSec / (1024 * 1024);
    return `${mbs.toFixed(1)} MB/s (${mbps.toFixed(1)} Mbps)`;
  }

  formatTime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remSeconds = seconds % 60;
    return `${minutes}m ${remSeconds}s`;
  }
}

// Attach to window so it is accessible
window.AirDrop = new AirDropManager();
