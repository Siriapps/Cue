import React, { useState, useEffect, useCallback } from 'react';
import { config } from '../config';
import { getStoredToken } from '../auth/googleAuth';

const ADK_API_URL = config.API_BASE_URL;
const WS_URL = ADK_API_URL ? (ADK_API_URL.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws/dashboard') : '';

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
  const [taskColumns, setTaskColumns] = useState({
    queue: [],
    inProgress: [],
    completed: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [acceptErrorToast, setAcceptErrorToast] = useState(null);
  const [acceptingId, setAcceptingId] = useState(null);

  const queueTasks = taskColumns.queue;
  const inProgressTasks = taskColumns.inProgress;
  const completedTasks = taskColumns.completed;

  // Edit modal state
  const [editingTask, setEditingTask] = useState(null);
  const [editFormData, setEditFormData] = useState({});

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
      const inProgressData = queueRes.ok ? (await queueRes.json()).tasks || [] : [];
      const completedData = completedRes.ok ? (await completedRes.json()).tasks || [] : [];
      setActivities(activitiesData);
      setTaskColumns({
        queue: pendingData,
        inProgress: inProgressData,
        completed: completedData,
      });
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

  // WebSocket: sync task columns when backend broadcasts TASKS_UPDATED
  useEffect(() => {
    if (!WS_URL) return;
    let ws = null;
    let reconnectTimeout = null;
    const connect = () => {
      try {
        ws = new WebSocket(WS_URL);
        ws.onopen = () => {};
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'TASKS_UPDATED' && Array.isArray(msg.tasks)) {
              const tasks = msg.tasks;
              setTaskColumns({
                queue: tasks.filter((t) => (t.status || '') === 'pending'),
                inProgress: tasks.filter((t) => (t.status || '') === 'in_progress'),
                completed: tasks.filter((t) => (t.status || '') === 'completed'),
              });
            }
          } catch (e) {}
        };
        ws.onclose = () => {
          reconnectTimeout = setTimeout(connect, 5000);
        };
        ws.onerror = () => {};
      } catch (e) {}
    };
    connect();
    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, []);

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
      setTaskColumns((prev) => ({
        ...prev,
        queue: prev.queue.filter((t) => t._id !== taskId),
        inProgress: [...prev.inProgress, { ...task, status: 'in_progress' }],
      }));

      const service = (task.service || 'gmail').toLowerCase();
      const command = task.description || task.title || '';

      // URL-only services: open the URL and mark completed without calling execute_command
      const URL_SERVICES = {
        gemini_chat: (p) => `https://gemini.google.com/app?q=${encodeURIComponent(p?.prompt || command)}`,
        antigravity: () => 'antigravity://',
        openai_studio: (p) => `https://chat.openai.com/?q=${encodeURIComponent(p?.prompt || command)}`,
      };
      if (URL_SERVICES[service]) {
        const openUrl = URL_SERVICES[service](task.params);
        window.open(openUrl, '_blank');
        await fetch(`${ADK_API_URL}/suggested_tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed', open_url: openUrl }),
        });
        setTaskColumns((prev) => ({
          ...prev,
          inProgress: prev.inProgress.filter((t) => t._id !== taskId),
          completed: [{ ...task, status: 'completed', open_url: openUrl }, ...prev.completed],
        }));
        return;
      }

      // Include task.action in suggested_params so backend doesn't have to re-infer it
      const paramsWithAction = { ...(task.params || {}), _action: task.action || null };
      const execRes = await fetch(`${ADK_API_URL}/execute_command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service,
          command,
          user_token: token,
          confirm: true,
          suggested_params: paramsWithAction,
          user_display_name: user?.name || '',
          user_email: user?.email || '',
        }),
      });
      const result = await execRes.json();

      if (result.success) {
        if (result.open_url) {
          window.open(result.open_url, '_blank');
        }
        await fetch(`${ADK_API_URL}/suggested_tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed', open_url: result?.open_url || '' }),
        });
        setTaskColumns((prev) => ({
          ...prev,
          inProgress: prev.inProgress.filter((t) => t._id !== taskId),
          completed: [{ ...task, status: 'completed', open_url: result?.open_url }, ...prev.completed],
        }));
      } else {
        // Execution failed (API error, quota, etc.) — keep in AI Queue
        console.warn('[GoogleActivity] Task execution failed:', result.error);
        setError(`Task couldn't be executed: ${result.error || 'API error'}. It's in the AI Queue for retry.`);
        setTimeout(() => setError(null), 5000);
      }
    } catch (err) {
      console.error('[GoogleActivity] accept error:', err);
      setError('Action couldn\'t be completed. Task is in the AI Queue for retry.');
      setTimeout(() => setError(null), 5000);
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDismiss = (taskId) => {
    // Update UI immediately (no loading, no fetch); persist in background
    setTaskColumns((prev) => ({
      ...prev,
      queue: prev.queue.filter((t) => t._id !== taskId),
      inProgress: prev.inProgress.filter((t) => t._id !== taskId),
    }));
    fetch(`${ADK_API_URL}/suggested_tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dismissed' }),
    }).catch(() => {});
  };

  // Edit task handlers
  const handleEditTask = (task) => {
    setEditingTask(task);
    const params = task.params || {};
    setEditFormData({
      to: params.to || '',
      subject: params.subject || '',
      body: params.body || params.message || '',
      title: params.title || params.summary || task.title || '',
      date: params.date || '',
      time: params.time || params.start || '',
      description: params.description || task.description || '',
    });
  };

  const handleEditFormChange = (field, value) => {
    setEditFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditCancel = () => {
    setEditingTask(null);
    setEditFormData({});
  };

  const handleEditSubmit = async () => {
    if (!editingTask) return;

    // Build updated params based on service type
    const updatedParams = { ...(editingTask.params || {}) };

    if (editingTask.service === 'gmail') {
      if (editFormData.to) updatedParams.to = editFormData.to;
      if (editFormData.subject) updatedParams.subject = editFormData.subject;
      if (editFormData.body) updatedParams.body = editFormData.body;
    } else if (editingTask.service === 'calendar') {
      if (editFormData.title) updatedParams.summary = editFormData.title;
      if (editFormData.date) updatedParams.date = editFormData.date;
      if (editFormData.time) updatedParams.start = editFormData.time;
      if (editFormData.description) updatedParams.description = editFormData.description;
    } else if (editingTask.service === 'tasks') {
      if (editFormData.title) updatedParams.title = editFormData.title;
      if (editFormData.description) updatedParams.notes = editFormData.description;
    } else {
      // Generic: update description/prompt
      if (editFormData.description) updatedParams.prompt = editFormData.description;
    }

    // Execute the task with updated params
    const updatedTask = { ...editingTask, params: updatedParams };
    setEditingTask(null);
    setEditFormData({});
    await handleAccept(updatedTask);
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
      {acceptErrorToast && (
        <div className="ai-task-toast error" role="alert">
          {acceptErrorToast}
        </div>
      )}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditTask(task);
                      }}
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

        <div className="ai-task-column in-progress-column">
          <h3 className="ai-column-title">AI Queue (Retry)</h3>
          <span className="ai-column-subtitle">{inProgressTasks.length} queued</span>
          <div className="ai-column-cards">
            {inProgressTasks.length === 0 ? (
              <p className="empty-column">No tasks awaiting review.</p>
            ) : (
              inProgressTasks.map((task) => (
                <div key={task._id} className="ai-task-card in-progress-card glass-card">
                  <button
                    type="button"
                    className="task-dismiss-x"
                    onClick={(e) => { e.stopPropagation(); handleDismiss(task._id); }}
                    title="Remove from queue"
                    aria-label="Remove task"
                  >
                    ×
                  </button>
                  <h4 className="ai-task-card-title">{task.title || task.description || 'Task'}</h4>
                  <p className="ai-task-card-subtitle">{task.service || 'general'}</p>
                  <p className="ai-task-card-status">Executing…</p>
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

      {/* Edit Task Modal */}
      {editingTask && (
        <div className="edit-modal-overlay" onClick={handleEditCancel}>
          <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="edit-modal-header">
              <h3>Edit Task</h3>
              <button className="edit-modal-close" onClick={handleEditCancel}>×</button>
            </div>
            <div className="edit-modal-body">
              <h4 className="edit-modal-task-title">{editingTask.title}</h4>

              {/* Gmail-specific fields */}
              {editingTask.service === 'gmail' && (
                <>
                  <label className="edit-modal-label">
                    To:
                    <input
                      type="email"
                      value={editFormData.to || ''}
                      onChange={(e) => handleEditFormChange('to', e.target.value)}
                      placeholder="recipient@example.com"
                      className="edit-modal-input"
                    />
                  </label>
                  <label className="edit-modal-label">
                    Subject:
                    <input
                      type="text"
                      value={editFormData.subject || ''}
                      onChange={(e) => handleEditFormChange('subject', e.target.value)}
                      placeholder="Email subject"
                      className="edit-modal-input"
                    />
                  </label>
                  <label className="edit-modal-label">
                    Message:
                    <textarea
                      value={editFormData.body || ''}
                      onChange={(e) => handleEditFormChange('body', e.target.value)}
                      placeholder="Email body"
                      className="edit-modal-textarea"
                      rows={4}
                    />
                  </label>
                </>
              )}

              {/* Calendar-specific fields */}
              {editingTask.service === 'calendar' && (
                <>
                  <label className="edit-modal-label">
                    Event Title:
                    <input
                      type="text"
                      value={editFormData.title || ''}
                      onChange={(e) => handleEditFormChange('title', e.target.value)}
                      placeholder="Meeting title"
                      className="edit-modal-input"
                    />
                  </label>
                  <label className="edit-modal-label">
                    Date:
                    <input
                      type="date"
                      value={editFormData.date || ''}
                      onChange={(e) => handleEditFormChange('date', e.target.value)}
                      className="edit-modal-input"
                    />
                  </label>
                  <label className="edit-modal-label">
                    Time:
                    <input
                      type="time"
                      value={editFormData.time || ''}
                      onChange={(e) => handleEditFormChange('time', e.target.value)}
                      className="edit-modal-input"
                    />
                  </label>
                  <label className="edit-modal-label">
                    Description:
                    <textarea
                      value={editFormData.description || ''}
                      onChange={(e) => handleEditFormChange('description', e.target.value)}
                      placeholder="Event description"
                      className="edit-modal-textarea"
                      rows={3}
                    />
                  </label>
                </>
              )}

              {/* Tasks-specific fields */}
              {editingTask.service === 'tasks' && (
                <>
                  <label className="edit-modal-label">
                    Task Title:
                    <input
                      type="text"
                      value={editFormData.title || ''}
                      onChange={(e) => handleEditFormChange('title', e.target.value)}
                      placeholder="Task title"
                      className="edit-modal-input"
                    />
                  </label>
                  <label className="edit-modal-label">
                    Notes:
                    <textarea
                      value={editFormData.description || ''}
                      onChange={(e) => handleEditFormChange('description', e.target.value)}
                      placeholder="Task notes"
                      className="edit-modal-textarea"
                      rows={3}
                    />
                  </label>
                </>
              )}

              {/* Generic/AI chat fields */}
              {(!editingTask.service || !['gmail', 'calendar', 'tasks'].includes(editingTask.service)) && (
                <label className="edit-modal-label">
                  Prompt/Description:
                  <textarea
                    value={editFormData.description || ''}
                    onChange={(e) => handleEditFormChange('description', e.target.value)}
                    placeholder="Edit the prompt or description"
                    className="edit-modal-textarea"
                    rows={5}
                  />
                </label>
              )}
            </div>
            <div className="edit-modal-footer">
              <button className="edit-modal-cancel" onClick={handleEditCancel}>Cancel</button>
              <button className="edit-modal-submit" onClick={handleEditSubmit}>Execute</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GoogleActivity;
