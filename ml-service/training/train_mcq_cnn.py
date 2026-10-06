"""
Iteration 1 — Train the MCQ letter-recognition CNN.

Two-stage training, matching your methodology (3.4.1):
  Stage A: train on EMNIST-letters (public dataset), restricted to the
           letters you actually use as MCQ options (default A-D).
  Stage B (optional but recommended): fine-tune on your own locally
           collected handwriting samples, so the model adapts to real
           student handwriting rather than only EMNIST's style.

Usage:
    python train_mcq_cnn.py                          # Stage A only
    python train_mcq_cnn.py --local-data data/local_mcq_samples --epochs-finetune 10
                                                       # Stage A then Stage B

Local samples directory layout expected for Stage B (torchvision ImageFolder format):
    data/local_mcq_samples/
        A/  img1.png  img2.png  ...
        B/  img1.png  ...
        C/  ...
        D/  ...

Requires: torch, torchvision (see requirements.txt). Needs internet access
the first time it runs, to download EMNIST (~500MB) via torchvision.
"""
import argparse
import sys
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset, random_split
from torchvision import datasets, transforms
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.mcq_model.model import MCQLetterCNN  # noqa: E402

# EMNIST-letters labels are 1-indexed: 1='a', 2='b', ..., 26='z' (lowercase
# mapping in the 'letters' split, since it's case-insensitive by design).
EMNIST_LETTERS_OFFSET = 1  # label 1 == 'a'
DEFAULT_LETTERS = ["A", "B", "C", "D"]  # change this if your exams use e.g. A-E


# NOTE: this must be a module-level (not nested) function. DataLoader workers
# on Windows use the 'spawn' start method, which pickles every object passed
# to a worker process — including transform functions. A function defined
# inside another function ("local"/nested) cannot be pickled, so it must live
# here at module scope. (On Linux/Mac, which use 'fork', this wouldn't matter.)
def fix_emnist_orientation(img):
    """EMNIST images are stored rotated 90 degrees and mirrored relative to
    how they're normally displayed; this is a well-known quirk of the
    dataset. Fix with a -90 degree rotation followed by a horizontal flip."""
    return img.rotate(-90, expand=True).transpose(Image.FLIP_LEFT_RIGHT)


class FilteredLettersDataset(Dataset):
    """Wraps torchvision's EMNIST 'letters' split and keeps only the labels
    corresponding to the letters we actually care about (e.g. A-D), remapped
    to a compact 0..N-1 class range."""

    def __init__(self, emnist_dataset, letters: list[str]):
        self.base = emnist_dataset
        self.letters = letters
        # EMNIST-letters label for letter L = (ord(L.lower()) - ord('a')) + 1
        wanted_labels = {
            (ord(l.lower()) - ord("a")) + EMNIST_LETTERS_OFFSET: idx
            for idx, l in enumerate(letters)
        }
        self.label_map = wanted_labels
        self.indices = [
            i for i, (_, label) in enumerate(self.base) if label in wanted_labels
        ]

    def __len__(self):
        return len(self.indices)

    def __getitem__(self, i):
        image, label = self.base[self.indices[i]]
        return image, self.label_map[label]


def build_emnist_loaders(letters, batch_size, data_dir="./data/emnist", num_workers=0):
    train_transform = transforms.Compose([
        transforms.Lambda(fix_emnist_orientation),
        transforms.RandomRotation(10),
        transforms.RandomAffine(degrees=0, translate=(0.08, 0.08)),
        transforms.ToTensor(),
        transforms.Normalize((0.5,), (0.5,)),
    ])
    test_transform = transforms.Compose([
        transforms.Lambda(fix_emnist_orientation),
        transforms.ToTensor(),
        transforms.Normalize((0.5,), (0.5,)),
    ])

    full_train = datasets.EMNIST(
        root=data_dir, split="letters", train=True, download=True, transform=train_transform
    )
    full_test = datasets.EMNIST(
        root=data_dir, split="letters", train=False, download=True, transform=test_transform
    )

    train_ds = FilteredLettersDataset(full_train, letters)
    test_ds = FilteredLettersDataset(full_test, letters)

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=num_workers)
    test_loader = DataLoader(test_ds, batch_size=batch_size, shuffle=False, num_workers=num_workers)
    return train_loader, test_loader


