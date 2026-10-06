"""TrOCR inference for handwritten completion/essay responses.

The ML service is responsible for transcription, not academic grading.
Long responses are split into handwriting lines when possible and each line is
transcribed independently before being reassembled in reading order.
"""
from pathlib import Path
from typing import Optional, Tuple, List

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from transformers import TrOCRProcessor, VisionEncoderDecoderModel


class PhraseRecognizer:
    def __init__(self, model_path: str, device: Optional[str] = None):
        self.device = torch.device(
            device or ("cuda" if torch.cuda.is_available() else "cpu")
        )
        self.processor = TrOCRProcessor.from_pretrained(model_path)
        self.model = VisionEncoderDecoderModel.from_pretrained(model_path).to(self.device)
        self.model.eval()

    def _split_lines(self, gray_image: np.ndarray) -> List[np.ndarray]:
        """Find likely handwritten text lines without assuming a fixed answer length."""
        gray = gray_image if len(gray_image.shape) == 2 else cv2.cvtColor(gray_image, cv2.COLOR_BGR2GRAY)
        ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
        projection = np.count_nonzero(ink, axis=1)
        active = projection > max(2, int(gray.shape[1] * 0.01))

        ranges = []
        start = None
        gap = 0
        max_gap = max(2, gray.shape[0] // 120)
        for i, on in enumerate(active):
            if on:
                if start is None:
                    start = i
                gap = 0
            elif start is not None:
                gap += 1
                if gap > max_gap:
                    end = i - gap + 1
                    if end - start >= 8:
                        ranges.append((max(0, start - 5), min(gray.shape[0], end + 5)))
                    start = None
                    gap = 0
        if start is not None:
            end = len(active)
            if end - start >= 8:
                ranges.append((max(0, start - 5), min(gray.shape[0], end + 5)))

        # If line detection is inconclusive, keep the original crop intact.
        if not ranges or len(ranges) > 80:
            return [gray]

        lines = []
        for y1, y2 in ranges:
            crop = gray[y1:y2, :]
            if np.count_nonzero(crop < 245) < 10:
                continue
            lines.append(crop)
        return lines or [gray]

    @torch.no_grad()
    def _predict_line(self, gray_image: np.ndarray, max_length: int = 128) -> Tuple[str, float]:
        rgb_image = Image.fromarray(gray_image).convert("RGB")
        pixel_values = self.processor(
            rgb_image, return_tensors="pt"
        ).pixel_values.to(self.device)

        outputs = self.model.generate(
            pixel_values,
            max_length=max_length,
            output_scores=True,
            return_dict_in_generate=True,
        )

        text = self.processor.batch_decode(
            outputs.sequences, skip_special_tokens=True
        )[0].strip()

        if not outputs.scores:
            return text, 0.0

        # Length-weighted token confidence. This is recognition confidence,
        # not correctness confidence.
        step_confidences = []
        for logits in outputs.scores:
            probs = F.softmax(logits, dim=-1)
            step_confidences.append(float(probs.max(dim=-1).values.mean().item()))
        return text, float(np.mean(step_confidences))

    def predict(self, gray_image: np.ndarray, max_length: int = 128) -> Tuple[str, float]:
        lines = self._split_lines(gray_image)
        recognised = []
        confidences = []

        for line in lines:
            text, confidence = self._predict_line(line, max_length=max_length)
            if text:
                recognised.append(text)
                confidences.append(confidence)

        if not recognised:
            return "", 0.0

        return "\n".join(recognised), float(np.mean(confidences))


def load_recognizer(model_path: str = "./checkpoints/trocr_finetuned") -> Optional["PhraseRecognizer"]:
    if not Path(model_path).exists():
        return None
    return PhraseRecognizer(model_path)
