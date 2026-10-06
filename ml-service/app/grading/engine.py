"""Small recognition-result helpers.

Academic grading is intentionally outside the ML service. Pxxl owns answer
keys, marks, Context settings, DeepSeek calls, and HIGH/UNCERTAIN/UNRELATED
outcomes. This module is retained for compatibility with imports from the old
prototype.
"""
from typing import Dict, Optional


def recognition_status(confidence: float, threshold: float = 0.75) -> str:
    return "HIGH_CERTAINTY" if confidence >= threshold else "UNCERTAIN"


def build_recognition_result(question_id: str, question_type: str,
                             text: str, confidence: float,
                             threshold: float = 0.75) -> Dict:
    return {
        "question_id": question_id,
        "type": question_type,
        "recognized_text": text,
        "recognition_confidence": float(confidence),
        "recognition_status": recognition_status(confidence, threshold),
    }
