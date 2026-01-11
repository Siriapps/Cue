/**
 * Chrome Flow - Content Script
 * Injects Halo Strip and handles page interactions
 */

// State
let haloStrip = null;

/**
 * Initialize the content script
 */
function init() {
  if (shouldSkipPage()) {
    console.log('[Chrome Flow] Skipping injection on this page');
    return;
  }

  console.log('[Chrome Flow] Initializing on', window.location.hostname);
  injectHaloStrip();
  setupMessageListener();
  // Disable automatic context analysis to prevent 429 errors
  // Only analyze when user explicitly asks via Ask AI
  // setTimeout(analyzePageContext, 1000);
}

/**
 * Check if we should skip this page
 */
function shouldSkipPage() {
  const url = window.location.href;
  const skipPatterns = [
    'chrome://',
    'chrome-extension://',
    'about:',
    'edge://',
    'brave://',
    'devtools://'
  ];
  return skipPatterns.some(pattern => url.startsWith(pattern));
}

console.log('[Chrome Flow] Content script loaded on:', window.location.href);

/**
 * Inject the Halo Strip into the page
 */
function injectHaloStrip() {
  if (document.getElementById('chrome-flow-halo-strip')) return;

  // Create page spacer
  const spacer = document.createElement('div');
  spacer.id = 'chrome-flow-page-spacer';
  
  // Create the strip
  const strip = document.createElement('div');
  strip.id = 'chrome-flow-halo-strip';
  strip.innerHTML = getStripHTML();

  // Create show button (minimized state)
  const showBtn = document.createElement('button');
  showBtn.id = 'chrome-flow-show-btn';
  showBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
    </svg>
  `;

  // Create the overlay for summaries and live transcript
  const overlay = document.createElement('div');
  overlay.id = 'chrome-flow-overlay';
  overlay.innerHTML = getOverlayHTML();

  // Inject
  document.body.insertBefore(spacer, document.body.firstChild);
  document.body.insertBefore(strip, document.body.firstChild);
  document.body.appendChild(showBtn);
  document.body.appendChild(overlay);

  // Store references
  haloStrip = {
    strip,
    spacer,
    showBtn,
    overlay,
    isMinimized: false,
    isSessionActive: false,
    isRecording: false,
    sessionStartTime: null,
    timerInterval: null,
    liveTranscript: ''
  };

  attachEventListeners();
}

/**
 * Get the HTML for the Halo Strip (centered layout)
 */
function getStripHTML() {
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

      <div class="halo-ai-container">
        <button class="halo-btn halo-btn-ai" id="halo-ai-btn">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
          <span>Ask AI</span>
        </button>
        <div class="halo-ai-input-expanded hidden" id="halo-ai-expanded">
          <input type="text" id="halo-ai-input" placeholder="Ask anything about this page..." autocomplete="off">
          <button class="halo-ai-submit" id="halo-ai-submit" title="Submit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </div>

      <button class="halo-btn halo-btn-library" id="halo-library-btn" title="View Library">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="3" width="7" height="7"/>
          <rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/>
        </svg>
        <span>Library</span>
      </button>

      <div class="halo-session-timer hidden" id="halo-timer">
        <span class="halo-timer-dot"></span>
        <span id="halo-timer-text">00:00</span>
      </div>
    </div>

    <div class="halo-controls">
      <button class="halo-control-btn" id="halo-minimize-btn" title="Minimize (Alt+H)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 15l-6-6-6 6"/>
        </svg>
      </button>
    </div>
  `;
}

/**
 * Get the HTML for the overlay
 */
