import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Draggable from 'react-draggable';
import { config } from '../config';
import { getStoredToken } from '../auth/googleAuth';

const ADK_API_URL = config.API_BASE_URL;
const MOSAIC_LAYOUT_KEY = 'cue_mosaic_layout';

// Hub sizes matching reference design
const FOCUS_HUB_SIZE = { width: 260, height: 260 };
const COMMS_HUB_SIZE = { width: 200, height: 200 };
const CARD_SIZE = { width: 240, height: 120 };
const TODO_SIZE = { width: 240, height: 180 };
const EVENT_CARD_SIZE = { width: 200, height: 80 };
const DATE_WIDGET_SIZE = { width: 160, height: 160 };
const DOC_CARD_SIZE = { width: 240, height: 120 };
const PRODUCTIVITY_HUB_SIZE = { width: 260, height: 300 };
const INSIGHTS_HUB_SIZE = { width: 320, height: 280 };
const ICON_SIZE = { width: 70, height: 70 };

// Default positions matching reference: Productivity center of normal view, Comms upper-middle, Today bottom-middle, Research middle-left
const DEFAULT_POSITIONS = {
  // Productivity hub (main center) – visible in center of default view
  'productivity': { x: 570, y: 370 },
  'tasks-completed': { x: 380, y: 340 },
  'insights': { x: 780, y: 180 },
  'productivity-stats': { x: 1000, y: 350 },
  'join-btn': { x: 600, y: 530 },
  'github-icon': { x: 665, y: 790 },
  // Comms hub – upper middle
  'comms': { x: 1100, y: 120 },
  'gmail-card': { x: 1300, y: 80 },
  'calendar-card': { x: 900, y: 170 },
  'doc-card': { x: 900, y: 350 },
  // Today hub – bottom middle
  'today-date': { x: 620, y: 820 },
  'todo': { x: 380, y: 860 },
  'work-patterns': { x: 590, y: 1010 },
  'today-events': { x: 800, y: 780 },
  // Hackathon / Research hub – middle left
  'hackathon': { x: 200, y: 420 },
  'hackathon-count': { x: 90, y: 430 },
  'hackathon-done': { x: 40, y: 540 },
  'hackathon-suggested': { x: 460, y: 540 },
};

// Neural edges: hub center to its cards only (match reference layout)
const NEURAL_EDGES = [
  ['productivity', 'insights'],
  ['productivity', 'tasks-completed'],
  ['productivity', 'productivity-stats'],
  ['comms', 'gmail-card'],
  ['comms', 'calendar-card'],
  ['comms', 'doc-card'],
  ['today-date', 'todo'],
  ['today-date', 'work-patterns'],
  ['today-date', 'today-events'],
  ['hackathon', 'hackathon-count'],
  ['hackathon', 'hackathon-done'],
  ['hackathon', 'hackathon-suggested'],
];

// Loading steps for the workspace preparation animation
const LOADING_STEPS = [
  { key: 'connect', label: 'Connecting to workspace...', icon: '🔌' },
  { key: 'sessions', label: 'Loading your sessions...', icon: '📋' },
  { key: 'tasks', label: 'Fetching your tasks...', icon: '✓' },
  { key: 'activity', label: 'Checking recent activity...', icon: '📊' },
  { key: 'comms', label: 'Syncing inbox & calendar...', icon: '📬' },
  { key: 'canvas', label: 'Preparing your canvas...', icon: '✨' },
];

