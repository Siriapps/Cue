/**
 * Chrome Flow - Background Service Worker
 * Orchestrates the entire meeting recording and summarization pipeline
 */

import { startAudioCapture, stopAudioCapture, isRecording, getRecordingDuration, blobToBase64 } from './audio-capture.js';
import { transcribeAudio, transcribeAndSummarize, mockTranscription } from './transcription.js';
import { generateTextSummary, generateVideoScript, mockTextSummary, mockVideoScript } from './gemini-service.js';
import { generateVideo, mockVideoGeneration, downloadVideo } from './veo-service.js';
import { analyzePageContext, askAI, generateNextStepInsight } from './context-analyzer.js';
import { saveSessionToMongoDB, saveSessionToStorage, fetchSessionsFromMongoDB } from './mongodb-service.js';
import { saveRecordingState, saveSummaryData, saveVideoUrl, getRecordingState } from '../utils/storage.js';
import { CONFIG } from '../utils/constants.js';

const { STATES } = CONFIG;

// Current state
let currentState = STATES.IDLE;
let recordingDuration = 0;
let durationInterval = null;

// Session state
let sessionActive = false;
let sessionStartTime = null;
let sessionPages = [];

// Demo mode flag - set to true to use mock APIs
const DEMO_MODE = false; // Change to false for production

/**
 * Initialize the background script
 */
function initialize() {
  console.log('Chrome Flow background script initialized');
  
  // Restore state from storage
  getRecordingState().then(state => {
    if (state) {
      currentState = state.state || STATES.IDLE;
      recordingDuration = state.duration || 0;
    }
  });
}

/**
 * Update state and notify popup/content scripts
 * @param {string} newState - New state
 * @param {Object} extra - Extra data to include
 */
async function updateState(newState, extra = {}) {
  currentState = newState;
  
  // Save to storage
  await saveRecordingState({
    state: currentState,
    duration: recordingDuration,
    ...extra
  });

  // Notify all extension pages
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATE',
    state: currentState,
    duration: recordingDuration,
    ...extra
  }).catch(() => {
    // Popup might be closed, ignore error
  });

  // Notify ALL content scripts (Halo Strip is on all pages now)
  const tabs = await chrome.tabs.query({});
  tabs.forEach(tab => {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'STATE_UPDATE',
        state: currentState,
        duration: recordingDuration,
        ...extra
      }).catch(() => {
        // Tab might not have content script, ignore
      });
    }
  });
}

/**
 * Start the recording process
 */
