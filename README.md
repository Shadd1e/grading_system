# Handwriting Grading Assistant — Starter Project

This is a working skeleton for the system described in your project: a Python/FastAPI
ML service that recognises handwritten MCQ letters (CNN) and short-phrase answers
(fine-tuned TrOCR), plus a grading engine that scores automatically and flags
low-confidence responses for human review.

**Build order (matches your Chapter 3 methodology — do not skip ahead):**

1. `ml-service/training/train_mcq_cnn.py` — train the MCQ letter classifier (Iteration 1)
2. `ml-service/training/finetune_trocr.py` — fine-tune TrOCR for short phrases (Iteration 2)
3. `ml-service/app/preprocessing/segment.py` — answer-sheet template + OpenCV segmentation (Iteration 3)
4. `ml-service/app/main.py` — FastAPI service tying it all together (Iteration 4, backend)
5. Node.js backend + React frontend — build these last, once the API above works standalone

Everything through step 4 can be developed and tested **without any web frontend at all**,
using the FastAPI interactive docs (`/docs`) or plain `curl`/Postman. That's deliberate —
it's the same isolation-first approach your methodology chapter describes.

## What's actually in this zip

- A **working** OpenCV segmentation pipeline (`segment.py`) — tested in this environment,
  including a synthetic test image generator so you can see it work before you have real
  scans.
- A **complete, correct** CNN training script for EMNIST → MCQ letters (`train_mcq_cnn.py`).
- A **complete, correct** TrOCR fine-tuning script (`finetune_trocr.py`).
- A **complete** FastAPI service (`main.py`) wiring preprocessing → both models → grading engine.
- A grading engine with exact-match MCQ scoring + similarity-based short-phrase scoring
  and confidence-threshold flagging.
- Example template + answer key JSON files.

## Important — what I could NOT test here

This sandbox has no internet access and no `torch`/`transformers`/`fastapi` installed, so I
could not actually *run* the CNN training, TrOCR fine-tuning, or the FastAPI server end to
end. I wrote and carefully checked the code (and syntax-checked every file), but **you must
run these yourself** on a machine with internet access (to download EMNIST and the
pretrained TrOCR checkpoint) and, ideally, a GPU (TrOCR fine-tuning is slow on CPU).

I *did* test the OpenCV segmentation logic directly, since `opencv-python` and `numpy`
were available — see `ml-service/tests/test_segmentation.py` and the generated
`data/samples/synthetic_test_sheet.png`.

## Setup

```bash
cd ml-service
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

A GPU is strongly recommended for `finetune_trocr.py`. Everything else runs fine on CPU.

## Suggested order of work for you, this week

1. Read `ml-service/training/README.md` and run `train_mcq_cnn.py`.
2. Read `ml-service/training/README.md` (TrOCR section) and run `finetune_trocr.py`
   once you've collected even a small (50–100 sample) short-phrase dataset.
3. Design your real answer sheet in a PDF/image editor, measure box coordinates, and
   fill in `data/template.json` to match (see comments in that file).
4. Run `uvicorn app.main:app --reload` and test with the interactive docs at
   `http://localhost:8000/docs`.
5. Only then start the Node.js/React layer.
# grading_system
