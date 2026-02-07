import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Draggable from 'react-draggable';
import { config } from '../config';
import { getStoredToken } from '../auth/googleAuth';

const ADK_API_URL = config.API_BASE_URL;
const MOSAIC_LAYOUT_KEY = 'cue_mosaic_layout';
const HUB_SIZE = { width: 280, height: 200 };
const PRODUCTIVITY_HUB_SIZE = { width: 220, height: 260 };
const INSIGHTS_HUB_SIZE = { width: 320, height: 280 };
const EVENTS_HUB_SIZE = { width: 280, height: 220 };
// Productivity centered, hubs radiate outward in 2000x1500 canvas
const DEFAULT_POSITIONS = {
  'productivity': { x: 840, y: 520 },
  'deep-work': { x: 380, y: 520 },
  'comms': { x: 1260, y: 420 },
  'events': { x: 1260, y: 760 },
  'insights': { x: 1260, y: 120 },
  'priority': { x: 840, y: 860 },
  'recent': { x: 520, y: 860 },
  'waiting': { x: 1160, y: 860 },
};

// Fixed edge list for neural connections (star from productivity + priority branches)
const NEURAL_EDGES = [
  ['productivity', 'comms'],
  ['productivity', 'events'],
  ['productivity', 'deep-work'],
  ['productivity', 'insights'],
  ['productivity', 'priority'],
  ['priority', 'recent'],
  ['priority', 'waiting'],
];