function getOverlayHTML() {
  return `
    <button class="overlay-close" id="overlay-close">×</button>
    <div class="overlay-container">
      <!-- Live Transcript (shown during recording) -->
      <div class="live-transcript-panel hidden" id="live-transcript-panel">
        <div class="live-transcript-header">
          <div class="live-transcript-title">
            <span>🎙️</span>
            <span>Live Transcript</span>
          </div>
          <div class="live-indicator">
            <span class="live-indicator-dot"></span>
            <span>LIVE</span>
          </div>
        </div>
        <div class="live-transcript-content" id="live-transcript-content">
          <div class="transcript-line">Listening...</div>
        </div>
      </div>

      <!-- Processing Indicator -->
      <div class="processing-indicator hidden" id="processing-indicator">
        <div class="processing-spinner"></div>
        <div class="processing-content">
          <span class="processing-text" id="processing-text">Processing your recording...</span>
          <button class="processing-view-btn hidden" id="processing-view-btn" onclick="window.open(chrome.runtime.getURL('library.html'), '_blank')">
            View Recordings →
          </button>
        </div>
      </div>

      <!-- Video Summary -->
      <div class="video-summary-panel hidden" id="video-summary-panel">
        <div class="video-container">
          <video class="video-player" id="summary-video" controls></video>
          <div class="video-placeholder" id="video-placeholder">
            <span class="video-placeholder-icon">🎬</span>
            <span class="video-placeholder-text">Video summary will appear here</span>
          </div>
        </div>
        <div class="video-controls-bar">
          <div class="video-badge">✨ Generated by Veo 3</div>
        </div>
      </div>

      <!-- Text Summary -->
      <div class="text-summary-panel hidden" id="text-summary-panel">
        <div class="summary-header">
          <h2 class="summary-title" id="summary-title">Meeting Summary</h2>
          <div class="summary-badges">
            <span class="summary-badge">✨ Gemini 3</span>
          </div>
        </div>
        <div id="summary-content">
          <!-- Summary content will be inserted here -->
        </div>
      </div>
    </div>
  `;
}

/**
 * Attach event listeners
 */
function attachEventListeners() {
  // Session button
  document.getElementById('halo-session-btn')?.addEventListener('click', toggleSession);

  // Go Live button
  document.getElementById('halo-live-btn')?.addEventListener('click', toggleRecording);

  // Ask AI button - expand input field
  document.getElementById('halo-ai-btn')?.addEventListener('click', toggleAIInput);

  // AI input submit button
  document.getElementById('halo-ai-submit')?.addEventListener('click', submitAIQuery);

  // AI input Enter key handler
  document.getElementById('halo-ai-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAIQuery();
    } else if (e.key === 'Escape') {
      collapseAIInput();
    }
  });

  // Library button - content scripts can't use chrome.tabs directly in Manifest V3
  document.getElementById('halo-library-btn')?.addEventListener('click', () => {
    // Check if extension context is still valid
    if (!chrome.runtime?.id) {
      alert('Extension context invalidated. Please reload the page.');
      return;
    }

    // Send message to background script to open library (localhost React app)
    chrome.runtime.sendMessage({ type: 'OPEN_LIBRARY' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Chrome Flow] Failed to open library:', chrome.runtime.lastError.message);
        alert(`Extension error: ${chrome.runtime.lastError.message}. Please reload the page.`);
      } else if (response && !response.success) {
        alert(`Failed to open library: ${response.error || 'Unknown error'}`);
      }
    });
  });

  // Minimize button
  document.getElementById('halo-minimize-btn')?.addEventListener('click', minimize);

  // Show button
  haloStrip.showBtn?.addEventListener('click', maximize);

  // Overlay close
  document.getElementById('overlay-close')?.addEventListener('click', closeOverlay);

  // Click outside overlay content to close
  haloStrip.overlay?.addEventListener('click', (e) => {
    if (e.target === haloStrip.overlay) {
      closeOverlay();
    }
  });

  // Keyboard shortcut: Alt+H to toggle strip
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      haloStrip.isMinimized ? maximize() : minimize();
    }
    // Escape to close overlay or collapse AI input
    if (e.key === 'Escape') {
      const aiExpanded = document.getElementById('halo-ai-expanded');
      if (aiExpanded && !aiExpanded.classList.contains('hidden')) {
        collapseAIInput();
      } else {
        closeOverlay();
      }
    }
  });

  // Click outside to collapse AI input
  document.addEventListener('click', (e) => {
    const aiContainer = document.querySelector('.halo-ai-container');
    const aiExpanded = document.getElementById('halo-ai-expanded');
    if (aiExpanded && !aiExpanded.classList.contains('hidden')) {
      // If click is outside the AI container, collapse it
      if (aiContainer && !aiContainer.contains(e.target)) {
        collapseAIInput();
      }
    }
  });
}

/**
 * Toggle session
 */
function toggleSession() {
  haloStrip.isSessionActive = !haloStrip.isSessionActive;
  const btn = document.getElementById('halo-session-btn');
  const timer = document.getElementById('halo-timer');

  if (haloStrip.isSessionActive) {
    btn.classList.add('active');
    btn.querySelector('span').textContent = 'End Session';
    timer.classList.remove('hidden');
    startTimer();
    chrome.runtime.sendMessage({ type: 'SESSION_START', url: window.location.href, title: document.title });
  } else {
    btn.classList.remove('active');
    btn.querySelector('span').textContent = 'Start Session';
    timer.classList.add('hidden');
    stopTimer();
    chrome.runtime.sendMessage({ type: 'SESSION_END' });
  }
}

