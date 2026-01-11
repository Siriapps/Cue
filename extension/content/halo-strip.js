/**
 * Chrome Flow - Halo Strip Component
 * Injects a persistent toolbar at the top of every webpage
 */

class HaloStrip {
  constructor() {
    this.isMinimized = false;
    this.isSessionActive = false;
    this.isRecording = false;
    this.sessionStartTime = null;
    this.timerInterval = null;
    this.currentSuggestion = null;
    this.insightVisible = false;
    this.aiModalVisible = false;
    
    this.init();
  }

  init() {
    // Don't inject on chrome:// pages or extension pages
    if (window.location.protocol === 'chrome:' || 
        window.location.protocol === 'chrome-extension:' ||
        window.location.protocol === 'about:') {
      return;
    }

    this.injectStyles();
    this.createStrip();
    this.attachEventListeners();
    this.setupMessageListener();
    this.analyzePageContext();
  }

  injectStyles() {
    // Styles are injected via manifest.json CSS
    // This is a fallback if needed
    if (!document.querySelector('#chrome-flow-styles')) {
      const link = document.createElement('link');
      link.id = 'chrome-flow-styles';
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('halo-strip.css');
      document.head.appendChild(link);
    }
  }

  createStrip() {
    // Create page spacer to push content down
    const spacer = document.createElement('div');
    spacer.id = 'chrome-flow-page-spacer';
    document.body.insertBefore(spacer, document.body.firstChild);

    // Create the strip
    const strip = document.createElement('div');
    strip.id = 'chrome-flow-halo-strip';
    strip.innerHTML = this.getStripHTML();
    document.body.insertBefore(strip, document.body.firstChild);

    // Create show button (for when minimized)
    const showBtn = document.createElement('button');
    showBtn.id = 'chrome-flow-show-btn';
    showBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
    `;
    document.body.appendChild(showBtn);

    // Create insight card
    const insightCard = document.createElement('div');
    insightCard.id = 'chrome-flow-insight-card';
    insightCard.className = 'halo-insight-card hidden';
    insightCard.innerHTML = this.getInsightCardHTML();
    document.body.appendChild(insightCard);

    // Create AI modal
    const aiModal = document.createElement('div');
    aiModal.id = 'chrome-flow-ai-modal';
    aiModal.className = 'halo-ai-modal hidden';
    aiModal.innerHTML = this.getAIModalHTML();
    document.body.appendChild(aiModal);

    // Store references
    this.strip = strip;
    this.spacer = spacer;
    this.showBtn = showBtn;
    this.insightCard = insightCard;
    this.aiModal = aiModal;
  }

  getStripHTML() {
    return `
      <div class="halo-logo">
        <div class="halo-logo-icon">
          <svg viewBox="0 0 24 24" fill="white">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span class="halo-logo-text">Chrome Flow</span>
      </div>

      <div class="halo-buttons">
        <button class="halo-btn halo-btn-session" id="halo-session-btn">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
          <span>Start Session</span>
        </button>

        <button class="halo-btn halo-btn-live" id="halo-live-btn">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="6"/>
          </svg>
          <span>Go Live</span>
        </button>

        <button class="halo-btn halo-btn-ai" id="halo-ai-btn">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
          <span>Ask AI</span>
        </button>
      </div>

      <div class="halo-session-timer hidden" id="halo-timer">
        <span class="halo-timer-dot"></span>
        <span id="halo-timer-text">00:00</span>
      </div>

      <div class="halo-suggestion" id="halo-suggestion">
        <span class="halo-suggestion-icon">💡</span>
        <span class="halo-suggestion-text" id="halo-suggestion-text">Analyzing page...</span>
        <button class="halo-suggestion-dismiss" id="halo-suggestion-dismiss">×</button>
      </div>

      <div class="halo-controls">
        <button class="halo-control-btn" id="halo-settings-btn" title="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button class="halo-control-btn" id="halo-minimize-btn" title="Minimize">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 15l-6-6-6 6"/>
          </svg>
        </button>
      </div>
    `;
  }

  getInsightCardHTML() {
    return `
      <div class="halo-insight-header">
        <span class="halo-insight-icon">✨</span>
        <span class="halo-insight-title">AI Insight:</span>
        <button class="halo-insight-close" id="halo-insight-close">×</button>
      </div>
      <div class="halo-insight-content" id="halo-insight-content">
        Loading insight...
      </div>
      <button class="halo-insight-action" id="halo-insight-action">
        Take Action →
      </button>
    `;
  }

  getAIModalHTML() {
    return `
      <div class="halo-ai-input-wrapper">
        <input type="text" class="halo-ai-input" id="halo-ai-input" 
               placeholder="Ask anything about this page..." />
        <button class="halo-ai-submit" id="halo-ai-submit">Ask</button>
      </div>
      <div class="halo-ai-response hidden" id="halo-ai-response"></div>
    `;
  }

  attachEventListeners() {
    // Session button
    document.getElementById('halo-session-btn').addEventListener('click', () => {
      this.toggleSession();
    });

    // Go Live button
    document.getElementById('halo-live-btn').addEventListener('click', () => {
      this.toggleRecording();
    });

    // Ask AI button
    document.getElementById('halo-ai-btn').addEventListener('click', () => {
      this.toggleAIModal();
    });

    // Minimize button
    document.getElementById('halo-minimize-btn').addEventListener('click', () => {
      this.minimize();
    });

    // Show button (when minimized)
    this.showBtn.addEventListener('click', () => {
      this.maximize();
    });

    // Suggestion dismiss
    document.getElementById('halo-suggestion-dismiss').addEventListener('click', () => {
      this.dismissSuggestion();
    });

    // Insight card close
    document.getElementById('halo-insight-close').addEventListener('click', () => {
      this.hideInsight();
    });

    // AI modal submit
    document.getElementById('halo-ai-submit').addEventListener('click', () => {
      this.submitAIQuery();
    });

    // AI input enter key
    document.getElementById('halo-ai-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.submitAIQuery();
      }
    });

    // Click outside to close modals
    document.addEventListener('click', (e) => {
      if (this.aiModalVisible && !this.aiModal.contains(e.target) && 
          e.target.id !== 'halo-ai-btn') {
        this.hideAIModal();
      }
    });

    // Keyboard shortcut: Alt+H to toggle strip
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'h') {
        e.preventDefault();
        this.isMinimized ? this.maximize() : this.minimize();
      }
    });
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'STATE_UPDATE':
          this.handleStateUpdate(message);
          break;
        case 'SUGGESTION':
          this.showSuggestion(message.text, message.action);
          break;
        case 'INSIGHT':
          this.showInsight(message.title, message.content, message.action);
          break;
      }
    });
  }

  // Session management
  toggleSession() {
    this.isSessionActive = !this.isSessionActive;
    const btn = document.getElementById('halo-session-btn');
    const timer = document.getElementById('halo-timer');

    if (this.isSessionActive) {
      btn.classList.add('active');
      btn.querySelector('span').textContent = 'End Session';
      btn.querySelector('svg').innerHTML = '<rect x="6" y="6" width="12" height="12"/>';
      timer.classList.remove('hidden');
      this.startTimer();
      
      chrome.runtime.sendMessage({ type: 'SESSION_START', url: window.location.href });
    } else {
      btn.classList.remove('active');
      btn.querySelector('span').textContent = 'Start Session';
      btn.querySelector('svg').innerHTML = '<path d="M8 5v14l11-7z"/>';
      timer.classList.add('hidden');
      this.stopTimer();
      
      chrome.runtime.sendMessage({ type: 'SESSION_END' });
    }
  }

  startTimer() {
    this.sessionStartTime = Date.now();
    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.sessionStartTime) / 1000);
      const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const secs = (elapsed % 60).toString().padStart(2, '0');
      document.getElementById('halo-timer-text').textContent = `${mins}:${secs}`;
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  // Recording
  toggleRecording() {
    const btn = document.getElementById('halo-live-btn');

    if (!this.isRecording) {
      chrome.runtime.sendMessage({ type: 'START_RECORDING' }, (response) => {
        if (response?.success) {
          this.isRecording = true;
          btn.classList.add('recording');
          btn.querySelector('span').textContent = 'Recording...';
        }
      });
    } else {
      chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response) => {
        if (response?.success) {
          this.isRecording = false;
          btn.classList.remove('recording');
          btn.querySelector('span').textContent = 'Go Live';
        }
      });
    }
  }

  handleStateUpdate(message) {
    if (message.state === 'recording') {
      this.isRecording = true;
      const btn = document.getElementById('halo-live-btn');
      btn.classList.add('recording');
      btn.querySelector('span').textContent = 'Recording...';
    } else if (message.state === 'idle' || message.state === 'complete') {
      this.isRecording = false;
      const btn = document.getElementById('halo-live-btn');
      btn.classList.remove('recording');
      btn.querySelector('span').textContent = 'Go Live';
    }
  }

  // AI Modal
  toggleAIModal() {
    if (this.aiModalVisible) {
      this.hideAIModal();
    } else {
      this.showAIModal();
    }
  }

  showAIModal() {
    this.aiModal.classList.remove('hidden');
    this.aiModalVisible = true;
    document.getElementById('halo-ai-input').focus();
  }

  hideAIModal() {
    this.aiModal.classList.add('hidden');
    this.aiModalVisible = false;
    document.getElementById('halo-ai-response').classList.add('hidden');
  }

  async submitAIQuery() {
    const input = document.getElementById('halo-ai-input');
    const response = document.getElementById('halo-ai-response');
    const query = input.value.trim();

    if (!query) return;

    response.classList.remove('hidden');
    response.textContent = 'Thinking...';

    // Get page context
    const pageContext = {
      title: document.title,
      url: window.location.href,
      selectedText: window.getSelection().toString(),
      query: query
    };

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'ASK_AI',
        context: pageContext
      });

      if (result?.success) {
        response.textContent = result.answer;
      } else {
        response.textContent = 'Sorry, I couldn\'t process that request.';
      }
    } catch (error) {
      response.textContent = 'Error connecting to AI service.';
    }

    input.value = '';
  }

  // Suggestions
  showSuggestion(text, action) {
    this.currentSuggestion = { text, action };
    document.getElementById('halo-suggestion-text').innerHTML = text;
    document.getElementById('halo-suggestion').style.display = 'flex';
  }

  dismissSuggestion() {
    document.getElementById('halo-suggestion').style.display = 'none';
    this.currentSuggestion = null;
  }

  // Insight card
  showInsight(title, content, action) {
    document.getElementById('halo-insight-content').innerHTML = content;
    this.insightCard.classList.remove('hidden');
    this.insightVisible = true;
  }

  hideInsight() {
    this.insightCard.classList.add('hidden');
    this.insightVisible = false;
  }

  // Minimize/Maximize
  minimize() {
    this.strip.classList.add('minimized');
    this.spacer.style.height = '0';
    this.showBtn.classList.add('visible');
    this.isMinimized = true;
  }

  maximize() {
    this.strip.classList.remove('minimized');
    this.spacer.style.height = '52px';
    this.showBtn.classList.remove('visible');
    this.isMinimized = false;
  }

  // Page context analysis
  async analyzePageContext() {
    const context = {
      title: document.title,
      url: window.location.href,
      domain: window.location.hostname,
      path: window.location.pathname
    };

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'ANALYZE_CONTEXT',
        context: context
      });

      if (result?.suggestion) {
        this.showSuggestion(result.suggestion);
      } else {
        // Default suggestion
        this.showSuggestion(`You're on <strong>${context.domain}</strong>. How can I help?`);
      }
    } catch (error) {
      this.showSuggestion(`Browsing <strong>${context.domain}</strong>`);
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new HaloStrip());
} else {
  new HaloStrip();
}
