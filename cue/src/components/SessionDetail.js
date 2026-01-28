import React from 'react';

function SessionDetail({ session, onBack, formatDate, formatDuration }) {
  const summary = session.summary || {};
  const tldr = summary.tldr || 'No summary available.';
  const keyPoints = summary.key_points || [];
  const actionItems = summary.action_items || [];
  const transcript = session.transcript || 'No transcript available.';

  const openSource = () => {
    if (session.source_url) {
      window.open(session.source_url, '_blank');
    }
  };

  return (
    <div className="session-detail-view">
      {/* Header */}
      <div className="detail-header">
        <button className="back-button" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          <span>Back to Library</span>
        </button>
        <div className="detail-header-info">
          <h1 className="detail-title">{session.title || 'Untitled Session'}</h1>
          <div className="detail-meta">
            <span className="detail-date">
              {formatDate(session.created_at ? new Date(session.created_at).getTime() : null)}
            </span>
            {session.duration_seconds > 0 && (
              <>
                <span className="detail-separator">•</span>
                <span className="detail-duration">
                  {formatDuration(session.duration_seconds)}
                </span>
              </>
            )}
            {summary.topic && (
              <>
                <span className="detail-separator">•</span>
                <span className="detail-topic">{summary.topic}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="detail-content">
        {/* Summary Section */}
        <section className="detail-section">
          <h2 className="detail-section-title">Summary</h2>
          <p className="detail-tldr">{tldr}</p>
        </section>

        {/* Key Points */}
        {keyPoints.length > 0 && (
          <section className="detail-section">
            <h2 className="detail-section-title">Key Points</h2>
            <ul className="detail-key-points">
              {keyPoints.map((point, idx) => (
                <li key={idx}>{point}</li>
              ))}
            </ul>
          </section>
        )}

        {/* Action Items */}
        {actionItems.length > 0 && (
          <section className="detail-section">
            <h2 className="detail-section-title">Action Items</h2>
            <div className="detail-action-items">
              {actionItems.map((item, idx) => (
                <div key={idx} className="detail-action-item">
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
          </section>
        )}

        {/* Transcript */}
        <section className="detail-section">
          <h2 className="detail-section-title">Transcript</h2>
          <div className="detail-transcript">
            {transcript.split('\n').map((paragraph, idx) => (
              paragraph.trim() && (
                <p key={idx}>{paragraph.trim()}</p>
              )
            ))}
          </div>
        </section>

        {/* Source URL */}
        {session.source_url && (
          <section className="detail-section">
            <button className="source-link-button" onClick={openSource}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              <span>Open Source URL</span>
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

export default SessionDetail;
