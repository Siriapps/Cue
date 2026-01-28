"""
Puppeteer Agent - IK Pose Generation

Converts motion hints into Inverse Kinematics target positions
and generates pose JSON compatible with Three.js avatars.
"""

import math
from typing import Any, Dict, List, Optional


# Standard humanoid skeleton joint hierarchy
SKELETON = {
    "hips": {"parent": None, "position": [0, 1.0, 0]},
    "spine": {"parent": "hips", "position": [0, 1.1, 0]},
    "chest": {"parent": "spine", "position": [0, 1.3, 0]},
    "neck": {"parent": "chest", "position": [0, 1.5, 0]},
    "head": {"parent": "neck", "position": [0, 1.65, 0]},
    # Left arm
    "leftShoulder": {"parent": "chest", "position": [-0.15, 1.45, 0]},
    "leftUpperArm": {"parent": "leftShoulder", "position": [-0.25, 1.4, 0]},
    "leftLowerArm": {"parent": "leftUpperArm", "position": [-0.45, 1.2, 0]},
    "leftHand": {"parent": "leftLowerArm", "position": [-0.6, 1.0, 0]},
    # Right arm
    "rightShoulder": {"parent": "chest", "position": [0.15, 1.45, 0]},
    "rightUpperArm": {"parent": "rightShoulder", "position": [0.25, 1.4, 0]},
    "rightLowerArm": {"parent": "rightUpperArm", "position": [0.45, 1.2, 0]},
    "rightHand": {"parent": "rightLowerArm", "position": [0.6, 1.0, 0]},
    # Left leg
    "leftUpperLeg": {"parent": "hips", "position": [-0.1, 0.9, 0]},
    "leftLowerLeg": {"parent": "leftUpperLeg", "position": [-0.1, 0.5, 0]},
    "leftFoot": {"parent": "leftLowerLeg", "position": [-0.1, 0.05, 0]},
    # Right leg
    "rightUpperLeg": {"parent": "hips", "position": [0.1, 0.9, 0]},
    "rightLowerLeg": {"parent": "rightUpperLeg", "position": [0.1, 0.5, 0]},
    "rightFoot": {"parent": "rightLowerLeg", "position": [0.1, 0.05, 0]},
}

# Neutral T-pose rotations (all zeros)
NEUTRAL_POSE = {joint: [0, 0, 0] for joint in SKELETON.keys()}


def get_affected_joints(body_part: str, side: str) -> List[str]:
    """
    Get the list of joints affected by a body part reference.
    
    Args:
        body_part: Body part name (arm, leg, hand, etc.)
        side: "left", "right", or "both"
        
    Returns:
        List of joint names
    """
    part_to_joints = {
        "arm": ["UpperArm", "LowerArm", "Hand"],
        "shoulder": ["Shoulder", "UpperArm"],
        "elbow": ["LowerArm"],
        "wrist": ["Hand"],
        "hand": ["Hand"],
        "leg": ["UpperLeg", "LowerLeg", "Foot"],
        "hip": ["UpperLeg"],
        "knee": ["LowerLeg"],
        "ankle": ["Foot"],
        "foot": ["Foot"],
        "head": ["neck", "head"],
        "neck": ["neck"],
        "torso": ["spine", "chest"],
        "spine": ["spine"],
        "chest": ["chest"],
    }
    
    base_joints = part_to_joints.get(body_part.lower(), [])
    
    if not base_joints:
        return []
    
    # Handle bilateral joints
    result = []
    for joint in base_joints:
        if joint in ["neck", "head", "spine", "chest", "hips"]:
            result.append(joint)
        else:
            # Joint needs side prefix
            if side in ["left", "both"]:
                result.append(f"left{joint}")
            if side in ["right", "both"]:
                result.append(f"right{joint}")
    
    return result


def compute_rotation_for_direction(
    direction: str,
    intensity: float = 1.0,
) -> List[float]:
    """
    Compute Euler rotation (in radians) for a movement direction.
    
    Args:
        direction: Movement direction
        intensity: 0.0 to 1.0 scale factor
        
    Returns:
        [x, y, z] Euler rotation in radians
    """
    # Base rotation angles (in radians, scaled by intensity)
    max_rotation = math.pi / 2  # 90 degrees max
    
    direction_map = {
        "up": [-max_rotation * 0.8, 0, 0],  # Rotate backward (arm up)
        "down": [max_rotation * 0.5, 0, 0],  # Rotate forward (arm down)
        "forward": [-max_rotation * 0.5, 0, 0],
        "back": [max_rotation * 0.3, 0, 0],
        "left": [0, max_rotation * 0.5, 0],
        "right": [0, -max_rotation * 0.5, 0],
        "out": [0, 0, max_rotation * 0.7],  # Abduction
        "in": [0, 0, -max_rotation * 0.3],  # Adduction
    }
    
    base = direction_map.get(direction, [0, 0, 0])
    return [r * intensity for r in base]


