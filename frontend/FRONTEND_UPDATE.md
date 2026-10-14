# Frontend update

This sweep refreshes the grading-system frontend and aligns it with the current backend/Supabase/ML workflow.

## Run

From the frontend project root:

```bash
npm install
npm run dev
```

Optional `.env`:

```env
VITE_BACKEND_URL=http://localhost:4000
```

## Main changes

- Modern academic assessment workspace UI.
- Overview dashboard with exam, grading, pending-review and ML status metrics.
- Grade Scripts workflow.
- Exam Builder for MCQ, Completion and Essay question presentation.
- Global Context grading mode: Off / necessary / all.
- Per Completion/Essay context toggle and lecturer context field.
- Results archive with pending-review filter.
- Results view adapted to the Supabase-backed result shape as well as the older ML result shape.
- Lecturer review UI retained and refreshed.
- Backend URL moved to `VITE_BACKEND_URL` instead of being hard-coded.

The frontend does not invent a DeepSeek result. Context configuration is sent with the examination payload; the actual DeepSeek grading call remains a backend responsibility.
