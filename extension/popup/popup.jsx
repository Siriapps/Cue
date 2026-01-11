import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './popup.css';

// Icons as SVG components
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z"/>
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h12v12H6z"/>
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
  </svg>
);

const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
  </svg>
);

const ExternalIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
  </svg>
);

const FlowLogo = () => (
  <svg viewBox="0 0 24 24" fill="white">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
  </svg>
);

// Processing states
const STATES = {
  IDLE: 'idle',
  RECORDING: 'recording',
  TRANSCRIBING: 'transcribing',
  SUMMARIZING: 'summarizing',
  GENERATING_VIDEO: 'generating_video',
  COMPLETE: 'complete',
  ERROR: 'error'
};

const STEP_LABELS = {
  [STATES.RECORDING]: 'Recording Meeting',
  [STATES.TRANSCRIBING]: 'Transcribing Audio',
  [STATES.SUMMARIZING]: 'Generating Summary',
  [STATES.GENERATING_VIDEO]: 'Creating Video',
  [STATES.COMPLETE]: 'Complete'
};

const STEPS = [
  { id: STATES.RECORDING, label: 'Recording', icon: '🎙️' },
  { id: STATES.TRANSCRIBING, label: 'Transcribing', icon: '📝' },
  { id: STATES.SUMMARIZING, label: 'Summarizing', icon: '🧠' },
  { id: STATES.GENERATING_VIDEO, label: 'Creating Video', icon: '🎬' }
];

