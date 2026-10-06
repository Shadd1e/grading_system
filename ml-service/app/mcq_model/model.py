"""
CNN architecture for single-letter MCQ recognition (A/B/C/D by default).

Kept deliberately small: this task is recognising one clean, isolated
character in a fixed-position box, which is exactly the case CNNs handle
well (Khandokar et al., 2021) — it does not need the depth of a full
ImageNet-style network.
"""
import torch
import torch.nn as nn


class MCQLetterCNN(nn.Module):
    def __init__(self, num_classes: int = 4, input_size: int = 28):
        """
        num_classes: number of possible letters (default 4 -> A,B,C,D).
                     Set to more if your exams use more options (e.g. 5 -> A-E).
        input_size: expected square input image size in pixels (28 matches EMNIST).
        """
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.BatchNorm2d(32),
            nn.MaxPool2d(2),  # -> input_size/2

            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.BatchNorm2d(64),
            nn.MaxPool2d(2),  # -> input_size/4

            nn.Conv2d(64, 128, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.BatchNorm2d(128),
            nn.MaxPool2d(2),  # -> input_size/8
        )

        reduced = input_size // 8
        flat_features = 128 * reduced * reduced

        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(0.4),
            nn.Linear(flat_features, 128),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(128, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.features(x)
        x = self.classifier(x)
        return x  # raw logits; apply softmax outside for probabilities
