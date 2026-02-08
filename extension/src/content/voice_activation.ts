/**
 * Voice Activation Listener
 * Listens for wake phrase (default: "Hey cue help me") to activate the chat popup.
 * Uses Web Speech API for continuous speech recognition.
 */

const WAKE_PHRASE_STORAGE_KEY = "cue_wake_phrase_v1";
const DEFAULT_WAKE_PHRASE = "hey cue help me";

// TypeScript declarations for Web Speech API
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

let recognition: SpeechRecognition | null = null;
let isListening = false;
let currentWakePhrase = DEFAULT_WAKE_PHRASE;
let isActivationEnabled = true;
let shouldBeListening = false; // Tracks if user wants voice activation on
let isPaused = false; // Temporarily paused (e.g., when popup is open)

/**
 * Get the wake phrase from storage
 */
export async function getWakePhrase(): Promise<string> {
  return new Promise((resolve) => {
    try {
      if (!chrome?.storage?.local) {
        resolve(DEFAULT_WAKE_PHRASE);
        return;
      }
      chrome.storage.local.get([WAKE_PHRASE_STORAGE_KEY], (result) => {
        const phrase = result?.[WAKE_PHRASE_STORAGE_KEY];
        resolve(typeof phrase === "string" && phrase.trim() ? phrase.trim().toLowerCase() : DEFAULT_WAKE_PHRASE);
      });
    } catch {
      resolve(DEFAULT_WAKE_PHRASE);
    }
  });
}

/**
 * Save a custom wake phrase to storage
 */
