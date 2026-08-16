document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initTabs();
  initShare();
});

/**
 * Initialize Theme (Light / Dark Mode)
 */
function initTheme() {
  const themeToggle = document.getElementById('theme-toggle');
  if (!themeToggle) return;

  // Check stored theme or system preference
  const isDark = localStorage.getItem('theme') === 'dark' || 
    (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);

  if (isDark) {
    document.documentElement.classList.add('dark');
    updateThemeIcon(true);
  } else {
    document.documentElement.classList.remove('dark');
    updateThemeIcon(false);
  }

  // Toggle theme on click
  themeToggle.addEventListener('click', () => {
    const root = document.documentElement;
    const isCurrentlyDark = root.classList.contains('dark');
    
    if (isCurrentlyDark) {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      updateThemeIcon(false);
    } else {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      updateThemeIcon(true);
    }
    
    // Regene QR Codes if they are loaded, to adjust colors
    if (window.AirDrop && typeof window.AirDrop.generatePairingQr === 'function' && window.AirDrop.localId) {
      window.AirDrop.generatePairingQr(window.AirDrop.localId.split('-')[1]);
    }
  });
}

/**
 * Update the SVG/Icon inside the theme toggle button
 */
function updateThemeIcon(isDark) {
  const moonIcon = document.getElementById('theme-icon-moon');
  const sunIcon = document.getElementById('theme-icon-sun');
  
  if (isDark) {
    moonIcon.classList.add('hidden');
    sunIcon.classList.remove('hidden');
  } else {
    sunIcon.classList.add('hidden');
    moonIcon.classList.remove('hidden');
  }
}

/**
 * Initialize Tab Switcher
 */
function initTabs() {
  const tabs = {
    airdrop: {
      button: document.getElementById('tab-airdrop'),
      content: document.getElementById('content-airdrop')
    },
    transcriber: {
      button: document.getElementById('tab-transcriber'),
      content: document.getElementById('content-transcriber')
    }
  };

  if (!tabs.airdrop.button || !tabs.transcriber.button) return;

  // Switch tab helper function
  function switchTab(targetId) {
    Object.keys(tabs).forEach(key => {
      const tab = tabs[key];
      if (key === targetId) {
        // Activate button
        tab.button.classList.add(
          'text-indigo-600', 'dark:text-indigo-400', 
          'bg-indigo-50/80', 'dark:bg-indigo-950/40', 
          'border-indigo-500/20', 'shadow-sm'
        );
        tab.button.classList.remove('text-slate-600', 'dark:text-slate-400', 'hover:bg-slate-100/50', 'dark:hover:bg-slate-800/40');
        
        // Show content
        tab.content.classList.remove('hidden');
        tab.content.classList.add('active');
      } else {
        // Deactivate button
        tab.button.classList.remove(
          'text-indigo-600', 'dark:text-indigo-400', 
          'bg-indigo-50/80', 'dark:bg-indigo-950/40', 
          'border-indigo-500/20', 'shadow-sm'
        );
        tab.button.classList.add('text-slate-600', 'dark:text-slate-400', 'hover:bg-slate-100/50', 'dark:hover:bg-slate-800/40');
        
        // Hide content
        tab.content.classList.add('hidden');
        tab.content.classList.remove('active');
      }
    });

    // Update URL hash
    window.location.hash = targetId;
  }

  // Bind click events
  tabs.airdrop.button.addEventListener('click', () => switchTab('airdrop'));
  tabs.transcriber.button.addEventListener('click', () => switchTab('transcriber'));

  // Handle initial tab from URL hash, fallback to default
  const initialHash = window.location.hash.split('?')[0].replace('#', '');
  if (initialHash && tabs[initialHash]) {
    switchTab(initialHash);
  } else {
    switchTab('airdrop'); // Default tab
  }

  // Handle browser back/forward buttons
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.split('?')[0].replace('#', '');
    if (hash && tabs[hash]) {
      switchTab(hash);
    }
  });
}

/**
 * Initialize Share site feature
 */
function initShare() {
  const shareBtn = document.getElementById('share-btn');
  const shareModal = document.getElementById('share-modal');
  const closeShareModalBtn = document.getElementById('close-share-modal-btn');
  const copyShareUrlBtn = document.getElementById('copy-share-url-btn');
  const shareQrCode = document.getElementById('share-qr-code');

  if (!shareBtn || !shareModal) return;

  const appUrl = `${window.location.origin}${window.location.pathname}`;

  shareBtn.addEventListener('click', async () => {
    // Attempt native share if available (primarily mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'AirSync Suite',
          text: '100% Private - AirDrop files & transcribe voice notes offline.',
          url: appUrl
        });
        return; // Success
      } catch (err) {
        console.warn('Native share failed or dismissed, fallback to modal:', err);
      }
    }

    // Show modal overlay
    shareModal.classList.remove('hidden', 'opacity-0');
    shareModal.classList.add('flex');

    // Generate Share QR code if not already populated
    if (shareQrCode && shareQrCode.innerHTML.includes('Generating')) {
      shareQrCode.innerHTML = '';
      if (typeof QRCode !== 'undefined') {
        new QRCode(shareQrCode, {
          text: appUrl,
          width: 128,
          height: 128,
          colorDark: document.documentElement.classList.contains('dark') ? '#ffffff' : '#0f172a',
          colorLight: 'transparent',
          correctLevel: QRCode.CorrectLevel.M
        });
        setTimeout(() => {
          const qrImg = shareQrCode.querySelector('img');
          if (qrImg) qrImg.classList.add('rounded-lg', 'bg-white', 'p-2');
        }, 50);
      }
    }
  });

  const closeModal = () => {
    shareModal.classList.add('hidden', 'opacity-0');
    shareModal.classList.remove('flex');
  };

  if (closeShareModalBtn) {
    closeShareModalBtn.addEventListener('click', closeModal);
  }

  // Close modal clicking backdrop
  shareModal.addEventListener('click', (e) => {
    if (e.target === shareModal) {
      closeModal();
    }
  });

  // Clipboard copy
  if (copyShareUrlBtn) {
    copyShareUrlBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(appUrl).then(() => {
        const originalText = copyShareUrlBtn.textContent;
        copyShareUrlBtn.textContent = 'Copied!';
        copyShareUrlBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-700');
        copyShareUrlBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
        
        setTimeout(() => {
          copyShareUrlBtn.textContent = originalText;
          copyShareUrlBtn.classList.remove('bg-emerald-600', 'hover:bg-emerald-700');
          copyShareUrlBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
        }, 2000);
      }).catch(err => {
        alert('Failed to copy: ' + err);
      });
    });
  }
}
