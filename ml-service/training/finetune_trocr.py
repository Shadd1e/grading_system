"""
Iteration 2 — Fine-tune a pretrained TrOCR model for short-phrase recognition.

Starts from 'microsoft/trocr-base-handwritten' (Li et al., 2021) and adapts it
to your own short-phrase samples, since training a transformer OCR model from
scratch is far beyond undergraduate-project scope/data availability.

--- Data format expected ---
A CSV file with two columns: `file_name`, `text`
    file_name          text
    sample_0001.png    hash table
    sample_0002.png    binary search tree
    ...
and the actual images living in the same folder (or pass --images-dir).

Realistically you will only have 50-300 labelled samples for a final-year
project. That's fine — fine-tuning a pretrained model needs far less data
than training from scratch, but expect accuracy to improve a lot as you add
more samples, and expect this to be the part of the project with the most
room for future extension (see your own Chapter 1, section 1.4).

Usage:
    python finetune_trocr.py --csv data/phrase_samples/labels.csv \\
                              --images-dir data/phrase_samples \\
                              --epochs 15 --output ./checkpoints/trocr_finetuned

Requires: transformers, torch, accelerate, sentencepiece, Pillow.
Needs internet access on first run to download the base TrOCR checkpoint
(~1.3GB). Strongly recommend a GPU — fine-tuning a transformer on CPU will
be extremely slow.
"""
import argparse
import csv
from pathlib import Path

import torch
from PIL import Image
from torch.utils.data import Dataset, DataLoader, random_split
from torch.optim import AdamW
from transformers import (
    TrOCRProcessor,
    VisionEncoderDecoderModel,
    get_linear_schedule_with_warmup,
)


class PhraseDataset(Dataset):
    def __init__(self, csv_path: str, images_dir: str, processor: TrOCRProcessor, max_length: int = 24):
        self.images_dir = Path(images_dir)
        self.processor = processor
        self.max_length = max_length
        self.samples = []
        with open(csv_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                self.samples.append((row["file_name"], row["text"]))

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        file_name, text = self.samples[idx]
        image_path = self.images_dir / file_name
        image = Image.open(image_path).convert("RGB")

        pixel_values = self.processor(image, return_tensors="pt").pixel_values.squeeze(0)

        labels = self.processor.tokenizer(
            text,
            padding="max_length",
            max_length=self.max_length,
            truncation=True,
            return_tensors="pt",
        ).input_ids.squeeze(0)

        # Replace pad token id with -100 so the loss function ignores padding.
        labels[labels == self.processor.tokenizer.pad_token_id] = -100

        return {"pixel_values": pixel_values, "labels": labels}


def train_one_epoch(model, loader, optimizer, scheduler, device):
    model.train()
    total_loss = 0.0
    for batch in loader:
        pixel_values = batch["pixel_values"].to(device)
        labels = batch["labels"].to(device)

        outputs = model(pixel_values=pixel_values, labels=labels)
        loss = outputs.loss

        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        scheduler.step()

        total_loss += loss.item()
    return total_loss / len(loader)


@torch.no_grad()
def evaluate(model, loader, processor, device, max_examples_to_print: int = 3):
    model.eval()
    total_loss = 0.0
    printed = 0
    for batch in loader:
        pixel_values = batch["pixel_values"].to(device)
        labels = batch["labels"].to(device)

        outputs = model(pixel_values=pixel_values, labels=labels)
        total_loss += outputs.loss.item()

        if printed < max_examples_to_print:
            generated_ids = model.generate(pixel_values, max_length=24)
            predictions = processor.batch_decode(generated_ids, skip_special_tokens=True)
            safe_labels = labels.clone()
            safe_labels[safe_labels == -100] = processor.tokenizer.pad_token_id
            references = processor.batch_decode(safe_labels, skip_special_tokens=True)
            for pred, ref in zip(predictions, references):
                if printed >= max_examples_to_print:
                    break
                print(f"    pred='{pred}'  |  true='{ref}'")
                printed += 1

    return total_loss / len(loader)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True, help="Path to labels.csv (file_name,text)")
    parser.add_argument("--images-dir", required=True, help="Folder containing the images referenced in the CSV")
    parser.add_argument("--base-model", default="microsoft/trocr-base-handwritten")
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=4,
                         help="Keep small (4-8) — TrOCR is memory-hungry, especially on limited GPU memory")
    parser.add_argument("--lr", type=float, default=5e-5)
    parser.add_argument("--val-split", type=float, default=0.15)
    parser.add_argument("--output", default="./checkpoints/trocr_finetuned")
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")
    if device.type == "cpu":
        print("WARNING: no GPU detected. Fine-tuning TrOCR on CPU will be very slow. "
              "Consider using a free Colab/Kaggle GPU runtime if you don't have local GPU access.")

    print(f"Loading base model: {args.base_model} (downloads on first run, ~1.3GB)")
    processor = TrOCRProcessor.from_pretrained(args.base_model)
    model = VisionEncoderDecoderModel.from_pretrained(args.base_model).to(device)

    # Required generation config for TrOCR fine-tuning.
    model.config.decoder_start_token_id = processor.tokenizer.cls_token_id
    model.config.pad_token_id = processor.tokenizer.pad_token_id
    model.config.vocab_size = model.config.decoder.vocab_size

    full_dataset = PhraseDataset(args.csv, args.images_dir, processor)
    val_size = max(1, int(len(full_dataset) * args.val_split))
    train_size = len(full_dataset) - val_size
    if train_size <= 0:
        raise ValueError(
            f"Only {len(full_dataset)} samples found — need more than "
            f"{val_size} to leave anything for training. Collect more samples "
            f"or lower --val-split."
        )
    train_ds, val_ds = random_split(full_dataset, [train_size, val_size])
    print(f"Training on {train_size} samples, validating on {val_size} samples.")

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False)

    optimizer = AdamW(model.parameters(), lr=args.lr)
    total_steps = len(train_loader) * args.epochs
    scheduler = get_linear_schedule_with_warmup(
        optimizer, num_warmup_steps=int(0.1 * total_steps), num_training_steps=total_steps
    )

    for epoch in range(1, args.epochs + 1):
        train_loss = train_one_epoch(model, train_loader, optimizer, scheduler, device)
        print(f"Epoch {epoch}/{args.epochs} — train_loss={train_loss:.4f}")
        val_loss = evaluate(model, val_loader, processor, device)
        print(f"Epoch {epoch}/{args.epochs} — val_loss={val_loss:.4f}")

    output_path = Path(args.output)
    output_path.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(output_path)
    processor.save_pretrained(output_path)
    print(f"\nSaved fine-tuned model + processor to {output_path}")


if __name__ == "__main__":
    main()