/**
 * Start session timer
 */
function startTimer() {
  haloStrip.sessionStartTime = Date.now();
  haloStrip.timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - haloStrip.sessionStartTime) / 1000);
    const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const secs = (elapsed % 60).toString().padStart(2, '0');
    document.getElementById('halo-timer-text').textContent = `${mins}:${secs}`;
  }, 1000);
}

/**
 * Stop session timer
 */
function stopTimer() {
  if (haloStrip.timerInterval) {
    clearInterval(haloStrip.timerInterval);
    haloStrip.timerInterval = null;
  }
}

/**
 * Toggle recording
 */
function toggleRecording() {
  const btn = document.getElementById('halo-live-btn');

  if (!haloStrip.isRecording) {
    // Start recording
    chrome.runtime.sendMessage({ type: 'START_RECORDING' }, (response) => {
      if (response?.success) {
        haloStrip.isRecording = true;
        haloStrip.liveTranscript = '';
        btn.classList.add('recording');
        btn.querySelector('span').textContent = 'Stop';
        
        // Show overlay with live transcript
        showLiveTranscript();
      } else {
        alert('Could not start recording: ' + (response?.error || 'Unknown error'));
      }
    });
  } else {
    // Stop recording
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response) => {
      if (response?.success) {
        haloStrip.isRecording = false;
        btn.classList.remove('recording');
        btn.querySelector('span').textContent = 'Go Live';
        
        // Hide live transcript, show processing
        hideLiveTranscript();
        showProcessing('Transcribing audio...');
      }
    });
  }
}

/**
 * Toggle AI input expand/collapse
 */
function toggleAIInput() {
  const expanded = document.getElementById('halo-ai-expanded');
  const input = document.getElementById('halo-ai-input');
  
  if (expanded.classList.contains('hidden')) {
    expandAIInput();
  } else {
    collapseAIInput();
  }
}

/**
 * Expand AI input field
 */
function expandAIInput() {
  const expanded = document.getElementById('halo-ai-expanded');
  const input = document.getElementById('halo-ai-input');
  const btn = document.getElementById('halo-ai-btn');
  
  if (expanded && input) {
    expanded.classList.remove('hidden');
    btn?.classList.add('active');
    
    // Update placeholder with current URL
    const currentUrl = window.location.href;
    const domain = window.location.hostname;
    input.placeholder = `Ask anything about ${domain}...`;
    
    // Focus input after a short delay to allow animation
    setTimeout(() => {
      input.focus();
    }, 100);
  }
}

/**
 * Collapse AI input field
 */
function collapseAIInput() {
  const expanded = document.getElementById('halo-ai-expanded');
  const input = document.getElementById('halo-ai-input');
  const btn = document.getElementById('halo-ai-btn');
  
  if (expanded && input) {
    expanded.classList.add('hidden');
    btn?.classList.remove('active');
    input.value = '';
    input.blur();
  }
}

/**
 * Submit AI query
 */
async function submitAIQuery() {
  const input = document.getElementById('halo-ai-input');
  const query = input?.value?.trim();
  
  if (!query) {
    return;
  }

  // Clear input and collapse
  input.value = '';
  collapseAIInput();

  openOverlay();
  showProcessing('Thinking...');

  const context = {
    title: document.title,
    url: window.location.href,
    selectedText: window.getSelection().toString().substring(0, 500),
    query: query
  };

  try {
    // Check if extension context is still valid
    if (!chrome.runtime?.id) {
      hideProcessing();
      showTextSummary({
        title: 'Error',
        summary: ['Extension context invalidated. Please reload the page.']
      });
      return;
    }

    // Use callback-based sendMessage to properly catch context invalidation
    chrome.runtime.sendMessage({ type: 'ASK_AI', context }, (result) => {
      hideProcessing();
      
      // Check for runtime errors (context invalidation)
      if (chrome.runtime.lastError) {
        showTextSummary({
          title: 'Error',
          summary: [`Extension error: ${chrome.runtime.lastError.message}. Please reload the page.`]
        });
        return;
      }

      if (result?.success) {
        showTextSummary({
          title: 'AI Response',
          summary: [result.answer]
        });
      } else {
        showTextSummary({
          title: 'Error',
          summary: [result?.error || 'Failed to get AI response']
        });
      }
    });
  } catch (error) {
    hideProcessing();
    showTextSummary({
      title: 'Error',
      summary: [`Failed to connect to AI service: ${error.message}`]
    });
  }
}

/**
 * Open overlay
 */
