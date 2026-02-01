import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';

// Components
import SessionCard from './components/SessionCard';
import ProcessingSessionCard from './components/ProcessingSessionCard';
import AudioSessionCard from './components/AudioSessionCard';
import PrismTaskCard from './components/PrismTaskCard';
import ReelsFeed from './components/ReelsFeed';
import AvatarViewer from './components/AvatarViewer';
import SessionDetail from './components/SessionDetail';

// Pages
import Landing from './pages/Landing';
import Login from './pages/Login';
import GoogleActivity from './pages/GoogleActivity';
import MosaicField from './pages/MosaicField';
import DailyOrbit from './pages/DailyOrbit';

// Layout
import DashboardLayout from './layouts/DashboardLayout';

// Auth
import { getStoredUser, storeAuth, handleOAuthRedirect } from './auth/googleAuth';

import './App.css';

const ADK_API_URL = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000';

function App() {
  // Auth state
  const [user, setUser] = useState(() => getStoredUser());
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!getStoredUser());

  // Session state
  const [sessions, setSessions] = useState([]);
  const [liveSessions, setLiveSessions] = useState([]);
  const [processingSessions, setProcessingSessions] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [diagrams, setDiagrams] = useState([]);
  const [reels, setReels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSession, setSelectedSession] = useState(null);

  // Avatar state
  const [avatarPose, setAvatarPose] = useState(null);
  const [isAvatarLive, setIsAvatarLive] = useState(false);
  const [motionContext, setMotionContext] = useState(null);
  const [poseHistory, setPoseHistory] = useState([]);
  const avatarWsRef = useRef(null);

  // Dashboard WebSocket
  const dashboardWsRef = useRef(null);
  const [dashboardConnected, setDashboardConnected] = useState(false);

  // Time tick for updating relative times
  const [timeTick, setTimeTick] = useState(() => Date.now());

  const navigate = useNavigate();

  // Handle OAuth redirect on mount
  useEffect(() => {
    const oauthResult = handleOAuthRedirect();
    if (oauthResult) {
      // Fetch user info with the token
      fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${oauthResult.accessToken}` },
      })
        .then((res) => res.json())
        .then((userData) => {
          const user = {
            id: userData.id,
            email: userData.email,
            name: userData.name,
            picture: userData.picture,
          };
          storeAuth(oauthResult.accessToken, user, oauthResult.expiresIn);
          setUser(user);
          setIsAuthenticated(true);
          navigate('/library');
        })
        .catch((err) => {
          console.error('[cue] OAuth error:', err);
          navigate('/login');
        });
    }
  }, [navigate]);

  // Dashboard WebSocket connection
  const connectDashboardWS = useCallback(() => {
    if (dashboardWsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_URL}/ws/dashboard`);

    ws.onopen = () => {
      console.log('Dashboard WebSocket connected');
      setDashboardConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'SESSION_PROCESSING_START') {
          setProcessingSessions((prev) => {
            const hasMatch = prev.some(
              (s) =>
                s.id === data.sessionId ||
                (s.title === (data.title || '') && s.source_url === (data.source_url || ''))
            );
            if (hasMatch) return prev;
            return [
              ...prev,
              {
                id: data.sessionId,
                title: data.title || 'Processing Session...',
                source_url: data.source_url || '',
                duration_seconds: data.duration_seconds || 0,
                progress: 0,
                currentStep: 'transcribing',
              },
            ];
          });
        } else if (data.type === 'SESSION_PROGRESS') {
          setProcessingSessions((prev) =>
            prev.map((s) =>
              s.id === data.sessionId ? { ...s, progress: data.progress, currentStep: data.step } : s
            )
          );
        } else if (data.type === 'SESSION_RESULT') {
          setProcessingSessions((prev) => prev.filter((s) => s.id !== data.sessionId));

          const summary = data.summary || {};
          const transformedSummary = {
            tldr: summary.tldr || summary.summary_tldr || 'No summary available',
            key_points: summary.key_points || [],
            action_items: (summary.action_items || summary.tasks || []).map((item) => ({
              task: typeof item === 'string' ? item : item.task || item.action || item,
              priority: item.priority || 'Medium',
            })),
            sentiment: summary.sentiment || 'Neutral',
            topic: summary.topic || '',
          };

          const newSession = {
            sessionId: data.sessionId,
            title: data.title,
            source_url: data.source_url,
            duration_seconds: data.duration_seconds,
            transcript: data.transcript || '',
            summary: transformedSummary,
            video_url: data.video_url || null,
            has_video: data.has_video || !!data.video_url,
            created_at: data.created_at || new Date().toISOString(),
            isLive: true,
          };

          setLiveSessions((prev) => [newSession, ...prev]);

          if (data.has_video && data.video_url) {
            setReels((prev) => {
              const prevArray = Array.isArray(prev) ? prev : [];
              const exists = prevArray.some((r) => r && r.id === data.sessionId);
              if (exists) return prevArray;

              const tasks = (transformedSummary.action_items || []).map((item) => ({
                action: item.task || item.action || item,
                priority: item.priority || 'Medium',
              }));

              const newReel = {
                id: data.sessionId,
                type: 'video_summary',
                title: data.title || 'Untitled Session',
                summary: transformedSummary.tldr || 'No summary available',
                sentiment: transformedSummary.sentiment || 'Neutral',
                tasks: tasks,
                key_points: transformedSummary.key_points || [],
                videoUrl: data.video_url,
                source_url: data.source_url || '',
                duration_seconds: data.duration_seconds || 0,
                transcript_preview: (data.transcript || '').substring(0, 200) + '...',
                timestamp: new Date(data.created_at || Date.now()).getTime(),
              };
              return [newReel, ...prevArray];
            });
          }

          setTimeout(() => loadSessions(), 2000);
          if (data.has_video) {
            setTimeout(() => loadReels(), 2500);
          }
        } else if (data.type === 'SESSION_COMPLETE' || data.type === 'SESSION_ERROR') {
          setProcessingSessions((prev) => prev.filter((s) => s.id !== data.sessionId));
        } else if (data.type === 'SESSION_ID_UPDATE') {
          setLiveSessions((prev) =>
            prev.map((s) => (s.sessionId === data.tempSessionId ? { ...s, sessionId: data.dbSessionId } : s))
          );
        } else if (data.type === 'ACTIVITY_UPDATE') {
          setLastActivityUpdate(Date.now());
        }
      } catch (e) {
        console.error('Failed to parse dashboard WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      console.log('Dashboard WebSocket closed');
      setDashboardConnected(false);
      dashboardWsRef.current = null;
      setTimeout(connectDashboardWS, 3000);
    };

    ws.onerror = (error) => {
      console.error('Dashboard WebSocket error:', error);
    };

    dashboardWsRef.current = ws;
  }, []);

  // Load sessions
  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      const [sessionsResponse, summariesResponse] = await Promise.all([
        fetch(`${ADK_API_URL}/sessions?limit=200`).catch(() => ({ ok: false, json: () => ({ sessions: [] }) })),
        fetch(`${ADK_API_URL}/summaries?limit=200`).catch(() => ({ ok: false, json: () => ({ items: [] }) })),
      ]);

      const sessionsResult = sessionsResponse.ok ? await sessionsResponse.json() : { sessions: [] };
      const summariesResult = summariesResponse.ok ? await summariesResponse.json() : { items: [] };

      const sessions = sessionsResult.sessions || [];
      const summaryItems = summariesResult.items || [];

      const transformedSessions = sessions.map((session) => {
        const summary = session.summary || {};
        return {
          sessionId: session._id?.$oid || session._id || session.sessionId,
          title: session.title || 'Untitled Session',
          source_url: session.source_url || '',
          transcript: session.transcript || '',
          duration_seconds: session.duration_seconds || 0,
          created_at: session.created_at || session._id?.$date || new Date().toISOString(),
          video_url: session.video_url || null,
          has_video: session.has_video || !!session.video_url,
          summary: {
            tldr: summary.tldr || summary.summary_tldr || 'No summary available',
            key_points: summary.key_points || [],
            action_items: (summary.action_items || summary.tasks || []).map((item) => ({
              task: typeof item === 'string' ? item : item.task || item.action || item,
              priority: item.priority || 'Medium',
            })),
            sentiment: summary.sentiment || 'Neutral',
            topic: summary.topic || '',
          },
        };
      });

      const transformedSummaries = summaryItems.map((item, index) => {
        const payload = item.payload || {};
        const resultData = item.result || {};
        const actionItems = (resultData.tasks || []).map((task) => ({
          task: task.action || task.task || task,
          priority: task.priority || 'Medium',
        }));

        let createdAt = new Date().toISOString();
        if (item._id) {
          if (typeof item._id === 'object' && item._id.generation_time) {
            createdAt = new Date(item._id.generation_time * 1000).toISOString();
          } else if (item._id.$date) {
            createdAt = typeof item._id.$date === 'string' ? item._id.$date : new Date(item._id.$date).toISOString();
          } else if (typeof item._id === 'string') {
            try {
              const timestamp = parseInt(item._id.substring(0, 8), 16) * 1000;
              createdAt = new Date(timestamp).toISOString();
            } catch (e) {}
          }
        }

        return {
          sessionId: item._id?.$oid || item._id || `summary-${index}`,
          title: payload.title || 'Untitled Summary',
          source_url: payload.source_url || '',
          transcript: payload.text || '',
          duration_seconds: payload.duration_seconds || payload.duration || 0,
          created_at: createdAt,
          summary: {
            tldr: resultData.summary_tldr || 'No summary available',
            key_points: resultData.key_points || [],
            action_items: actionItems,
            sentiment: resultData.sentiment || 'Neutral',
            topic: resultData.topic || '',
          },
        };
      });

      const allTransformed = [...transformedSessions, ...transformedSummaries].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setSessions(allTransformed);
    } catch (error) {
      console.error('Error loading sessions:', error);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSummaries = useCallback(async () => {
    try {
      const response = await fetch(`${ADK_API_URL}/summaries?limit=20`);
      const result = await response.json();
      setSummaries(result.items || []);
    } catch (error) {
      setSummaries([]);
    }
  }, []);

  const loadDiagrams = useCallback(async () => {
    try {
      const response = await fetch(`${ADK_API_URL}/diagrams?limit=20`);
      const result = await response.json();
      setDiagrams(result.items || []);
    } catch (error) {
      setDiagrams([]);
    }
  }, []);

  const loadReels = useCallback(async () => {
    try {
      const response = await fetch(`${ADK_API_URL}/reels?limit=50`);
      if (!response.ok) return;

      const result = await response.json();
      const dbReels = result?.reels || [];

      setReels((prev) => {
        const reelMap = new Map();
        if (Array.isArray(dbReels)) {
          dbReels.forEach((reel) => {
            if (reel && reel.id) reelMap.set(reel.id, reel);
          });
        }
        if (Array.isArray(prev)) {
          prev.forEach((reel) => {
            if (reel && reel.id && !reelMap.has(reel.id)) reelMap.set(reel.id, reel);
          });
        }
        return Array.from(reelMap.values()).sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
      });
    } catch (error) {
      console.error('[cue] Error loading reels:', error);
    }
  }, []);

  // Initial data load
  useEffect(() => {
    if (isAuthenticated) {
      loadSessions();
      loadSummaries();
      loadDiagrams();
      loadReels();
      connectDashboardWS();

      const sessionInterval = setInterval(loadSessions, 5000);
      const memoryInterval = setInterval(() => {
        loadSummaries();
        loadDiagrams();
        loadReels();
      }, 5000);

      return () => {
        clearInterval(sessionInterval);
        clearInterval(memoryInterval);
        if (avatarWsRef.current) avatarWsRef.current.close();
        if (dashboardWsRef.current) dashboardWsRef.current.close();
      };
    }
  }, [isAuthenticated, connectDashboardWS, loadSessions, loadSummaries, loadDiagrams, loadReels]);

  // Update time tick
  useEffect(() => {
    const id = setInterval(() => setTimeTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  // Avatar WebSocket
  const connectAvatarWS = useCallback(() => {
    if (avatarWsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_URL}/ws/puppeteer`);

    ws.onopen = () => setIsAvatarLive(true);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pose') {
          setAvatarPose(data);
          setMotionContext(data.context || null);
          setPoseHistory((prev) => [...prev.slice(-19), { ...data, timestamp: Date.now() }]);
        } else if (data.type === 'motion') {
          setMotionContext(data.context || null);
        }
      } catch (e) {}
    };
    ws.onclose = () => {
      setIsAvatarLive(false);
      avatarWsRef.current = null;
    };

    avatarWsRef.current = ws;
  }, []);

  const disconnectAvatarWS = useCallback(() => {
    if (avatarWsRef.current) {
      avatarWsRef.current.close();
      avatarWsRef.current = null;
    }
    setIsAvatarLive(false);
  }, []);

  const loadPresetPose = useCallback(async (poseName) => {
    try {
      const response = await fetch(`${ADK_API_URL}/pose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pose_name: poseName }),
      });
      const data = await response.json();
      if (!data.error) setAvatarPose(data);
    } catch (error) {}
  }, []);

  const handleDeleteSession = async (sessionId) => {
    if (!sessionId) return;
    try {
      const response = await fetch(`${ADK_API_URL}/sessions/${sessionId}`, { method: 'DELETE' });
      if (response.ok) {
        setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId && s._id !== sessionId));
        setLiveSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      }
    } catch (error) {
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId && s._id !== sessionId));
      setLiveSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    }
  };

  // Combine sessions
  const sessionMap = new Map();
  liveSessions.forEach((s) => {
    const id = s.sessionId || s._id;
    if (id) sessionMap.set(id, s);
  });
  sessions.forEach((s) => {
    const id = s.sessionId || s._id;
    if (id && !sessionMap.has(id)) sessionMap.set(id, s);
  });

  const allSessions = Array.from(sessionMap.values());
  const filteredSessions = allSessions.filter((session) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      session.title?.toLowerCase().includes(query) ||
      session.summary?.tldr?.toLowerCase().includes(query) ||
      session.transcript?.toLowerCase().includes(query)
    );
  });

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown date';
    const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
    if (isNaN(date.getTime())) return 'Unknown date';

    const now = new Date();
    const diffMs = now - date;
    if (diffMs < 0) return 'Just now';

    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Auth handlers
  const handleLogin = (userData) => {
    setUser(userData);
    setIsAuthenticated(true);
    navigate('/library');
  };

  // Protected route wrapper
  const ProtectedRoute = ({ children }) => {
    if (!isAuthenticated) {
      return <Navigate to="/login" replace />;
    }
    return (
      <DashboardLayout
        user={user}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        dashboardConnected={dashboardConnected}
      >
        {children}
      </DashboardLayout>
    );
  };

  // Library page content
  const LibraryContent = () => (
    <>
      {selectedSession ? (
        <SessionDetail
          session={selectedSession}
          onBack={() => setSelectedSession(null)}
          formatDate={formatDate}
          formatDuration={formatDuration}
        />
      ) : (
        <div className="sessions-container">
          <div className="section-header">
            <h2 className="sections-title">Past Digital Sessions</h2>
            <span className="session-count">{filteredSessions.length + processingSessions.length} sessions</span>
            <span aria-hidden="true" style={{ display: 'none' }}>{timeTick}</span>
          </div>

          {loading && processingSessions.length === 0 && filteredSessions.length === 0 ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading sessions...</p>
            </div>
          ) : (
            <div className="sessions-grid">
              {processingSessions.map((session) => (
                <ProcessingSessionCard key={session.id} session={session} formatDuration={formatDuration} />
              ))}

              {filteredSessions.map((session, index) => (
                <SessionCard
                  key={session.sessionId || session._id || index}
                  session={session}
                  formatDate={formatDate}
                  formatDuration={formatDuration}
                  onClick={setSelectedSession}
                  onDelete={handleDeleteSession}
                />
              ))}

              <div className="session-card new-session-card" onClick={() => alert('Use the cue extension to record a session.')}>
                <div className="new-session-icon">+</div>
                <div className="new-session-text">Record New Session</div>
              </div>
            </div>
          )}
        </div>
      )}

      {!selectedSession && (
        <div className="sessions-container">
          <div className="section-header">
            <h2 className="sections-title">Memory Bank</h2>
          </div>
          <div className="memory-grid">
            <div className="memory-section">
              <h3>Live Diagrams</h3>
              {diagrams.length === 0 ? (
                <p className="empty-memory">No diagrams captured yet</p>
              ) : (
                diagrams.map((diagram, idx) => <AudioSessionCard key={diagram._id || idx} session={diagram} />)
              )}
            </div>
            <div className="memory-section">
              <h3>Prism Summaries</h3>
              {summaries.length === 0 ? (
                <p className="empty-memory">No summaries generated yet</p>
              ) : (
                summaries.map((summary, idx) => <PrismTaskCard key={summary._id || idx} summary={summary} />)
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Avatar page content
  const AvatarContent = () => (
    <div className="sessions-container avatar-container">
      <div className="avatar-panel">
        <div className="avatar-main">
          <AvatarViewer pose={avatarPose} isLive={isAvatarLive} motionContext={motionContext} height={500} />
        </div>
        <div className="avatar-controls">
          <h3>Live Connection</h3>
          <div className="control-group">
            {!isAvatarLive ? (
              <button className="primary-btn" onClick={connectAvatarWS}>Connect Live</button>
            ) : (
              <button className="secondary-btn" onClick={disconnectAvatarWS}>Disconnect</button>
            )}
          </div>

          <h3>Preset Poses</h3>
          <div className="pose-buttons">
            <button className="pose-btn" onClick={() => loadPresetPose('t_pose')}>T-Pose</button>
            <button className="pose-btn" onClick={() => loadPresetPose('arms_up')}>Arms Up</button>
            <button className="pose-btn" onClick={() => loadPresetPose('squat')}>Squat</button>
          </div>

          <h3>Recent Poses</h3>
          <div className="pose-history">
            {poseHistory.length === 0 ? (
              <p className="empty-history">No poses yet. Connect live or try a preset.</p>
            ) : (
              poseHistory.slice(-5).reverse().map((pose, idx) => (
                <div key={idx} className="pose-history-item" onClick={() => setAvatarPose(pose)}>
                  <span className="pose-time">{new Date(pose.timestamp).toLocaleTimeString()}</span>
                  <span className="pose-context">{pose.context || 'general'}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // Settings page content
  const SettingsContent = () => (
    <div className="sessions-container settings-container">
      <div className="settings-section">
        <h3>API Configuration</h3>
        <p className="settings-info">Backend URL: {ADK_API_URL}</p>
        <p className="settings-info">WebSocket Status: {dashboardConnected ? 'Connected' : 'Disconnected'}</p>
      </div>
      <div className="settings-section">
        <h3>Account</h3>
        {user && (
          <div className="settings-user-info">
            <img src={user.picture} alt={user.name} className="settings-avatar" />
            <div>
              <p className="settings-info"><strong>{user.name}</strong></p>
              <p className="settings-info">{user.email}</p>
            </div>
          </div>
        )}
      </div>
      <div className="settings-section">
        <h3>About cue</h3>
        <p className="settings-info">
          cue is an intelligent session recording and analysis tool powered by Gemini AI.
        </p>
      </div>
    </div>
  );

  return (
    <>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={isAuthenticated ? <Navigate to="/library" replace /> : <Landing />} />
        <Route path="/login" element={isAuthenticated ? <Navigate to="/library" replace /> : <Login onLogin={handleLogin} />} />

        {/* Protected routes */}
        <Route path="/library" element={<ProtectedRoute><LibraryContent /></ProtectedRoute>} />
        <Route path="/avatar" element={<ProtectedRoute><AvatarContent /></ProtectedRoute>} />
        <Route path="/reels" element={<ProtectedRoute><div className="sessions-container reels-container-wrapper"><ReelsFeed reels={reels} /></div></ProtectedRoute>} />
        <Route path="/activity" element={<ProtectedRoute><GoogleActivity lastActivityUpdate={lastActivityUpdate} /></ProtectedRoute>} />
        <Route path="/mosaic" element={<ProtectedRoute><MosaicField /></ProtectedRoute>} />
        <Route path="/orbit" element={<ProtectedRoute><DailyOrbit /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><SettingsContent /></ProtectedRoute>} />

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* AI Processing Toast */}
      {processingSessions.length > 0 && (
        <div className="ai-toast">
          <div className="toast-icon">✨</div>
          <div className="toast-content">
            <div className="toast-title">AI is organizing {processingSessions.length} new session{processingSessions.length > 1 ? 's' : ''}</div>
            <div className="toast-subtitle">Processing audio for '{processingSessions[0]?.title || 'Session'}'</div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
