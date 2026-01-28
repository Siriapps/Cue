import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

export default function AudioSessionCard({ session }) {
  const audioRef = useRef(null);
  const [svg, setSvg] = useState("");

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false });
  }, []);

  useEffect(() => {
    if (!session?.result?.mermaid_code) return;
    mermaid
      .render(`diagram-${session._id}`, session.result.mermaid_code)
      .then((result) => setSvg(result.svg))
      .catch(() => setSvg(""));
  }, [session]);

  const handleSeek = (timestamp) => {
    if (!audioRef.current || !timestamp) return;
    const [mm, ss] = timestamp.split(":").map((val) => parseInt(val, 10));
    if (Number.isNaN(mm) || Number.isNaN(ss)) return;
    audioRef.current.currentTime = mm * 60 + ss;
  };

  const nodeTimestamps = session?.result?.node_timestamps || {};

  return (
    <div className="card audio-card">
      <div className="card-left">
        <audio ref={audioRef} controls src={session?.audioUrl || ""} />
        <div className="card-caption">{session?.payload?.source_url}</div>
      </div>
      <div className="card-right">
        <div
          className="mermaid-diagram"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="timestamp-list">
          {Object.entries(nodeTimestamps).map(([node, time]) => (
            <button
              key={`${node}-${time}`}
              className="timestamp-btn"
              onClick={() => handleSeek(time)}
            >
              {node} • {time}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
