/**
 * Capture popup - handles tabCapture with proper extension invocation
 * Clicking the button in this popup counts as "extension invocation"
 * which allows tabCapture to work
 */

const startBtn = document.getElementById('startBtn');
const statusEl = document.getElementById('status');

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.textContent = '⏳ Starting...';
  statusEl.className = 'status';
  statusEl.style.display = 'none';

  try {
    // Get the tab that opened this popup
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      throw new Error('No active tab found');
    }

    // This is the key - calling getMediaStreamId from a popup (extension page)
    // counts as proper extension invocation
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id
    });

    console.log('[cue popup] Got stream ID:', streamId);

    // Send to service worker to start capture with this stream ID
    const response = await chrome.runtime.sendMessage({
      type: 'START_CAPTURE_WITH_STREAM',
      streamId: streamId,
      tabId: tab.id,
      includeMic: true
    });

    if (response?.success) {
      statusEl.className = 'status success';
      statusEl.textContent = '✓ Recording started! You can close this popup.';
      startBtn.textContent = '✓ Recording';

      // Close popup after short delay
      setTimeout(() => window.close(), 1500);
    } else {
      throw new Error(response?.error || 'Failed to start recording');
    }

  } catch (error) {
    console.error('[cue popup] Error:', error);
    statusEl.className = 'status error';
    statusEl.textContent = '✗ ' + error.message;
    startBtn.disabled = false;
    startBtn.textContent = '🎙️ Try Again';
  }
});

// Auto-focus the button
startBtn.focus();
