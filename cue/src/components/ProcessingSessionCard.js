import React from 'react';

/**
 * ProcessingSessionCard - Shows a session that is currently being processed
 * Displays progress bar and step checklist during transcription/summarization
 */
function ProcessingSessionCard({ session }) {
  // Processing states: recording, transcribing, summarizing, saving, complete
  const state = session.processingState || 'recording';
  const progress = session.progress || 0;
  const title = session.title || 'Recording Session...';

  // Step definitions (matching main.py progress values)
  const steps = [
    { id: 'transcribing', label: 'Transcribing audio...', threshold: 10 },
    { id: 'summarizing', label: 'Generating AI summary...', threshold: 55 },
    { id: 'generating_video', label: 'Creating video summary...', threshold: 75 },
    { id: 'complete', label: 'Saving to library...', threshold: 95 },
  ];

  // Determine which steps are complete based on current step from server
  const currentStep = session.currentStep || 'transcribing';

  const getStepStatus = (step) => {
    const stepOrder = ['transcribing', 'summarizing', 'generating_video', 'complete'];
    const currentIdx = stepOrder.indexOf(currentStep);
    const stepIdx = stepOrder.indexOf(step.id);

    if (stepIdx < currentIdx) return 'complete';
    if (stepIdx === currentIdx) return 'active';
    return 'pending';
  };

  // Get status text based on current step
  const getStatusText = () => {
    if (state === 'recording') return 'Recording...';
    switch (currentStep) {
      case 'transcribing': return 'Transcribing audio...';
      case 'summarizing': return 'Generating summary...';
      case 'generating_video': return 'Creating video...';
      case 'complete': return 'Complete!';
      default: return 'Processing...';
    }
  };

  // Gradient based on state
  const getGradient = () => {
    if (state === 'recording') {
      return 'linear-gradient(135deg, #ef4444 0%, #dc2626 50%, #f87171 100%)';
    }
    return 'linear-gradient(135deg, #8b7dd8 0%, #6b5eb8 50%, #9b8dd8 100%)';
  };

  return (
    <div className={`session-card processing-card ${state}`}>
      {/* Thumbnail with shimmer effect */}
      <div 
        className="session-thumbnail processing-thumbnail"
        style={{ background: getGradient() }}
      >
        {/* Shimmer overlay */}
        <div className="shimmer-overlay"></div>

        {/* Recording indicator or processing spinner */}
        <div className="processing-indicator">
          {state === 'recording' ? (
            <div className="recording-pulse">
              <svg viewBox="0 0 24 24" fill="white" width="32" height="32">
                <circle cx="12" cy="12" r="8" />
              </svg>
            </div>
          ) : (
            <div className="processing-spinner">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" width="32" height="32">
                <circle cx="12" cy="12" r="10" opacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
              </svg>
            </div>
          )}
        </div>

        {/* Duration/Status Badge */}
        <div className="duration-badge processing-badge">
          {state === 'recording' ? (
            <>
              <span className="recording-dot"></span>
              {session.duration || '00:00'}
            </>
          ) : (
            `${Math.round(progress)}%`
          )}
        </div>
      </div>

      {/* Card Content */}
      <div className="session-content processing-content">
        {/* Title */}
        <div className="title-row">
          <h3 className="session-title">{title}</h3>
          <span className="processing-status">{getStatusText()}</span>
        </div>

        {/* Progress Bar */}
        {state !== 'recording' && (
          <div className="progress-bar-container">
            <div 
              className="progress-bar-fill" 
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        )}

        {/* Step Checklist */}
        {state !== 'recording' && (
          <div className="processing-steps">
            {steps.map((step) => {
              const status = getStepStatus(step);
              return (
                <div key={step.id} className={`step-item ${status}`}>
                  <span className="step-icon">
                    {status === 'complete' ? (
                      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                      </svg>
                    ) : status === 'active' ? (
                      <div className="step-spinner"></div>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                        <circle cx="12" cy="12" r="4" opacity="0.3"/>
                      </svg>
                    )}
                  </span>
                  <span className="step-label">{step.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Recording state message */}
        {state === 'recording' && (
          <p className="recording-message">
            Recording audio from the current tab...
          </p>
        )}
      </div>
    </div>
  );
}

export default ProcessingSessionCard;

