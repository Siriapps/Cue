import React, { useState } from 'react';

/**
 * DashboardHalo - Top bar for the dashboard matching the extension halo strip style
 */
function DashboardHalo() {
  const [chatOpen, setChatOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [aiAnswer, setAiAnswer] = useState(null);
  const [isThinking, setIsThinking] = useState(false);

  const ADK_API_URL = 'http://localhost:8000';

  const handleAsk = async () => {
    if (!query.trim()) return;
    const currentQuery = query.trim();
    setQuery('');
    setIsThinking(true);
    setAiAnswer(null);

    try {
      const response = await fetch(`${ADK_API_URL}/ask_ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: currentQuery,
          page_title: 'cue Dashboard',
          current_url: window.location.href,
          selected_text: '',
        }),
      });
      const data = await response.json();
      setIsThinking(false);
      if (data.success && data.answer) {
        setAiAnswer(data.answer);
      } else {
        setAiAnswer(data.error || 'Failed to get AI response');
      }
    } catch (error) {
      setIsThinking(false);
      setAiAnswer('Error connecting to server');
    }
  };

  const toggleChat = () => {
    setChatOpen(!chatOpen);
    if (chatOpen) {
      setAiAnswer(null);
      setIsThinking(false);
    }
  };

  return (
    <div className="dashboard-halo">
      {/* Logo and Brand */}
      <div className="halo-brand">
        <div className="halo-logo">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" fill="url(#dashLogoGrad)" />
            <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="12" cy="14" r="2" fill="white"/>
            <defs>
              <linearGradient id="dashLogoGrad" x1="2" y1="2" x2="22" y2="22">
                <stop stopColor="#6366f1"/>
                <stop offset="1" stopColor="#8b5cf6"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <span className="halo-brand-text">cue</span>
      </div>

      {/* Start Session Button (disabled on dashboard) */}
      <button 
        className="halo-btn start-session disabled" 
        title="Use extension on websites to start a session"
        disabled
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M8 5v14l11-7z"/>
        </svg>
        <span>Start Session</span>
      </button>

      {/* Go Live Button (disabled on dashboard) */}
      <button 
        className="halo-btn go-live disabled" 
        title="Use extension on websites for Go Live"
        disabled
      >
        <span className="live-indicator"></span>
        <span>Go Live</span>
      </button>

      {/* Ask AI Button */}
      <button className="halo-btn ask-ai" onClick={toggleChat}>
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
        </svg>
        <span>Ask AI</span>
      </button>

      {/* Library Button (current page indicator) */}
      <button className="halo-btn library active">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
          <rect x="3" y="3" width="7" height="7"/>
          <rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/>
        </svg>
        <span>Library</span>
      </button>

      {/* Chat Panel */}
      {chatOpen && (
        <div className="halo-chat dashboard-chat">
          <div className="halo-chat-header">
            <span>Ask AI</span>
            <button className="halo-close" onClick={toggleChat}>×</button>
          </div>
          <input
            className="halo-input"
            placeholder="Ask anything about your sessions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAsk();
            }}
          />
          <div className="halo-actions">
            <button className="halo-btn send-btn" onClick={handleAsk}>
              Send
            </button>
          </div>
          {isThinking && (
            <div className="halo-answer">
              <div className="halo-thinking">
                <span className="thinking-dot"></span>
                <span className="thinking-dot"></span>
                <span className="thinking-dot"></span>
                Thinking...
              </div>
            </div>
          )}
          {aiAnswer && !isThinking && (
            <div className="halo-answer">
              <div className="halo-answer-text">{aiAnswer}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DashboardHalo;
