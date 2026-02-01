import React, { useState, useEffect, useRef, useCallback } from 'react';
import SessionCard from './components/SessionCard';
import ProcessingSessionCard from './components/ProcessingSessionCard';
import AudioSessionCard from './components/AudioSessionCard';
import PrismTaskCard from './components/PrismTaskCard';
import ReelsFeed from './components/ReelsFeed';
import AvatarViewer from './components/AvatarViewer';
import SessionDetail from './components/SessionDetail';
import DashboardHalo from './components/DashboardHalo';
import './App.css';

const ADK_API_URL = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000';

function App() {
  const [sessions, setSessions] = useState([]);
  const [liveSessions, setLiveSessions] = useState([]); // Sessions from WebSocket (not saved to DB)
  const [processingSessions, setProcessingSessions] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [diagrams, setDiagrams] = useState([]);
  const [reels, setReels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeNav, setActiveNav] = useState('library');
  const [selectedSession, setSelectedSession] = useState(null);
  
  // Avatar state
  const [avatarPose, setAvatarPose] = useState(null);
  const [isAvatarLive, setIsAvatarLive] = useState(false);
  const [motionContext, setMotionContext] = useState(null);
  const [poseHistory, setPoseHistory] = useState([]);
  const avatarWsRef = useRef(null);
  
  // Dashboard WebSocket for progress updates
  const dashboardWsRef = useRef(null);
  const [dashboardConnected, setDashboardConnected] = useState(false);

  // Tick state to re-render session cards so "Xm ago" updates without refresh
  const [timeTick, setTimeTick] = useState(() => Date.now());

  // Connect to dashboard WebSocket for progress updates
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
          // Add new processing session only if no duplicate (same sessionId or title+source_url)
          setProcessingSessions(prev => {
            const hasMatch = prev.some(
              s => s.id === data.sessionId ||
                (s.title === (data.title || '') && s.source_url === (data.source_url || ''))
            );
            if (hasMatch) return prev;
            return [...prev, {
              id: data.sessionId,
              title: data.title || 'Processing Session...',
              source_url: data.source_url || '',
              duration_seconds: data.duration_seconds || 0,
              progress: 0,
              currentStep: 'transcribing',
            }];
          });
        }
        
        else if (data.type === 'SESSION_PROGRESS') {
          // Update progress for existing processing session
          setProcessingSessions(prev => prev.map(s => 
            s.id === data.sessionId 
              ? { ...s, progress: data.progress, currentStep: data.step }
              : s
          ));
        }
        
        else if (data.type === 'SESSION_RESULT') {
          // Remove from processing
          setProcessingSessions(prev => prev.filter(s => s.id !== data.sessionId));

          // Transform summary to match SessionCard expected format
          const summary = data.summary || {};
          const transformedSummary = {
            tldr: summary.tldr || summary.summary_tldr || 'No summary available',
            key_points: summary.key_points || [],
            action_items: (summary.action_items || summary.tasks || []).map(item => ({
              task: typeof item === 'string' ? item : (item.task || item.action || item),
              priority: item.priority || 'Medium'
            })),
            sentiment: summary.sentiment || 'Neutral',
            topic: summary.topic || ''
          };

          // Add the completed session to liveSessions for immediate display
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
            isLive: true, // Mark as live session for immediate display
          };

          setLiveSessions(prev => [newSession, ...prev]);
          console.log('[cue] Live session added:', data.title, 'has_video:', data.has_video, 'video_url:', data.video_url);

          // If video was generated, add to reels immediately (before MongoDB save)
          if (data.has_video && data.video_url) {
            try {
              setReels(prev => {
                try {
                  // Ensure prev is an array
                  const prevArray = Array.isArray(prev) ? prev : [];
                  
                  // Check if already exists
                  const exists = prevArray.some(r => r && r.id === data.sessionId);
                  if (exists) return prevArray;
                  
                  // Transform action_items to match ReelsFeed expected format (task.action)
                  const tasks = (transformedSummary.action_items || []).map(item => ({
                    action: item.task || item.action || item,
                    priority: item.priority || 'Medium'
                  }));
                  
                  // Add new reel with video
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
                } catch (reelError) {
                  console.error('[cue] Error adding reel to state:', reelError);
                  // Return prev (which is already an array or will be converted)
                  return Array.isArray(prev) ? prev : [];
                }
              });
              console.log('[cue] Added session to reels immediately:', data.title, 'videoUrl:', data.video_url);
            } catch (error) {
              console.error('[cue] Failed to add session to reels:', error);
            }
          }

          // Also refresh sessions from DB (session is now saved to MongoDB)
          setTimeout(() => {
            loadSessions();
          }, 2000); // Delay to ensure MongoDB save is complete

          // Refresh reels from DB to get any updates (after MongoDB save)
          if (data.has_video) {
            setTimeout(() => {
              loadReels();
            }, 2500);
          }
        }
        
        else if (data.type === 'SESSION_COMPLETE') {
          // Legacy handler - remove from processing
          setProcessingSessions(prev => prev.filter(s => s.id !== data.sessionId));
        }
        
        else if (data.type === 'SESSION_ERROR') {
          // Remove from processing on error
          setProcessingSessions(prev => prev.filter(s => s.id !== data.sessionId));
          console.error('Session processing error:', data.error);
        }
        
        else if (data.type === 'SESSION_ID_UPDATE') {
          // Update session ID after MongoDB save (temp UUID -> MongoDB ObjectId)
          setLiveSessions(prev => prev.map(s => 
            s.sessionId === data.tempSessionId 
              ? { ...s, sessionId: data.dbSessionId }
              : s
          ));
          console.log('[cue] Updated session ID:', data.tempSessionId, '->', data.dbSessionId);
        }
        
      } catch (e) {
        console.error('Failed to parse dashboard WebSocket message:', e);
      }
    };
    
    ws.onclose = () => {
      console.log('Dashboard WebSocket closed');
      setDashboardConnected(false);
      dashboardWsRef.current = null;
      // Auto-reconnect after 3 seconds
      setTimeout(connectDashboardWS, 3000);
    };
    
    ws.onerror = (error) => {
      console.error('Dashboard WebSocket error:', error);
    };
    
    dashboardWsRef.current = ws;
  }, []);

  // Define load functions before useEffect that uses them
  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      
      // Fetch from /sessions endpoint (recorded sessions) and /summaries (prism summaries)
      const [sessionsResponse, summariesResponse] = await Promise.all([
        fetch(`${ADK_API_URL}/sessions?limit=200`).catch(() => ({ ok: false, json: () => ({ sessions: [] }) })),
        fetch(`${ADK_API_URL}/summaries?limit=200`).catch(() => ({ ok: false, json: () => ({ items: [] }) }))
      ]);

      const sessionsResult = sessionsResponse.ok ? await sessionsResponse.json() : { sessions: [] };
      const summariesResult = summariesResponse.ok ? await summariesResponse.json() : { items: [] };
      
      const sessions = sessionsResult.sessions || [];
      const summaryItems = summariesResult.items || [];
      
      // Transform sessions to session card format
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
            action_items: (summary.action_items || summary.tasks || []).map(item => ({
              task: typeof item === 'string' ? item : (item.task || item.action || item),
              priority: item.priority || 'Medium'
            })),
            sentiment: summary.sentiment || 'Neutral',
            topic: summary.topic || ''
          }
        };
      });
      
      // Transform summary data to session card format (for Prism summaries)
      const transformedSummaries = summaryItems.map((item, index) => {
        const payload = item.payload || {};
        const resultData = item.result || {};
        
        // Map tasks to action_items format expected by SessionCard
        const actionItems = (resultData.tasks || []).map(task => ({
          task: task.action || task.task || task,
          priority: task.priority || 'Medium'
        }));
        
        // Extract date from MongoDB ObjectId or use provided date
        let createdAt = new Date().toISOString();
        if (item._id) {
          // Try to get date from ObjectId generation_time
          if (typeof item._id === 'object' && item._id.generation_time) {
            createdAt = new Date(item._id.generation_time * 1000).toISOString();
          } else if (item._id.$date) {
            createdAt = typeof item._id.$date === 'string' ? item._id.$date : new Date(item._id.$date).toISOString();
          } else if (typeof item._id === 'string') {
            // Extract timestamp from ObjectId string (first 8 hex chars = seconds since epoch)
            try {
              const timestamp = parseInt(item._id.substring(0, 8), 16) * 1000;
              createdAt = new Date(timestamp).toISOString();
            } catch (e) {
              // Fallback to current time
            }
          }
        }
        
        // Get duration from payload if available (for recorded sessions)
        const duration = payload.duration_seconds || payload.duration || 0;
        
        return {
          sessionId: item._id?.$oid || item._id || `summary-${index}`,
          title: payload.title || 'Untitled Summary',
          source_url: payload.source_url || '',
          transcript: payload.text || '',
          duration_seconds: duration,
          created_at: createdAt,
          summary: {
            tldr: resultData.summary_tldr || 'No summary available',
            key_points: resultData.key_points || [],
            action_items: actionItems,
            sentiment: resultData.sentiment || 'Neutral', // Use actual sentiment from Gemini
            topic: resultData.topic || ''
          }
        };
      });
      
      // Combine sessions and summaries, sort by date (newest first)
      const allTransformed = [...transformedSessions, ...transformedSummaries].sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateB - dateA;
      });
      
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
      console.error('Error loading summaries:', error);
      setSummaries([]);
    }
  }, []);

  const loadDiagrams = useCallback(async () => {
    try {
      const response = await fetch(`${ADK_API_URL}/diagrams?limit=20`);
      const result = await response.json();
      setDiagrams(result.items || []);
    } catch (error) {
      console.error('Error loading diagrams:', error);
      setDiagrams([]);
    }
  }, []);

  const loadReels = useCallback(async () => {
    try {
      const response = await fetch(`${ADK_API_URL}/reels?limit=50`);
      
      if (!response.ok) {
        console.warn(`[cue] Failed to load reels: HTTP ${response.status}`);
        return; // Don't update reels on error
      }
      
      const result = await response.json();
      const dbReels = result?.reels || [];
      
      // Merge with existing reels (preserve live reels that haven't been saved yet)
      setReels(prev => {
        try {
          const reelMap = new Map();
          
          // Add DB reels first (they have MongoDB IDs)
          if (Array.isArray(dbReels)) {
            dbReels.forEach(reel => {
              if (reel && reel.id) {
                reelMap.set(reel.id, reel);
              }
            });
          }
          
          // Add live reels that aren't in DB yet (by checking if ID doesn't exist in DB reels)
          if (Array.isArray(prev)) {
            prev.forEach(reel => {
              if (reel && reel.id && !reelMap.has(reel.id)) {
                reelMap.set(reel.id, reel);
              }
            });
          }
          
          return Array.from(reelMap.values()).sort((a, b) => {
            const timeA = a?.timestamp || 0;
            const timeB = b?.timestamp || 0;
            return timeB - timeA; // Newest first
          });
        } catch (mergeError) {
          console.error('[cue] Error merging reels:', mergeError);
          return prev || []; // Return previous state on merge error
        }
      });
    } catch (error) {
      console.error('[cue] Error loading reels:', error);
      // Don't clear reels on error - preserve existing ones
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadSummaries();
    loadDiagrams();
    loadReels();
    connectDashboardWS();
    
    // Refresh sessions more frequently to catch new recordings
    const sessionInterval = setInterval(loadSessions, 5000);
    const memoryInterval = setInterval(() => {
      loadSummaries();
      loadDiagrams();
      loadReels();
    }, 5000);
    
    return () => {
      clearInterval(sessionInterval);
      clearInterval(memoryInterval);
      if (avatarWsRef.current) {
        avatarWsRef.current.close();
      }
      if (dashboardWsRef.current) {
        dashboardWsRef.current.close();
      }
    };
  }, [connectDashboardWS, loadSessions, loadSummaries, loadDiagrams, loadReels]);

  // Update timings on cards every 60s so "Xm ago" updates without refresh
  useEffect(() => {
    const id = setInterval(() => setTimeTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  // WebSocket connection for live avatar updates
  const connectAvatarWS = useCallback(() => {
    if (avatarWsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_URL}/ws/puppeteer`);
    
    ws.onopen = () => {
      console.log('Avatar WebSocket connected');
      setIsAvatarLive(true);
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pose') {
          setAvatarPose(data);
          setMotionContext(data.context || null);
          setPoseHistory(prev => [...prev.slice(-19), { ...data, timestamp: Date.now() }]);
        } else if (data.type === 'motion') {
          setMotionContext(data.context || null);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };
    
    ws.onclose = () => {
      console.log('Avatar WebSocket closed');
      setIsAvatarLive(false);
      avatarWsRef.current = null;
    };
    
    ws.onerror = (error) => {
      console.error('Avatar WebSocket error:', error);
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
      if (!data.error) {
        setAvatarPose(data);
      }
    } catch (error) {
      console.error('Error loading preset pose:', error);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [filter, searchQuery, loadSessions]);

  const handleRecordNew = () => {
    // Open instructions for using the extension
    alert('Use the cue extension on any webpage to record a session.\n\nClick "Start Session" in the floating halo strip.');
  };

  const handleDeleteSession = async (sessionId) => {
    if (!sessionId) return;

    try {
      // Try to delete from backend
      const response = await fetch(`${ADK_API_URL}/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Remove from local state
        setSessions(prev => prev.filter(s => s.sessionId !== sessionId && s._id !== sessionId));
        setLiveSessions(prev => prev.filter(s => s.sessionId !== sessionId));
        console.log('[cue] Session deleted:', sessionId);
      } else {
        console.error('[cue] Failed to delete session:', response.statusText);
      }
    } catch (error) {
      console.error('[cue] Error deleting session:', error);
      // Still remove from local state for better UX
      setSessions(prev => prev.filter(s => s.sessionId !== sessionId && s._id !== sessionId));
      setLiveSessions(prev => prev.filter(s => s.sessionId !== sessionId));
    }
  };

  // Transform reels to session format for library display
  const reelsAsSessions = (reels || []).map((reel, index) => ({
    sessionId: reel.id || `reel-${index}`,
    title: reel.title || 'Untitled Reel',
    source_url: reel.source_url || '',
    transcript: '',
    duration_seconds: 0,
    created_at: reel.created_at || new Date().toISOString(),
    isReel: true, // Mark as reel for potential styling
    summary: {
      tldr: reel.summary || 'No summary available',
      key_points: [],
      action_items: (reel.tasks || []).map(task => ({
        task: task.action || task.task || task,
        priority: task.priority || 'Medium'
      })),
      sentiment: reel.sentiment || 'Neutral',
      topic: reel.type || ''
    },
    mermaid_code: reel.mermaid_code,
    videoUrl: reel.videoUrl
  }));

  // Combine live sessions (from WebSocket), fetched sessions (from DB/API), and reels
  // Use a Set to deduplicate by sessionId/id
  const sessionMap = new Map();

  // Add live sessions first (highest priority)
  liveSessions.forEach(s => {
    const id = s.sessionId || s._id;
    if (id) sessionMap.set(id, s);
  });

  // Add regular sessions
  sessions.forEach(s => {
    const id = s.sessionId || s._id;
    if (id && !sessionMap.has(id)) {
      sessionMap.set(id, s);
    }
  });

  // Add reels (only if not already present)
  reelsAsSessions.forEach(s => {
    if (s.sessionId && !sessionMap.has(s.sessionId)) {
      sessionMap.set(s.sessionId, s);
    }
  });

  const allSessions = Array.from(sessionMap.values());

  const filteredSessions = allSessions.filter(session => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesTitle = session.title?.toLowerCase().includes(query);
      const matchesSummary = session.summary?.tldr?.toLowerCase().includes(query);
      const matchesTranscript = session.transcript?.toLowerCase().includes(query);
      
      if (!matchesTitle && !matchesSummary && !matchesTranscript) {
        return false;
      }
    }
    return true;
  });

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown date';
    
    // Handle both number (milliseconds) and string (ISO) formats
    const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
      return 'Unknown date';
    }
    
    const now = new Date();
    const diffMs = now - date;
    
    // If date is in the future (likely parsing error), show relative to now
    if (diffMs < 0) {
      return 'Just now';
    }
    
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);

    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else if (diffWeeks < 4) {
      return `${diffWeeks}w ago`;
    } else if (diffMonths < 12) {
      return `${diffMonths}mo ago`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
      {/* Dashboard Halo - Top Bar */}
      <DashboardHalo />
      
      {/* Sidebar */}
      <div className="library-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" fill="url(#logoGradSidebar)" />
              <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="12" cy="14" r="2" fill="white"/>
              <defs>
                <linearGradient id="logoGradSidebar" x1="2" y1="2" x2="22" y2="22">
                  <stop stopColor="#6366f1"/>
                  <stop offset="1" stopColor="#8b5cf6"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span className="sidebar-brand-text">cue</span>
        </div>
        
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
            <span>Library</span>
          </button>
          <button 
            className={`nav-item ${activeNav === 'avatar' ? 'active' : ''}`}
            onClick={() => setActiveNav('avatar')}
            title="Avatar Preview"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="7" r="4"/>
              <path d="M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/>
            </svg>
            <span>Avatar</span>
          </button>
          <button 
            className={`nav-item ${activeNav === 'reels' ? 'active' : ''}`}
            onClick={() => setActiveNav('reels')}
            title="Reels"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="18" rx="2"/>
              <path d="M8 21V3M16 21V3M2 12h20"/>
            </svg>
            <span>Reels</span>
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
            <span>Settings</span>
          </button>
        </div>
        <button className="nav-item record-btn" onClick={handleRecordNew} title="Record New Session">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="6" fill="white"/>
          </svg>
          <span>New Session</span>
        </button>
      </div>

      {/* Main Content */}
      <div className="library-main">
        {/* Header */}
        <header className="library-header">
          <h1 className="library-title">
            {activeNav === 'library' && 'Session Library'}
            {activeNav === 'avatar' && 'Avatar Preview'}
            {activeNav === 'reels' && 'Reels Feed'}
            {activeNav === 'settings' && 'Settings'}
          </h1>
          <div className="header-actions">
            <div className="search-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="text"
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {dashboardConnected && (
              <div className="connection-indicator connected" title="Connected to server">
                <span className="connection-dot"></span>
              </div>
            )}
          </div>
        </header>

        {/* Avatar Preview Panel */}
        {activeNav === 'avatar' && (
          <div className="sessions-container avatar-container">
            <div className="avatar-panel">
              <div className="avatar-main">
                <AvatarViewer 
                  pose={avatarPose}
                  isLive={isAvatarLive}
                  motionContext={motionContext}
                  height={500}
                />
              </div>
              <div className="avatar-controls">
                <h3>Live Connection</h3>
                <div className="control-group">
                  {!isAvatarLive ? (
                    <button className="primary-btn" onClick={connectAvatarWS}>
                      Connect Live
                    </button>
                  ) : (
                    <button className="secondary-btn" onClick={disconnectAvatarWS}>
                      Disconnect
                    </button>
                  )}
                </div>
                
                <h3>Preset Poses</h3>
                <div className="pose-buttons">
                  <button className="pose-btn" onClick={() => loadPresetPose('t_pose')}>
                    T-Pose
                  </button>
                  <button className="pose-btn" onClick={() => loadPresetPose('arms_up')}>
                    Arms Up
                  </button>
                  <button className="pose-btn" onClick={() => loadPresetPose('squat')}>
                    Squat
                  </button>
                </div>
                
                <h3>Recent Poses</h3>
                <div className="pose-history">
                  {poseHistory.length === 0 ? (
                    <p className="empty-history">No poses yet. Connect live or try a preset.</p>
                  ) : (
                    poseHistory.slice(-5).reverse().map((pose, idx) => (
                      <div 
                        key={idx} 
                        className="pose-history-item"
                        onClick={() => setAvatarPose(pose)}
                      >
                        <span className="pose-time">
                          {new Date(pose.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="pose-context">{pose.context || 'general'}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeNav === 'reels' && (
          <div className="sessions-container reels-container-wrapper">
            <ReelsFeed reels={reels} />
          </div>
        )}
        
        {activeNav === 'library' && (
          <>
            {selectedSession ? (
              <SessionDetail
                session={selectedSession}
                onBack={() => setSelectedSession(null)}
                formatDate={formatDate}
                formatDuration={formatDuration}
              />
            ) : (
              /* Sessions Grid */
              <div className="sessions-container">
                <div className="section-header">
                  <h2 className="sections-title">Past Digital Sessions</h2>
                  <span className="session-count">
                    {filteredSessions.length + processingSessions.length} sessions
                  </span>
                  {/* timeTick triggers re-render so formatDate "Xm ago" updates every 60s */}
                  <span aria-hidden="true" style={{ display: 'none' }}>{timeTick}</span>
                </div>
                
                {loading && processingSessions.length === 0 && filteredSessions.length === 0 ? (
                  <div className="loading-state">
                    <div className="spinner"></div>
                    <p>Loading sessions...</p>
                  </div>
                ) : (
                  <div className="sessions-grid">
                    {/* Processing Sessions (at the top) */}
                    {processingSessions.map((session) => (
                      <ProcessingSessionCard
                        key={session.id}
                        session={session}
                        formatDuration={formatDuration}
                      />
                    ))}

                  {/* Completed Session Cards */}
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

                  {/* New Session Card */}
                  <div className="session-card new-session-card" onClick={handleRecordNew}>
                    <div className="new-session-icon">+</div>
                    <div className="new-session-text">Record New Session</div>
                  </div>

                  {filteredSessions.length === 0 && processingSessions.length === 0 && !loading && (
                    <div className="empty-state">
                      <div className="empty-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <circle cx="12" cy="12" r="10"/>
                          <path d="M8 12h8M12 8v8"/>
                        </svg>
                      </div>
                      <h3>No Sessions Yet</h3>
                      <p>Use the cue extension to record your first session</p>
                      <button className="primary-btn" onClick={handleRecordNew}>
                        How to Record
                      </button>
                    </div>
                  )}
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
                    diagrams.map((diagram, idx) => (
                      <AudioSessionCard key={diagram._id || idx} session={diagram} />
                    ))
                  )}
                </div>
                <div className="memory-section">
                  <h3>Prism Summaries</h3>
                  {summaries.length === 0 ? (
                    <p className="empty-memory">No summaries generated yet</p>
                  ) : (
                    summaries.map((summary, idx) => (
                      <PrismTaskCard key={summary._id || idx} summary={summary} />
                    ))
                  )}
                </div>
              </div>
              </div>
            )}
          </>
        )}

        {activeNav === 'settings' && (
          <div className="sessions-container settings-container">
            <div className="settings-section">
              <h3>API Configuration</h3>
              <p className="settings-info">Backend URL: {ADK_API_URL}</p>
              <p className="settings-info">
                WebSocket Status: {dashboardConnected ? '✓ Connected' : '○ Disconnected'}
              </p>
            </div>
            <div className="settings-section">
              <h3>About cue</h3>
              <p className="settings-info">
                cue is an intelligent session recording and analysis tool powered by Gemini AI.
                Record any web content, get automatic transcriptions, and AI-generated summaries.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* AI Processing Toast */}
      {processingSessions.length > 0 && (
        <div className="ai-toast">
          <div className="toast-icon">✨</div>
          <div className="toast-content">
            <div className="toast-title">AI is organizing {processingSessions.length} new session{processingSessions.length > 1 ? 's' : ''}</div>
            <div className="toast-subtitle">
              Processing audio for '{processingSessions[0]?.title || 'Session'}'
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
