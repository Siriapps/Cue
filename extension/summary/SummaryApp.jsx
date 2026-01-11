import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import TextSummary from './TextSummary';
import VideoPlayer from './VideoPlayer';
import ProcessingStatus from './ProcessingStatus';
import './summary.css';

// Logo component
const FlowLogo = () => (
  <svg viewBox="0 0 24 24" fill="white">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
  </svg>
);

function SummaryApp() {
  const [loading, setLoading] = useState(true);
  const [summaryData, setSummaryData] = useState(null);
  const [error, setError] = useState(null);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    loadSummaryData();
  }, []);

  const loadSummaryData = async () => {
    try {
      // Load summary data from Chrome storage
      const result = await chrome.storage.local.get(['summaryData', 'videoUrl']);
      
      if (result.summaryData) {
        setSummaryData(result.summaryData);
        setLoading(false);
      } else {
        // No data yet - might still be processing
        // Listen for updates
        chrome.runtime.onMessage.addListener((message) => {
          if (message.type === 'STATE_UPDATE' && message.summaryReady) {
            loadSummaryData(); // Reload when ready
          }
        });

        // Check current state
        const stateResult = await chrome.storage.local.get(['recordingState']);
        if (stateResult.recordingState?.state === 'complete') {
          // State says complete but no data - this is an error
          setError('Summary data not found. Please try recording again.');
          setLoading(false);
        }
        // Otherwise keep loading/processing state
      }
    } catch (err) {
      console.error('Error loading summary data:', err);
      setError('Failed to load summary data. Please try again.');
      setLoading(false);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    return new Date(timestamp).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleDownloadSummary = () => {
    if (!summaryData?.summary) return;

    const content = `
# ${summaryData.summary.title || 'Meeting Summary'}
Generated on: ${formatDate(summaryData.createdAt)}

## Summary
${summaryData.summary.summary?.map(s => `- ${s}`).join('\n') || 'No summary available'}

## Decisions Made
${summaryData.summary.decisions?.map(d => `- ${d}`).join('\n') || 'No decisions recorded'}

## Action Items
${summaryData.summary.actionItems?.map(a => `- ${a.task} (Owner: ${a.owner}, Deadline: ${a.deadline})`).join('\n') || 'No action items'}

## Key Topics
${summaryData.summary.keyTopics?.join(', ') || 'No topics identified'}

## Transcript
${summaryData.transcript || 'No transcript available'}
    `.trim();

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting-summary-${new Date().toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Show processing overlay if still loading
  if (loading && !summaryData) {
    return <ProcessingStatus />;
  }

  // Show error state
  if (error) {
    return (
      <div className="summary-app">
        <div className="error-card fade-in">
          <div className="error-icon">⚠️</div>
          <h2 className="error-title">Something went wrong</h2>
          <p className="error-message">{error}</p>
          <button className="btn btn-primary" onClick={() => window.close()}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="summary-app fade-in">
      {/* Header */}
      <header className="summary-header">
        <div className="header-left">
          <div className="logo">
            <FlowLogo />
          </div>
          <div className="header-title">
            <h1>{summaryData?.summary?.title || 'Meeting Summary'}</h1>
            <span className="meeting-date">{formatDate(summaryData?.createdAt)}</span>
          </div>
        </div>
        
        <div className="header-badges">
          <div className="badge gemini">
            <span className="badge-icon">✨</span>
            <span>Gemini 3</span>
          </div>
          {summaryData?.hasVideo && (
            <div className="badge veo">
              <span className="badge-icon">🎬</span>
              <span>Veo 3</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="summary-content">
        {/* Text Summary Panel */}
        <div className="text-panel">
          <TextSummary 
            summary={summaryData?.summary}
            onDownload={handleDownloadSummary}
          />

          {/* Transcript Section */}
          {summaryData?.transcript && (
            <div className="transcript-section slide-up">
              <button 
                className="transcript-toggle"
                onClick={() => setShowTranscript(!showTranscript)}
              >
                <span>📝 View Full Transcript</span>
                <span>{showTranscript ? '▲' : '▼'}</span>
              </button>
              
              {showTranscript && (
                <div className="transcript-content fade-in">
                  <p className="transcript-text">{summaryData.transcript}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Video Panel */}
        <div className="video-panel">
          <VideoPlayer 
            videoUrl={summaryData?.videoUrl}
            videoScript={summaryData?.videoScript}
            hasVideo={summaryData?.hasVideo}
            videoError={summaryData?.videoError}
          />
        </div>
      </main>
    </div>
  );
}

// Mount the app
const container = document.getElementById('summary-root');
const root = createRoot(container);
root.render(<SummaryApp />);
