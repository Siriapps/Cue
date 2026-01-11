// Chrome Storage Helper Functions

/**
 * Save data to Chrome local storage
 * @param {string} key - Storage key
 * @param {any} value - Value to store
 */
export async function saveToStorage(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Get data from Chrome local storage
 * @param {string} key - Storage key
 * @returns {Promise<any>} - Stored value
 */
export async function getFromStorage(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result[key]);
      }
    });
  });
}

/**
 * Remove data from Chrome local storage
 * @param {string} key - Storage key
 */
export async function removeFromStorage(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove([key], () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Clear all extension storage
 */
export async function clearStorage() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.clear(() => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Save recording state
 * @param {Object} state - Recording state object
 */
export async function saveRecordingState(state) {
  return saveToStorage('recordingState', {
    ...state,
    timestamp: Date.now()
  });
}

/**
 * Get recording state
 * @returns {Promise<Object>} - Recording state
 */
export async function getRecordingState() {
  return getFromStorage('recordingState');
}

/**
 * Save meeting summary data
 * @param {Object} summary - Summary data
 */
export async function saveSummaryData(summary) {
  return saveToStorage('summaryData', {
    ...summary,
    createdAt: Date.now()
  });
}

/**
 * Get meeting summary data
 * @returns {Promise<Object>} - Summary data
 */
export async function getSummaryData() {
  return getFromStorage('summaryData');
}

/**
 * Save generated video URL
 * @param {string} videoUrl - Video URL or blob URL
 */
export async function saveVideoUrl(videoUrl) {
  return saveToStorage('videoUrl', videoUrl);
}

/**
 * Get generated video URL
 * @returns {Promise<string>} - Video URL
 */
export async function getVideoUrl() {
  return getFromStorage('videoUrl');
}

export default {
  saveToStorage,
  getFromStorage,
  removeFromStorage,
  clearStorage,
  saveRecordingState,
  getRecordingState,
  saveSummaryData,
  getSummaryData,
  saveVideoUrl,
  getVideoUrl
};