def generate_pose_for_motion(motion_hint: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate a full pose JSON from a motion hint.
    
    Args:
        motion_hint: Output from motion.parse_motion_to_animation_hint
        
    Returns:
        Pose JSON for Three.js avatar
    """
    joints = {}
    
    # Start with neutral pose
    for joint in SKELETON.keys():
        joints[joint] = {
            "rotation": list(NEUTRAL_POSE[joint]),
            "position": list(SKELETON[joint]["position"]),
        }
    
    # Get animation parameters from hint
    hint_joints = motion_hint.get("joints", [])
    side = motion_hint.get("side", "both")
    rotation_hint = motion_hint.get("rotation", {})
    intensity = motion_hint.get("intensity", 0.5)
    animation_type = motion_hint.get("animation_type", "generic")
    
    # Convert rotation hint to radians
    rotation = [
        rotation_hint.get("x", 0) * math.pi,
        rotation_hint.get("y", 0) * math.pi,
        rotation_hint.get("z", 0) * math.pi,
    ]
    
    # Apply rotation to affected joints
    for hint_joint in hint_joints:
        affected = get_affected_joints(hint_joint, side)
        for joint_name in affected:
            if joint_name in joints:
                # Apply rotation with some propagation down the chain
                joints[joint_name]["rotation"] = rotation
    
    # Apply animation-specific adjustments
    if animation_type == "lower_body":
        # Squat - bend hips and knees
        joints["hips"]["position"][1] -= 0.3 * intensity
        joints["leftUpperLeg"]["rotation"] = [0.8 * intensity, 0, 0]
        joints["rightUpperLeg"]["rotation"] = [0.8 * intensity, 0, 0]
        joints["leftLowerLeg"]["rotation"] = [-1.2 * intensity, 0, 0]
        joints["rightLowerLeg"]["rotation"] = [-1.2 * intensity, 0, 0]
    
    elif animation_type == "step_forward":
        # Lunge - one leg forward, one back
        if side == "left" or side == "both":
            joints["leftUpperLeg"]["rotation"] = [-0.6 * intensity, 0, 0]
            joints["leftLowerLeg"]["rotation"] = [0.4 * intensity, 0, 0]
        if side == "right" or side == "both":
            joints["rightUpperLeg"]["rotation"] = [0.3 * intensity, 0, 0]
    
    elif animation_type == "extend":
        # Stretch/reach - extend limbs outward
        pass  # Already handled by base rotation
    
    elif animation_type == "reset":
        # Relax - return to neutral
        for joint in joints:
            joints[joint]["rotation"] = [0, 0, 0]
    
    return {
        "type": "pose",
        "joints": joints,
        "interpolation": "smooth",
        "duration_ms": motion_hint.get("duration_ms", 1000),
        "easing": motion_hint.get("easing", "ease-in-out"),
    }


def generate_pose_sequence(
    motion_hints: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Generate a sequence of poses from multiple motion hints.
    
    Args:
        motion_hints: List of motion hints from the motion agent
        
    Returns:
        Pose sequence JSON with keyframes
    """
    keyframes = []
    current_time = 0
    
    for hint in motion_hints:
        pose = generate_pose_for_motion(hint)
        keyframes.append({
            "time_ms": current_time,
            "pose": pose,
        })
        current_time += pose.get("duration_ms", 1000)
    
    # Add return to neutral at the end
    keyframes.append({
        "time_ms": current_time,
        "pose": {
            "type": "pose",
            "joints": {joint: {"rotation": [0, 0, 0], "position": list(SKELETON[joint]["position"])} 
                      for joint in SKELETON.keys()},
            "interpolation": "smooth",
            "duration_ms": 500,
            "easing": "ease-out",
        },
    })
    
    return {
        "type": "pose_sequence",
        "keyframes": keyframes,
        "total_duration_ms": current_time + 500,
        "loop": False,
    }


def map_audio_to_motion(transcript: str) -> Dict[str, Any]:
    """
    Legacy function - Map transcript to motion data.
    Kept for backward compatibility.
    """
    return {
        "motions": [],
        "note": "Use extract_motions from motion.py for audio-to-motion mapping",
        "transcript_excerpt": transcript[:200] if transcript else "",
    }


# Predefined poses for common exercises
PRESET_POSES = {
    "t_pose": {
        joint: {"rotation": [0, 0, 0], "position": list(data["position"])}
        for joint, data in SKELETON.items()
    },
    "arms_up": {
        **{joint: {"rotation": [0, 0, 0], "position": list(SKELETON[joint]["position"])} 
           for joint in SKELETON.keys()},
        "leftUpperArm": {"rotation": [-math.pi/2, 0, 0], "position": [-0.25, 1.4, 0]},
        "rightUpperArm": {"rotation": [-math.pi/2, 0, 0], "position": [0.25, 1.4, 0]},
    },
    "squat": {
        **{joint: {"rotation": [0, 0, 0], "position": list(SKELETON[joint]["position"])} 
           for joint in SKELETON.keys()},
        "hips": {"rotation": [0, 0, 0], "position": [0, 0.7, 0]},
        "leftUpperLeg": {"rotation": [0.8, 0, 0], "position": [-0.1, 0.6, 0]},
        "rightUpperLeg": {"rotation": [0.8, 0, 0], "position": [0.1, 0.6, 0]},
        "leftLowerLeg": {"rotation": [-1.2, 0, 0], "position": [-0.1, 0.3, 0]},
        "rightLowerLeg": {"rotation": [-1.2, 0, 0], "position": [0.1, 0.3, 0]},
    },
}


def get_preset_pose(pose_name: str) -> Optional[Dict[str, Any]]:
    """Get a predefined pose by name."""
    if pose_name not in PRESET_POSES:
        return None
    
    return {
        "type": "pose",
        "joints": PRESET_POSES[pose_name],
        "interpolation": "smooth",
        "duration_ms": 1000,
        "easing": "ease-in-out",
    }
