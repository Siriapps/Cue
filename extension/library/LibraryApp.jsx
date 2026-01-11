import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import SessionCard from './SessionCard';
import './library.css';

function LibraryApp() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'today', 'history'
  const [searchQuery, setSearchQuery] = useState('');
  const [activeNav, setActiveNav] = useState('library');

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const result = await chrome.runtime.sendMessage({ type: 'FETCH_SESSIONS' });
      
      if (result?.success && result.sessions) {
        setSessions(result.sessions);
      } else {
        // Fallback: load from Chrome storage
        const storage = await chrome.storage.local.get(['sessions']);
        if (storage.sessions) {
          setSessions(storage.sessions);
        }
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
      // Fallback to Chrome storage
      const storage = await chrome.storage.local.get(['sessions']);
      if (storage.sessions) {
        setSessions(storage.sessions);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRecordNew = () => {
    // Open a new tab and start recording
    chrome.tabs.create({ url: 'https://meet.google.com' });
    window.close();
  };

  const filteredSessions = sessions.filter(session => {
    // Filter by date
    if (filter === 'today') {
      const today = new Date().toDateString();
      const sessionDate = new Date(session.createdAt).toDateString();
      if (sessionDate !== today) return false;
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesTitle = session.title?.toLowerCase().includes(query);
      const matchesSummary = session.summary?.summary?.some(s => 
        s.toLowerCase().includes(query)
      );
      const matchesTopics = session.summary?.keyTopics?.some(t => 
        t.toLowerCase().includes(query)
      );
      
      if (!matchesTitle && !matchesSummary && !matchesTopics) {
        return false;
      }
    }

    return true;
  });

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown date';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="library-app">
      {/* Sidebar */}
      <div className="library-sidebar">
        <div className="sidebar-nav">
          <button 
            className={`nav-item ${activeNav === 'library' ? 'active' : ''}`}
            onClick={() => setActiveNav('library')}
            title="Library"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
            </svg>
          </button>
          <button 
            className={`nav-item ${activeNav === 'history' ? 'active' : ''}`}
            onClick={() => setActiveNav('history')}
            title="History"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </button>
          <button 
            className={`nav-item ${activeNav === 'ai' ? 'active' : ''}`}
            onClick={() => setActiveNav('ai')}
            title="AI Assistant"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </button>
          <button 
            className={`nav-item ${activeNav === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveNav('settings')}
            title="Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
        <button className="nav-item record-btn" onClick={handleRecordNew} title="Record New Session">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="6" fill="white"/>
          </svg>
        </button>
      </div>

      {/* Main Content */}
      <div className="library-main">
        {/* Header */}
        <header className="library-header">
          <h1 className="library-title">Chrome Flow Session Library</h1>
          <div className="header-actions">
            <button 
              className={`filter-btn ${filter === 'today' ? 'active' : ''}`}
              onClick={() => setFilter('today')}
            >
              Today
            </button>
            <button 
              className={`filter-btn ${filter === 'history' ? 'active' : ''}`}
              onClick={() => setFilter('history')}
            >
              History
            </button>
            <button className="icon-btn" title="Search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
            </button>
            <button className="icon-btn" title="Dark Mode">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            </button>
            <button className="text-btn">
              Export Data
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </button>
          </div>
        </header>

        {/* Search Bar */}
        <div className="search-container">
          <input
            type="text"
            className="search-input"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Sessions Grid */}
        <div className="sessions-container">
          <h2 className="sections-title">Past Digital Sessions</h2>
          
          {loading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading sessions...</p>
            </div>
          ) : (
            <div className="sessions-grid">
              {/* Record New Session Card */}
              <div className="session-card new-session-card" onClick={handleRecordNew}>
                <div className="new-session-icon">+</div>
                <div className="new-session-text">Record New Session</div>
              </div>

              {/* Session Cards */}
              {filteredSessions.map((session) => (
                <SessionCard
                  key={session.sessionId || session._id}
                  session={session}
                  formatDate={formatDate}
                  formatDuration={formatDuration}
                />
              ))}

              {filteredSessions.length === 0 && !loading && (
                <div className="empty-state">
                  <p>No sessions found</p>
                  <button className="primary-btn" onClick={handleRecordNew}>
                    Record Your First Session
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* AI Processing Toast */}
      <div className="ai-toast hidden" id="ai-toast">
        <div className="toast-icon">✨</div>
        <div className="toast-content">
          <div className="toast-title">AI is organizing sessions</div>
          <div className="toast-subtitle" id="toast-subtitle">Processing...</div>
        </div>
        <button className="toast-close" onClick={() => {
          document.getElementById('ai-toast').classList.add('hidden');
        }}>×</button>
      </div>
    </div>
  );
}

// Mount the app
const container = document.getElementById('library-root');
const root = createRoot(container);
root.render(<LibraryApp />);
