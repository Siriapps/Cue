import React, { useState } from 'react';

const NOTES_STORAGE_KEY = 'cue_session_notes';

function SessionCard({ session, formatDate, formatDuration, onClick, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesValue, setNotesValue] = useState(() => {
    try {
      const raw = localStorage.getItem(NOTES_STORAGE_KEY);
      if (!raw) return '';
      const obj = JSON.parse(raw);
      return obj[session.sessionId || session._id] || '';
    } catch {
      return '';
    }
  });
  const sessionId = session.sessionId || session._id;
  // Thumbnail only from session (list or SESSION_RESULT). No image API calls — no 404s, no loading.
  const sessionThumbnail =
    session.thumbnail_base64 && session.thumbnail_mime_type
      ? `data:${session.thumbnail_mime_type};base64,${session.thumbnail_base64}`
      : null;

  // Echoes-style gradient palette (fallback when no image)
  const getThumbnailGradient = (index) => {
    const gradients = [
      'linear-gradient(135deg, #8b7dd8 0%, #6b5eb8 50%, #9b8dd8 100%)',
      'linear-gradient(135deg, #7ba3d8 0%, #5b83b8 50%, #8bb3e8 100%)',
      'linear-gradient(135deg, #d89b7b 0%, #b87b5b 50%, #e8ab8b 100%)',
      'linear-gradient(135deg, #c8a8d8 0%, #a888b8 50%, #d8b8e8 100%)',
      'linear-gradient(135deg, #7bc8d8 0%, #5ba8b8 50%, #8bd8e8 100%)',
      'linear-gradient(135deg, #d87b9b 0%, #b85b7b 50%, #e88bab 100%)',
    ];
    const idx = session.sessionId
      ? parseInt(session.sessionId.slice(-2), 16) % gradients.length
      : (index || 0) % gradients.length;
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
      onDelete(sessionId);
    }
  };

  const handleShare = (e) => {
    e.stopPropagation();
    const url = window.location.origin + '/library?session=' + encodeURIComponent(sessionId);
    if (navigator.share) {
      navigator.share({
        title: session.title || 'Session',
        url,
      }).catch(() => {
        navigator.clipboard.writeText(url);
      });
    } else {
      navigator.clipboard.writeText(url);
    }
  };

  const handleNotesClick = (e) => {
    e.stopPropagation();
    try {
      const raw = localStorage.getItem(NOTES_STORAGE_KEY) || '{}';
      const obj = JSON.parse(raw);
      setNotesValue(obj[sessionId] || '');
    } catch {
      setNotesValue('');
    }
    setNotesOpen(true);
  };

  const saveNotes = (e) => {
    e.stopPropagation();
    try {
      const raw = localStorage.getItem(NOTES_STORAGE_KEY) || '{}';
      const obj = JSON.parse(raw);
      obj[sessionId] = notesValue;
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(obj));
    } catch (err) {
      console.error('[SessionCard] save notes:', err);
    }
    setNotesOpen(false);
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

  const sessionIndex = session.sessionId
    ? parseInt(session.sessionId.slice(-1), 16)
    : 0;

  const createdTs = session.created_at
    ? (typeof session.created_at === 'string' ? new Date(session.created_at).getTime() : session.created_at)
    : null;
  const isActive = session.isLive || (createdTs && Date.now() - createdTs < 24 * 60 * 60 * 1000);
  const dateLong = createdTs
    ? (() => {
        const d = new Date(createdTs);
        const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
        return `${dateStr} • ${timeStr}`;
      })()
    : '';

  const hasReel = session.has_video || session.video_url;

  return (
    <div className={`session-card echoes-style stitch-card ${expanded ? 'expanded' : ''}`} onClick={handleCardClick}>
      {/* Thumbnail with Play Reel overlay (stitch reference) */}
      <div
        className="session-thumbnail"
        style={{ background: getThumbnailGradient(sessionIndex) }}
      >
        {sessionThumbnail && (
          <img
            src={sessionThumbnail}
            alt=""
            className="session-thumbnail-image"
          />
        )}
        {hasReel && (
          <div className="session-thumbnail-play" onClick={(e) => { e.stopPropagation(); if (onClick) onClick(session); }}>
            <span className="play-reel-btn">
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <path d="M8 5v14l11-7z"/>
              </svg>
              Play Reel
            </span>
          </div>
        )}
        {session.locked && (
          <div className="lock-icon">
            <svg viewBox="0 0 24 24" fill="white" width="16" height="16">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
        )}
      </div>

      {/* Card Content - stitch: title, date, ACTIVE tag, Key Decisions, footer */}
      <div className="session-content">
        <div className="title-row">
          <div className="title-col">
            <h3 className="session-title">
              {session.title || 'Untitled Session'}
            </h3>
            <span className="session-date session-date-long">
              {dateLong || formatDate(createdTs)}
            </span>
          </div>
          {isActive && <span className="session-active-tag">ACTIVE</span>}
        </div>

        {/* Key Decisions (stitch reference) */}
        <div className="session-key-decisions">
          <span className="key-decisions-label">Key Decisions:</span> {tldr}
        </div>

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

        {/* Footer: duration + Notes, Share, Delete */}
        <div className="session-card-footer" onClick={(e) => e.stopPropagation()}>
          <span className="session-duration-footer">
            {session.duration_seconds > 0 ? formatDuration(session.duration_seconds) : '—'}
          </span>
          <div className="session-card-actions">
            <button type="button" className="session-footer-btn notes-btn" onClick={handleNotesClick} title="Notes">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              <span>Notes</span>
            </button>
            <button type="button" className="session-footer-btn share-btn" onClick={handleShare} title="Share">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <circle cx="18" cy="5" r="3"/>
                <circle cx="6" cy="12" r="3"/>
                <circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
              <span>Share</span>
            </button>
            {onDelete && (
              <button type="button" className="session-footer-btn delete-btn" onClick={handleDelete} title="Delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
                <span>Delete</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Notes modal */}
      {notesOpen && (
        <div className="session-notes-overlay" onClick={(e) => { e.stopPropagation(); setNotesOpen(false); }}>
          <div className="session-notes-modal" onClick={(e) => e.stopPropagation()}>
            <h4>Notes</h4>
            <textarea
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              placeholder="Add notes for this session..."
              rows={6}
            />
            <div className="session-notes-actions">
              <button type="button" className="secondary-btn" onClick={() => setNotesOpen(false)}>Cancel</button>
              <button type="button" className="primary-btn" onClick={saveNotes}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SessionCard;
