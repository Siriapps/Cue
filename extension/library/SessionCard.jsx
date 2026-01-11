import React, { useState } from 'react';

function SessionCard({ session, formatDate, formatDuration }) {
  const [showDetails, setShowDetails] = useState(false);

  const getThumbnailGradient = (index) => {
    const gradients = [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    ];
    return gradients[index % gradients.length];
  };

  const handleCardClick = () => {
    // Open summary view
    chrome.tabs.create({ 
      url: chrome.runtime.getURL(`summary.html?sessionId=${session.sessionId || session._id}`)
    });
  };

  const getActionItems = () => {
    return session.summary?.actionItems?.slice(0, 2) || [];
  };

  return (
    <div className="session-card" onClick={handleCardClick}>
      {/* Thumbnail */}
      <div 
        className="session-thumbnail"
        style={{ background: getThumbnailGradient(session.index || 0) }}
      >
        {session.hasVideo ? (
          <div className="video-indicator">
            <svg viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        ) : (
          <div className="audio-waveform">
            <svg viewBox="0 0 200 60" fill="white" opacity="0.8">
              <rect x="10" y="20" width="8" height="20" rx="4"/>
              <rect x="30" y="10" width="8" height="40" rx="4"/>
              <rect x="50" y="15" width="8" height="30" rx="4"/>
              <rect x="70" y="5" width="8" height="50" rx="4"/>
              <rect x="90" y="18" width="8" height="24" rx="4"/>
              <rect x="110" y="12" width="8" height="36" rx="4"/>
              <rect x="130" y="8" width="8" height="44" rx="4"/>
              <rect x="150" y="16" width="8" height="28" rx="4"/>
            </svg>
          </div>
        )}
        
        {session.locked && (
          <div className="lock-icon">
            <svg viewBox="0 0 24 24" fill="white">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
        )}

        <div className="duration-badge">
          {formatDuration(session.duration || session.recordingDuration)}
        </div>
      </div>

      {/* Card Content */}
      <div className="session-content">
        <h3 className="session-title">{session.title || session.summary?.title || 'Untitled Session'}</h3>
        <div className="session-meta">
          <span className="session-date">{formatDate(session.createdAt)}</span>
        </div>
        <p className="session-summary">
          {session.summary?.summary?.[0] || 'No summary available'}
        </p>

        {/* Action Items */}
        {getActionItems().length > 0 && (
          <div className="session-actions">
            {getActionItems().map((item, idx) => (
              <div key={idx} className="action-item-check">
                <svg viewBox="0 0 24 24" fill="#8b5cf6">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
                <span>{item.task}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SessionCard;
