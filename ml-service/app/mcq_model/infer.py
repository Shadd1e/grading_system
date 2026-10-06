"""
Inference wrapper around the trained MCQLetterCNN, used by the FastAPI app.
Keeps model-loading and pre/post-processing details out of main.py.
"""
from pathlib import Path
from typing import Optional, Tuple

import numpy as np
import torch
import torch.nn.functional as F
from torchvision import transforms

from app.mcq_model.model import MCQLetterCNN


class MCQRecognizer:
    def __init__(self, checkpoint_path: str, device: Optional[str] = None):
        self.device = torch.device(
            device or ("cuda" if torch.cuda.is_available() else "cpu")
        )
        checkpoint = torch.load(checkpoint_path, map_location=self.device)
        self.letters = checkpoint["letters"]

        self.model = MCQLetterCNN(num_classes=len(self.letters)).to(self.device)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.eval()

        self.transform = transforms.Compose([
            transforms.ToPILImage(),
            transforms.Resize((28, 28)),
            transforms.ToTensor(),
            transforms.Normalize((0.5,), (0.5,)),
        ])

    @torch.no_grad()
    def predict(self, gray_image: np.ndarray) -> Tuple[str, float]:
        """gray_image: single-channel numpy array (as produced by segment.py).
        Returns (predicted_letter, confidence in [0, 1])."""
        tensor = self.transform(gray_image).unsqueeze(0).to(self.device)
        logits = self.model(tensor)
        probs = F.softmax(logits, dim=1).squeeze(0)
        conf, idx = torch.max(probs, dim=0)
        return self.letters[idx.item()], float(conf.item())


def load_recognizer(checkpoint_path: str = "./checkpoints/mcq_cnn.pt") -> Optional["MCQRecognizer"]:
    """Returns None (rather than raising) if the checkpoint doesn't exist yet,
    so the FastAPI app can start up and report a clear error instead of
    crashing before you've trained a model."""
    if not Path(checkpoint_path).exists():
        return None
    return MCQRecognizer(checkpoint_path)
