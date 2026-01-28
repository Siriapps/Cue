import React, { useState, useEffect, useRef } from 'react';

// CSS-based 3D Avatar using transforms
// No Three.js dependency - works everywhere
function CSSAvatar({ pose, isAnimating }) {
  const [currentPose, setCurrentPose] = useState({});

  useEffect(() => {
    if (pose && pose.joints) {
      setCurrentPose(pose.joints);
    }
  }, [pose]);

  const getTransform = (joint) => {
    const rot = currentPose[joint]?.rotation || [0, 0, 0];
    const x = (rot[0] * 180) / Math.PI;
    const y = (rot[1] * 180) / Math.PI;
    const z = (rot[2] * 180) / Math.PI;
    return `rotateX(${x}deg) rotateY(${y}deg) rotateZ(${z}deg)`;
  };

  return (
    <div className="css-avatar-container">
      <div className="css-avatar" style={{ transform: isAnimating ? 'scale(1.02)' : 'scale(1)' }}>
        {/* Head */}
        <div 
          className="avatar-head" 
          style={{ transform: getTransform('head') }}
        >
          <div className="avatar-face">
            <div className="avatar-eye left"></div>
            <div className="avatar-eye right"></div>
          </div>
        </div>

        {/* Neck */}
        <div className="avatar-neck" style={{ transform: getTransform('neck') }}></div>

        {/* Torso */}
        <div className="avatar-torso" style={{ transform: getTransform('chest') }}>
          {/* Left Arm */}
          <div className="avatar-arm left">
            <div 
              className="avatar-upper-arm" 
              style={{ transform: getTransform('leftUpperArm') }}
            >
              <div 
                className="avatar-lower-arm"
                style={{ transform: getTransform('leftLowerArm') }}
              >
                <div className="avatar-hand"></div>
              </div>
            </div>
          </div>

          {/* Right Arm */}
          <div className="avatar-arm right">
            <div 
              className="avatar-upper-arm" 
              style={{ transform: getTransform('rightUpperArm') }}
            >
              <div 
                className="avatar-lower-arm"
                style={{ transform: getTransform('rightLowerArm') }}
              >
                <div className="avatar-hand"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Hips */}
        <div className="avatar-hips" style={{ transform: getTransform('hips') }}>
          {/* Left Leg */}
          <div className="avatar-leg left">
            <div 
              className="avatar-upper-leg"
              style={{ transform: getTransform('leftUpperLeg') }}
            >
              <div 
                className="avatar-lower-leg"
                style={{ transform: getTransform('leftLowerLeg') }}
              >
                <div className="avatar-foot"></div>
              </div>
            </div>
          </div>

          {/* Right Leg */}
          <div className="avatar-leg right">
            <div 
              className="avatar-upper-leg"
              style={{ transform: getTransform('rightUpperLeg') }}
            >
              <div 
                className="avatar-lower-leg"
                style={{ transform: getTransform('rightLowerLeg') }}
              >
                <div className="avatar-foot"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Status indicator
function StatusIndicator({ isLive, motionContext }) {
  return (
    <div className="avatar-status-bar">
      <div className={`status-indicator ${isLive ? 'live' : ''}`}>
        <span className="status-dot"></span>
        <span>{isLive ? 'Live' : 'Idle'}</span>
      </div>
      {motionContext && (
        <div className="motion-context-badge">{motionContext}</div>
      )}
    </div>
  );
}

// Main AvatarViewer component
export default function AvatarViewer({ 
  pose = null, 
  isLive = false,
  motionContext = null,
  width = '100%',
  height = 400,
  className = '',
}) {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (pose) {
      setIsAnimating(true);
      const duration = pose.duration_ms || 1000;
      const timer = setTimeout(() => setIsAnimating(false), duration);
      return () => clearTimeout(timer);
    }
  }, [pose]);

  return (
    <div className={`avatar-viewer-wrapper ${className}`} style={{ width, minHeight: height }}>
      <StatusIndicator isLive={isLive} motionContext={motionContext} />
      <CSSAvatar pose={pose} isAnimating={isAnimating} />

      <style>{`
        .avatar-viewer-wrapper {
          background: linear-gradient(180deg, #1a1a2e 0%, #0f1117 100%);
          border-radius: 16px;
          overflow: hidden;
          position: relative;
          display: flex;
          flex-direction: column;
        }

        .avatar-status-bar {
          position: absolute;
          top: 16px;
          left: 16px;
          right: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 10;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(10px);
          padding: 8px 14px;
          border-radius: 20px;
          color: #9ca3af;
          font-size: 12px;
          font-weight: 500;
        }

        .status-indicator.live {
          color: #4ade80;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #6b7280;
        }

        .status-indicator.live .status-dot {
          background: #4ade80;
          animation: pulse-glow 1.5s ease-in-out infinite;
        }

        @keyframes pulse-glow {
          0%, 100% { opacity: 1; box-shadow: 0 0 4px #4ade80; }
          50% { opacity: 0.6; box-shadow: 0 0 12px #4ade80; }
        }

        .motion-context-badge {
          background: rgba(139, 92, 246, 0.2);
          color: #a78bfa;
          padding: 6px 12px;
          border-radius: 12px;
          font-size: 11px;
          text-transform: capitalize;
        }

        .css-avatar-container {
          flex: 1;
          display: flex;
          justify-content: center;
          align-items: center;
          perspective: 800px;
          padding: 60px 20px 20px;
        }

        .css-avatar {
          position: relative;
          width: 140px;
          height: 320px;
          transform-style: preserve-3d;
          transition: transform 0.5s ease;
        }

        /* Head */
        .avatar-head {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 50px;
          height: 55px;
          background: linear-gradient(135deg, #fcd5ce 0%, #f9bec7 100%);
          border-radius: 50% 50% 45% 45%;
          transform-origin: center bottom;
          transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: inset 0 -5px 15px rgba(0,0,0,0.1);
        }

        .avatar-face {
          position: absolute;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          width: 30px;
          display: flex;
          justify-content: space-between;
        }

        .avatar-eye {
          width: 8px;
          height: 8px;
          background: #2d3748;
          border-radius: 50%;
        }

        /* Neck */
        .avatar-neck {
          position: absolute;
          top: 50px;
          left: 50%;
          transform: translateX(-50%);
          width: 20px;
          height: 12px;
          background: #fcd5ce;
          transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* Torso */
        .avatar-torso {
          position: absolute;
          top: 60px;
          left: 50%;
          transform: translateX(-50%);
          width: 70px;
          height: 90px;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          border-radius: 10px 10px 5px 5px;
          transform-origin: center top;
          transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: inset 0 5px 15px rgba(255,255,255,0.2),
                      inset 0 -5px 15px rgba(0,0,0,0.2);
        }

        /* Arms */
        .avatar-arm {
          position: absolute;
          top: 5px;
          transform-style: preserve-3d;
        }

        .avatar-arm.left {
          left: -15px;
        }

        .avatar-arm.right {
          right: -15px;
        }

        .avatar-upper-arm {
          width: 18px;
          height: 45px;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          border-radius: 10px;
          transform-origin: center top;
          transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: inset 0 3px 8px rgba(255,255,255,0.2);
        }

        .avatar-lower-arm {
          position: absolute;
          top: 40px;
          left: 50%;
          transform: translateX(-50%);
          width: 16px;
          height: 45px;
          background: linear-gradient(135deg, #fcd5ce 0%, #f9bec7 100%);
          border-radius: 8px;
          transform-origin: center top;
          transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .avatar-hand {
          position: absolute;
          bottom: -10px;
          left: 50%;
          transform: translateX(-50%);
          width: 16px;
          height: 16px;
          background: #fcd5ce;
          border-radius: 50%;
        }

        /* Hips */
        .avatar-hips {
          position: absolute;
          top: 150px;
          left: 50%;
          transform: translateX(-50%);
          width: 65px;
          height: 25px;
          background: linear-gradient(135deg, #374151 0%, #1f2937 100%);
          border-radius: 5px;
          transform-origin: center top;
          transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* Legs */
        .avatar-leg {
          position: absolute;
          top: 20px;
          transform-style: preserve-3d;
        }

        .avatar-leg.left {
          left: 8px;
        }

        .avatar-leg.right {
          right: 8px;
        }

        .avatar-upper-leg {
          width: 22px;
          height: 55px;
          background: linear-gradient(135deg, #374151 0%, #1f2937 100%);
          border-radius: 10px;
          transform-origin: center top;
          transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .avatar-lower-leg {
          position: absolute;
          top: 50px;
          left: 50%;
          transform: translateX(-50%);
          width: 20px;
          height: 55px;
          background: linear-gradient(135deg, #374151 0%, #1f2937 100%);
          border-radius: 10px;
          transform-origin: center top;
          transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .avatar-foot {
          position: absolute;
          bottom: -8px;
          left: 50%;
          transform: translateX(-50%);
          width: 26px;
          height: 12px;
          background: #1f2937;
          border-radius: 5px 5px 8px 8px;
        }
      `}</style>
    </div>
  );
}

// Preset pose viewer
export function PosePresetViewer({ presetName = 't_pose' }) {
  const [pose, setPose] = useState(null);

  useEffect(() => {
    fetch(`http://localhost:8000/pose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pose_name: presetName }),
    })
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          setPose(data);
        }
      })
      .catch(console.error);
  }, [presetName]);

  return <AvatarViewer pose={pose} />;
}
