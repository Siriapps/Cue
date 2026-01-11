import React, { useState, useEffect } from 'react';

/**
 * ProcessingStatus Component
 * Shows the current processing state while generating summary
 */

const STEPS = [
  { id: 'transcribing', label: 'Transcribing Audio', icon: '📝', description: 'Converting speech to text...' },
  { id: 'summarizing', label: 'Generating Summary', icon: '🧠', description: 'Gemini is analyzing your meeting...' },
  { id: 'generating_video', label: 'Creating Video', icon: '🎬', description: 'Veo 3 is generating visual summary...' }
];

const STATE_TO_STEP = {
  'transcribing': 0,
  'summarizing': 1,
  'generating_video': 2,
  'complete': 3
};

function ProcessingStatus() {
  const [currentState, setCurrentState] = useState('transcribing');
  const [dots, setDots] = useState('');

  useEffect(() => {
    // Animate dots
    const dotsInterval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);

    // Listen for state updates
    const handleMessage = (message) => {
      if (message.type === 'STATE_UPDATE') {
        setCurrentState(message.state);
        
        // If complete, reload the page to show summary
        if (message.state === 'complete') {
          window.location.reload();
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    // Get initial state
    chrome.storage.local.get(['recordingState'], (result) => {
      if (result.recordingState?.state) {
        setCurrentState(result.recordingState.state);
      }
    });

    return () => {
      clearInterval(dotsInterval);
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const currentStepIndex = STATE_TO_STEP[currentState] ?? 0;
  const currentStep = STEPS[currentStepIndex] || STEPS[0];

  return (
    <div className="processing-overlay">
      <div className="processing-content fade-in">
        {/* Spinner */}
        <div className="processing-spinner"></div>
        
        {/* Title */}
        <h1 className="processing-title">
          Processing Your Meeting{dots}
        </h1>
        
        <p className="processing-subtitle">
          {currentStep?.description || 'Please wait while we analyze your meeting'}
        </p>

        {/* Progress Steps */}
        <div className="processing-steps">
          {STEPS.map((step, index) => {
            const isActive = index === currentStepIndex;
            const isCompleted = index < currentStepIndex;
            
            return (
              <div 
                key={step.id} 
                className={`processing-step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
              >
                <div className="step-indicator">
                  {isCompleted ? '✓' : step.icon}
                </div>
                <span className="step-label">{step.label}</span>
              </div>
            );
          })}
        </div>

        {/* Estimated Time */}
        <p style={{ 
          marginTop: '24px', 
          fontSize: '13px', 
          color: 'var(--text-muted)' 
        }}>
          This may take 1-2 minutes depending on meeting length
        </p>
      </div>
    </div>
  );
}

export default ProcessingStatus;
