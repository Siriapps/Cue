import React, { useState, useRef, useEffect } from 'react';

export default function ReelsFeed({ reels = [] }) {
  const [expandedId, setExpandedId] = useState(null);
  const containerRef = useRef(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isScrolling = false;
    let scrollTimeout;

    const handleScroll = () => {
      if (isScrolling) return;
      
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const scrollTop = container.scrollTop;
        const itemHeight = container.clientHeight;
        const index = Math.round(scrollTop / itemHeight);
        
        if (index !== currentIndex && index >= 0 && index < reels.length) {
          setCurrentIndex(index);
        }
        isScrolling = false;
      }, 100);
    };

    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [reels.length, currentIndex]);

  const handleReelClick = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  if (reels.length === 0) {
    return (
      <div className="reels-empty">
        <p>No reels available yet</p>
        <p className="reels-empty-subtitle">Record sessions to see them here</p>
      </div>
    );
  }

  return (
    <div className="reels-container" ref={containerRef}>
      {reels.map((reel, index) => {
        const isExpanded = expandedId === reel.id;
        const isActive = index === currentIndex;
        
        return (
          <div
            key={reel.id}
            className={`reel-item ${isActive ? 'active' : ''} ${isExpanded ? 'expanded' : ''}`}
            onClick={() => handleReelClick(reel.id)}
          >
            <div className="reel-preview">
              <div className="reel-header">
                <h3 className="reel-title">{reel.title || 'Untitled Reel'}</h3>
                <span className="reel-type-badge">{reel.type}</span>
              </div>
              
              {reel.sentiment && (
                <div className={`reel-sentiment ${reel.sentiment.toLowerCase()}`}>
                  {reel.sentiment}
                </div>
              )}
              
              <div className="reel-summary-preview">
                {reel.summary ? (
                  <p>{reel.summary.substring(0, 150)}{reel.summary.length > 150 ? '...' : ''}</p>
                ) : (
                  <p>No summary available</p>
                )}
              </div>
              
              {reel.tasks && reel.tasks.length > 0 && (
                <div className="reel-tasks-preview">
                  <span className="reel-tasks-count">{reel.tasks.length} tasks</span>
                </div>
              )}
              
              {reel.mermaid_code && (
                <div className="reel-diagram-preview">
                  <span className="reel-diagram-badge">📊 Diagram Available</span>
                </div>
              )}
            </div>

            {isExpanded && (
              <div className="reel-expanded-content">
                <div className="reel-full-summary">
                  <h4>Summary</h4>
                  <p>{reel.summary || 'No summary available'}</p>
                </div>

                {reel.tasks && reel.tasks.length > 0 && (
                  <div className="reel-tasks-full">
                    <h4>Action Items</h4>
                    <ul>
                      {reel.tasks.map((task, idx) => (
                        <li key={idx} className={`task-item priority-${task.priority?.toLowerCase() || 'medium'}`}>
                          <span className="task-priority">{task.priority || 'Medium'}</span>
                          <span className="task-action">{task.action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {reel.mermaid_code && (
                  <div className="reel-diagram-full">
                    <h4>Diagram</h4>
                    <div className="mermaid-container">
                      <pre className="mermaid-code">{reel.mermaid_code}</pre>
                    </div>
                  </div>
                )}

                {reel.videoUrl && (
                  <div className="reel-video-full">
                    <h4>Video</h4>
                    <video controls src={reel.videoUrl} className="reel-video-player" />
                  </div>
                )}

                {reel.source_url && (
                  <div className="reel-source">
                    <a href={reel.source_url} target="_blank" rel="noopener noreferrer">
                      View Source →
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