function MosaicField() {
  const [sessions, setSessions] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hubPositions, setHubPositions] = useState(() => {
    try {
      const raw = localStorage.getItem(MOSAIC_LAYOUT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_POSITIONS, ...parsed };
      }
    } catch (e) {}
    return { ...DEFAULT_POSITIONS };
  });
  const [pan, setPan] = useState(() => {
    try {
      if (!localStorage.getItem(MOSAIC_LAYOUT_KEY)) {
        const prod = DEFAULT_POSITIONS.productivity;
        const cw = 220 / 2;
        const ch = 260 / 2;
        return { x: -prod.x - cw + 400, y: -prod.y - ch + 300 };
      }
    } catch (e) {}
    return { x: 0, y: 0 };
  });
  const [scale, setScale] = useState(1);
  const [canvasSearch, setCanvasSearch] = useState('');
  const [expandedHubId, setExpandedHubId] = useState(null);
  const [showCreateHub, setShowCreateHub] = useState(false);
  const [newHubName, setNewHubName] = useState('');
  const [customHubs, setCustomHubs] = useState(() => {
    try {
      const saved = localStorage.getItem('cue_custom_hubs');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [gmailUnread, setGmailUnread] = useState(null);
  const [gmailSummary, setGmailSummary] = useState(null);
  const [whatToDo, setWhatToDo] = useState(null);
  const [calendarUpcoming, setCalendarUpcoming] = useState([]);
  const [commsLoading, setCommsLoading] = useState(false);
  const canvasRef = useRef(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  function formatCalendarStart(start) {
    if (!start) return '';
    const dt = start.dateTime || (start.date ? start.date + 'T00:00:00Z' : null);
    if (!dt) return '';
    const d = new Date(dt);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  // Productivity calculations
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const totalTasks = tasks.length;
  const productivityScore = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Activity stats
  const gmailCount = activities.filter(a => a.service === 'gmail').length;

  const fetchSessions = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    fetch(`${ADK_API_URL}/sessions?limit=50`)
      .then((res) => res.ok ? res.json() : { sessions: [] })
      .then((data) => setSessions(data.sessions || []))
      .catch(() => setSessions([]))
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  const fetchTasks = useCallback(() => {
    fetch(`${ADK_API_URL}/suggested_tasks?limit=100`)
      .then((res) => res.ok ? res.json() : { tasks: [] })
      .then((data) => setTasks(data.tasks || []))
      .catch(() => setTasks([]));
  }, []);

  const fetchActivities = useCallback(() => {
    fetch(`${ADK_API_URL}/google_activity?limit=50`)
      .then((res) => res.ok ? res.json() : { activities: [] })
      .then((data) => setActivities(data.activities || []))
      .catch(() => setActivities([]));
  }, []);

  const fetchCommsData = useCallback((forceRefresh = false) => {
    const token = getStoredToken();
    if (!token) return;
    if (!forceRefresh && sessionStorage.getItem('cue_comms_fetched')) return;
    setCommsLoading(true);
    fetch(`${ADK_API_URL}/mosaic/comms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_token: token }),
    })
      .then((res) => res.ok ? res.json() : {})
      .then((data) => {
        setGmailUnread(data.gmail_unread_count != null ? data.gmail_unread_count : null);
        setGmailSummary(data.gmail_summary ?? null);
        setWhatToDo(data.what_to_do ?? null);
        setCalendarUpcoming(Array.isArray(data.calendar_upcoming) ? data.calendar_upcoming : []);
        try { sessionStorage.setItem('cue_comms_fetched', '1'); } catch (e) {}
      })
      .catch(() => {
        setGmailUnread(null);
        setGmailSummary(null);
        setWhatToDo(null);
        setCalendarUpcoming([]);
      })
      .finally(() => setCommsLoading(false));
  }, []);

  useEffect(() => {
    fetchSessions();
    fetchTasks();
    fetchActivities();
  }, [fetchSessions, fetchTasks, fetchActivities]);

  useEffect(() => {
    fetchCommsData();
  }, [fetchCommsData]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchSessions(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [fetchSessions]);

  // WebSocket listener for real-time task updates
  useEffect(() => {
    const wsUrl = ADK_API_URL.replace(/^http/, 'ws') + '/ws/dashboard';
    let ws = null;
    let reconnectTimeout = null;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log('[cue] Dashboard WebSocket connected');
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'TASKS_UPDATED' && msg.tasks) {
              setTasks(msg.tasks);
            }
          } catch (e) {
            // Ignore parse errors
          }
        };

        ws.onclose = () => {
          // Reconnect after 5 seconds
          reconnectTimeout = setTimeout(connect, 5000);
        };

        ws.onerror = () => {
          // Will trigger onclose
        };
      } catch (e) {
        reconnectTimeout = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, []);

  const saveLayout = useCallback((next) => {
    setHubPositions((prev) => {
      const nextPos = typeof next === 'function' ? next(prev) : next;
      try {
        localStorage.setItem(MOSAIC_LAYOUT_KEY, JSON.stringify(nextPos));
      } catch (e) {}
      return nextPos;
    });
  }, []);

  const handleHubDrag = useCallback((hubId, _e, data) => {
    setHubPositions((prev) => ({ ...prev, [hubId]: { x: data.x, y: data.y } }));
  }, []);

  const handleHubDragStop = useCallback((hubId, _e, data) => {
    saveLayout((prev) => ({ ...prev, [hubId]: { x: data.x, y: data.y } }));
  }, [saveLayout]);

  const handleMouseDown = useCallback((e) => {
    if (e.target.closest('.react-draggable') || e.target.closest('.mosaic-hub-card') || e.target.closest('.mosaic-toolbar')) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e) => {
    if (!isPanning.current) return;
    setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const handleBigPicture = useCallback(() => {
    setPan({ x: 0, y: 0 });
    setScale(1);
  }, []);

  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.25, 2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  }, []);

  // Create new custom hub
  const handleCreateHub = useCallback(() => {
    if (!newHubName.trim()) return;
    const newHub = {
      id: `custom-${Date.now()}`,
      name: newHubName.trim(),
      tasks: [],
      position: { x: 400 + Math.random() * 200, y: 300 + Math.random() * 100 },
    };
    const updated = [...customHubs, newHub];
    setCustomHubs(updated);
    localStorage.setItem('cue_custom_hubs', JSON.stringify(updated));
    setNewHubName('');
    setShowCreateHub(false);
  }, [newHubName, customHubs]);

  // Handle custom hub drag
  const handleCustomHubDrag = useCallback((hubId, data) => {
    setCustomHubs(prev => prev.map(h =>
      h.id === hubId ? { ...h, position: { x: data.x, y: data.y } } : h
    ));
  }, []);

  const handleCustomHubDragStop = useCallback((hubId, data) => {
    setCustomHubs(prev => {
      const updated = prev.map(h =>
        h.id === hubId ? { ...h, position: { x: data.x, y: data.y } } : h
      );
      localStorage.setItem('cue_custom_hubs', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const recent = sessions.slice(0, 6);
  const priority = sessions.filter((s) => (s.summary?.sentiment || '').toLowerCase() === 'urgent' || (s.summary?.action_items?.length || 0) > 2).slice(0, 4);
  const waiting = sessions.filter((s) => (s.summary?.action_items || []).some((a) => (a.task || a.action || '').toLowerCase().includes('wait'))).slice(0, 4);
  const pendingTasks = tasks.filter(t => t.status === 'pending').slice(0, 5);

  // Insights hub data
  const activityCounts = useMemo(() => {
    const counts = { gmail: 0, calendar: 0, docs: 0, sheets: 0, drive: 0, tasks: 0 };
    activities.forEach(a => {
      const svc = a.service || 'other';
      if (counts[svc] !== undefined) counts[svc]++;
    });
    return counts;
  }, [activities]);

  const personalityScores = useMemo(() => {
    const scores = { Analytical: 0.7, 'Future-Oriented': 0.6, Structured: 0.7, Engaged: 0.5 };
    if (activityCounts.docs > 3) scores.Analytical = Math.min(scores.Analytical + 0.15, 1);
    if (activityCounts.calendar > 2) scores.Structured = Math.min(scores.Structured + 0.15, 1);
    if (sessions.length > 3) scores.Engaged = Math.min(scores.Engaged + 0.2, 1);
    if (activityCounts.sheets > 1) scores.Analytical = Math.min(scores.Analytical + 0.1, 1);
    return scores;
  }, [activityCounts, sessions]);

  const weeklyTrend = useMemo(() => {
    const trend = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dayStr = date.toDateString();
      const dayTasks = tasks.filter(t => {
        const created = new Date(t.created_at);
        return created.toDateString() === dayStr;
      });
      const completed = dayTasks.filter(t => t.status === 'completed').length;
      const total = dayTasks.length || 1;
      trend.push(Math.round((completed / total) * 100));
    }
    return trend;
  }, [tasks]);

  const habitStreak = useMemo(() => {
    let streak = 0;
    const now = new Date();
    for (let i = 0; i < 30; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dayStr = date.toDateString();
      const hasActivity = sessions.some(s => new Date(s.created_at).toDateString() === dayStr) ||
        activities.some(a => {
          try { return new Date(parseInt(String(a._id).substring(0, 8), 16) * 1000).toDateString() === dayStr; }
          catch { return false; }
        });
      if (hasActivity) streak++;
      else break;
    }
    return streak;
  }, [sessions, activities]);

  const personalityType = useMemo(() => {
    const top = Object.entries(personalityScores).sort((a, b) => b[1] - a[1])[0][0];
    if (top === 'Analytical') return 'The Strategist';
    if (top === 'Structured') return 'The Architect';
    if (top === 'Engaged') return 'The Collaborator';
    return 'The Visionary';
  }, [personalityScores]);

  // Focus hub data: derive title from recent sessions or pending tasks
  const focusTitle = useMemo(() => {
    if (pendingTasks.length > 0) return pendingTasks[0].title || 'Current Focus';
    if (sessions.length > 0) return sessions[0].title || 'Hackathon Research';
    return 'Hackathon Research';
  }, [pendingTasks, sessions]);

  const hubIds = ['productivity', 'deep-work', 'comms', 'events', 'insights', 'priority', 'recent', 'waiting'];
  const hubCenters = hubIds.map((id) => {
    const pos = hubPositions[id] || DEFAULT_POSITIONS[id] || { x: 100, y: 100 };
    const size = id === 'productivity' ? PRODUCTIVITY_HUB_SIZE
      : id === 'insights' ? INSIGHTS_HUB_SIZE
      : id === 'events' ? EVENTS_HUB_SIZE
      : HUB_SIZE;
    return {
      id,
      x: pos.x + size.width / 2,
      y: pos.y + size.height / 2,
    };
  });

  if (loading) {
    return (
      <div className="sessions-container">
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mosaic-field mosaic-whiteboard stitch-mosaic">
      {/* Stitch: top-center search */}
      <div className="mosaic-search-bar glass">
        <span className="mosaic-search-icon" aria-hidden>⌕</span>
        <input
          type="text"
          className="mosaic-search-input"
          placeholder="Search your canvas..."
          value={canvasSearch}
          onChange={(e) => setCanvasSearch(e.target.value)}
        />
        <button type="button" className="mosaic-search-mic" title="Voice search" aria-label="Voice search">🎤</button>
        <button type="button" className="mosaic-search-ai" title="AI">AI</button>
      </div>

      {/* Stitch: left zoom + Big Picture */}
      <div className="mosaic-zoom-controls glass">
        <button type="button" className="mosaic-zoom-btn" onClick={handleZoomIn} aria-label="Zoom in">+</button>
        <div className="mosaic-zoom-divider" />
        <button type="button" className="mosaic-zoom-btn" onClick={handleZoomOut} aria-label="Zoom out">−</button>
        <div className="mosaic-zoom-divider" />
        <span className="mosaic-zoom-label">{Math.round(scale * 100)}%</span>
        <div className="mosaic-zoom-divider" />
        <button type="button" className="mosaic-zoom-btn big-picture-btn" onClick={handleBigPicture} title="Big Picture">⊞</button>
      </div>

      <div
        className="mosaic-canvas-wrapper"
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: isPanning.current ? 'grabbing' : 'grab' }}
      >
        <div
          className="mosaic-canvas-world"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {/* Neural lines: glowing connections between hubs (update with hub positions) */}
          <svg className="mosaic-neural-lines" width={2000} height={1500} viewBox="0 0 2000 1500">
            <defs>
              <linearGradient id="neuralGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(139, 92, 246, 0.7)" />
                <stop offset="100%" stopColor="rgba(99, 102, 241, 0.7)" />
              </linearGradient>
              <filter id="neuralGlow">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {NEURAL_EDGES.map(([fromId, toId]) => {
              const from = hubCenters.find(h => h.id === fromId);
              const to = hubCenters.find(h => h.id === toId);
              if (!from || !to) return null;
              return (
                <line
                  key={`line-${fromId}-${toId}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className="mosaic-neural-line"
                  stroke="url(#neuralGrad)"
                  strokeWidth="1.5"
                  strokeOpacity="0.5"
                  filter="url(#neuralGlow)"
                />
              );
            })}
          </svg>

          {/* Draggable hub cards */}
          {hubIds.map((hubId) => {
            const pos = hubPositions[hubId] || DEFAULT_POSITIONS[hubId] || { x: 100, y: 100 };
            const isProductivity = hubId === 'productivity';
            const isInsights = hubId === 'insights';
            const isEvents = hubId === 'events';
            const size = isProductivity ? PRODUCTIVITY_HUB_SIZE
              : isInsights ? INSIGHTS_HUB_SIZE
              : isEvents ? EVENTS_HUB_SIZE
              : HUB_SIZE;

            return (
              <Draggable
                key={hubId}
                position={pos}
                onStart={() => {}}
                onDrag={(e, data) => handleHubDrag(hubId, e, data)}
                onStop={(e, data) => handleHubDragStop(hubId, e, data)}
                cancel=".mosaic-hub-expand-btn, .mosaic-item, .mosaic-task-item"
                bounds={false}
              >
                <div
                  className={`mosaic-hub-card glassmorphic ${isProductivity ? 'productivity-hub' : ''} ${isInsights ? 'insights-hub' : ''} ${isEvents ? 'events-hub' : ''}`}
                  style={{ width: size.width, height: size.height }}
                  onClick={() => setExpandedHubId(hubId)}
                >
                  {hubId === 'productivity' && (
                    <>
                      <div className="hub-badge">PRODUCTIVITY</div>
                      <div className="productivity-score-ring">
                        <svg viewBox="0 0 100 100" className="score-svg">
                          <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(139, 92, 246, 0.2)" strokeWidth="8" />
                          <circle
                            cx="50" cy="50" r="40" fill="none"
                            stroke="url(#scoreGrad)" strokeWidth="8"
                            strokeDasharray={`${productivityScore * 2.51} 251`}
                            strokeLinecap="round"
                            transform="rotate(-90 50 50)"
                          />
                          <defs>
                            <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor="#8b5cf6" />
                              <stop offset="100%" stopColor="#6366f1" />
                            </linearGradient>
                          </defs>
                        </svg>
                        <span className="score-value">{productivityScore}%</span>
                      </div>
                      <div className="productivity-stats">
                        <div className="stat-row">
                          <span className="stat-label">Tasks Done</span>
                          <span className="stat-value">{completedTasks}/{totalTasks}</span>
                        </div>
                        <div className="stat-row">
                          <span className="stat-label">Sessions</span>
                          <span className="stat-value">{sessions.length}</span>
                        </div>
                      </div>
                    </>
                  )}
                  {hubId === 'deep-work' && (
                    <>
                      <div className="hub-badge">DEEP WORK</div>
                      <h3>{focusTitle}</h3>
                      <p className="hub-subtitle">{pendingTasks.length > 0 ? `${pendingTasks.length} tasks in focus` : 'No active focus'}</p>
                      <div className="hub-progress">
                        <div className="progress-bar-mini">
                          <div className="progress-fill" style={{ width: `${productivityScore}%` }} />
                        </div>
                        <span className="progress-label">{productivityScore}%</span>
                      </div>
                      {pendingTasks.slice(0, 2).map((t, i) => (
                        <div key={t._id || i} className="mosaic-task-item">
                          <span className="task-status-dot pending" />
                          <span className="task-text">{t.title}</span>
                        </div>
                      ))}
                    </>
                  )}
                  {hubId === 'comms' && (
                    <>
                      <div className="hub-badge comms">COMMS HUB</div>
                      {!getStoredToken() ? (
                        <p className="comms-sign-in mosaic-muted">Sign in with Google to see Gmail and Calendar</p>
                      ) : (
                        <>
                          <div className="comms-section">
                            <div className="comms-label">Gmail</div>
                            <span className="comms-badge new">
                              {commsLoading && gmailUnread == null ? '…' : (gmailUnread != null ? gmailUnread : gmailCount)} unread
                            </span>
                          </div>
                          {gmailSummary && (
                            <div className="comms-gemini-card">
                              <div className="comms-gemini-label">Important from today (Gemini)</div>
                              <p className="comms-gemini-text">{gmailSummary}</p>
                            </div>
                          )}
                          {whatToDo && (
                            <div className="comms-gemini-card what-to-do">
                              <div className="comms-gemini-label">What you should do</div>
                              <p className="comms-gemini-text">{whatToDo}</p>
                            </div>
                          )}
                          <div className="comms-section">
                            <div className="comms-label">Upcoming</div>
                            {calendarUpcoming.length === 0 && !commsLoading ? (
                              <span className="comms-count mosaic-muted">No events</span>
                            ) : (
                              calendarUpcoming.slice(0, 3).map((ev, i) => (
                                <div key={ev.id || i} className="comms-item">
                                  <span className="comms-sender">{ev.summary}</span>
                                  <span className="comms-time">{formatCalendarStart(ev.start)}</span>
                                </div>
                              ))
                            )}
                          </div>
                        </>
                      )}
                    </>
                  )}
                  {hubId === 'insights' && (
                    <>
                      <div className="hub-badge insights">USER INSIGHTS</div>
                      <div className="insights-hub-content">
                        {/* Mini personality */}
                        <div className="insights-row">
                          <div className="insights-mini-card">
                            <span className="insights-mini-label">Personality</span>
                            <span className="insights-mini-value">{personalityType}</span>
                          </div>
                          <div className="insights-mini-card">
                            <span className="insights-mini-label">Score</span>
                            <div className="insights-mini-ring">
                              <svg viewBox="0 0 36 36" className="mini-ring-svg">
                                <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(139,92,246,0.2)" strokeWidth="3" />
                                <circle cx="18" cy="18" r="14" fill="none" stroke="#8b5cf6" strokeWidth="3"
                                  strokeDasharray={`${productivityScore * 0.88} 88`} strokeLinecap="round"
                                  transform="rotate(-90 18 18)" />
                              </svg>
                              <span className="mini-ring-val">{productivityScore}%</span>
                            </div>
                          </div>
                        </div>
                        <div className="insights-row">
                          <div className="insights-mini-card">
                            <span className="insights-mini-label">Streak</span>
                            <span className="insights-streak-val">{habitStreak}d</span>
                          </div>
                          <div className="insights-mini-card">
                            <span className="insights-mini-label">Activities</span>
                            <span className="insights-activity-count">{activities.length}</span>
                          </div>
                        </div>
                        <p className="insights-expand-hint">Click to expand</p>
                      </div>
                    </>
                  )}
                  {hubId === 'events' && (
                    <>
                      <div className="hub-badge events">EVENTS</div>
                      {!getStoredToken() ? (
                        <p className="comms-sign-in mosaic-muted">Sign in with Google to see events</p>
                      ) : (
                        <>
                          <p className="hub-subtitle">{calendarUpcoming.length} upcoming</p>
                          {calendarUpcoming.length === 0 && !commsLoading ? (
                            <p className="mosaic-muted">No upcoming events</p>
                          ) : (
                            calendarUpcoming.slice(0, 3).map((ev, i) => (
                              <div key={ev.id || i} className="comms-item">
                                <span className="comms-sender">{ev.summary}</span>
                                <span className="comms-time">{formatCalendarStart(ev.start)}</span>
                              </div>
                            ))
                          )}
                        </>
                      )}
                    </>
                  )}
                  {hubId === 'priority' && (
                    <>
                      <div className="hub-badge priority">PRIORITY</div>
                      <p>{priority.length} urgent session(s)</p>
                      {priority.slice(0, 2).map((s, i) => (
                        <div key={s.sessionId || s._id || i} className="mosaic-item">{s.title || 'Session'}</div>
                      ))}
                    </>
                  )}
                  {hubId === 'recent' && (
                    <>
                      <div className="hub-badge">RECENT</div>
                      <p>Quick access to latest</p>
                      {recent.slice(0, 3).map((s, i) => (
                        <div key={s.sessionId || s._id || i} className="mosaic-item">{s.title || 'Session'}</div>
                      ))}
                    </>
                  )}
                  {hubId === 'waiting' && (
                    <>
                      <div className="hub-badge">WAITING</div>
                      <p>Tasks pending others</p>
                      {waiting.length === 0 ? <p className="mosaic-muted">None</p> : waiting.slice(0, 2).map((s, i) => (
                        <div key={s.sessionId || s._id || i} className="mosaic-item">{s.title || 'Session'}</div>
                      ))}
                    </>
                  )}
                </div>
              </Draggable>
            );
          })}

          {/* Custom Hubs */}
          {customHubs.map((hub) => (
            <Draggable
              key={hub.id}
              position={hub.position}
              onDrag={(e, data) => handleCustomHubDrag(hub.id, data)}
              onStop={(e, data) => handleCustomHubDragStop(hub.id, data)}
              bounds={false}
            >
              <div
                className="mosaic-hub-card custom-hub glassmorphic"
                style={{ width: 260, minHeight: 140 }}
              >
                <div className="hub-badge custom">{hub.name}</div>
                <div className="hub-content">
                  {hub.tasks && hub.tasks.length > 0 ? (
                    hub.tasks.map((task, i) => (
                      <div key={i} className="mosaic-task-item">{task.title || task}</div>
                    ))
                  ) : (
                    <p className="mosaic-muted">Tasks will appear here when generated.</p>
                  )}
                </div>
              </div>
            </Draggable>
          ))}

          {/* Create New Hub button */}
          <div
            className="mosaic-create-hub glassmorphic"
            style={{ position: 'absolute', left: 620, top: 300 }}
            onClick={() => setShowCreateHub(true)}
          >
            <span className="create-hub-icon">+</span>
            <span className="create-hub-text">Create New Hub</span>
          </div>
        </div>
      </div>

      {/* Stitch: floating AI button */}
      <div className="mosaic-floating-ai" title="AI Assistant">
        <button type="button" className="mosaic-ai-btn glass" aria-label="AI Assistant">
          <span className="mosaic-ai-icon">◇</span>
        </button>
      </div>

      {/* Hub expand overlay */}
      {expandedHubId && (
        <div className="mosaic-expand-overlay" onClick={() => setExpandedHubId(null)}>
          <div className="mosaic-expand-panel glassmorphic" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="mosaic-expand-close" onClick={() => setExpandedHubId(null)}>Close</button>
            {expandedHubId === 'productivity' && (
              <>
                <h3>Productivity Overview</h3>
                <div className="expand-stats-grid">
                  <div className="expand-stat-card">
                    <span className="expand-stat-value">{productivityScore}%</span>
                    <span className="expand-stat-label">Score</span>
                  </div>
                  <div className="expand-stat-card">
                    <span className="expand-stat-value">{completedTasks}/{totalTasks}</span>
                    <span className="expand-stat-label">Tasks Done</span>
                  </div>
                  <div className="expand-stat-card">
                    <span className="expand-stat-value">{sessions.length}</span>
                    <span className="expand-stat-label">Sessions</span>
                  </div>
                  <div className="expand-stat-card">
                    <span className="expand-stat-value">{activities.length}</span>
                    <span className="expand-stat-label">Activities</span>
                  </div>
                </div>
                <h4>Recent Activity</h4>
                {activities.slice(0, 8).map((a, i) => (
                  <div key={a._id || i} className="mosaic-item">
                    <span className="task-status-dot" style={{ background: a.service === 'gmail' ? '#ea4335' : a.service === 'calendar' ? '#4285f4' : '#34a853' }} />
                    {a.description || a.action || 'Activity'} ({a.service})
                  </div>
                ))}
              </>
            )}
            {expandedHubId === 'deep-work' && (
              <>
                <h3>{focusTitle}</h3>
                <p>{pendingTasks.length} pending tasks in focus</p>
                {pendingTasks.map((t, i) => (
                  <div key={t._id || i} className="mosaic-task-item">
                    <span className="task-status-dot pending" />
                    <span className="task-text">{t.title}</span>
                  </div>
                ))}
                {pendingTasks.length === 0 && <p className="mosaic-muted">Start a session from the extension to see live progress here.</p>}
              </>
            )}
            {expandedHubId === 'priority' && (
              <>
                <h3>Priority</h3>
                <p>{priority.length} session(s) with urgent or many action items</p>
                {priority.map((s, i) => (
                  <div key={s.sessionId || s._id || i} className="mosaic-item">{s.title || 'Session'}</div>
                ))}
              </>
            )}
            {expandedHubId === 'recent' && (
              <>
                <h3>Recent</h3>
                <p>Quick access to latest sessions</p>
                {recent.map((s, i) => (
                  <div key={s.sessionId || s._id || i} className="mosaic-item">{s.title || 'Session'}</div>
                ))}
              </>
            )}
            {expandedHubId === 'waiting' && (
              <>
                <h3>Waiting</h3>
                <p>Tasks pending others</p>
                {waiting.length === 0 ? <p className="mosaic-muted">None</p> : waiting.map((s, i) => (
                  <div key={s.sessionId || s._id || i} className="mosaic-item">{s.title || 'Session'}</div>
                ))}
              </>
            )}
            {expandedHubId === 'comms' && (
              <>
                <h3>Comms Hub</h3>
                {!getStoredToken() ? (
                  <p className="mosaic-muted">Sign in with Google to see Gmail and Calendar.</p>
                ) : (
                  <>
                    <button
                      type="button"
                      className="mosaic-expand-refresh"
                      onClick={() => fetchCommsData(true)}
                      disabled={commsLoading}
                    >
                      {commsLoading ? 'Refreshing…' : 'Refresh'}
                    </button>
                    <div className="comms-section">
                      <div className="comms-label">Gmail</div>
                      <span className="comms-badge new">
                        {commsLoading && gmailUnread == null ? '…' : (gmailUnread != null ? gmailUnread : gmailCount)} unread
                      </span>
                    </div>
                    {gmailSummary && (
                      <div className="comms-gemini-card expanded">
                        <div className="comms-gemini-label">Important from today (Gemini)</div>
                        <p className="comms-gemini-text">{gmailSummary}</p>
                      </div>
                    )}
                    {whatToDo && (
                      <div className="comms-gemini-card expanded what-to-do">
                        <div className="comms-gemini-label">What you should do</div>
                        <p className="comms-gemini-text">{whatToDo}</p>
                      </div>
                    )}
                    <div className="comms-section">
                      <div className="comms-label">Upcoming events</div>
                      {calendarUpcoming.length === 0 && !commsLoading ? (
                        <p className="mosaic-muted">No upcoming events</p>
                      ) : (
                        <ul className="comms-calendar-list">
                          {calendarUpcoming.map((ev, i) => (
                            <li key={ev.id || i} className="comms-item">
                              <span className="comms-sender">{ev.summary}</span>
                              <span className="comms-time">{formatCalendarStart(ev.start)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
            {expandedHubId === 'events' && (
              <>
                <h3>Upcoming Events</h3>
                {!getStoredToken() ? (
                  <p className="mosaic-muted">Sign in with Google to see your calendar.</p>
                ) : calendarUpcoming.length === 0 ? (
                  <p className="mosaic-muted">No upcoming events</p>
                ) : (
                  <ul className="comms-calendar-list">
                    {calendarUpcoming.map((ev, i) => (
                      <li key={ev.id || i} className="comms-item">
                        <span className="comms-sender">{ev.summary}</span>
                        <span className="comms-time">{formatCalendarStart(ev.start)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {expandedHubId === 'insights' && (
              <div className="insights-expanded">
                <h3>User Insights</h3>
                <div className="insights-grid">
                  {/* Personality Card */}
                  <div className="insight-card personality-insight">
                    <span className="insight-card-label">User Personality:</span>
                    <h4 className="insight-personality-type">{personalityType}</h4>
                    <div className="insight-radar">
                      <svg viewBox="0 0 200 200" className="radar-svg-expanded">
                        <polygon points="100,20 170,60 170,140 100,180 30,140 30,60" fill="none" stroke="rgba(139,92,246,0.3)" strokeWidth="1" />
                        <polygon points="100,40 155,70 155,130 100,160 45,130 45,70" fill="none" stroke="rgba(139,92,246,0.2)" strokeWidth="1" />
                        <polygon points="100,60 140,80 140,120 100,140 60,120 60,80" fill="none" stroke="rgba(139,92,246,0.1)" strokeWidth="1" />
                        <polygon
                          points={`100,${20 + (1 - personalityScores.Analytical) * 80} ${100 + personalityScores['Future-Oriented'] * 70},${60 + (1 - personalityScores['Future-Oriented']) * 40} ${100 + personalityScores.Structured * 70},${140 - (1 - personalityScores.Structured) * 40} 100,${180 - (1 - personalityScores.Engaged) * 80} ${100 - personalityScores.Structured * 70},${140 - (1 - personalityScores.Structured) * 40} ${100 - personalityScores['Future-Oriented'] * 70},${60 + (1 - personalityScores['Future-Oriented']) * 40}`}
                          fill="rgba(139,92,246,0.3)" stroke="#8b5cf6" strokeWidth="2"
                        />
                        {Object.values(personalityScores).map((v, i) => {
                          const angles = [270, 330, 30, 90, 150, 210];
                          const rad = (angles[i] * Math.PI) / 180;
                          const r = 20 + v * 60;
                          return <circle key={i} cx={100 + Math.cos(rad) * r} cy={100 + Math.sin(rad) * r} r="3" fill="#a78bfa" />;
                        })}
                      </svg>
                      <span className="radar-lbl top">Analytical</span>
                      <span className="radar-lbl right">Future-Oriented</span>
                      <span className="radar-lbl bottom-right">Structured</span>
                      <span className="radar-lbl bottom">Engaged</span>
                    </div>
                  </div>

                  {/* Recent Activities Card */}
                  <div className="insight-card activities-insight">
                    <span className="insight-card-label">Recent Activities</span>
                    <div className="insight-activities-icons">
                      {[
                        { key: 'gmail', icon: 'M', count: activityCounts.gmail },
                        { key: 'calendar', icon: 'C', count: activityCounts.calendar },
                        { key: 'docs', icon: 'D', count: activityCounts.docs },
                        { key: 'sheets', icon: 'S', count: activityCounts.sheets },
                        { key: 'drive', icon: 'F', count: activityCounts.drive },
                        { key: 'tasks', icon: 'T', count: activityCounts.tasks },
                      ].map(svc => (
                        <div key={svc.key} className={`insight-act-icon ${svc.count > 0 ? 'active' : ''}`}>
                          <span>{svc.icon}</span>
                          {svc.count > 0 && <span className="act-count">{svc.count}</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Productivity Score Card */}
                  <div className="insight-card score-insight">
                    <span className="insight-card-label">Productivity Score: {productivityScore}/100</span>
                    <div className="insight-score-content">
                      <div className="insight-ring-wrap">
                        <svg viewBox="0 0 100 100" className="insight-ring-svg">
                          <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(139,92,246,0.2)" strokeWidth="7" />
                          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#insightProdGrad)" strokeWidth="7"
                            strokeDasharray={`${productivityScore * 2.39} 239`} strokeLinecap="round"
                            transform="rotate(-90 50 50)" />
                          <defs>
                            <linearGradient id="insightProdGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor="#8b5cf6" />
                              <stop offset="100%" stopColor="#d946ef" />
                            </linearGradient>
                          </defs>
                        </svg>
                        <span className="insight-ring-value">{productivityScore}<small>/100</small></span>
                      </div>
                      <div className="insight-trend-wrap">
                        <svg viewBox="0 0 140 50" className="insight-trend-svg">
                          <polyline
                            points={weeklyTrend.map((v, i) => `${i * 20 + 10},${48 - (v / 100) * 40}`).join(' ')}
                            fill="none" stroke="#6366f1" strokeWidth="2"
                          />
                          {weeklyTrend.map((v, i) => (
                            <circle key={i} cx={i * 20 + 10} cy={48 - (v / 100) * 40} r="2.5" fill="#6366f1" />
                          ))}
                        </svg>
                        <div className="insight-day-labels">
                          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                            <span key={i}>{d}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Focus & Habits Card */}
                  <div className="insight-card focus-insight">
                    <span className="insight-card-label">Focus & Habits</span>
                    <span className="insight-focus-sub">Deep Work Hours</span>
                    <div className="insight-heatmap">
                      {Array.from({ length: 5 }).map((_, row) => (
                        <div key={row} className="heatmap-row-exp">
                          {Array.from({ length: 7 }).map((_, col) => {
                            const intensity = Math.random() * 0.9;
                            return (
                              <div key={col} className="heatmap-cell-exp" style={{
                                backgroundColor: intensity > 0.6 ? '#d946ef' : intensity > 0.3 ? '#8b5cf6' : intensity > 0.1 ? '#6366f1' : 'rgba(99,102,241,0.15)',
                                opacity: 0.3 + intensity * 0.7
                              }} />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Habit Streak Card */}
                  <div className="insight-card streak-insight">
                    <span className="insight-card-label">Habit Streak</span>
                    <div className="insight-streak-arc">
                      <svg viewBox="0 0 100 55">
                        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="rgba(139,92,246,0.2)" strokeWidth="7" strokeLinecap="round" />
                        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="url(#arcGradExp)" strokeWidth="7" strokeLinecap="round"
                          strokeDasharray={`${Math.min(habitStreak / 7, 1) * 126} 126`} />
                        <defs>
                          <linearGradient id="arcGradExp" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#22d3ee" />
                            <stop offset="100%" stopColor="#6366f1" />
                          </linearGradient>
                        </defs>
                      </svg>
                    </div>
                    <span className="insight-streak-days">{habitStreak} Days</span>
                  </div>

                  {/* Habit Streak Lightning Card */}
                  <div className="insight-card streak-lightning-insight">
                    <span className="insight-card-label">Habit Streak</span>
                    <div className="insight-lightning-row">
                      {[1, 2, 3, 4, 5].map(i => (
                        <span key={i} className={`insight-bolt ${i <= habitStreak ? 'active' : ''}`}>&#9889;</span>
                      ))}
                    </div>
                    <span className="insight-streak-sub">Habit Streak</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Hub Modal */}
      {showCreateHub && (
        <div className="mosaic-create-modal" onClick={() => setShowCreateHub(false)}>
          <div className="create-hub-form glassmorphic" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Hub</h3>
            <p className="mosaic-muted">Enter a name for your hub. Tasks will be generated around this topic.</p>
            <input
              type="text"
              className="hub-name-input"
              placeholder="Hub name (e.g., Project Alpha, Research)..."
              value={newHubName}
              onChange={(e) => setNewHubName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateHub()}
              autoFocus
            />
            <div className="form-actions">
              <button type="button" className="cancel-btn" onClick={() => setShowCreateHub(false)}>Cancel</button>
              <button type="button" className="create-btn primary" onClick={handleCreateHub} disabled={!newHubName.trim()}>
                Create Hub
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MosaicField;