function MosaicField() {
  const [sessions, setSessions] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [activities, setActivities] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0);
  const [loadingComplete, setLoadingComplete] = useState(() => {
    // Only show loading on first visit or page refresh
    return !!sessionStorage.getItem('cue_workspace_loaded');
  });
  const [hubPositions, setHubPositions] = useState(() => {
    try {
      const raw = localStorage.getItem(MOSAIC_LAYOUT_KEY);
      if (raw) return { ...DEFAULT_POSITIONS, ...JSON.parse(raw) };
    } catch (e) {}
    return { ...DEFAULT_POSITIONS };
  });
  const [pan, setPan] = useState(() => {
    try {
      if (!localStorage.getItem(MOSAIC_LAYOUT_KEY)) {
        const center = DEFAULT_POSITIONS.productivity || DEFAULT_POSITIONS.focus;
        return { x: -(center.x || 680) - FOCUS_HUB_SIZE.width / 2 + 500, y: -(center.y || 480) - FOCUS_HUB_SIZE.height / 2 + 350 };
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
  const [workPatternsFromComms, setWorkPatternsFromComms] = useState([]);
  const [commsLoading, setCommsLoading] = useState(false);
  const canvasRef = useRef(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  // Format calendar time
  function formatCalendarTime(start) {
    if (!start) return '';
    const dt = start.dateTime || (start.date ? start.date + 'T00:00:00Z' : null);
    if (!dt) return '';
    const d = new Date(dt);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function formatCalendarFull(start) {
    if (!start) return '';
    const dt = start.dateTime || (start.date ? start.date + 'T00:00:00Z' : null);
    if (!dt) return '';
    const d = new Date(dt);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  // Computed values
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const totalTasks = tasks.length;
  const productivityScore = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const gmailCount = activities.filter(a => a.service === 'gmail').length;
  const pendingTasks = tasks.filter(t => t.status === 'pending').slice(0, 5);
  const completedTasksList = useMemo(() => tasks.filter(t => t.status === 'completed').slice(0, 5), [tasks]);

  // Today's events (filter calendar by today)
  const todayEvents = useMemo(() => {
    const todayStr = new Date().toDateString();
    return (calendarUpcoming || []).filter(ev => {
      const dt = ev.start?.dateTime || ev.start?.date;
      if (!dt) return false;
      return new Date(dt).toDateString() === todayStr;
    });
  }, [calendarUpcoming]);

  // Work patterns: from comms (backend) if available, else from activity
  const workPatterns = useMemo(() => {
    if (workPatternsFromComms && workPatternsFromComms.length > 0) {
      return workPatternsFromComms;
    }
    const counts = {};
    activities.forEach(a => {
      const s = a.service || 'other';
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  }, [activities, workPatternsFromComms]);

  // Hackathon-related tasks (keyword match)
  const HACKATHON_KEYWORDS = ['hackathon', 'project', 'build', 'api', 'research', 'demo', 'prototype'];
  const hackathonTasks = useMemo(() => {
    const match = (t) => {
      const text = ((t.title || '') + ' ' + (t.description || '')).toLowerCase();
      return HACKATHON_KEYWORDS.some(kw => text.includes(kw));
    };
    const suggested = tasks.filter(t => (t.status === 'pending' || t.status === 'in_progress') && match(t));
    const done = tasks.filter(t => t.status === 'completed' && match(t));
    return { suggested, done, total: suggested.length + done.length };
  }, [tasks]);

  // Productivity phase (for main hub)
  const focusPhase = useMemo(() => {
    const pending = tasks.filter(t => t.status === 'pending').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    if (completed > 10) return 'BUILD PHASE';
    if (pending > 5) return 'PLANNING PHASE';
    return 'RESEARCH PHASE';
  }, [tasks]);

  // Doc card: most recent doc activity or session
  const latestDoc = useMemo(() => {
    const docActivity = activities.find(a => a.service === 'docs');
    if (docActivity) {
      return {
        title: docActivity.details?.title || 'Document',
        description: docActivity.details?.content?.substring(0, 80) || 'Recent document',
      };
    }
    if (sessions.length > 0) {
      return { title: sessions[0].title || 'API Specs', description: sessions[0].summary?.tldr || 'Meeting notes and requirements' };
    }
    return { title: 'API Specs', description: 'Latency requirements for the websocket server.' };
  }, [activities, sessions]);

  // Activity grid for productivity hub (GitHub-style, last 5 weeks)
  const activityGrid = useMemo(() => {
    const grid = [];
    const now = new Date();
    for (let week = 4; week >= 0; week--) {
      const row = [];
      for (let day = 0; day < 7; day++) {
        const date = new Date(now);
        date.setDate(date.getDate() - (week * 7 + (6 - day)));
        const dayStr = date.toDateString();
        const dayActivity = activities.filter(a => {
          try { return new Date(parseInt(String(a._id).substring(0, 8), 16) * 1000).toDateString() === dayStr; }
          catch { return false; }
        }).length;
        const daySessions = sessions.filter(s => new Date(s.created_at).toDateString() === dayStr).length;
        const dayTasks = tasks.filter(t => {
          try { return new Date(t.created_at).toDateString() === dayStr; } catch { return false; }
        }).length;
        const total = dayActivity + daySessions + dayTasks;
        row.push({ date, total, level: total >= 5 ? 3 : total >= 3 ? 2 : total >= 1 ? 1 : 0 });
      }
      grid.push(row);
    }
    return grid;
  }, [activities, sessions, tasks]);

  // Hobby analysis from MongoDB
  const hobbyAnalysis = useMemo(() => {
    const serviceCounts = {};
    activities.forEach(a => {
      const key = a.service || 'other';
      serviceCounts[key] = (serviceCounts[key] || 0) + 1;
    });
    const topService = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1])[0];
    // Map services to hobby names
    const hobbyMap = { gmail: 'Email Management', docs: 'Documentation', calendar: 'Scheduling', tasks: 'Task Planning', sheets: 'Data Analysis', drive: 'File Organization' };
    return {
      hobby: topService ? (hobbyMap[topService[0]] || 'LeetCode') : 'LeetCode',
      streak: 7, // Default streak
    };
  }, [activities]);

  // Habit streak
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
    return streak || hobbyAnalysis.streak;
  }, [sessions, activities, hobbyAnalysis]);

  // Insights data
  const activityCounts = useMemo(() => {
    const counts = { gmail: 0, calendar: 0, docs: 0, sheets: 0, drive: 0, tasks: 0 };
    activities.forEach(a => { if (counts[a.service] !== undefined) counts[a.service]++; });
    return counts;
  }, [activities]);

  const personalityScores = useMemo(() => {
    const scores = { Analytical: 0.7, 'Future-Oriented': 0.6, Structured: 0.7, Engaged: 0.5 };
    if (activityCounts.docs > 3) scores.Analytical = Math.min(scores.Analytical + 0.15, 1);
    if (activityCounts.calendar > 2) scores.Structured = Math.min(scores.Structured + 0.15, 1);
    if (sessions.length > 3) scores.Engaged = Math.min(scores.Engaged + 0.2, 1);
    return scores;
  }, [activityCounts, sessions]);

  const personalityType = useMemo(() => {
    const top = Object.entries(personalityScores).sort((a, b) => b[1] - a[1])[0][0];
    if (top === 'Analytical') return 'The Strategist';
    if (top === 'Structured') return 'The Architect';
    if (top === 'Engaged') return 'The Collaborator';
    return 'The Visionary';
  }, [personalityScores]);

  const weeklyTrend = useMemo(() => {
    const trend = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dayStr = date.toDateString();
      const dayTasks = tasks.filter(t => { try { return new Date(t.created_at).toDateString() === dayStr; } catch { return false; } });
      const completed = dayTasks.filter(t => t.status === 'completed').length;
      trend.push(Math.round((completed / (dayTasks.length || 1)) * 100));
    }
    return trend;
  }, [tasks]);

  // ============ SEQUENTIAL DATA LOADING ============
  useEffect(() => {
    if (loadingComplete) {
      // Already loaded this session, do a silent parallel fetch
      Promise.all([
        fetch(`${ADK_API_URL}/sessions?limit=50`).then(r => r.ok ? r.json() : { sessions: [] }).then(d => setSessions(d.sessions || [])),
        fetch(`${ADK_API_URL}/suggested_tasks?limit=100`).then(r => r.ok ? r.json() : { tasks: [] }).then(d => setTasks(d.tasks || [])),
        fetch(`${ADK_API_URL}/google_activity?limit=50`).then(r => r.ok ? r.json() : { activities: [] }).then(d => setActivities(d.activities || [])),
      ]).then(() => {
        setInitialLoading(false);
        // Fetch comms separately (has its own caching)
        const token = getStoredToken();
        if (token && !sessionStorage.getItem('cue_comms_fetched')) {
          fetchCommsData();
        }
      }).catch(() => setInitialLoading(false));
      return;
    }

    // First visit: sequential loading with animation
    let cancelled = false;
    (async () => {
      try {
        // Step 0: Connect
        if (cancelled) return;
        setLoadingStep(0);
        await new Promise(r => setTimeout(r, 600));

        // Step 1: Sessions
        if (cancelled) return;
        setLoadingStep(1);
        try {
          const res = await fetch(`${ADK_API_URL}/sessions?limit=50`);
          const data = res.ok ? await res.json() : { sessions: [] };
          setSessions(data.sessions || []);
        } catch { setSessions([]); }
        await new Promise(r => setTimeout(r, 400));

        // Step 2: Tasks
        if (cancelled) return;
        setLoadingStep(2);
        try {
          const res = await fetch(`${ADK_API_URL}/suggested_tasks?limit=100`);
          const data = res.ok ? await res.json() : { tasks: [] };
          setTasks(data.tasks || []);
        } catch { setTasks([]); }
        await new Promise(r => setTimeout(r, 400));

        // Step 3: Activity
        if (cancelled) return;
        setLoadingStep(3);
        try {
          const res = await fetch(`${ADK_API_URL}/google_activity?limit=50`);
          const data = res.ok ? await res.json() : { activities: [] };
          setActivities(data.activities || []);
        } catch { setActivities([]); }
        await new Promise(r => setTimeout(r, 400));

        // Step 4: Comms (Gmail + Calendar — the Gemini call)
        if (cancelled) return;
        setLoadingStep(4);
        const token = getStoredToken();
        if (token) {
          try {
            const res = await fetch(`${ADK_API_URL}/mosaic/comms`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ user_token: token }),
            });
            const data = res.ok ? await res.json() : {};
            setGmailUnread(data.gmail_unread_count ?? null);
            setGmailSummary(data.gmail_summary ?? null);
            setWhatToDo(data.what_to_do ?? null);
            setCalendarUpcoming(Array.isArray(data.calendar_upcoming) ? data.calendar_upcoming : []);
            setWorkPatternsFromComms(Array.isArray(data.work_patterns) ? data.work_patterns : []);
            try { sessionStorage.setItem('cue_comms_fetched', '1'); } catch (e) {}
          } catch { /* comms failed, not critical */ }
        }
        await new Promise(r => setTimeout(r, 400));

        // Step 5: Preparing canvas
        if (cancelled) return;
        setLoadingStep(5);
        await new Promise(r => setTimeout(r, 800));

        // Done
        if (cancelled) return;
        setInitialLoading(false);
        setLoadingComplete(true);
        try { sessionStorage.setItem('cue_workspace_loaded', '1'); } catch (e) {}
      } catch {
        if (!cancelled) {
          setInitialLoading(false);
          setLoadingComplete(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      .then(r => r.ok ? r.json() : {})
      .then(data => {
        setGmailUnread(data.gmail_unread_count ?? null);
        setGmailSummary(data.gmail_summary ?? null);
        setWhatToDo(data.what_to_do ?? null);
        setCalendarUpcoming(Array.isArray(data.calendar_upcoming) ? data.calendar_upcoming : []);
        setWorkPatternsFromComms(Array.isArray(data.work_patterns) ? data.work_patterns : []);
        try { sessionStorage.setItem('cue_comms_fetched', '1'); } catch (e) {}
      })
      .catch(() => {})
      .finally(() => setCommsLoading(false));
  }, []);

  // Visibility-based refresh
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetch(`${ADK_API_URL}/sessions?limit=50`).then(r => r.ok ? r.json() : { sessions: [] }).then(d => setSessions(d.sessions || [])).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // WebSocket for live task updates
  useEffect(() => {
    const wsUrl = ADK_API_URL.replace(/^http/, 'ws') + '/ws/dashboard';
    let ws = null;
    let reconnectTimeout = null;
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'TASKS_UPDATED' && msg.tasks) setTasks(msg.tasks);
          } catch {}
        };
        ws.onclose = () => { reconnectTimeout = setTimeout(connect, 5000); };
        ws.onerror = () => {};
      } catch { reconnectTimeout = setTimeout(connect, 5000); }
    };
    connect();
    return () => { if (reconnectTimeout) clearTimeout(reconnectTimeout); if (ws) ws.close(); };
  }, []);

  // Layout persistence
  const saveLayout = useCallback((next) => {
    setHubPositions(prev => {
      const nextPos = typeof next === 'function' ? next(prev) : next;
      try { localStorage.setItem(MOSAIC_LAYOUT_KEY, JSON.stringify(nextPos)); } catch {}
      return nextPos;
    });
  }, []);

  const handleHubDrag = useCallback((hubId, _e, data) => {
    setHubPositions(prev => ({ ...prev, [hubId]: { x: data.x, y: data.y } }));
  }, []);

  const handleHubDragStop = useCallback((hubId, _e, data) => {
    saveLayout(prev => ({ ...prev, [hubId]: { x: data.x, y: data.y } }));
  }, [saveLayout]);

  // Canvas pan/zoom
  const handleMouseDown = useCallback((e) => {
    if (e.target.closest('.react-draggable') || e.target.closest('.mosaic-hub-card') || e.target.closest('.mosaic-toolbar')) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e) => {
    if (!isPanning.current) return;
    setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
  }, []);

  const handleMouseUp = useCallback(() => { isPanning.current = false; }, []);
  const handleBigPicture = useCallback(() => { setPan({ x: 0, y: 0 }); setScale(1); }, []);
  const handleZoomIn = useCallback(() => { setScale(prev => Math.min(prev + 0.25, 2)); }, []);
  const handleZoomOut = useCallback(() => { setScale(prev => Math.max(prev - 0.25, 0.5)); }, []);

  // Custom hubs
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

  const handleCustomHubDrag = useCallback((hubId, data) => {
    setCustomHubs(prev => prev.map(h => h.id === hubId ? { ...h, position: { x: data.x, y: data.y } } : h));
  }, []);

  const handleCustomHubDragStop = useCallback((hubId, data) => {
    setCustomHubs(prev => {
      const updated = prev.map(h => h.id === hubId ? { ...h, position: { x: data.x, y: data.y } } : h);
      localStorage.setItem('cue_custom_hubs', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Derived session data
  const recent = sessions.slice(0, 6);

  // Hub centers for neural lines
  const allHubIds = Object.keys(DEFAULT_POSITIONS);
  const hubCenters = allHubIds.map(id => {
    const pos = hubPositions[id] || DEFAULT_POSITIONS[id] || { x: 100, y: 100 };
    let size = CARD_SIZE;
    if (id === 'productivity') size = FOCUS_HUB_SIZE;
    else if (id === 'comms') size = COMMS_HUB_SIZE;
    else if (id === 'todo') size = TODO_SIZE;
    else if (id === 'insights') size = INSIGHTS_HUB_SIZE;
    else if (id === 'today-date') size = DATE_WIDGET_SIZE;
    else if (id === 'doc-card' || id === 'tasks-completed') size = DOC_CARD_SIZE;
    else if (id === 'calendar-card' || id === 'work-patterns' || id === 'today-events' || id === 'hackathon-done' || id === 'hackathon-suggested') size = { width: 220, height: 120 };
    else if (id === 'hackathon' || id === 'hackathon-count') size = { width: 160, height: 100 };
    else if (id === 'gmail-card') size = { width: 260, height: 100 };
    else if (id === 'productivity-stats') size = PRODUCTIVITY_HUB_SIZE;
    else if (id === 'github-icon' || id === 'join-btn') size = ICON_SIZE;
    return { id, x: pos.x + (size.width || 0) / 2, y: pos.y + (size.height || 0) / 2 };
  });

  // Today's date
  const today = new Date();
  const todayMonth = today.toLocaleDateString(undefined, { month: 'long' });
  const todayDay = today.getDate();

  // Get event color based on index
  const eventColors = ['#4285f4', '#4285f4', '#4285f4'];

  // ============ LOADING SCREEN ============
  if (initialLoading && !loadingComplete) {
    const progress = ((loadingStep + 1) / LOADING_STEPS.length) * 100;
    return (
      <div className="mosaic-loading-screen">
        <div className="mosaic-loading-content">
          <div className="mosaic-loading-potion">
            <svg viewBox="0 0 80 100" className="potion-svg">
              <path d="M30 30 L30 10 L50 10 L50 30 L65 70 Q70 90 50 95 L30 95 Q10 90 15 70 Z" fill="none" stroke="rgba(139,92,246,0.6)" strokeWidth="2" />
              <path d={`M18 ${90 - progress * 0.5} Q20 ${85 - progress * 0.5} 40 ${88 - progress * 0.5} Q60 ${85 - progress * 0.5} 62 ${90 - progress * 0.5} L60 90 Q55 95 40 95 Q25 95 20 90 Z`}
                fill="url(#potionFill)" opacity="0.8">
                <animate attributeName="d"
                  values={`M18 ${90 - progress * 0.5} Q25 ${83 - progress * 0.5} 40 ${88 - progress * 0.5} Q55 ${85 - progress * 0.5} 62 ${90 - progress * 0.5} L60 90 Q55 95 40 95 Q25 95 20 90 Z;M18 ${90 - progress * 0.5} Q20 ${87 - progress * 0.5} 40 ${84 - progress * 0.5} Q60 ${87 - progress * 0.5} 62 ${90 - progress * 0.5} L60 90 Q55 95 40 95 Q25 95 20 90 Z;M18 ${90 - progress * 0.5} Q25 ${83 - progress * 0.5} 40 ${88 - progress * 0.5} Q55 ${85 - progress * 0.5} 62 ${90 - progress * 0.5} L60 90 Q55 95 40 95 Q25 95 20 90 Z`}
                  dur="2s" repeatCount="indefinite" />
              </path>
              <defs>
                <linearGradient id="potionFill" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#6366f1" />
                </linearGradient>
              </defs>
              {/* Bubbles */}
              <circle cx="30" cy="75" r="2" fill="#a78bfa" opacity="0.6"><animate attributeName="cy" values="80;50;80" dur="2s" repeatCount="indefinite" /><animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite" /></circle>
              <circle cx="45" cy="70" r="1.5" fill="#c4b5fd" opacity="0.5"><animate attributeName="cy" values="75;45;75" dur="1.5s" repeatCount="indefinite" /><animate attributeName="opacity" values="0.5;0;0.5" dur="1.5s" repeatCount="indefinite" /></circle>
              <circle cx="38" cy="78" r="1" fill="#ddd6fe" opacity="0.4"><animate attributeName="cy" values="78;55;78" dur="2.5s" repeatCount="indefinite" /></circle>
            </svg>
          </div>

          <h2 className="mosaic-loading-title">Preparing your workspace</h2>

          <div className="mosaic-loading-steps">
            {LOADING_STEPS.map((step, i) => (
              <div key={step.key} className={`mosaic-loading-step ${i < loadingStep ? 'done' : i === loadingStep ? 'active' : ''}`}>
                <span className="step-icon">{i < loadingStep ? '✓' : step.icon}</span>
                <span className="step-label">{step.label}</span>
              </div>
            ))}
          </div>

          <div className="mosaic-loading-bar">
            <div className="mosaic-loading-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
    );
  }

  // ============ MAIN CANVAS ============
  return (
    <div className="mosaic-field mosaic-whiteboard stitch-mosaic">
      {/* Search bar */}
      <div className="mosaic-search-bar glass">
        <span className="mosaic-search-icon" aria-hidden>⌕</span>
        <input type="text" className="mosaic-search-input" placeholder="Search your canvas..." value={canvasSearch} onChange={e => setCanvasSearch(e.target.value)} />
        <button type="button" className="mosaic-search-mic" title="Voice search" aria-label="Voice search">🎤</button>
        <button type="button" className="mosaic-search-ai" title="AI">AI</button>
      </div>

      {/* Zoom controls */}
      <div className="mosaic-zoom-controls glass">
        <button type="button" className="mosaic-zoom-btn" onClick={handleZoomIn}>+</button>
        <div className="mosaic-zoom-divider" />
        <button type="button" className="mosaic-zoom-btn" onClick={handleZoomOut}>−</button>
        <div className="mosaic-zoom-divider" />
        <span className="mosaic-zoom-label">{Math.round(scale * 100)}%</span>
        <div className="mosaic-zoom-divider" />
        <button type="button" className="mosaic-zoom-btn big-picture-btn" onClick={handleBigPicture}>⊞</button>
      </div>

      <div className="mosaic-canvas-wrapper" ref={canvasRef}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        style={{ cursor: isPanning.current ? 'grabbing' : 'grab' }}>
        <div className="mosaic-canvas-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: '0 0' }}>

          {/* Neural connection lines */}
          <svg className="mosaic-neural-lines" width={2000} height={1500} viewBox="0 0 2000 1500">
            <defs>
              <linearGradient id="neuralGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(139, 92, 246, 0.5)" />
                <stop offset="100%" stopColor="rgba(99, 102, 241, 0.5)" />
              </linearGradient>
              <filter id="neuralGlow"><feGaussianBlur stdDeviation="2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            {NEURAL_EDGES.map(([fromId, toId]) => {
              const from = hubCenters.find(h => h.id === fromId);
              const to = hubCenters.find(h => h.id === toId);
              if (!from || !to) return null;
              return <line key={`${fromId}-${toId}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="url(#neuralGrad)" strokeWidth="1.5" strokeOpacity="0.4" filter="url(#neuralGlow)" />;
            })}
          </svg>

          {/* ===== PRODUCTIVITY HUB (Main Center) ===== */}
          <Draggable position={hubPositions['productivity'] || DEFAULT_POSITIONS['productivity']}
            onDrag={(e, d) => handleHubDrag('productivity', e, d)} onStop={(e, d) => handleHubDragStop('productivity', e, d)} cancel=".mosaic-hub-expand-btn">
            <div className="mosaic-hub-card focus-hub-circle" style={{ width: FOCUS_HUB_SIZE.width, height: FOCUS_HUB_SIZE.height }}
              onClick={() => setExpandedHubId('productivity')}>
              <div className="focus-hub-inner">
                <div className="focus-hub-icon">
                  <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#a78bfa" strokeWidth="1.5">
                    <path d="M9 3L5 7L9 11M15 3L19 7L15 11M5 21L12 14L19 21" />
                  </svg>
                </div>
                <h2 className="focus-hub-title">Productivity</h2>
                <div className="focus-hub-phase">{focusPhase}</div>
                <div className="focus-hub-progress">
                  <div className="focus-progress-bar">
                    <div className="focus-progress-fill" style={{ width: `${productivityScore}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </Draggable>

          {/* ===== TASKS COMPLETED CARD ===== */}
          <Draggable position={hubPositions['tasks-completed'] || DEFAULT_POSITIONS['tasks-completed']}
            onDrag={(e, d) => handleHubDrag('tasks-completed', e, d)} onStop={(e, d) => handleHubDragStop('tasks-completed', e, d)}>
            <div className="mosaic-hub-card glassmorphic" style={{ width: CARD_SIZE.width, minHeight: CARD_SIZE.height }}
              onClick={() => setExpandedHubId('productivity')}>
              <div className="hub-badge">TASKS DONE</div>
              <div className="tasks-completed-count">{completedTasks}/{totalTasks}</div>
              {completedTasksList.slice(0, 2).map((t, i) => (
                <div key={t._id || i} className="mosaic-task-item"><span className="task-status-dot completed" />{(t.title || t.description || '').substring(0, 40)}</div>
              ))}
            </div>
          </Draggable>

          {/* ===== COMMS HUB (Circle) ===== */}
          <Draggable position={hubPositions['comms'] || DEFAULT_POSITIONS['comms']}
            onDrag={(e, d) => handleHubDrag('comms', e, d)} onStop={(e, d) => handleHubDragStop('comms', e, d)}>
            <div className="mosaic-hub-card comms-hub-circle" style={{ width: COMMS_HUB_SIZE.width, height: COMMS_HUB_SIZE.height }}
              onClick={() => setExpandedHubId('comms')}>
              <div className="comms-hub-inner">
                <div className="comms-hub-icon">
                  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#a78bfa" strokeWidth="1.5">
                    <circle cx="12" cy="5" r="2" /><circle cx="6" cy="12" r="2" /><circle cx="18" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
                    <line x1="12" y1="7" x2="12" y2="17" /><line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </div>
                <h3 className="comms-hub-title">Comms</h3>
                {gmailUnread != null && (
                  <div className="comms-hub-badges">
                    {['S', 'D'].map((letter, i) => (
                      <span key={i} className="comms-avatar-badge">{letter}</span>
                    ))}
                    {gmailUnread > 2 && <span className="comms-avatar-badge more">+{gmailUnread - 2}</span>}
                  </div>
                )}
              </div>
            </div>
          </Draggable>

          {/* ===== GMAIL CARD ===== */}
          <Draggable position={hubPositions['gmail-card'] || DEFAULT_POSITIONS['gmail-card']}
            onDrag={(e, d) => handleHubDrag('gmail-card', e, d)} onStop={(e, d) => handleHubDragStop('gmail-card', e, d)}>
            <div className="mosaic-hub-card gmail-notification-card" style={{ width: 260, minHeight: 80 }}>
              <div className="notif-card-header">
                <span className="notif-card-service gmail-label">GMAIL</span>
                <span className="notif-card-time">{gmailUnread != null ? `${gmailUnread} unread` : ''}</span>
              </div>
              <div className="notif-card-title">{gmailSummary ? gmailSummary.split('\n')[0]?.substring(0, 50) || 'Check your inbox' : 'Check your inbox'}</div>
              <div className="notif-card-snippet">{whatToDo ? whatToDo.substring(0, 60) + '...' : 'Sign in to see email insights'}</div>
            </div>
          </Draggable>

          {/* ===== CALENDAR CARD (Comms - upcoming events) ===== */}
          <Draggable position={hubPositions['calendar-card'] || DEFAULT_POSITIONS['calendar-card']}
            onDrag={(e, d) => handleHubDrag('calendar-card', e, d)} onStop={(e, d) => handleHubDragStop('calendar-card', e, d)}>
            <div className="mosaic-hub-card glassmorphic" style={{ width: 240, minHeight: 100 }}
              onClick={() => setExpandedHubId('comms')}>
              <div className="notif-card-header">
                <span className="notif-card-service">CALENDAR</span>
              </div>
              {calendarUpcoming.length === 0 ? (
                <p className="mosaic-muted">No upcoming events</p>
              ) : (
                <ul className="mosaic-calendar-list">
                  {calendarUpcoming.slice(0, 3).map((ev, i) => (
                    <li key={ev.id || i}><span className="event-dot" />{formatCalendarTime(ev.start)} {ev.summary || 'Event'}</li>
                  ))}
                </ul>
              )}
            </div>
          </Draggable>

          {/* ===== DOC CARD ===== */}
          <Draggable position={hubPositions['doc-card'] || DEFAULT_POSITIONS['doc-card']}
            onDrag={(e, d) => handleHubDrag('doc-card', e, d)} onStop={(e, d) => handleHubDragStop('doc-card', e, d)}>
            <div className="mosaic-hub-card doc-card-hub" style={{ width: DOC_CARD_SIZE.width, height: DOC_CARD_SIZE.height }}
              onClick={() => setExpandedHubId('doc-card')}>
              <div className="doc-card-header">
                <span className="doc-card-icon">📄</span>
                <span className="doc-card-type">Doc</span>
              </div>
              <h3 className="doc-card-title">{latestDoc.title}</h3>
              <p className="doc-card-desc">{latestDoc.description}</p>
            </div>
          </Draggable>

          {/* ===== GITHUB ICON ===== */}
          <Draggable position={hubPositions['github-icon'] || DEFAULT_POSITIONS['github-icon']}
            onDrag={(e, d) => handleHubDrag('github-icon', e, d)} onStop={(e, d) => handleHubDragStop('github-icon', e, d)}>
            <div className="mosaic-hub-card icon-hub github-icon-hub" style={{ width: ICON_SIZE.width, height: ICON_SIZE.height }}>
              <svg viewBox="0 0 24 24" width="32" height="32" fill="white">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </div>
          </Draggable>

          {/* ===== JOIN VIDEO BUTTON ===== */}
          <Draggable position={hubPositions['join-btn'] || DEFAULT_POSITIONS['join-btn']}
            onDrag={(e, d) => handleHubDrag('join-btn', e, d)} onStop={(e, d) => handleHubDragStop('join-btn', e, d)}>
            <div className="mosaic-hub-card icon-hub join-btn-hub" style={{ width: ICON_SIZE.width, height: ICON_SIZE.height }}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#34a853" strokeWidth="2">
                <rect x="2" y="4" width="14" height="14" rx="2" /><path d="M16 10l5-3v10l-5-3" />
              </svg>
              <span className="join-label">Join</span>
            </div>
          </Draggable>

          {/* ===== TO DO HUB ===== */}
          <Draggable position={hubPositions['todo'] || DEFAULT_POSITIONS['todo']}
            onDrag={(e, d) => handleHubDrag('todo', e, d)} onStop={(e, d) => handleHubDragStop('todo', e, d)} cancel=".mosaic-task-item">
            <div className="mosaic-hub-card todo-hub glassmorphic" style={{ width: TODO_SIZE.width, minHeight: TODO_SIZE.height }}
              onClick={() => setExpandedHubId('todo')}>
              <div className="todo-hub-header">
                <span className="todo-dot" />
                <span className="todo-title">To Do</span>
              </div>
              <div className="todo-items">
                {pendingTasks.length === 0 ? (
                  <p className="mosaic-muted">No pending tasks</p>
                ) : pendingTasks.slice(0, 3).map((t, i) => (
                  <div key={t._id || i} className="mosaic-task-item todo-checkbox-item">
                    <span className="todo-checkbox" />
                    <span className="task-text">{t.title}</span>
                  </div>
                ))}
              </div>
            </div>
          </Draggable>

          {/* ===== TODAY EVENTS CARD (Today hub) ===== */}
          <Draggable position={hubPositions['today-events'] || DEFAULT_POSITIONS['today-events']}
            onDrag={(e, d) => handleHubDrag('today-events', e, d)} onStop={(e, d) => handleHubDragStop('today-events', e, d)}>
            <div className="mosaic-hub-card glassmorphic" style={{ width: 220, minHeight: 100 }}
              onClick={() => setExpandedHubId('today')}>
              <div className="hub-badge">TODAY&apos;S EVENTS</div>
              {todayEvents.length === 0 ? (
                <p className="mosaic-muted">No events today</p>
              ) : (
                <ul className="mosaic-calendar-list">
                  {todayEvents.slice(0, 3).map((ev, i) => (
                    <li key={ev.id || i}><span className="event-dot" />{formatCalendarTime(ev.start)} {ev.summary || 'Event'}</li>
                  ))}
                </ul>
              )}
            </div>
          </Draggable>

          {/* ===== WORK PATTERNS CARD (Today hub) ===== */}
          <Draggable position={hubPositions['work-patterns'] || DEFAULT_POSITIONS['work-patterns']}
            onDrag={(e, d) => handleHubDrag('work-patterns', e, d)} onStop={(e, d) => handleHubDragStop('work-patterns', e, d)}>
            <div className="mosaic-hub-card glassmorphic" style={{ width: 220, minHeight: 100 }}
              onClick={() => setExpandedHubId('today')}>
              <div className="hub-badge">WORK PATTERNS</div>
              {workPatterns.length === 0 ? (
                <p className="mosaic-muted">Use the extension to see patterns</p>
              ) : (
                <div className="work-patterns-boxes">
                  {workPatterns.map((p, i) => (
                    <span key={i} className="work-pattern-tag">{p.name} ({p.count})</span>
                  ))}
                </div>
              )}
            </div>
          </Draggable>

          {/* ===== HACKATHON RESEARCH HUB ===== */}
          <Draggable position={hubPositions['hackathon'] || DEFAULT_POSITIONS['hackathon']}
            onDrag={(e, d) => handleHubDrag('hackathon', e, d)} onStop={(e, d) => handleHubDragStop('hackathon', e, d)}>
            <div className="mosaic-hub-card comms-hub-circle" style={{ width: 160, height: 100 }}
              onClick={() => setExpandedHubId('hackathon')}>
              <h3 className="comms-hub-title">Research</h3>
              <span className="hackathon-count-badge">{hackathonTasks.total}</span>
            </div>
          </Draggable>

          {/* ===== HACKATHON COUNT CARD ===== */}
          <Draggable position={hubPositions['hackathon-count'] || DEFAULT_POSITIONS['hackathon-count']}
            onDrag={(e, d) => handleHubDrag('hackathon-count', e, d)} onStop={(e, d) => handleHubDragStop('hackathon-count', e, d)}>
            <div className="mosaic-hub-card glassmorphic" style={{ width: 160, minHeight: 80 }} onClick={() => setExpandedHubId('hackathon')}>
              <div className="hub-badge">Total</div>
              <div className="tasks-completed-count">{hackathonTasks.total}</div>
            </div>
          </Draggable>

          {/* ===== HACKATHON DONE CARD ===== */}
          <Draggable position={hubPositions['hackathon-done'] || DEFAULT_POSITIONS['hackathon-done']}
            onDrag={(e, d) => handleHubDrag('hackathon-done', e, d)} onStop={(e, d) => handleHubDragStop('hackathon-done', e, d)}>
            <div className="mosaic-hub-card glassmorphic" style={{ width: 220, minHeight: 100 }} onClick={() => setExpandedHubId('hackathon')}>
              <div className="hub-badge">Done</div>
              {hackathonTasks.done.slice(0, 2).map((t, i) => (
                <div key={t._id || i} className="mosaic-task-item"><span className="task-status-dot completed" />{(t.title || '').substring(0, 35)}</div>
              ))}
              {hackathonTasks.done.length === 0 && <p className="mosaic-muted">No completed</p>}
            </div>
          </Draggable>

          {/* ===== HACKATHON SUGGESTED CARD ===== */}
          <Draggable position={hubPositions['hackathon-suggested'] || DEFAULT_POSITIONS['hackathon-suggested']}
            onDrag={(e, d) => handleHubDrag('hackathon-suggested', e, d)} onStop={(e, d) => handleHubDragStop('hackathon-suggested', e, d)}>
            <div className="mosaic-hub-card glassmorphic" style={{ width: 220, minHeight: 100 }} onClick={() => setExpandedHubId('hackathon')}>
              <div className="hub-badge">Suggested</div>
              {hackathonTasks.suggested.slice(0, 2).map((t, i) => (
                <div key={t._id || i} className="mosaic-task-item"><span className="task-status-dot pending" />{(t.title || '').substring(0, 35)}</div>
              ))}
              {hackathonTasks.suggested.length === 0 && <p className="mosaic-muted">No suggested</p>}
            </div>
          </Draggable>

          {/* ===== TODAY DATE WIDGET (Today hub center) ===== */}
          <Draggable position={hubPositions['today-date'] || DEFAULT_POSITIONS['today-date']}
            onDrag={(e, d) => handleHubDrag('today-date', e, d)} onStop={(e, d) => handleHubDragStop('today-date', e, d)}>
            <div className="mosaic-hub-card today-widget" style={{ width: DATE_WIDGET_SIZE.width, height: DATE_WIDGET_SIZE.height }}
              onClick={() => setExpandedHubId('today')}>
              <span className="today-label">TODAY</span>
              <span className="today-day">{todayDay}</span>
              <span className="today-month">{todayMonth}</span>
            </div>
          </Draggable>

          {/* ===== PRODUCTIVITY STATS CARD (optional; main circle is productivity hub) ===== */}
          <Draggable position={hubPositions['productivity-stats'] || DEFAULT_POSITIONS['productivity-stats']}
            onDrag={(e, d) => handleHubDrag('productivity-stats', e, d)} onStop={(e, d) => handleHubDragStop('productivity-stats', e, d)}>
            <div className="mosaic-hub-card productivity-hub glassmorphic" style={{ width: PRODUCTIVITY_HUB_SIZE.width, minHeight: PRODUCTIVITY_HUB_SIZE.height }}
              onClick={() => setExpandedHubId('productivity')}>
              <div className="hub-badge">PRODUCTIVITY</div>
              <div className="productivity-score-ring">
                <svg viewBox="0 0 100 100" className="score-svg">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(139, 92, 246, 0.2)" strokeWidth="8" />
                  <circle cx="50" cy="50" r="40" fill="none" stroke="url(#scoreGrad)" strokeWidth="8"
                    strokeDasharray={`${productivityScore * 2.51} 251`} strokeLinecap="round" transform="rotate(-90 50 50)" />
                  <defs><linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#8b5cf6" /><stop offset="100%" stopColor="#6366f1" /></linearGradient></defs>
                </svg>
                <span className="score-value">{productivityScore}%</span>
              </div>
              {/* Activity grid (GitHub-style) */}
              <div className="productivity-activity-grid">
                {activityGrid.map((week, wi) => (
                  <div key={wi} className="activity-grid-row">
                    {week.map((cell, di) => (
                      <div key={di} className={`activity-grid-cell level-${cell.level}`} title={`${cell.date.toLocaleDateString()}: ${cell.total} activities`} />
                    ))}
                  </div>
                ))}
              </div>
              {/* Hobby streak */}
              <div className="productivity-hobby">
                <span className="hobby-label">{hobbyAnalysis.hobby}</span>
                <span className="hobby-streak">🔥 {habitStreak}d streak</span>
              </div>
            </div>
          </Draggable>

          {/* ===== INSIGHTS HUB ===== */}
          <Draggable position={hubPositions['insights'] || DEFAULT_POSITIONS['insights']}
            onDrag={(e, d) => handleHubDrag('insights', e, d)} onStop={(e, d) => handleHubDragStop('insights', e, d)}>
            <div className="mosaic-hub-card insights-hub glassmorphic" style={{ width: INSIGHTS_HUB_SIZE.width, minHeight: 200 }}
              onClick={() => setExpandedHubId('insights')}>
              <div className="hub-badge insights">USER INSIGHTS</div>
              <div className="insights-hub-content">
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
                          strokeDasharray={`${productivityScore * 0.88} 88`} strokeLinecap="round" transform="rotate(-90 18 18)" />
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
            </div>
          </Draggable>

          {/* Custom Hubs (tasks filtered by hub name from state) */}
          {customHubs.map(hub => {
            const matchingTasks = tasks.filter(t => {
              const text = ((t.title || '') + ' ' + (t.description || '')).toLowerCase();
              return text.includes(hub.name.toLowerCase());
            });
            return (
              <Draggable key={hub.id} position={hub.position}
                onDrag={(e, data) => handleCustomHubDrag(hub.id, data)}
                onStop={(e, data) => handleCustomHubDragStop(hub.id, data)} bounds={false}>
                <div className="mosaic-hub-card custom-hub glassmorphic" style={{ width: 260, minHeight: 140 }}
                  onClick={() => setExpandedHubId(`custom-${hub.id}`)}>
                  <div className="hub-badge custom">{hub.name}</div>
                  <div className="hub-content">
                    {matchingTasks.length > 0 ? (
                      <>
                        <span className="custom-hub-count">{matchingTasks.length} task{matchingTasks.length !== 1 ? 's' : ''}</span>
                        {matchingTasks.slice(0, 3).map((task, i) => (
                          <div key={task._id || i} className="mosaic-task-item">{(task.title || task.description || '').substring(0, 40)}</div>
                        ))}
                      </>
                    ) : <p className="mosaic-muted">Tasks matching &quot;{hub.name}&quot; will appear here.</p>}
                  </div>
                </div>
              </Draggable>
            );
          })}
        </div>
      </div>

      {/* Floating "New Hub" button (replaces AI button) */}
      <div className="mosaic-floating-ai" title="Create New Hub">
        <button type="button" className="mosaic-ai-btn glass" aria-label="Create New Hub" onClick={() => setShowCreateHub(true)}>
          <span className="mosaic-ai-icon">+</span>
        </button>
      </div>

      {/* ===== EXPANDED HUB OVERLAY ===== */}
      {expandedHubId && (
        <div className="mosaic-expand-overlay" onClick={() => setExpandedHubId(null)}>
          <div className="mosaic-expand-panel glassmorphic" onClick={e => e.stopPropagation()}>
            <button type="button" className="mosaic-expand-close" onClick={() => setExpandedHubId(null)}>Close</button>

            {expandedHubId === 'productivity' && (
              <>
                <h3>Productivity</h3>
                <p className="mosaic-muted">{focusPhase}</p>
                <div className="expand-stats-grid">
                  <div className="expand-stat-card"><span className="expand-stat-value">{sessions.length}</span><span className="expand-stat-label">Sessions</span></div>
                  <div className="expand-stat-card"><span className="expand-stat-value">{completedTasks}/{totalTasks}</span><span className="expand-stat-label">Tasks Done</span></div>
                  <div className="expand-stat-card"><span className="expand-stat-value">{productivityScore}%</span><span className="expand-stat-label">Score</span></div>
                </div>
                <h4>Tasks Completed</h4>
                {completedTasksList.map((t, i) => (
                  <div key={t._id || i} className="mosaic-task-item"><span className="task-status-dot completed" /><span className="task-text">{t.title || t.description}</span></div>
                ))}
                {completedTasksList.length === 0 && <p className="mosaic-muted">No completed tasks yet.</p>}
                <h4>User Insights</h4>
                <p>{personalityType} · {habitStreak}d streak</p>
              </>
            )}

            {expandedHubId === 'productivity' && (
              <>
                <h3>Productivity Overview</h3>
                <div className="expand-stats-grid">
                  <div className="expand-stat-card"><span className="expand-stat-value">{productivityScore}%</span><span className="expand-stat-label">Score</span></div>
                  <div className="expand-stat-card"><span className="expand-stat-value">{completedTasks}/{totalTasks}</span><span className="expand-stat-label">Tasks Done</span></div>
                  <div className="expand-stat-card"><span className="expand-stat-value">{sessions.length}</span><span className="expand-stat-label">Sessions</span></div>
                  <div className="expand-stat-card"><span className="expand-stat-value">{activities.length}</span><span className="expand-stat-label">Activities</span></div>
                </div>
                <h4>Activity Grid</h4>
                <div className="productivity-activity-grid expanded">
                  {activityGrid.map((week, wi) => (
                    <div key={wi} className="activity-grid-row">
                      {week.map((cell, di) => (
                        <div key={di} className={`activity-grid-cell level-${cell.level}`} title={`${cell.date.toLocaleDateString()}: ${cell.total} activities`} />
                      ))}
                    </div>
                  ))}
                </div>
                <h4>Hobby Analysis</h4>
                <div className="hobby-expanded">
                  <span className="hobby-label-lg">{hobbyAnalysis.hobby}</span>
                  <span className="hobby-streak-lg">🔥 {habitStreak} day streak</span>
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

            {expandedHubId === 'comms' && (
              <>
                <h3>Comms Hub</h3>
                {!getStoredToken() ? <p className="mosaic-muted">Sign in with Google to see Gmail and Calendar.</p> : (
                  <>
                    <button type="button" className="mosaic-expand-refresh" onClick={() => fetchCommsData(true)} disabled={commsLoading}>
                      {commsLoading ? 'Refreshing…' : 'Refresh'}
                    </button>
                    <div className="comms-section"><div className="comms-label">Gmail</div>
                      <span className="comms-badge new">{gmailUnread != null ? gmailUnread : gmailCount} unread</span>
                    </div>
                    {gmailSummary && <div className="comms-gemini-card expanded"><div className="comms-gemini-label">Important from today</div><p className="comms-gemini-text">{gmailSummary}</p></div>}
                    {whatToDo && <div className="comms-gemini-card expanded what-to-do"><div className="comms-gemini-label">What you should do</div><p className="comms-gemini-text">{whatToDo}</p></div>}
                    <div className="comms-section"><div className="comms-label">Upcoming Events</div>
                      {calendarUpcoming.length === 0 ? <p className="mosaic-muted">No upcoming events</p> : (
                        <ul className="comms-calendar-list">{calendarUpcoming.map((ev, i) => (
                          <li key={ev.id || i} className="comms-item"><span className="comms-sender">{ev.summary}</span><span className="comms-time">{formatCalendarFull(ev.start)}</span></li>
                        ))}</ul>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {expandedHubId === 'today' && (
              <>
                <h3>Today</h3>
                <div className="expand-stats-grid">
                  <div className="expand-stat-card"><span className="expand-stat-value">{pendingTasks.length}</span><span className="expand-stat-label">To-do</span></div>
                  <div className="expand-stat-card"><span className="expand-stat-value">{todayEvents.length}</span><span className="expand-stat-label">Events</span></div>
                </div>
                <h4>To Do</h4>
                {pendingTasks.map((t, i) => (
                  <div key={t._id || i} className="mosaic-task-item"><span className="task-status-dot pending" /><span className="task-text">{t.title}</span></div>
                ))}
                {pendingTasks.length === 0 && <p className="mosaic-muted">No pending tasks.</p>}
                <h4>Work Patterns</h4>
                <div className="work-patterns-boxes">
                  {workPatterns.map((p, i) => (
                    <span key={i} className="work-pattern-tag">{p.name} ({p.count})</span>
                  ))}
                </div>
                {workPatterns.length === 0 && <p className="mosaic-muted">Use the extension to see patterns.</p>}
                <h4>Today&apos;s Events</h4>
                {todayEvents.length === 0 ? <p className="mosaic-muted">No events today.</p> : (
                  <ul className="comms-calendar-list">
                    {todayEvents.map((ev, i) => (
                      <li key={ev.id || i}>{formatCalendarFull(ev.start)} — {ev.summary}</li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {expandedHubId === 'todo' && (
              <>
                <h3>To Do</h3>
                <p>{pendingTasks.length} pending tasks</p>
                {pendingTasks.map((t, i) => (
                  <div key={t._id || i} className="mosaic-task-item"><span className="task-status-dot pending" /><span className="task-text">{t.title}</span></div>
                ))}
                {pendingTasks.length === 0 && <p className="mosaic-muted">No pending tasks.</p>}
              </>
            )}

            {expandedHubId === 'hackathon' && (
              <>
                <h3>Hackathon Research</h3>
                <div className="expand-stats-grid">
                  <div className="expand-stat-card"><span className="expand-stat-value">{hackathonTasks.total}</span><span className="expand-stat-label">Total</span></div>
                  <div className="expand-stat-card"><span className="expand-stat-value">{hackathonTasks.done.length}</span><span className="expand-stat-label">Done</span></div>
                  <div className="expand-stat-card"><span className="expand-stat-value">{hackathonTasks.suggested.length}</span><span className="expand-stat-label">Suggested</span></div>
                </div>
                <h4>Completed</h4>
                {hackathonTasks.done.map((t, i) => (
                  <div key={t._id || i} className="mosaic-task-item"><span className="task-status-dot completed" /><span className="task-text">{t.title || t.description}</span></div>
                ))}
                {hackathonTasks.done.length === 0 && <p className="mosaic-muted">No completed.</p>}
                <h4>Suggested</h4>
                {hackathonTasks.suggested.map((t, i) => (
                  <div key={t._id || i} className="mosaic-task-item"><span className="task-status-dot pending" /><span className="task-text">{t.title || t.description}</span></div>
                ))}
                {hackathonTasks.suggested.length === 0 && <p className="mosaic-muted">No suggested.</p>}
              </>
            )}

            {expandedHubId === 'doc-card' && (
              <>
                <h3>{latestDoc.title}</h3>
                <p>{latestDoc.description}</p>
                <h4>Recent Sessions</h4>
                {recent.map((s, i) => <div key={s.sessionId || s._id || i} className="mosaic-item">{s.title || 'Session'}</div>)}
              </>
            )}

            {expandedHubId && expandedHubId.startsWith('custom-') && (() => {
              const hubId = expandedHubId.replace('custom-', '');
              const customHub = customHubs.find(h => h.id === hubId);
              if (!customHub) return null;
              const matchingTasks = tasks.filter(t => {
                const text = ((t.title || '') + ' ' + (t.description || '')).toLowerCase();
                return text.includes(customHub.name.toLowerCase());
              });
              return (
                <>
                  <h3>{customHub.name}</h3>
                  <p className="mosaic-muted">{matchingTasks.length} matching task{matchingTasks.length !== 1 ? 's' : ''}</p>
                  {matchingTasks.length === 0 ? (
                    <p className="mosaic-muted">Tasks matching this hub will appear here.</p>
                  ) : (
                    <div className="expand-stats-grid">
                      {matchingTasks.map((t, i) => (
                        <div key={t._id || i} className="mosaic-task-item">
                          <span className="task-status-dot">{t.status === 'completed' ? 'completed' : 'pending'}</span>
                          <span className="task-text">{t.title || t.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}

            {expandedHubId === 'insights' && (
              <div className="insights-expanded">
                <h3>User Insights</h3>
                <div className="insights-grid">
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
                          fill="rgba(139,92,246,0.3)" stroke="#8b5cf6" strokeWidth="2" />
                      </svg>
                    </div>
                  </div>
                  <div className="insight-card score-insight">
                    <span className="insight-card-label">Productivity Score</span>
                    <div className="insight-score-content">
                      <div className="insight-ring-wrap">
                        <svg viewBox="0 0 100 100" className="insight-ring-svg">
                          <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(139,92,246,0.2)" strokeWidth="7" />
                          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#insightProdGrad)" strokeWidth="7"
                            strokeDasharray={`${productivityScore * 2.39} 239`} strokeLinecap="round" transform="rotate(-90 50 50)" />
                          <defs><linearGradient id="insightProdGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#8b5cf6" /><stop offset="100%" stopColor="#d946ef" /></linearGradient></defs>
                        </svg>
                        <span className="insight-ring-value">{productivityScore}<small>/100</small></span>
                      </div>
                      <div className="insight-trend-wrap">
                        <svg viewBox="0 0 140 50" className="insight-trend-svg">
                          <polyline points={weeklyTrend.map((v, i) => `${i * 20 + 10},${48 - (v / 100) * 40}`).join(' ')} fill="none" stroke="#6366f1" strokeWidth="2" />
                          {weeklyTrend.map((v, i) => <circle key={i} cx={i * 20 + 10} cy={48 - (v / 100) * 40} r="2.5" fill="#6366f1" />)}
                        </svg>
                      </div>
                    </div>
                  </div>
                  <div className="insight-card streak-insight">
                    <span className="insight-card-label">Habit Streak</span>
                    <div className="insight-streak-arc">
                      <svg viewBox="0 0 100 55">
                        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="rgba(139,92,246,0.2)" strokeWidth="7" strokeLinecap="round" />
                        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="url(#arcGradExp)" strokeWidth="7" strokeLinecap="round"
                          strokeDasharray={`${Math.min(habitStreak / 7, 1) * 126} 126`} />
                        <defs><linearGradient id="arcGradExp" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#22d3ee" /><stop offset="100%" stopColor="#6366f1" /></linearGradient></defs>
                      </svg>
                    </div>
                    <span className="insight-streak-days">{habitStreak} Days</span>
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
          <div className="create-hub-form glassmorphic" onClick={e => e.stopPropagation()}>
            <h3>Create New Hub</h3>
            <p className="mosaic-muted">Enter a name for your hub. Tasks will be generated around this topic.</p>
            <input type="text" className="hub-name-input" placeholder="Hub name (e.g., Project Alpha)..." value={newHubName}
              onChange={e => setNewHubName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateHub()} autoFocus />
            <div className="form-actions">
              <button type="button" className="cancel-btn" onClick={() => setShowCreateHub(false)}>Cancel</button>
              <button type="button" className="create-btn primary" onClick={handleCreateHub} disabled={!newHubName.trim()}>Create Hub</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MosaicField;
