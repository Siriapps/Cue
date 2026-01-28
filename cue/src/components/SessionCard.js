import React, { useState } from 'react';

function SessionCard({ session, formatDate, formatDuration, onClick, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  // Echoes-style gradient palette
  const getThumbnailGradient = (index) => {
    const gradients = [
      'linear-gradient(135deg, #8b7dd8 0%, #6b5eb8 50%, #9b8dd8 100%)', // Purple (like Decision Review)
      'linear-gradient(135deg, #7ba3d8 0%, #5b83b8 50%, #8bb3e8 100%)', // Blue (like Product Sync)
      'linear-gradient(135deg, #d89b7b 0%, #b87b5b 50%, #e8ab8b 100%)', // Orange/Coral (like Client Briefing)
      'linear-gradient(135deg, #c8a8d8 0%, #a888b8 50%, #d8b8e8 100%)', // Light Purple (like Workshop)
      'linear-gradient(135deg, #7bc8d8 0%, #5ba8b8 50%, #8bd8e8 100%)', // Teal
      'linear-gradient(135deg, #d87b9b 0%, #b85b7b 50%, #e88bab 100%)', // Pink
    ];
    const idx = session.sessionId ? 
      parseInt(session.sessionId.slice(-2), 16) % gradients.length : 
      (index || 0) % gradients.length;
    return gradients[idx];
  };

  const handleCardClick = () => {
    if (onClick) {
      onClick(session);
    } else {
      setExpanded(!expanded);
    }
  };

  const openSource = (e) => {
    e.stopPropagation();
    if (session.source_url) {
      window.open(session.source_url, '_blank');
    }
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    if (onDelete && window.confirm('Are you sure you want to delete this session?')) {
      onDelete(session.sessionId || session._id);
    }
  };

  // Extract summary data (must be before getSentimentDisplay)
  const summary = session.summary || {};
  const tldr = summary.tldr || 'AI-inferred summary from session...';
  const keyPoints = summary.key_points || [];
  const actionItems = summary.action_items || [];

  // Get sentiment with fallback and proper display
  // Gemini returns: "Informative|Educational|Casual|Professional|Entertainment" or traditional values
  const getSentimentDisplay = () => {
    const sentiment = summary.sentiment || 'Neutral';
    const normalized = sentiment.toLowerCase();
    
    // Map Gemini's sentiment values to display
    const sentimentMap = {
      // Traditional sentiment values
      'positive': { label: 'Positive', class: 'positive' },
      'negative': { label: 'Negative', class: 'negative' },
      'neutral': { label: 'Neutral', class: 'neutral' },
      'mixed': { label: 'Mixed', class: 'mixed' },
      // Gemini session summary values
      'informative': { label: 'Informative', class: 'positive' },
      'educational': { label: 'Educational', class: 'positive' },
      'casual': { label: 'Casual', class: 'neutral' },
      'professional': { label: 'Professional', class: 'positive' },
      'entertainment': { label: 'Entertainment', class: 'positive' },
    };
    
    // Check exact match first
    if (sentimentMap[normalized]) {
      return sentimentMap[normalized];
    }
    
    // If no match, use the original value as label (capitalize first letter)
    const displayLabel = sentiment.charAt(0).toUpperCase() + sentiment.slice(1).toLowerCase();
    return { label: displayLabel, class: 'neutral' };
  };

  const sentimentInfo = getSentimentDisplay();

  // Get transcript preview
  const transcriptPreview = session.transcript 
    ? session.transcript.substring(0, 300) + (session.transcript.length > 300 ? '...' : '')
    : '';

  const sessionIndex = session.sessionId ? 
    parseInt(session.sessionId.slice(-1), 16) : 0;

  // Check if session has video
  const hasVideo = session.videoUrl || session.hasVideo || 
    (session.source_url && (session.source_url.includes('youtube') || session.source_url.includes('meet')));

  return (
    <div className={`session-card echoes-style ${expanded ? 'expanded' : ''}`} onClick={handleCardClick}>
      {/* Thumbnail - Echoes Style */}
      <div 
        className="session-thumbnail"
        style={{ background: getThumbnailGradient(sessionIndex) }}
      >
        {/* Audio Waveform Visualization */}
        <div className="waveform-container">
          {hasVideo ? (
            <div className="video-play-icon">
              <svg viewBox="0 0 24 24" fill="white" width="32" height="32">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
          ) : (
            <svg className="waveform-svg" viewBox="0 0 120 40" fill="white">
              <rect x="5" y="12" width="4" height="16" rx="2" opacity="0.7"/>
              <rect x="15" y="8" width="4" height="24" rx="2" opacity="0.8"/>
              <rect x="25" y="14" width="4" height="12" rx="2" opacity="0.6"/>
              <rect x="35" y="6" width="4" height="28" rx="2" opacity="0.9"/>
              <rect x="45" y="10" width="4" height="20" rx="2" opacity="0.7"/>
              <rect x="55" y="4" width="4" height="32" rx="2" opacity="0.85"/>
              <rect x="65" y="8" width="4" height="24" rx="2" opacity="0.75"/>
              <rect x="75" y="12" width="4" height="16" rx="2" opacity="0.65"/>
              <rect x="85" y="6" width="4" height="28" rx="2" opacity="0.8"/>
              <rect x="95" y="10" width="4" height="20" rx="2" opacity="0.7"/>
              <rect x="105" y="14" width="4" height="12" rx="2" opacity="0.6"/>
            </svg>
          )}
        </div>

        {/* Microphone icon for audio sessions */}
        {!hasVideo && (
          <div className="mic-icon">
            <svg viewBox="0 0 24 24" fill="white" width="20" height="20" opacity="0.9">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          </div>
        )}

        {/* Duration Badge - Always show duration if available */}
        {session.duration_seconds > 0 && (
          <div className="duration-badge">
            {formatDuration(session.duration_seconds)}
          </div>
        )}

        {/* Lock icon if needed */}
        {session.locked && (
          <div className="lock-icon">
            <svg viewBox="0 0 24 24" fill="white" width="16" height="16">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
        )}
      </div>

      {/* Card Content - Echoes Style */}
      <div className="session-content">
        {/* Title Row with Delete Button */}
        <div className="title-row">
          <h3 className="session-title">
            {session.title || 'Untitled Session'}
          </h3>
          <div className="title-actions">
            <span className="session-date">
              {formatDate(session.created_at ? (typeof session.created_at === 'string' ? new Date(session.created_at).getTime() : session.created_at) : null)}
            </span>
            {onDelete && (
              <button className="delete-btn" onClick={handleDelete} title="Delete session">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Tags Row - Topic and Sentiment */}
        <div className="tags-row">
          {summary.topic && (
            <div className="topic-tag">{summary.topic}</div>
          )}
          <div className={`sentiment-tag ${sentimentInfo.class}`}>
            {sentimentInfo.label}
          </div>
        </div>

        {/* Summary */}
        <p className="session-summary">
          {tldr}
        </p>

        {/* Transcript Preview - Always visible */}
        {transcriptPreview && (
          <div className="transcript-section">
            <span className="transcript-label">Transcript:</span>
            <p className="transcript-preview-text">{transcriptPreview}</p>
          </div>
        )}

        {/* Action Items Preview (Always show up to 2) */}
        {actionItems.length > 0 && (
          <div className="action-items-preview">
            {actionItems.slice(0, 2).map((item, idx) => (
              <div key={idx} className="action-item-row">
                <span className="action-bullet">◆</span>
                <span className="action-text">{item.task || item}</span>
              </div>
            ))}
            {actionItems.length > 2 && (
              <div className="action-item-row more">
                <span className="action-bullet">◆</span>
                <span className="action-text">+{actionItems.length - 2} more items</span>
              </div>
            )}
          </div>
        )}

        {/* Expanded Details */}
        {expanded && (
          <div className="session-details">
            {/* All Action Items */}
            {actionItems.length > 2 && (
              <div className="detail-section">
                <h4>All Action Items</h4>
                <div className="action-items-full">
                  {actionItems.map((item, idx) => (
                    <div key={idx} className="action-item-row">
                      <span className="action-bullet">◆</span>
                      <span className="action-text">{item.task || item}</span>
                      {item.priority && (
                        <span className={`priority-tag ${item.priority.toLowerCase()}`}>
                          {item.priority}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Key Points */}
            {keyPoints.length > 0 && (
              <div className="detail-section">
                <h4>Key Points</h4>
                <ul className="key-points-list">
                  {keyPoints.map((point, idx) => (
                    <li key={idx}>{point}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Transcript Preview */}
            {transcriptPreview && (
              <div className="detail-section">
                <h4>Transcript</h4>
                <p className="transcript-preview">{transcriptPreview}</p>
              </div>
            )}

            {/* Source Link */}
            {session.source_url && (
              <button className="source-link-btn" onClick={openSource}>
                Open Source
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SessionCard;