export async function setWakePhrase(phrase: string): Promise<void> {
  const normalizedPhrase = phrase.trim().toLowerCase() || DEFAULT_WAKE_PHRASE;
  currentWakePhrase = normalizedPhrase;
  
  return new Promise((resolve) => {
    try {
      if (!chrome?.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.set({ [WAKE_PHRASE_STORAGE_KEY]: normalizedPhrase }, () => {
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

/**
 * Check if the transcript contains the wake phrase.
 * Also accepts "hey cue" as a shorter trigger when full phrase is "hey cue help me".
 */
function containsWakePhrase(transcript: string, wakePhrase: string): boolean {
  const normalizedTranscript = transcript.toLowerCase().trim();
  const normalizedPhrase = wakePhrase.toLowerCase().trim();
  
  const variations = [
    normalizedPhrase,
    normalizedPhrase.replace("cue", "queue"),
    normalizedPhrase.replace("cue", "q"),
    normalizedPhrase.replace("cue", "cute"),
    normalizedPhrase.replace("hey", "hay"),
    normalizedPhrase.replace("hey", "hi"),
  ];
  
  if (variations.some((v) => normalizedTranscript.includes(v))) {
    return true;
  }
  
  // Accept "hey cue" / "hay cue" etc. as trigger when full phrase contains it (e.g. "hey cue help me")
  const shortTriggers = ["hey cue", "hay cue", "hi cue", "hey queue", "hay queue"];
  if (shortTriggers.some((t) => normalizedTranscript.includes(t) && normalizedPhrase.includes("cue"))) {
    return true;
  }
  
  return false;
}

/**
 * Dispatch the voice activation event.
 * Uses bubbles: true so document-level listeners also receive it.
 */
function dispatchActivationEvent(transcript: string): void {
  console.log("[cue] Wake phrase detected! Opening voice chat popup, transcript:", transcript);
  const event = new CustomEvent("cue:voice-activated", {
    detail: { transcript, wakePhrase: currentWakePhrase },
    bubbles: true,
  });
  window.dispatchEvent(event);
}

/**
 * Check if Speech Recognition is supported
 */
export function isSpeechRecognitionSupported(): boolean {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Start the voice activation listener
 */
export async function startVoiceActivation(): Promise<boolean> {
  console.log("[cue] startVoiceActivation called, current state:", { isListening, shouldBeListening, isPaused, hasRecognition: !!recognition });
  
  if (!isSpeechRecognitionSupported()) {
    console.warn("[cue] Speech Recognition not supported in this browser");
    return false;
  }

  // If paused, don't start
  if (isPaused) {
    console.log("[cue] Voice activation is paused, not starting");
    return false;
  }

  shouldBeListening = true;

  if (isListening && recognition) {
    console.log("[cue] Voice activation already running");
    return true;
  }

  // Clean up any existing recognition
  if (recognition) {
    try {
      recognition.abort();
    } catch {
      // Ignore
    }
    recognition = null;
  }

  // Load the wake phrase
  currentWakePhrase = await getWakePhrase();
  console.log("[cue] Voice activation starting with wake phrase:", currentWakePhrase);

  const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognitionClass();

  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.maxAlternatives = 3;

  recognition.onstart = () => {
    isListening = true;
    console.log("[cue] Voice activation listening...");
    window.dispatchEvent(new CustomEvent("cue:voice-listening-started"));
  };

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    if (!isActivationEnabled) return;

    // Check recent results for the wake phrase
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      for (let j = 0; j < result.length; j++) {
        const transcript = result[j].transcript;
        
        if (containsWakePhrase(transcript, currentWakePhrase)) {
          // Temporarily disable to prevent multiple triggers
          isActivationEnabled = false;
          dispatchActivationEvent(transcript);
          
          // Re-enable after a delay
          setTimeout(() => {
            isActivationEnabled = true;
          }, 2000);
          
          return;
        }
      }
    }
  };

  let lastRecoverableError = 0;
  const RECOVERABLE_ERROR_THROTTLE_MS = 8000;

  recognition.onerror = (event) => {
    // Don't restart on "not-allowed" or "service-not-allowed" errors
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      isListening = false;
      console.warn("[cue] Speech recognition permission denied:", event.error);
      window.dispatchEvent(new CustomEvent("cue:voice-permission-denied"));
      return;
    }
    // no-speech is expected during silence - throttle logging to avoid console spam
    if (event.error === "no-speech") {
      const now = Date.now();
      if (now - lastRecoverableError > RECOVERABLE_ERROR_THROTTLE_MS) {
        lastRecoverableError = now;
        console.debug("[cue] No speech detected (will auto-restart)");
      }
    } else {
      console.warn("[cue] Speech recognition error:", event.error);
    }
  };

  recognition.onend = () => {
    isListening = false;
    
    // Don't auto-restart if paused (popup is using the mic)
    if (isPaused) {
      return;
    }
    
    // Auto-restart if user wants voice activation enabled
    if (shouldBeListening) {
      // Discard the old recognition instance - after no-speech/errors it may be in a bad state.
      // Creating a fresh instance gives us the best chance of a clean restart.
      const oldRecognition = recognition;
      recognition = null;
      if (oldRecognition) {
        try {
          oldRecognition.abort();
        } catch {
          // Ignore
        }
      }
      
      setTimeout(() => {
        if (shouldBeListening && !isListening && !isPaused) {
          console.log("[cue] Restarting voice activation (fresh instance)...");
          startVoiceActivation();
        }
      }, 400);
    } else {
      window.dispatchEvent(new CustomEvent("cue:voice-listening-stopped"));
    }
  };

  try {
    recognition.start();
    return true;
  } catch (error) {
    console.error("[cue] Failed to start speech recognition:", error);
    isListening = false;
    return false;
  }
}

/**
 * Stop the voice activation listener
 */
export function stopVoiceActivation(): void {
  shouldBeListening = false;
  isListening = false;
  if (recognition) {
    try {
      recognition.stop();
    } catch {
      // Ignore errors when stopping
    }
    recognition = null;
  }
  console.log("[cue] Voice activation stopped");
  window.dispatchEvent(new CustomEvent("cue:voice-listening-stopped"));
}

/**
 * Pause voice activation (call when popup opens)
 */
export function pauseVoiceActivation(): void {
  console.log("[cue] Pausing voice activation, current state:", { isListening, shouldBeListening, isPaused });
  isPaused = true;
  
  // Stop current recognition
  if (recognition) {
    try {
      recognition.abort(); // Use abort instead of stop for immediate termination
    } catch {
      // Ignore
    }
    recognition = null;
  }
  isListening = false;
  console.log("[cue] Voice activation paused successfully");
}

/**
 * Resume voice activation (call when popup closes)
 */
export async function resumeVoiceActivation(): Promise<boolean> {
  console.log("[cue] Resuming voice activation, state:", { shouldBeListening, isPaused, isListening });
  isPaused = false;
  
  if (!shouldBeListening) {
    console.log("[cue] Not resuming - shouldBeListening is false");
    return false;
  }
  
  isActivationEnabled = true;
  
  // Delay to ensure popup's recognition is fully released
  console.log("[cue] Waiting 500ms before restarting...");
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log("[cue] Now calling startVoiceActivation...");
  const result = await startVoiceActivation();
  console.log("[cue] startVoiceActivation result:", result);
  return result;
}

/**
 * Check if voice activation is currently listening
 */
export function isVoiceActivationListening(): boolean {
  return isListening;
}

/**
 * Toggle voice activation on/off
 */
export async function toggleVoiceActivation(): Promise<boolean> {
  if (isListening) {
    stopVoiceActivation();
    return false;
  } else {
    return await startVoiceActivation();
  }
}

// Listen for storage changes to update wake phrase
try {
  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[WAKE_PHRASE_STORAGE_KEY]) {
        const newPhrase = changes[WAKE_PHRASE_STORAGE_KEY].newValue;
        if (typeof newPhrase === "string" && newPhrase.trim()) {
          currentWakePhrase = newPhrase.trim().toLowerCase();
          console.log("[cue] Wake phrase updated to:", currentWakePhrase);
        }
      }
    });
  }
} catch {
  // Ignore
}

// When tab becomes visible and we should be listening but aren't, try to restart.
// User focusing the tab (e.g. by clicking it) may provide the activation needed for start().
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && shouldBeListening && !isListening && !isPaused) {
      console.log("[cue] Tab visible, attempting to resume voice activation...");
      setTimeout(() => startVoiceActivation(), 200);
    }
  });
}
