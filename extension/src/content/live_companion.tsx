import React, { useState, useEffect, useRef, useCallback } from "react";

interface Joint {
  rotation: number[];
  position: number[];
}

interface PoseData {
  type: string;
  joints: Record<string, Joint>;
  interpolation?: string;
  duration_ms?: number;
  easing?: string;
  context?: string;
}

interface MotionData {
  type: string;
  motions: Array<{
    verb: string;
    body_part: string;
    direction: string;
    intensity: number;
  }>;
  context: string;
}

// Simple 2D avatar visualization using CSS transforms
// (Three.js is too heavy for content script injection)
function Avatar2D({ pose }: { pose: PoseData | null }) {
  const [animatedPose, setAnimatedPose] = useState<Record<string, number[]>>({});

  useEffect(() => {
    if (pose && pose.joints) {
      // Animate to new pose
      const newPose: Record<string, number[]> = {};
      Object.entries(pose.joints).forEach(([joint, data]) => {
        newPose[joint] = data.rotation || [0, 0, 0];
      });
      setAnimatedPose(newPose);
    }
  }, [pose]);

  const getRotation = (joint: string): string => {
    const rot = animatedPose[joint] || [0, 0, 0];
    // Convert radians to degrees for CSS
    const x = (rot[0] * 180) / Math.PI;
    const y = (rot[1] * 180) / Math.PI;
    const z = (rot[2] * 180) / Math.PI;
    return `rotateX(${x}deg) rotateY(${y}deg) rotateZ(${z}deg)`;
  };

  return (
    <div className="avatar-2d">
      {/* Head */}
      <div
        className="avatar-part head"
        style={{ transform: getRotation("head") }}
      />
      {/* Torso */}
      <div className="avatar-part torso" />
      {/* Left Arm */}
      <div className="avatar-limb left-arm">
        <div
          className="avatar-part upper-arm"
          style={{ transform: getRotation("leftUpperArm") }}
        >
          <div
            className="avatar-part lower-arm"
            style={{ transform: getRotation("leftLowerArm") }}
          >
            <div className="avatar-part hand" />
          </div>
        </div>
      </div>
      {/* Right Arm */}
      <div className="avatar-limb right-arm">
        <div
          className="avatar-part upper-arm"
          style={{ transform: getRotation("rightUpperArm") }}
        >
          <div
            className="avatar-part lower-arm"
            style={{ transform: getRotation("rightLowerArm") }}
          >
            <div className="avatar-part hand" />
          </div>
        </div>
      </div>
      {/* Left Leg */}
      <div className="avatar-limb left-leg">
        <div
          className="avatar-part upper-leg"
          style={{ transform: getRotation("leftUpperLeg") }}
        >
          <div
            className="avatar-part lower-leg"
            style={{ transform: getRotation("leftLowerLeg") }}
          >
            <div className="avatar-part foot" />
          </div>
        </div>
      </div>
      {/* Right Leg */}
      <div className="avatar-limb right-leg">
        <div
          className="avatar-part upper-leg"
          style={{ transform: getRotation("rightUpperLeg") }}
        >
          <div
            className="avatar-part lower-leg"
            style={{ transform: getRotation("rightLowerLeg") }}
          >
            <div className="avatar-part foot" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Motion indicator showing detected actions
function MotionIndicator({ motion }: { motion: MotionData | null }) {
  if (!motion || !motion.motions?.length) return null;

  const lastMotion = motion.motions[motion.motions.length - 1];

  return (
    <div className="motion-indicator">
      <div className="motion-verb">{lastMotion.verb}</div>
      <div className="motion-details">
        {lastMotion.body_part} {lastMotion.direction}
      </div>
    </div>
  );
}

export function LiveCompanion(): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [currentPose, setCurrentPose] = useState<PoseData | null>(null);
  const [currentMotion, setCurrentMotion] = useState<MotionData | null>(null);
  const [context, setContext] = useState<string>("general");
  const hideTimeout = useRef<number | null>(null);

  // Listen for messages from background script
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === "GO_LIVE_STARTED") {
        setIsLive(true);
        setIsExpanded(false); // Start collapsed
      } else if (message.type === "GO_LIVE_STOPPED") {
        setIsLive(false);
        setIsExpanded(false);
        setCurrentPose(null);
        setCurrentMotion(null);
      } else if (message.type === "POSE_UPDATE") {
        const pose = message.payload as PoseData;
        setCurrentPose(pose);
        setContext(pose.context || "general");
        setIsExpanded(true);

        // Auto-collapse after pose animation completes
        if (hideTimeout.current) {
          clearTimeout(hideTimeout.current);
        }
        hideTimeout.current = window.setTimeout(() => {
          setIsExpanded(false);
        }, (pose.duration_ms || 1000) + 5000); // Stay visible 5s after animation
      } else if (message.type === "MOTION_DETECTED") {
        const motion = message.payload as MotionData;
        setCurrentMotion(motion);
        setContext(motion.context || "general");
        setIsExpanded(true);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      if (hideTimeout.current) {
        clearTimeout(hideTimeout.current);
      }
    };
  }, []);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  if (!isLive) return <></>;

  return (
    <div className={`live-companion ${isExpanded ? "expanded" : "collapsed"}`}>
      {/* Pulsing orb when collapsed */}
      <div className="companion-orb" onClick={toggleExpanded}>
        <div className="orb-inner" />
        <div className="orb-pulse" />
      </div>

      {/* Expanded card */}
      {isExpanded && (
        <div className="companion-card">
          <div className="card-header">
            <div className="status-live">
              <span className="live-dot" />
              Live
            </div>
            <div className="context-label">{context}</div>
            <button className="close-btn" onClick={toggleExpanded}>
              ×
            </button>
          </div>

          <div className="card-content">
            <Avatar2D pose={currentPose} />
            <MotionIndicator motion={currentMotion} />
          </div>
        </div>
      )}

      <style>{`
        .live-companion {
          position: fixed;
          bottom: 100px;
          right: 20px;
          z-index: 2147483646;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .live-companion.collapsed {
          width: 60px;
          height: 60px;
        }

        .live-companion.expanded {
          width: 280px;
          height: auto;
        }

        .companion-orb {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          cursor: pointer;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
          transition: transform 0.2s ease;
        }

        .companion-orb:hover {
          transform: scale(1.1);
        }

        .expanded .companion-orb {
          display: none;
        }

        .orb-inner {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.3);
        }

        .orb-pulse {
          position: absolute;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: rgba(102, 126, 234, 0.5);
          animation: pulse-ring 1.5s ease-out infinite;
        }

        @keyframes pulse-ring {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(1.5);
            opacity: 0;
          }
        }

        .companion-card {
          background: rgba(26, 26, 46, 0.95);
          backdrop-filter: blur(20px);
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          overflow: hidden;
          animation: slide-in 0.3s ease-out;
        }

        @keyframes slide-in {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .card-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .status-live {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #4ade80;
          font-size: 12px;
          font-weight: 600;
        }

        .live-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #4ade80;
          animation: blink 1s ease-in-out infinite;
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .context-label {
          flex: 1;
          color: #94a3b8;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .close-btn {
          background: none;
          border: none;
          color: #94a3b8;
          font-size: 20px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
          transition: color 0.2s;
        }

        .close-btn:hover {
          color: white;
        }

        .card-content {
          padding: 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }

        /* 2D Avatar Styles */
        .avatar-2d {
          width: 120px;
          height: 180px;
          position: relative;
          perspective: 400px;
        }

        .avatar-part {
          position: absolute;
          background: linear-gradient(135deg, #4a90d9 0%, #357abd 100%);
          border-radius: 4px;
          transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
          transform-origin: center top;
        }

        .avatar-part.head {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: #e0b8a0;
          left: 50%;
          top: 0;
          transform: translateX(-50%);
        }

        .avatar-part.torso {
          width: 50px;
          height: 60px;
          left: 50%;
          top: 35px;
          transform: translateX(-50%);
        }

        .avatar-limb {
          position: absolute;
        }

        .avatar-limb.left-arm {
          left: 15px;
          top: 38px;
        }

        .avatar-limb.right-arm {
          right: 15px;
          top: 38px;
        }

        .avatar-limb.left-leg {
          left: 30px;
          top: 95px;
        }

        .avatar-limb.right-leg {
          right: 30px;
          top: 95px;
        }

        .avatar-part.upper-arm,
        .avatar-part.upper-leg {
          width: 14px;
          height: 35px;
        }

        .avatar-part.lower-arm,
        .avatar-part.lower-leg {
          width: 12px;
          height: 35px;
          position: relative;
          top: 30px;
          left: 1px;
        }

        .avatar-part.hand,
        .avatar-part.foot {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          position: relative;
          top: 30px;
          left: -1px;
        }

        .avatar-part.hand {
          background: #e0b8a0;
        }

        .avatar-part.foot {
          border-radius: 4px;
          background: #333;
        }

        .avatar-part.lower-arm {
          background: #e0b8a0;
        }

        .avatar-part.upper-leg,
        .avatar-part.lower-leg {
          background: #2c3e50;
        }

        /* Motion Indicator */
        .motion-indicator {
          text-align: center;
          padding: 8px 16px;
          background: rgba(102, 126, 234, 0.2);
          border-radius: 8px;
          width: 100%;
        }

        .motion-verb {
          color: #667eea;
          font-size: 14px;
          font-weight: 600;
          text-transform: capitalize;
        }

        .motion-details {
          color: #94a3b8;
          font-size: 11px;
          margin-top: 2px;
        }
      `}</style>
    </div>
  );
}

export default LiveCompanion;
