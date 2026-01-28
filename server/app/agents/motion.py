"""
Motion Agent - Exercise Verb Detection via Gemini

Analyzes audio for physical movement instructions and extracts
exercise verbs, body parts, directions, and timing.
"""

from typing import Any, Dict, List, Optional

from app.agents.gemini_client import call_gemini


MOTION_PROMPT = """
You are an expert movement analyst. Analyze this audio for physical movement instructions.
Extract exercise verbs, body parts mentioned, directions, and timing.

Exercise verb categories to detect:
- Upper body: reach, stretch, raise, lower, rotate, bend, push, pull, extend, flex
- Lower body: squat, lunge, step, kick, extend, bend, kneel, stand
- Full body: twist, lean, balance, hold, breathe, relax, tighten

Return strict JSON format:
{
  "motions": [
    {
      "verb": "stretch",
      "body_part": "arm",
      "side": "right" | "left" | "both",
      "direction": "up" | "down" | "forward" | "back" | "left" | "right",
      "intensity": 0.0-1.0,
      "duration_ms": 2000,
      "timestamp": "00:15"
    }
  ],
  "context": "yoga instruction" | "physical therapy" | "exercise demo" | "general",
  "has_instructions": true | false
}

If no movement instructions are detected, return:
{
  "motions": [],
  "context": "general",
  "has_instructions": false
}
"""


def extract_motions(
    audio_base64: str,
    mime_type: str,
    chunk_start_seconds: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Extract movement instructions from audio using Gemini.
    
    Args:
        audio_base64: Base64-encoded audio data
        mime_type: MIME type of the audio (e.g., "audio/webm")
        chunk_start_seconds: Start time of this chunk in the overall recording
        
    Returns:
        Dictionary with motions array and context
    """
    prompt_text = "Analyze this audio segment for physical movement instructions."
    if chunk_start_seconds is not None:
        prompt_text += f" This chunk starts at {chunk_start_seconds} seconds."
    
    parts = [
        {"text": prompt_text},
        {
            "inlineData": {
                "mimeType": mime_type,
                "data": audio_base64,
            }
        },
    ]
    
    result = call_gemini(parts=parts, system_prompt=MOTION_PROMPT)
    
    # Ensure we have the expected structure
    if "motions" not in result:
        result = {
            "motions": [],
            "context": "general",
            "has_instructions": False,
        }
    
    return result


def parse_motion_to_animation_hint(motion: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert a detected motion into an animation hint for the puppeteer.
    
    Args:
        motion: Single motion dictionary from extract_motions
        
    Returns:
        Animation hint with target positions and timing
    """
    verb = motion.get("verb", "").lower()
    body_part = motion.get("body_part", "").lower()
    side = motion.get("side", "both")
    direction = motion.get("direction", "")
    intensity = motion.get("intensity", 0.5)
    duration_ms = motion.get("duration_ms", 1000)
    
    # Map body parts to joint names
    joint_mapping = {
        "arm": ["shoulder", "elbow", "wrist"],
        "leg": ["hip", "knee", "ankle"],
        "hand": ["wrist", "fingers"],
        "head": ["neck", "head"],
        "torso": ["spine", "chest"],
        "back": ["spine"],
        "shoulder": ["shoulder"],
        "knee": ["knee"],
        "hip": ["hip"],
    }
    
    # Map directions to rotation hints
    direction_rotations = {
        "up": {"x": -0.5, "y": 0, "z": 0},
        "down": {"x": 0.5, "y": 0, "z": 0},
        "forward": {"x": -0.3, "y": 0, "z": 0},
        "back": {"x": 0.3, "y": 0, "z": 0},
        "left": {"x": 0, "y": -0.5, "z": 0},
        "right": {"x": 0, "y": 0.5, "z": 0},
    }
    
    # Map verbs to animation types
    verb_animations = {
        "stretch": "extend",
        "raise": "lift",
        "lower": "drop",
        "bend": "flex",
        "rotate": "twist",
        "reach": "extend",
        "squat": "lower_body",
        "lunge": "step_forward",
        "kick": "swing",
        "hold": "static",
        "relax": "reset",
    }
    
    affected_joints = joint_mapping.get(body_part, [body_part])
    base_rotation = direction_rotations.get(direction, {"x": 0, "y": 0, "z": 0})
    animation_type = verb_animations.get(verb, "generic")
    
    # Scale rotation by intensity
    scaled_rotation = {
        k: v * intensity for k, v in base_rotation.items()
    }
    
    return {
        "type": "animation_hint",
        "verb": verb,
        "animation_type": animation_type,
        "joints": affected_joints,
        "side": side,
        "rotation": scaled_rotation,
        "intensity": intensity,
        "duration_ms": duration_ms,
        "easing": "ease-in-out" if duration_ms > 500 else "ease-out",
    }


def batch_motions_to_sequence(motions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Convert a batch of motions into a timed animation sequence.
    
    Args:
        motions: List of motion dictionaries
        
    Returns:
        Animation sequence with keyframes
    """
    if not motions:
        return {
            "type": "sequence",
            "keyframes": [],
            "total_duration_ms": 0,
        }
    
    keyframes = []
    current_time = 0
    
    for motion in motions:
        hint = parse_motion_to_animation_hint(motion)
        keyframes.append({
            "start_ms": current_time,
            "duration_ms": hint["duration_ms"],
            "hint": hint,
        })
        current_time += hint["duration_ms"]
    
    return {
        "type": "sequence",
        "keyframes": keyframes,
        "total_duration_ms": current_time,
    }
