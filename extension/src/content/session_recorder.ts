/**
 * Session Recorder - Handles audio recording directly in content script
 * Uses navigator.mediaDevices.getUserMedia() for microphone capture
 * No offscreen documents or tabCapture needed!
 */

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let audioStream: MediaStream | null = null;
let isRecording = false;

export async function startMicRecording(): Promise<void> {
  if (isRecording || mediaRecorder) {
    console.warn("[cue] Recording already in progress");
    return;
  }

  try {
    // Request microphone access directly in content script
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    audioChunks = [];
    const options = { mimeType: "audio/webm;codecs=opus" };

    try {
      mediaRecorder = new MediaRecorder(audioStream, options);
    } catch (err: any) {
      mediaRecorder = new MediaRecorder(audioStream);
    }

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onerror = (event: Event) => {
      console.error("[cue] MediaRecorder error:", event);
    };

    mediaRecorder.start(5000); // Collect chunks every 5second
    isRecording = true;
    console.log("[cue] Microphone recording started");
  } catch (error: any) {
    isRecording = false;
    throw error;
  }
}

export function pauseMicRecording(): void {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.pause();
    console.log("[cue] Recording paused");
  }
}

export function resumeMicRecording(): void {
  if (mediaRecorder && mediaRecorder.state === "paused") {
    mediaRecorder.resume();
    console.log("[cue] Recording resumed");
  }
}

export async function stopMicRecording(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder || !isRecording) {
      reject(new Error("No active recording"));
      return;
    }

    mediaRecorder.onstop = () => {
      const mimeType = mediaRecorder?.mimeType || "audio/webm";
      const blob = new Blob(audioChunks, { type: mimeType });

      console.log("[cue] Recording stopped, blob size:", blob.size);

      // Cleanup
      if (audioStream) {
        audioStream.getTracks().forEach((track) => track.stop());
        audioStream = null;
      }
      mediaRecorder = null;
      audioChunks = [];
      isRecording = false;

      resolve(blob);
    };

    if (mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    } else {
      // Already stopped, just return what we have
      const mimeType = mediaRecorder?.mimeType || "audio/webm";
      const blob = new Blob(audioChunks, { type: mimeType });

      if (audioStream) {
        audioStream.getTracks().forEach((track) => track.stop());
        audioStream = null;
      }
      mediaRecorder = null;
      audioChunks = [];
      isRecording = false;

      resolve(blob);
    }
  });
}

export function isMicRecording(): boolean {
  return isRecording;
}