function openOverlay() {
  haloStrip.overlay.classList.add('visible');
}

/**
 * Close overlay
 */
function closeOverlay() {
  haloStrip.overlay.classList.remove('visible');
  
  // Hide all panels
  document.getElementById('live-transcript-panel')?.classList.add('hidden');
  document.getElementById('processing-indicator')?.classList.add('hidden');
  document.getElementById('video-summary-panel')?.classList.add('hidden');
  document.getElementById('text-summary-panel')?.classList.add('hidden');
}

/**
 * Show live transcript panel
 */
function showLiveTranscript() {
  openOverlay();
  document.getElementById('live-transcript-panel')?.classList.remove('hidden');
  document.getElementById('live-transcript-content').innerHTML = '<div class="transcript-line">Listening...</div>';
}

/**
 * Hide live transcript panel
 */
function hideLiveTranscript() {
  document.getElementById('live-transcript-panel')?.classList.add('hidden');
}

/**
 * Update live transcript
 */
function updateLiveTranscript(text) {
  const content = document.getElementById('live-transcript-content');
  if (content) {
    haloStrip.liveTranscript = text;
    const lines = text.split('\n').filter(l => l.trim());
    content.innerHTML = lines.map((line, i) => 
      `<div class="transcript-line ${i === lines.length - 1 ? 'new' : ''}">${line}</div>`
    ).join('');
    content.scrollTop = content.scrollHeight;
  }
}

/**
 * Show processing indicator
 */
function showProcessing(text, showViewButton = false) {
  openOverlay();
  const indicator = document.getElementById('processing-indicator');
  const viewBtn = document.getElementById('processing-view-btn');
  
  indicator?.classList.remove('hidden');
  document.getElementById('processing-text').textContent = text;
  
  if (showViewButton && viewBtn) {
    viewBtn.classList.remove('hidden');
    viewBtn.onclick = () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
    };
  } else if (viewBtn) {
    viewBtn.classList.add('hidden');
  }
}

/**
 * Hide processing indicator
 */
function hideProcessing() {
  document.getElementById('processing-indicator')?.classList.add('hidden');
}

/**
 * Add View Summary button to overlay
 */
