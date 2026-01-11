/**
 * MongoDB Atlas Integration Service
 * Handles saving and fetching session summaries from MongoDB
 */

import { CONFIG } from '../utils/constants.js';

/**
 * Save a session summary to MongoDB Atlas
 * @param {Object} sessionData - Session data to save
 * @returns {Promise<{success: boolean, sessionId?: string, error?: string}>}
 */
export async function saveSessionToMongoDB(sessionData) {
  try {
    if (!CONFIG.MONGODB_API_URL) {
      console.warn('MongoDB API URL not configured, saving to Chrome storage only');
      return { success: false, error: 'MongoDB not configured' };
    }

    const sessionId = sessionData.sessionId || generateSessionId();
    
    const payload = {
      sessionId: sessionId,
      title: sessionData.summary?.title || sessionData.title || 'Untitled Session',
      createdAt: sessionData.createdAt || new Date().toISOString(),
      duration: sessionData.recordingDuration || sessionData.duration || 0,
      transcript: sessionData.transcript || '',
      summary: sessionData.summary || {},
      videoUrl: sessionData.videoUrl || null,
      videoScript: sessionData.videoScript || null,
      hasVideo: sessionData.hasVideo || false,
      metadata: {
        domain: sessionData.metadata?.domain || '',
        url: sessionData.metadata?.url || '',
        participants: sessionData.summary?.participants || []
      }
    };

    const response = await fetch(`${CONFIG.MONGODB_API_URL}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('MongoDB save error:', errorData);
      return { 
        success: false, 
        error: errorData.message || `HTTP ${response.status}` 
      };
    }

    const result = await response.json();
    console.log('Session saved to MongoDB:', result.sessionId || sessionId);
    
    return { 
      success: true, 
      sessionId: result.sessionId || result._id || sessionId 
    };
  } catch (error) {
    console.error('Error saving to MongoDB:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Fetch all sessions from MongoDB
 * @param {Object} options - Query options (filter, search, limit)
 * @returns {Promise<{success: boolean, sessions?: Array, error?: string}>}
 */
export async function fetchSessionsFromMongoDB(options = {}) {
  try {
    if (!CONFIG.MONGODB_API_URL) {
      // Fallback to Chrome storage
      return fetchSessionsFromStorage();
    }

    const queryParams = new URLSearchParams();
    if (options.filter) queryParams.append('filter', options.filter);
    if (options.search) queryParams.append('search', options.search);
    if (options.limit) queryParams.append('limit', options.limit);
    if (options.skip) queryParams.append('skip', options.skip);

    const url = `${CONFIG.MONGODB_API_URL}/sessions${queryParams.toString() ? '?' + queryParams : ''}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('MongoDB fetch error:', response.status);
      // Fallback to Chrome storage
      return fetchSessionsFromStorage();
    }

    const result = await response.json();
    const sessions = Array.isArray(result) ? result : (result.sessions || []);
    
    // Sort by date (newest first)
    sessions.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0);
      const dateB = new Date(b.createdAt || 0);
      return dateB - dateA;
    });

    return { success: true, sessions };
  } catch (error) {
    console.error('Error fetching from MongoDB:', error);
    // Fallback to Chrome storage
    return fetchSessionsFromStorage();
  }
}

/**
 * Fetch a single session by ID
 * @param {string} sessionId - Session ID
 * @returns {Promise<{success: boolean, session?: Object, error?: string}>}
 */
export async function fetchSessionById(sessionId) {
  try {
    if (!CONFIG.MONGODB_API_URL) {
      return fetchSessionFromStorage(sessionId);
    }

    const response = await fetch(`${CONFIG.MONGODB_API_URL}/sessions/${sessionId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return fetchSessionFromStorage(sessionId);
    }

    const session = await response.json();
    return { success: true, session };
  } catch (error) {
    console.error('Error fetching session:', error);
    return fetchSessionFromStorage(sessionId);
  }
}

/**
 * Delete a session from MongoDB
 * @param {string} sessionId - Session ID to delete
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteSessionFromMongoDB(sessionId) {
  try {
    if (!CONFIG.MONGODB_API_URL) {
      return deleteSessionFromStorage(sessionId);
    }

    const response = await fetch(`${CONFIG.MONGODB_API_URL}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return deleteSessionFromStorage(sessionId);
    }

    return { success: true };
  } catch (error) {
    console.error('Error deleting session:', error);
    return deleteSessionFromStorage(sessionId);
  }
}

/**
 * Upload video file to MongoDB GridFS (if needed)
 * @param {Blob} videoBlob - Video file blob
 * @param {string} sessionId - Session ID
 * @returns {Promise<{success: boolean, videoId?: string, error?: string}>}
 */
export async function uploadVideoToMongoDB(videoBlob, sessionId) {
  try {
    if (!CONFIG.MONGODB_API_URL) {
      return { success: false, error: 'MongoDB not configured' };
    }

    const formData = new FormData();
    formData.append('video', videoBlob, `session-${sessionId}.mp4`);
    formData.append('sessionId', sessionId);

    const response = await fetch(`${CONFIG.MONGODB_API_URL}/videos/upload`, {
      method: 'POST',
      // Don't set Content-Type header for FormData - browser sets it automatically
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.message || 'Upload failed' };
    }

    const result = await response.json();
    return { success: true, videoId: result.videoId, videoUrl: result.videoUrl };
  } catch (error) {
    console.error('Error uploading video:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// Chrome Storage Fallback Functions
// ============================================

/**
 * Fetch sessions from Chrome storage (fallback)
 */
async function fetchSessionsFromStorage() {
  try {
    const result = await chrome.storage.local.get(['sessions']);
    const sessions = result.sessions || [];
    return { success: true, sessions };
  } catch (error) {
    return { success: false, error: error.message, sessions: [] };
  }
}

/**
 * Fetch single session from Chrome storage
 */
async function fetchSessionFromStorage(sessionId) {
  try {
    const result = await chrome.storage.local.get(['sessions']);
    const sessions = result.sessions || [];
    const session = sessions.find(s => (s.sessionId || s._id) === sessionId);
    return { success: !!session, session };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete session from Chrome storage
 */
async function deleteSessionFromStorage(sessionId) {
  try {
    const result = await chrome.storage.local.get(['sessions']);
    const sessions = (result.sessions || []).filter(s => 
      (s.sessionId || s._id) !== sessionId
    );
    await chrome.storage.local.set({ sessions });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Generate a unique session ID
 */
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Save session to Chrome storage (fallback)
 */
export async function saveSessionToStorage(sessionData) {
  try {
    const result = await chrome.storage.local.get(['sessions']);
    const sessions = result.sessions || [];
    
    const sessionId = sessionData.sessionId || generateSessionId();
    const session = {
      ...sessionData,
      sessionId,
      createdAt: sessionData.createdAt || new Date().toISOString()
    };

    sessions.push(session);
    await chrome.storage.local.set({ sessions });
    
    return { success: true, sessionId };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export default {
  saveSessionToMongoDB,
  fetchSessionsFromMongoDB,
  fetchSessionById,
  deleteSessionFromMongoDB,
  uploadVideoToMongoDB,
  saveSessionToStorage
};