function Popup() {
  const [state, setState] = useState(STATES.IDLE);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState(null);
  const [summaryReady, setSummaryReady] = useState(false);

  // Format time as MM:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Load state from storage on mount
  useEffect(() => {
    chrome.storage.local.get(['recordingState'], (result) => {
      if (result.recordingState) {
        setState(result.recordingState.state || STATES.IDLE);
        setRecordingTime(result.recordingState.duration || 0);
        setSummaryReady(result.recordingState.summaryReady || false);
      }
    });

    // Listen for state updates from background
    const handleMessage = (message) => {
      if (message.type === 'STATE_UPDATE') {
        setState(message.state);
        if (message.duration !== undefined) {
          setRecordingTime(message.duration);
        }
        if (message.error) {
          setError(message.error);
        }
        if (message.summaryReady) {
          setSummaryReady(true);
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  // Timer for recording
  useEffect(() => {
    let interval;
    if (state === STATES.RECORDING) {
      interval = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [state]);

  // Start recording
  const handleStartRecording = useCallback(async () => {
    setError(null);
    setRecordingTime(0);
    setSummaryReady(false);
    
    try {
      const response = await chrome.runtime.sendMessage({ type: 'START_RECORDING' });
      if (response.success) {
        setState(STATES.RECORDING);
      } else {
        setError(response.error || 'Failed to start recording');
      }
    } catch (err) {
      setError('Failed to communicate with extension. Please reload the page.');
    }
  }, []);

  // Stop recording
  const handleStopRecording = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
      if (response.success) {
        setState(STATES.TRANSCRIBING);
      } else {
        setError(response.error || 'Failed to stop recording');
      }
    } catch (err) {
      setError('Failed to communicate with extension.');
    }
  }, []);

  // View summary
  const handleViewSummary = useCallback(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL('summary.html') });
  }, []);

  // Reset state
  const handleReset = useCallback(() => {
    setState(STATES.IDLE);
    setRecordingTime(0);
    setError(null);
    setSummaryReady(false);
    chrome.runtime.sendMessage({ type: 'RESET' });
  }, []);

  // Get step status
  const getStepStatus = (stepId) => {
    const stepOrder = [STATES.RECORDING, STATES.TRANSCRIBING, STATES.SUMMARIZING, STATES.GENERATING_VIDEO];
    const currentIndex = stepOrder.indexOf(state);
    const stepIndex = stepOrder.indexOf(stepId);
    
    if (state === STATES.COMPLETE) return 'completed';
    if (state === STATES.IDLE) return 'pending';
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'active';
    return 'pending';
  };

  // Render status text
  const getStatusText = () => {
    switch (state) {
      case STATES.IDLE:
        return { main: 'Ready to Record', sub: 'Open a Google Meet tab to start' };
      case STATES.RECORDING:
        return { main: 'Recording...', sub: 'Capturing meeting audio' };
      case STATES.TRANSCRIBING:
        return { main: 'Transcribing...', sub: 'Converting speech to text' };
      case STATES.SUMMARIZING:
        return { main: 'Summarizing...', sub: 'Gemini is analyzing the meeting' };
      case STATES.GENERATING_VIDEO:
        return { main: 'Creating Video...', sub: 'Veo 3 is generating visual summary' };
      case STATES.COMPLETE:
        return { main: 'Summary Ready!', sub: 'Your meeting summary is ready to view' };
      case STATES.ERROR:
        return { main: 'Error Occurred', sub: 'Something went wrong' };
      default:
        return { main: 'Unknown State', sub: '' };
    }
  };

  const statusText = getStatusText();
  const isProcessing = [STATES.TRANSCRIBING, STATES.SUMMARIZING, STATES.GENERATING_VIDEO].includes(state);

  return (
    <div className="popup-container">
      {/* Header */}
      <div className="header">
        <div className="logo">
          <FlowLogo />
        </div>
        <div className="header-text">
          <h1>Chrome Flow</h1>
          <p>AI Meeting Summarizer</p>
        </div>
      </div>

      {/* Status Section */}
      <div className="status-section fade-in">
        <div className="status-indicator">
          <div className={`status-dot ${state === STATES.IDLE ? 'idle' : state === STATES.RECORDING ? 'recording' : isProcessing ? 'processing' : state === STATES.COMPLETE ? 'complete' : 'error'}`} />
          <div>
            <div className="status-text">{statusText.main}</div>
            <div className="status-subtext">{statusText.sub}</div>
          </div>
        </div>

        {/* Timer (shown during recording) */}
        {(state === STATES.RECORDING || recordingTime > 0) && (
          <div className={`timer ${state === STATES.RECORDING ? 'recording' : ''}`}>
            {formatTime(recordingTime)}
          </div>
        )}

        {/* Progress Steps (shown during processing) */}
        {(isProcessing || state === STATES.COMPLETE) && (
          <div className="progress-steps">
            {STEPS.map((step) => (
              <div key={step.id} className={`progress-step ${getStepStatus(step.id)}`}>
                <div className="step-icon">
                  {getStepStatus(step.id) === 'completed' ? '✓' : step.icon}
                </div>
                <span className="step-text">{step.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="error-message fade-in">
          <AlertIcon />
          <span>{error}</span>
        </div>
      )}

      {/* Success Card */}
      {state === STATES.COMPLETE && (
        <div className="success-card fade-in">
          <h3>✨ Summary Complete!</h3>
          <p>Your meeting has been transcribed, summarized, and a video explanation has been generated.</p>
        </div>
      )}

      {/* Control Buttons */}
      <div className="controls">
        {state === STATES.IDLE && (
          <button className="btn btn-primary" onClick={handleStartRecording}>
            <PlayIcon />
            Start Recording
          </button>
        )}

        {state === STATES.RECORDING && (
          <button className="btn btn-danger" onClick={handleStopRecording}>
            <StopIcon />
            Stop Recording
          </button>
        )}

        {isProcessing && (
          <button className="btn btn-secondary" disabled>
            <div className="spinner" />
            Processing...
          </button>
        )}

        {state === STATES.COMPLETE && (
          <>
            <button className="btn btn-primary" onClick={handleViewSummary}>
              <ExternalIcon />
              View Summary
            </button>
            <button className="btn btn-secondary" onClick={handleReset}>
              Start New Recording
            </button>
          </>
        )}

        {state === STATES.ERROR && (
          <button className="btn btn-secondary" onClick={handleReset}>
            Try Again
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="footer">
        <div className="footer-badge">
          <span>Powered by</span>
          <strong>Gemini 3</strong>
        </div>
        <div className="footer-badge">
          <span>+</span>
          <strong>Veo 3</strong>
        </div>
      </div>
    </div>
  );
}

// Mount the app
const container = document.getElementById('popup-root');
const root = createRoot(container);
root.render(<Popup />);
