/**
 * Voice Debug Test Utility
 * 
 * This utility helps test and verify voice functionality in the browser console.
 * Usage: Import and call test functions from browser console or React DevTools.
 */

import { checkBrowserSupport, checkMicrophonePermission, requestMicrophoneAccess, isSpeechRecognitionAvailable, getSpeechRecognition } from './voiceUtils';

/**
 * Test browser support for voice features
 */
export async function testBrowserSupport() {
  console.log('=== Testing Browser Support ===');
  
  const support = checkBrowserSupport();
  console.log('Browser Support:', support);
  
  if (!support.supported) {
    console.error('❌ Browser does not support required features:', support.reason);
    return false;
  }
  
  console.log('✅ Browser supports all required features');
  return true;
}

/**
 * Test microphone permission
 */
export async function testMicrophonePermission() {
  console.log('=== Testing Microphone Permission ===');
  
  try {
    const permission = await checkMicrophonePermission();
    console.log('Permission status:', permission);
    
    if (permission === 'granted') {
      console.log('✅ Microphone permission granted');
      return true;
    } else if (permission === 'prompt') {
      console.log('⚠️ Microphone permission needs to be requested');
      return false;
    } else {
      console.error('❌ Microphone permission denied');
      return false;
    }
  } catch (error) {
    console.error('❌ Error checking permission:', error);
    return false;
  }
}

/**
 * Test microphone access request
 */
export async function testMicrophoneAccess() {
  console.log('=== Testing Microphone Access ===');
  
  try {
    const stream = await requestMicrophoneAccess();
    console.log('✅ Microphone access granted');
    console.log('Stream tracks:', stream.getTracks().length);
    
    // Stop tracks to release microphone
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (error) {
    console.error('❌ Failed to access microphone:', error);
    return false;
  }
}

/**
 * Test Web Speech API availability
 */
export function testSpeechRecognition() {
  console.log('=== Testing Speech Recognition ===');
  
  const available = isSpeechRecognitionAvailable();
  console.log('Speech Recognition available:', available);
  
  if (!available) {
    console.error('❌ Speech Recognition not available');
    return false;
  }
  
  const SpeechRecognition = getSpeechRecognition();
  if (!SpeechRecognition) {
    console.error('❌ Speech Recognition constructor not found');
    return false;
  }
  
  console.log('✅ Speech Recognition available');
  console.log('Constructor:', SpeechRecognition.name);
  
  // Try to create an instance
  try {
    const recognition = new SpeechRecognition();
    console.log('✅ Speech Recognition instance created');
    console.log('Recognition object:', recognition);
    return true;
  } catch (error) {
    console.error('❌ Failed to create recognition:', error);
    return false;
  }
}

/**
 * Test wake word detection (simulated)
 */
export function testWakeWordDetection() {
  console.log('=== Testing Wake Word Detection ===');
  
  const SpeechRecognition = getSpeechRecognition();
  if (!SpeechRecognition) {
    console.error('❌ Speech Recognition not available');
    return false;
  }
  
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  
  let detected = false;
  
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.toLowerCase().trim();
      console.log('Heard:', transcript);
      
      if (transcript.includes('hey cue') || transcript.includes('hey q')) {
        detected = true;
        console.log('✅ Wake word "Hey Cue" detected!');
        recognition.stop();
      }
    }
  };
  
  recognition.onerror = (event) => {
    console.error('Recognition error:', event.error);
  };
  
  recognition.onend = () => {
    if (!detected) {
      console.log('⚠️ Wake word not detected. Try saying "Hey Cue"');
    }
  };
  
  console.log('🎤 Starting wake word test... Say "Hey Cue"');
  recognition.start();
  
  // Auto-stop after 10 seconds
  setTimeout(() => {
    if (recognition) {
      recognition.stop();
      if (!detected) {
        console.log('⏱️ Test timeout - wake word not detected');
      }
    }
  }, 10000);
  
  return true;
}

/**
 * Test full transcription flow
 */
export function testTranscription() {
  console.log('=== Testing Transcription ===');
  
  const SpeechRecognition = getSpeechRecognition();
  if (!SpeechRecognition) {
    console.error('❌ Speech Recognition not available');
    return false;
  }
  
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  
  recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript + ' ';
      } else {
        interimTranscript += transcript;
      }
    }
    
    const fullTranscript = finalTranscript + interimTranscript;
    console.log('📝 Transcript:', fullTranscript);
    
    if (finalTranscript) {
      console.log('✅ Final:', finalTranscript.trim());
    }
  };
  
  recognition.onerror = (event) => {
    console.error('❌ Recognition error:', event.error);
  };
  
  recognition.onend = () => {
    console.log('⏹️ Transcription stopped');
  };
  
  console.log('🎤 Starting transcription test... Speak now');
  recognition.start();
  
  // Auto-stop after 15 seconds
  setTimeout(() => {
    if (recognition) {
      recognition.stop();
      console.log('⏱️ Test timeout - stopping transcription');
    }
  }, 15000);
  
  return true;
}

/**
 * Run all tests
 */
export async function runAllTests() {
  console.log('🚀 Running All Voice Tests...\n');
  
  const results = {
    browserSupport: await testBrowserSupport(),
    microphonePermission: await testMicrophonePermission(),
    microphoneAccess: false,
    speechRecognition: testSpeechRecognition(),
  };
  
  if (results.microphonePermission) {
    results.microphoneAccess = await testMicrophoneAccess();
  }
  
  console.log('\n=== Test Summary ===');
  console.table(results);
  
  const allPassed = Object.values(results).every(r => r === true);
  
  if (allPassed) {
    console.log('✅ All tests passed!');
  } else {
    console.log('⚠️ Some tests failed. Check the logs above.');
  }
  
  return results;
}

/**
 * Quick test - just check if everything is available
 */
export async function quickTest() {
  console.log('⚡ Quick Voice Test\n');
  
  const support = checkBrowserSupport();
  console.log('Browser Support:', support.supported ? '✅' : '❌', support.reason || '');
  
  const permission = await checkMicrophonePermission();
  console.log('Microphone Permission:', permission === 'granted' ? '✅' : '⚠️', permission);
  
  const speechAvailable = isSpeechRecognitionAvailable();
  console.log('Speech Recognition:', speechAvailable ? '✅' : '❌');
  
  return {
    supported: support.supported,
    permission: permission === 'granted',
    speechAvailable,
  };
}

// Export default object with all test functions
export default {
  testBrowserSupport,
  testMicrophonePermission,
  testMicrophoneAccess,
  testSpeechRecognition,
  testWakeWordDetection,
  testTranscription,
  runAllTests,
  quickTest,
};

