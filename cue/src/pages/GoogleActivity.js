import React, { useState, useEffect, useCallback } from 'react';
import { config } from '../config';
import { getStoredToken } from '../auth/googleAuth';

const ADK_API_URL = config.API_BASE_URL;

// Service-specific URLs for completed tasks
const SERVICE_URLS = {
  gmail: 'https://mail.google.com',
  calendar: 'https://calendar.google.com',
  docs: 'https://docs.google.com',
  sheets: 'https://sheets.google.com',
  drive: 'https://drive.google.com',
  tasks: 'https://tasks.google.com',
  gemini_chat: 'https://gemini.google.com',
  antigravity: 'https://labs.google.com/search',
  openai_studio: 'https://chat.openai.com',
};

const getServiceUrl = (service, openUrl) => {
  if (openUrl) return openUrl;
  return SERVICE_URLS[service] || null;
};

function GoogleActivity({ lastActivityUpdate = 0, user }) {
  const [activities, setActivities] = useState([]);
  const [inProgressTasks, setInProgressTasks] = useState([]);
  const [queueTasks, setQueueTasks] = useState([]);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [acceptingId, setAcceptingId] = useState(null);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [actRes, pendingRes, queueRes, completedRes] = await Promise.all([
        fetch(`${ADK_API_URL}/google_activity?limit=100`),
        fetch(`${ADK_API_URL}/suggested_tasks?limit=50&status=pending`),
        fetch(`${ADK_API_URL}/suggested_tasks?limit=50&status=in_progress`),
        fetch(`${ADK_API_URL}/suggested_tasks?limit=50&status=completed`),
      ]);
      const activitiesData = actRes.ok ? (await actRes.json()).activities || [] : [];
      const pendingData = pendingRes.ok ? (await pendingRes.json()).tasks || [] : [];
      const queueData = queueRes.ok ? (await queueRes.json()).tasks || [] : [];
      const completedData = completedRes.ok ? (await completedRes.json()).tasks || [] : [];
      setActivities(activitiesData);
      setInProgressTasks(pendingData);
      setQueueTasks(queueData);
      setCompletedTasks(completedData);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await fetchAll();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (lastActivityUpdate > 0) fetchAll(true);
  }, [lastActivityUpdate, fetchAll]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchAll(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [fetchAll]);

  const handleAccept = async (task) => {
    const taskId = task._id;
    const token = getStoredToken();
    if (!token) {
      alert('Please sign in with Google to execute tasks.');
      return;
    }
    setAcceptingId(taskId);
    try {
      await fetch(`${ADK_API_URL}/suggested_tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      });
      setInProgressTasks((prev) => prev.filter((t) => t._id !== taskId));
      setQueueTasks((prev) => [...prev, { ...task, status: 'in_progress' }]);

      const service = (task.service || 'gmail').toLowerCase();
      const command = task.description || task.title || '';
      const execRes = await fetch(`${ADK_API_URL}/execute_command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service,
          command,
          user_token: token,
          confirm: true,
          user_display_name: user?.name || '',
          user_email: user?.email || '',
        }),
      });
      const result = await execRes.json();

      if (result.success && result.open_url) {
        window.open(result.open_url, '_blank');
      }
      await fetch(`${ADK_API_URL}/suggested_tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      setQueueTasks((prev) => prev.filter((t) => t._id !== taskId));
      setCompletedTasks((prev) => [{ ...task, status: 'completed' }, ...prev]);
      fetchAll(true);
    } catch (err) {
      console.error('[GoogleActivity] accept error:', err);
      setQueueTasks((prev) => prev.filter((t) => t._id !== taskId));
      setInProgressTasks((prev) => [...prev, task]);
      fetchAll(true);
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDismiss = async (taskId) => {
    try {
      await fetch(`${ADK_API_URL}/suggested_tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'dismissed' }),
      });
      setInProgressTasks((prev) => prev.filter((t) => t._id !== taskId));
    } catch (err) {
      console.error('[GoogleActivity] dismiss error:', err);
    }
  };

  const filteredActivities = activities.filter(
    (a) => !(a.service === 'gmail' && a.action === 'create_draft')
  );

  const counts = filteredActivities.reduce((acc, a) => {
    const s = a.service || 'other';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  const formatTime = (id) => {
    if (!id) return '';
    try {
      const date = new Date(parseInt(id.substring(0, 8), 16) * 1000);
      if (isNaN(date.getTime())) return '';
      const now = new Date();
      const diffMs = now - date;
      const mins = Math.floor(diffMs / 60000);
      const hours = Math.floor(diffMs / 3600000);
      const days = Math.floor(diffMs / 86400000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins}m ago`;
      if (hours < 24) return `${hours}h ago`;
      if (days < 7) return `${days}d ago`;
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  };

  const formatTaskTime = (task) => {
    const created = task.created_at;
    if (!created) return '';
    const date = new Date(created);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diffMs = now - date;
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  const describeActivity = (a) => {
    const service = a.service || '';
    const action = a.action || '';
    const details = a.details || {};
    if (service === 'gmail') {
      if (action === 'send_email') return `Sent: ${details.subject || 'email'}`;
      if (action === 'list_emails') return `Listed ${details.count || 0} emails`;
      if (action === 'read_email') return 'Read an email';
    }
    if (service === 'calendar') {
      if (action === 'create_event') return `Created: ${details.summary || 'event'}`;
      if (action === 'list_events') return `Listed ${details.count || 0} events`;
    }
    if (service === 'drive') {
      if (action === 'create_file') return `Created: ${details.name || 'file'}`;
      if (action === 'share_file') return `Shared with ${details.email || ''}`;
    }
    if (service === 'docs') {
      if (action === 'create_document') return `Created doc: ${details.title || 'doc'}`;
    }
    if (service === 'sheets') {
      if (action === 'create_sheet') return `Created sheet: ${details.title || 'sheet'}`;
    }
    if (service === 'tasks') {
      if (action === 'create_task') return `Created task: ${details.title || 'task'}`;
    }
    return `${service} ${action}`;
  };

  const completedItems = [
    ...completedTasks.map((t) => ({
      type: 'task',
      id: t._id,
      title: t.title || t.description,
      time: formatTaskTime(t),
      ts: t.created_at ? new Date(t.created_at).getTime() : 0,
      service: t.service,
      url: getServiceUrl(t.service, t.open_url),
    })),
    ...filteredActivities.map((a) => ({
      type: 'activity',
      id: a._id,
      title: describeActivity(a),
      time: formatTime(a._id),
      ts: parseInt(String(a._id).substring(0, 8), 16) * 1000 || 0,
      service: a.service,
      url: getServiceUrl(a.service, a.details?.webViewLink || a.details?.htmlLink),
    })),
  ].sort((a, b) => (b.ts || 0) - (a.ts || 0));

  if (loading && activities.length === 0 && inProgressTasks.length === 0 && queueTasks.length === 0 && completedTasks.length === 0) {
    return (
      <div className="sessions-container">
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sessions-container">
        <p className="empty-memory">Could not load: {error}</p>
      </div>
    );
  }

  return (
    <div className="sessions-container ai-task-automation ai-task-board-panel">
      <div className="ai-task-header">
        <div className="google-activity-cards">
          <div className="google-activity-card">
            <span className="google-activity-card-label">Gmail</span>
            <span className="google-activity-card-count">{counts.gmail || 0}</span>
          </div>
          <div className="google-activity-card">
            <span className="google-activity-card-label">Calendar</span>
            <span className="google-activity-card-count">{counts.calendar || 0}</span>
          </div>
          <div className="google-activity-card">
            <span className="google-activity-card-label">Drive</span>
            <span className="google-activity-card-count">{counts.drive || 0}</span>
          </div>
          <div className="google-activity-card">
            <span className="google-activity-card-label">Docs</span>
            <span className="google-activity-card-count">{counts.docs || 0}</span>
          </div>
          <div className="google-activity-card">
            <span className="google-activity-card-label">Sheets</span>
            <span className="google-activity-card-count">{counts.sheets || 0}</span>
          </div>
          <div className="google-activity-card">
            <span className="google-activity-card-label">Tasks</span>
            <span className="google-activity-card-count">{counts.tasks || 0}</span>
          </div>
        </div>
      </div>

      <div className="ai-task-columns">
        <div className="ai-task-column ai-queue-column">
          <h3 className="ai-column-title">AI Queue (Auto-Drafting)</h3>
          <span className="ai-column-subtitle">AI Queue</span>
          <div className="ai-column-cards">
            {queueTasks.length === 0 ? (
              <p className="empty-column">No tasks in queue.</p>
            ) : (
              queueTasks.map((task) => (
                <div key={task._id} className="ai-task-card queue-card glass-card glow-border">
                  <h4 className="ai-task-card-title">{task.title || task.description || 'Task'}</h4>
                  <p className="ai-task-card-subtitle">Processing…</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="ai-task-column in-progress-column">
          <h3 className="ai-column-title">In Progress (User Review)</h3>
          <span className="ai-column-subtitle">{inProgressTasks.length} Queue</span>
          <div className="ai-column-cards">
            {inProgressTasks.length === 0 ? (
              <p className="empty-column">No tasks awaiting review.</p>
            ) : (
              inProgressTasks.map((task) => (
                <div key={task._id} className="ai-task-card in-progress-card glass-card">
                  <h4 className="ai-task-card-title">{task.title || task.description || 'Task'}</h4>
                  <p className="ai-task-card-subtitle">{task.service || 'general'}</p>
                  <div className="ai-task-card-actions">
                    <button
                      type="button"
                      className="task-btn accept"
                      onClick={() => handleAccept(task)}
                      disabled={acceptingId === task._id}
                    >
                      {acceptingId === task._id ? 'Accepting…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="task-btn edit"
                      onClick={(e) => { e.stopPropagation(); }}
                      title="Edit task"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="task-btn dismiss"
                      onClick={() => handleDismiss(task._id)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="ai-task-column completed-column">
          <h3 className="ai-column-title">Completed (Executed)</h3>
          <span className="ai-column-subtitle">AI Queue</span>
          <div className="ai-column-cards">
            {completedItems.length === 0 ? (
              <p className="empty-column">No completed tasks or activity yet.</p>
            ) : (
              completedItems.map((item) => (
                <div key={`${item.type}-${item.id}`} className="ai-task-card completed-card glass-card completed-stitch">
                  <span className="completed-check">✓</span>
                  <div className="completed-content">
                    <span className="ai-task-card-title">{item.title}</span>
                    {item.service && (
                      <span className="completed-service-badge">{item.service}</span>
                    )}
                  </div>
                  <div className="completed-meta">
                    <span className="ai-task-card-time">{item.time}</span>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="completed-link"
                        onClick={(e) => e.stopPropagation()}
                        title={`Open in ${item.service || 'browser'}`}
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GoogleActivity;