function addViewSummaryButton() {
  const overlay = haloStrip.overlay;
  if (!overlay) return;
  
  // Check if button already exists
  let viewBtn = document.getElementById('view-summary-btn');
  if (!viewBtn) {
    viewBtn = document.createElement('button');
    viewBtn.id = 'view-summary-btn';
    viewBtn.className = 'view-summary-btn';
    viewBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3"/>
      </svg>
      <span>View in Library</span>
    `;
    viewBtn.onclick = () => {
      chrome.runtime.sendMessage({ type: 'OPEN_LIBRARY' }).catch(() => {});
    };
    overlay.appendChild(viewBtn);
  }
  viewBtn.classList.add('visible');
}

/**
 * Show video summary
 */
function showVideoSummary(videoUrl) {
  const panel = document.getElementById('video-summary-panel');
  const video = document.getElementById('summary-video');
  const placeholder = document.getElementById('video-placeholder');

  panel?.classList.remove('hidden');

  if (videoUrl) {
    video.src = videoUrl;
    placeholder?.classList.add('hidden');
    video.style.display = 'block';
  } else {
    video.style.display = 'none';
    placeholder?.classList.remove('hidden');
  }
}

/**
 * Show text summary
 */
function showTextSummary(summary) {
  const panel = document.getElementById('text-summary-panel');
  const title = document.getElementById('summary-title');
  const content = document.getElementById('summary-content');

  panel?.classList.remove('hidden');
  
  if (summary.title) {
    title.textContent = summary.title;
  }

  let html = '';

  // Key points
  if (summary.summary && summary.summary.length > 0) {
    html += `
      <div class="summary-section">
        <h3 class="section-title">Key Points</h3>
        <ul class="summary-list">
          ${summary.summary.map(point => `
            <li><span class="list-bullet"></span><span>${point}</span></li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  // Decisions
  if (summary.decisions && summary.decisions.length > 0) {
    html += `
      <div class="summary-section">
        <h3 class="section-title">Decisions Made</h3>
        <ul class="summary-list">
          ${summary.decisions.map(d => `
            <li><span class="list-bullet green"></span><span>${d}</span></li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  // Action items
  if (summary.actionItems && summary.actionItems.length > 0) {
    html += `
      <div class="summary-section">
        <h3 class="section-title">Action Items</h3>
        ${summary.actionItems.map(item => `
          <div class="action-item">
            <div class="action-task">${item.task}</div>
            <div class="action-meta">
              <span>👤 ${item.owner || 'Unassigned'}</span>
              <span>📅 ${item.deadline || 'TBD'}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Topics
  if (summary.keyTopics && summary.keyTopics.length > 0) {
    html += `
      <div class="summary-section">
        <h3 class="section-title">Key Topics</h3>
        <div class="topics-container">
          ${summary.keyTopics.map(topic => `
            <span class="topic-tag">${topic}</span>
          `).join('')}
        </div>
      </div>
    `;
  }

  content.innerHTML = html || '<p>No summary data available</p>';
}

/**
 * Minimize strip
 */
function minimize() {
  haloStrip.strip.classList.add('minimized');
  haloStrip.spacer.style.height = '0';
  haloStrip.showBtn.classList.add('visible');
  haloStrip.isMinimized = true;
}

/**
 * Maximize strip
 */
function maximize() {
  haloStrip.strip.classList.remove('minimized');
  haloStrip.spacer.style.height = '52px';
  haloStrip.showBtn.classList.remove('visible');
  haloStrip.isMinimized = false;
}

/**
 * Analyze page context
 */
async function analyzePageContext() {
  const context = {
    title: document.title,
    url: window.location.href,
    domain: window.location.hostname,
    path: window.location.pathname
  };

  try {
    const result = await chrome.runtime.sendMessage({ type: 'ANALYZE_CONTEXT', context });
    // Could show suggestion somewhere if needed
  } catch (error) {
    console.log('[Chrome Flow] Context analysis skipped');
  }
}

/**
 * Set up message listener
 */
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Chrome Flow] Received message:', message.type);
    
    switch (message.type) {
      case 'STATE_UPDATE':
        handleStateUpdate(message);
        break;
      case 'LIVE_TRANSCRIPT':
        updateLiveTranscript(message.text);
        break;
      case 'SHOW_SUMMARY':
        hideProcessing();
        if (message.summary) showTextSummary(message.summary);
        if (message.videoUrl) showVideoSummary(message.videoUrl);
        // Add View Summary button
        addViewSummaryButton();
        break;
      case 'PROCESSING_UPDATE':
        showProcessing(message.text);
        break;
      case 'TOGGLE_STRIP':
        // Toggle strip visibility when clicking extension icon
        if (haloStrip) {
          haloStrip.isMinimized ? maximize() : minimize();
        }
        sendResponse({ success: true });
        break;
      case 'PING':
        sendResponse({ status: 'ok' });
        break;
    }
    return true;
  });
}

/**
 * Handle state updates from background
 */
function handleStateUpdate(message) {
  const btn = document.getElementById('halo-live-btn');
  
  switch (message.state) {
    case 'recording':
      haloStrip.isRecording = true;
      btn?.classList.add('recording');
      btn.querySelector('span').textContent = 'Stop';
      break;
    case 'transcribing':
      hideLiveTranscript();
      showProcessing('Transcribing audio...');
      break;
    case 'summarizing':
      showProcessing('Generating summary with Gemini...');
      break;
    case 'generating_video':
      showProcessing('Creating video with Veo 3...');
      break;
    case 'complete':
      haloStrip.isRecording = false;
      btn?.classList.remove('recording');
      btn.querySelector('span').textContent = 'Go Live';
      hideProcessing();
      // Load and show summary
      loadAndShowSummary();
      addViewSummaryButton();
      break;
    case 'error':
      hideProcessing();
      showTextSummary({
        title: 'Error',
        summary: [message.error || 'An error occurred']
      });
      break;
    case 'idle':
      haloStrip.isRecording = false;
      btn?.classList.remove('recording');
      btn.querySelector('span').textContent = 'Go Live';
      break;
  }
}

/**
 * Load and show summary from storage
 */
async function loadAndShowSummary() {
  try {
    const result = await chrome.storage.local.get(['summaryData', 'videoUrl']);
    
    if (result.summaryData) {
      openOverlay();
      
      if (result.summaryData.summary) {
        showTextSummary(result.summaryData.summary);
      }
      
      if (result.summaryData.hasVideo && result.summaryData.videoUrl) {
        showVideoSummary(result.summaryData.videoUrl);
      }
    }
  } catch (error) {
    console.error('[Chrome Flow] Failed to load summary:', error);
  }
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  setTimeout(init, 100);
}

window.addEventListener('load', () => {
  if (!document.getElementById('chrome-flow-halo-strip')) {
    console.log('[Chrome Flow] Retrying injection on window load');
    init();
  }
});
