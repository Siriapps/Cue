import React, { useState, useEffect, useRef, useCallback } from 'react';
import Draggable from 'react-draggable';
import { config } from '../config';
import { getStoredToken } from '../auth/googleAuth';

const ADK_API_URL = config.API_BASE_URL;
const MOSAIC_LAYOUT_KEY = 'cue_mosaic_layout';
const HUB_SIZE = { width: 280, height: 200 };
const PRODUCTIVITY_HUB_SIZE = { width: 220, height: 260 };
// Spread out positions for larger canvas (2000x1500)
const DEFAULT_POSITIONS = {
  'productivity': { x: 80, y: 80 },
  'deep-work': { x: 450, y: 120 },
  'comms': { x: 850, y: 80 },
  'priority': { x: 450, y: 420 },
  'recent': { x: 120, y: 450 },
  'waiting': { x: 780, y: 420 },
};

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
  const [pan, setPan] = useState({ x: 0, y: 0 });
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
  const calendarCount = activities.filter(a => a.service === 'calendar').length;
  const docsCount = activities.filter(a => a.service === 'docs').length;

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

  const fetchCommsData = useCallback(() => {
    const token = getStoredToken();
    if (!token) return;
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
        setCalendarUpcoming(Array.isArray(data.calendar_upcoming) ? data.calendar_upcoming : []);
      })
      .catch(() => {
        setGmailUnread(null);
        setGmailSummary(null);
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
      if (document.visibilityState === 'visible') fetchCommsData();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
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
  const recentActivities = activities.slice(0, 5);

  const hubIds = ['productivity', 'deep-work', 'comms', 'priority', 'recent', 'waiting'];
  const hubCenters = hubIds.map((id) => {
    const pos = hubPositions[id] || DEFAULT_POSITIONS[id] || { x: 100, y: 100 };
    const size = id === 'productivity' ? PRODUCTIVITY_HUB_SIZE : HUB_SIZE;
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
          <svg className="mosaic-neural-lines" width={800} height={600} viewBox="0 0 800 600">
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
            {hubCenters.map((curr, i) => {
              const next = hubCenters[(i + 1) % hubCenters.length];
              return (
                <line
                  key={`line-${curr.id}-${next.id}`}
                  x1={curr.x}
                  y1={curr.y}
                  x2={next.x}
                  y2={next.y}
                  className="mosaic-neural-line"
                  stroke="url(#neuralGrad)"
                  strokeWidth="1.5"
                  strokeOpacity="0.7"
                  filter="url(#neuralGlow)"
                />
              );
            })}
          </svg>

          {/* Draggable hub cards */}
          {hubIds.map((hubId) => {
            const pos = hubPositions[hubId] || DEFAULT_POSITIONS[hubId] || { x: 100, y: 100 };
            const isProductivity = hubId === 'productivity';
            const size = isProductivity ? PRODUCTIVITY_HUB_SIZE : HUB_SIZE;

            return (
              <Draggable
                key={hubId}
                position={pos}
                onStart={() => {}}
                onDrag={(e, data) => handleHubDrag(hubId, e, data)}
                onStop={(e, data) => handleHubDragStop(hubId, e, data)}
                cancel=".mosaic-hub-expand-btn, .mosaic-item, .mosaic-task-item"
                bounds="parent"
              >
                <div
                  className={`mosaic-hub-card glassmorphic ${isProductivity ? 'productivity-hub' : ''}`}
                  style={{ width: size.width, height: size.height }}
                  onClick={() => !isProductivity && setExpandedHubId(hubId)}
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
                      <h3>Hackathon Research</h3>
                      <p className="hub-subtitle">Phase 3: Execution & Development</p>
                      <div className="hub-progress">
                        <div className="progress-bar-mini">
                          <div className="progress-fill" style={{ width: '65%' }} />
                        </div>
                        <span className="progress-label">65%</span>
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
              bounds="parent"
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
            {expandedHubId === 'deep-work' && (
              <>
                <h3>Deep Work</h3>
                <p>Current focus and live progress</p>
                <p className="mosaic-muted">Start a session from the extension to see live progress here.</p>
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