async function startRecording() {
  try {
    console.log('Starting recording...');
    
    const result = await startAudioCapture();
    
    if (!result.success) {
      await updateState(STATES.ERROR, { error: result.error });
      return { success: false, error: result.error };
    }

    // Reset duration and start tracking
    recordingDuration = 0;
    durationInterval = setInterval(() => {
      recordingDuration = getRecordingDuration();
      chrome.runtime.sendMessage({
        type: 'STATE_UPDATE',
        state: STATES.RECORDING,
        duration: recordingDuration
      }).catch(() => {});
    }, 1000);

    await updateState(STATES.RECORDING);
    return { success: true };
  } catch (error) {
    console.error('Start recording error:', error);
    await updateState(STATES.ERROR, { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Stop recording and start the processing pipeline
 */
async function stopRecordingAndProcess() {
  try {
    console.log('Stopping recording...');

    // Clear duration interval
    if (durationInterval) {
      clearInterval(durationInterval);
      durationInterval = null;
    }

    // Stop audio capture
    const audioResult = await stopAudioCapture();
    
    if (!audioResult.success) {
      await updateState(STATES.ERROR, { error: audioResult.error });
      return { success: false, error: audioResult.error };
    }

    const { audioBlob, duration, mimeType } = audioResult;
    recordingDuration = duration;
    
    console.log(`Recording stopped. Duration: ${duration}s, Size: ${audioBlob.size} bytes`);

    // Start processing pipeline
    await processMeeting(audioBlob, mimeType);
    
    return { success: true };
  } catch (error) {
    console.error('Stop recording error:', error);
    await updateState(STATES.ERROR, { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Process the meeting recording through the full pipeline
 * @param {Blob} audioBlob - Recorded audio
 * @param {string} mimeType - Audio MIME type
 */
async function processMeeting(audioBlob, mimeType) {
  try {
    // Step 1: Transcription
    console.log('Step 1: Transcribing audio...');
    await updateState(STATES.TRANSCRIBING);

    let transcriptResult;
    if (DEMO_MODE) {
      transcriptResult = await mockTranscription();
    } else {
      // Use Gemini native audio transcription (no separate STT service needed!)
      transcriptResult = await transcribeAudio(audioBlob);
    }

    if (!transcriptResult.success) {
      throw new Error(`Transcription failed: ${transcriptResult.error}`);
    }

    const transcript = transcriptResult.transcript;
    console.log('Transcription complete:', transcript.substring(0, 100) + '...');

    // Step 2: Generate text summary with Gemini
    console.log('Step 2: Generating text summary...');
    await updateState(STATES.SUMMARIZING);

    let summaryResult;
    if (DEMO_MODE) {
      summaryResult = await mockTextSummary();
    } else {
      summaryResult = await generateTextSummary(transcript);
    }

    if (!summaryResult.success) {
      throw new Error(`Summary generation failed: ${summaryResult.error}`);
    }

    const summary = summaryResult.summary;
    console.log('Summary generated:', summary.title);

    // Step 3: Generate video script with Gemini
    console.log('Step 3: Generating video script...');

    let videoScriptResult;
    if (DEMO_MODE) {
      videoScriptResult = await mockVideoScript();
    } else {
      videoScriptResult = await generateVideoScript(summary);
    }

    if (!videoScriptResult.success) {
      // Video script failed, but we can still show text summary
      console.warn('Video script generation failed, continuing with text only');
      await saveSummaryData({
        transcript,
        summary,
        videoScript: null,
        hasVideo: false
      });
      await updateState(STATES.COMPLETE, { summaryReady: true });
      return;
    }

    const videoScript = videoScriptResult.videoScript;
    console.log('Video script generated. Style:', videoScript.selectedStyle);

    // Step 4: Generate video with Veo 3
    console.log('Step 4: Generating video with Veo 3...');
    await updateState(STATES.GENERATING_VIDEO);

    let videoResult;
    if (DEMO_MODE) {
      videoResult = await mockVideoGeneration();
    } else {
      videoResult = await generateVideo(videoScript);
    }

    if (!videoResult.success) {
      // Video generation failed, but we still have the text summary
      console.warn('Video generation failed:', videoResult.error);
      await saveSummaryData({
        transcript,
        summary,
        videoScript,
        hasVideo: false,
        videoError: videoResult.error
      });
      await updateState(STATES.COMPLETE, { summaryReady: true });
      return;
    }

    // Save video URL
    const videoUrl = videoResult.videoUrl;
    console.log('Video generated successfully!');

    // Save all data
    await saveSummaryData({
      transcript,
      summary,
      videoScript,
      hasVideo: true,
      videoUrl,
      recordingDuration,
      createdAt: Date.now()
    });

    await saveVideoUrl(videoUrl);

    // Get current tab URL for metadata
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    
    // Save session to MongoDB and Chrome storage
    const sessionData = {
      transcript,
      summary,
      videoScript,
      hasVideo: true,
      videoUrl,
      recordingDuration,
      createdAt: Date.now(),
      metadata: {
        domain: currentTab?.url ? new URL(currentTab.url).hostname : '',
        url: currentTab?.url || ''
      }
    };

    // Try MongoDB first, fallback to Chrome storage
    const mongoResult = await saveSessionToMongoDB(sessionData);
    if (!mongoResult.success) {
      console.log('MongoDB save failed, using Chrome storage:', mongoResult.error);
      await saveSessionToStorage(sessionData);
    }

      // Also save to Chrome storage for local access
      await saveSummaryData(sessionData);
      
      // Update sessions list in Chrome storage
      const storage = await chrome.storage.local.get(['sessions']);
      const sessions = storage.sessions || [];
      sessions.push({ ...sessionData, sessionId: mongoResult.sessionId || sessionData.sessionId });
      await chrome.storage.local.set({ sessions });

    // Complete! Send summary to content scripts
    await updateState(STATES.COMPLETE, { summaryReady: true });
    
    // Send summary directly to active tab's content script (reuse tabs from above)
    if (currentTab?.id) {
      chrome.tabs.sendMessage(currentTab.id, {
        type: 'SHOW_SUMMARY',
        summary: summary,
        videoUrl: videoUrl
      }).catch(() => {});
    }
    
    console.log('Processing pipeline complete!');

  } catch (error) {
    console.error('Processing pipeline error:', error);
    await updateState(STATES.ERROR, { error: error.message });
  }
}

/**
 * Reset state to idle
 */
async function resetState() {
  if (durationInterval) {
    clearInterval(durationInterval);
    durationInterval = null;
  }
  
  recordingDuration = 0;
  await updateState(STATES.IDLE);
  
  return { success: true };
}

/**
 * Handle messages from popup and content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.type);

  switch (message.type) {
    case 'START_RECORDING':
      startRecording().then(sendResponse);
      return true; // Keep channel open for async response

    case 'STOP_RECORDING':
      stopRecordingAndProcess().then(sendResponse);
      return true;

    case 'RESET':
      resetState().then(sendResponse);
      return true;

    case 'GET_STATE':
      sendResponse({
        state: currentState,
        duration: recordingDuration,
        isRecording: isRecording()
      });
      break;

    case 'MEETING_STATUS':
      // Log meeting status from content script
      console.log('Meeting status:', message.isInMeeting ? 'In meeting' : 'Not in meeting');
      break;

    case 'SESSION_START':
      handleSessionStart(message).then(sendResponse);
      return true;

    case 'SESSION_END':
      handleSessionEnd().then(sendResponse);
      return true;

    case 'ANALYZE_CONTEXT':
      analyzePageContext(message.context).then(sendResponse);
      return true;

    case 'ASK_AI':
      // Enhance context with browsing history
      const enhancedContext = {
        ...message.context,
        browsingHistory: sessionPages,
        sessionActive: sessionActive,
        sessionDuration: sessionStartTime ? Math.floor((Date.now() - sessionStartTime) / 1000 / 60) : 0
      };
      askAI(enhancedContext).then(result => {
        sendResponse(result);
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;

    case 'FETCH_SESSIONS':
      fetchSessionsFromMongoDB(message.options || {}).then(sendResponse);
      return true;

    case 'OPEN_LIBRARY':
      try {
        // Determine library URL - use config or fallback to extension library.html
        const libraryUrl = CONFIG.LIBRARY_URL || chrome.runtime.getURL('library.html');
        
        // Open library (React app or extension page)
        chrome.tabs.create({ url: libraryUrl }, (tab) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true });
          }
        });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return true;

    default:
      console.log('Unknown message type:', message.type);
  }
});

/**
 * Handle session start
 */
async function handleSessionStart(message) {
  sessionActive = true;
  sessionStartTime = Date.now();
  sessionPages = [{
    url: message.url,
    title: message.title,
    domain: new URL(message.url).hostname,
    timestamp: Date.now()
  }];
  
  console.log('Session started:', message.title);
  return { success: true };
}

/**
 * Handle session end
 */
async function handleSessionEnd() {
  const duration = sessionStartTime ? Math.floor((Date.now() - sessionStartTime) / 1000 / 60) : 0;
  
  console.log(`Session ended. Duration: ${duration} minutes, Pages visited: ${sessionPages.length}`);
  
  // Generate insight about the session
  if (sessionPages.length > 1 && !DEMO_MODE) {
    const insight = await generateNextStepInsight({
      duration,
      pages: sessionPages,
      currentPage: sessionPages[sessionPages.length - 1]
    });
    
    if (insight.success) {
      // Could show this to user
      console.log('Session insight:', insight.insight);
    }
  }
  
  sessionActive = false;
  sessionStartTime = null;
  sessionPages = [];
  
  return { success: true };
}

/**
 * Handle extension icon click - toggle strip visibility
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    // Send toggle message to content script
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_STRIP' }).catch(() => {
      console.log('Could not toggle strip - content script not loaded');
    });
  }
});

/**
 * Handle extension installation/update
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Chrome Flow installed!');
    // Could open onboarding page here
  } else if (details.reason === 'update') {
    console.log('Chrome Flow updated to version', chrome.runtime.getManifest().version);
  }
});

// Track tab updates to build browsing history
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (sessionActive && changeInfo.status === 'complete' && tab.url && tab.title) {
    // Add page to session history
    const pageInfo = {
      url: tab.url,
      title: tab.title,
      domain: new URL(tab.url).hostname,
      timestamp: Date.now()
    };
    
    // Avoid duplicates (same URL within 2 seconds)
    const recentPage = sessionPages[sessionPages.length - 1];
    if (!recentPage || recentPage.url !== pageInfo.url || 
        (pageInfo.timestamp - recentPage.timestamp) > 2000) {
      sessionPages.push(pageInfo);
      console.log('Page tracked:', pageInfo.title);
    }
  }
});

// Initialize
initialize();
