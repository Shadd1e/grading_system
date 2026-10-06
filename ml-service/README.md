# ML Service — Setup & Usage Guide

## 1. Install

```bash
cd ml-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Requires internet access (to download EMNIST and the pretrained TrOCR
checkpoint) and, for TrOCR fine-tuning, a GPU is strongly recommended.
Everything else (segmentation, MCQ CNN training) works fine on CPU, if slowly.

## 2. Run the parts that already work, right now

The OpenCV segmentation pipeline needs no trained models and no internet.
Try it immediately:

```bash
python app/preprocessing/segment.py
```

This generates a synthetic (fake) answer sheet, deliberately rotated a
couple of degrees, runs it through deskewing + box-cropping, and prints how
many question boxes it found. You should see 10/10 boxes found. Open
`data/samples/synthetic_test_sheet.png` to see what it drew.

Run the automated tests the same way:

```bash
python -m pytest tests/test_segmentation.py -v
```

## 3. Train the MCQ CNN (Iteration 1)

```bash
python training/train_mcq_cnn.py --epochs 12
```

First run downloads EMNIST (~500MB) automatically. Training 12 epochs on
CPU takes maybe 15-30 minutes for 4 letter classes; much faster on GPU.

Once you've collected some real student handwriting samples (see below),
fine-tune on them:

```bash
python training/train_mcq_cnn.py --epochs 12 \
    --local-data data/local_mcq_samples \
    --epochs-finetune 10
```

**Collecting local MCQ samples:** ask volunteers to write A/B/C/D
repeatedly in isolated boxes (you can literally print a grid of small boxes
labelled nothing, photograph it, and crop each cell out). Aim for at least
30-50 samples per letter to start. Organise into:
```
data/local_mcq_samples/A/*.png
data/local_mcq_samples/B/*.png
data/local_mcq_samples/C/*.png
data/local_mcq_samples/D/*.png
```

Output: `checkpoints/mcq_cnn.pt`

## 4. Fine-tune TrOCR (Iteration 2)

You need labelled short-phrase samples first: crop out real short-answer
handwriting boxes and transcribe them by hand. See
`data/samples/phrase_labels_example.csv` for the expected format.

Realistically start small — even 50-100 samples is enough to see whether
fine-tuning is working, then keep adding more as you collect them.

```bash
python training/finetune_trocr.py \
    --csv data/phrase_samples/labels.csv \
    --images-dir data/phrase_samples \
    --epochs 15
```

If you don't have local GPU access, use a free Kaggle or Google Colab GPU
runtime for this step specifically — upload just the `training/` folder,
your CSV, and your images.

Output: `checkpoints/trocr_finetuned/` (a folder, not a single file)

## 5. Run the full service

Once both checkpoints exist:

```bash
uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000/docs` — this gives you an interactive page
where you can upload a scanned answer sheet image and an answer key path,
and see the full pipeline run, with no frontend code needed yet.

Example with curl instead:

```bash
curl -X POST "http://localhost:8000/grade-script" \
  -F "file=@/path/to/scanned_sheet.png" \
  -F "answer_key_path=data/answer_key_example.json" \
  -F "student_id=STU001"
```

Then to confirm/correct a flagged item:

```bash
curl -X POST "http://localhost:8000/scripts/STU001/review" \
  -H "Content-Type: application/json" \
  -d '{"question_id": "q3", "corrected_score": 2}'
```

## 6. Before you can grade a REAL scanned sheet

`data/template.json` currently describes a made-up 10-question layout for
testing. You need to:

1. Design your actual answer sheet (print/PDF) with the same four solid
   black corner squares as alignment markers.
2. Scan or photograph a blank copy at a reasonably high, consistent
   resolution.
3. Measure the pixel coordinates of the markers and every answer box on
   that scan (any image editor with a pixel-coordinate cursor readout works,
   e.g. GIMP, Preview, or even `matplotlib`'s interactive viewer).
4. Update `reference_width`, `reference_height`, `alignment_markers`, and
   `questions` in `template.json` to match exactly.
5. Re-run `python app/preprocessing/segment.py` logic against a real scanned
   test sheet (swap the synthetic generator call for `cv2.imread` on your
   real file) to confirm boxes line up before trusting it on a full class set.

## What's a stub vs what's real here

| Component | Status |
|---|---|
| `app/preprocessing/segment.py` | Fully working, tested in this environment |
| `app/grading/engine.py` | Fully working, tested in this environment |
| `training/train_mcq_cnn.py` | Complete, syntax-checked — needs you to run it (needs internet + torch) |
| `training/finetune_trocr.py` | Complete, syntax-checked — needs you to run it (needs internet + torch + transformers) |
| `app/main.py` (FastAPI) | Complete, syntax-checked — needs both trained models to be useful end-to-end |
| Node.js backend / React frontend | Not started — build these last, per the main README |