def build_local_loaders(local_dir, letters, batch_size, val_split=0.2):
    """Load your own collected handwriting samples for Stage B fine-tuning.
    Expects torchvision ImageFolder layout with subfolders named exactly
    matching entries in `letters` (e.g. A/, B/, C/, D/)."""
    transform = transforms.Compose([
        transforms.Grayscale(num_output_channels=1),
        transforms.Resize((28, 28)),
        transforms.RandomRotation(8),
        transforms.RandomAffine(degrees=0, translate=(0.05, 0.05)),
        transforms.ToTensor(),
        transforms.Normalize((0.5,), (0.5,)),
    ])

    full_dataset = datasets.ImageFolder(root=local_dir, transform=transform)

    # Sanity check: fail loudly if folder names don't match expected letters,
    # rather than silently training on the wrong class indices.
    found_classes = set(full_dataset.classes)
    expected_classes = set(letters)
    if found_classes != expected_classes:
        raise ValueError(
            f"Local data folder classes {sorted(found_classes)} do not match "
            f"expected letters {sorted(expected_classes)}. Rename subfolders "
            f"to match exactly, or pass --letters to override."
        )

    val_size = max(1, int(len(full_dataset) * val_split))
    train_size = len(full_dataset) - val_size
    train_ds, val_ds = random_split(full_dataset, [train_size, val_size])

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False)
    return train_loader, val_loader


def train_one_epoch(model, loader, optimizer, criterion, device):
    model.train()
    total_loss, correct, total = 0.0, 0, 0
    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        optimizer.zero_grad()
        outputs = model(images)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()

        total_loss += loss.item() * images.size(0)
        preds = outputs.argmax(dim=1)
        correct += (preds == labels).sum().item()
        total += labels.size(0)
    return total_loss / total, correct / total


@torch.no_grad()
def evaluate(model, loader, criterion, device):
    model.eval()
    total_loss, correct, total = 0.0, 0, 0
    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        outputs = model(images)
        loss = criterion(outputs, labels)
        total_loss += loss.item() * images.size(0)
        preds = outputs.argmax(dim=1)
        correct += (preds == labels).sum().item()
        total += labels.size(0)
    return total_loss / total, correct / total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--letters", nargs="+", default=DEFAULT_LETTERS,
                         help="Which letters are valid MCQ options, e.g. A B C D E")
    parser.add_argument("--epochs", type=int, default=12, help="Epochs for Stage A (EMNIST)")
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--local-data", type=str, default=None,
                         help="Path to local samples folder for Stage B fine-tuning")
    parser.add_argument("--epochs-finetune", type=int, default=8,
                         help="Epochs for Stage B fine-tuning on local data")
    parser.add_argument("--finetune-lr", type=float, default=1e-4,
                         help="Lower LR for Stage B, since we're adapting not retraining")
    parser.add_argument("--output", type=str, default="./checkpoints/mcq_cnn.pt")
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    model = MCQLetterCNN(num_classes=len(args.letters)).to(device)
    criterion = nn.CrossEntropyLoss()

    # ---------------- Stage A: EMNIST ----------------
    print(f"\n=== Stage A: training on EMNIST-letters, classes={args.letters} ===")
    train_loader, test_loader = build_emnist_loaders(args.letters, args.batch_size)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)

    best_acc = 0.0
    for epoch in range(1, args.epochs + 1):
        train_loss, train_acc = train_one_epoch(model, train_loader, optimizer, criterion, device)
        val_loss, val_acc = evaluate(model, test_loader, criterion, device)
        print(f"[Stage A] Epoch {epoch}/{args.epochs} "
              f"train_loss={train_loss:.4f} train_acc={train_acc:.4f} "
              f"val_loss={val_loss:.4f} val_acc={val_acc:.4f}")
        best_acc = max(best_acc, val_acc)

    # ---------------- Stage B: local fine-tuning (optional) ----------------
    if args.local_data:
        print(f"\n=== Stage B: fine-tuning on local data at {args.local_data} ===")
        local_train_loader, local_val_loader = build_local_loaders(
            args.local_data, args.letters, args.batch_size
        )
        finetune_optimizer = torch.optim.Adam(model.parameters(), lr=args.finetune_lr)
        for epoch in range(1, args.epochs_finetune + 1):
            train_loss, train_acc = train_one_epoch(
                model, local_train_loader, finetune_optimizer, criterion, device
            )
            val_loss, val_acc = evaluate(model, local_val_loader, criterion, device)
            print(f"[Stage B] Epoch {epoch}/{args.epochs_finetune} "
                  f"train_loss={train_loss:.4f} train_acc={train_acc:.4f} "
                  f"val_loss={val_loss:.4f} val_acc={val_acc:.4f}")

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "model_state_dict": model.state_dict(),
        "letters": args.letters,
    }, output_path)
    print(f"\nSaved model to {output_path}")


if __name__ == "__main__":
    main()