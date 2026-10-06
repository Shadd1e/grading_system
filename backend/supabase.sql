create extension if not exists pgcrypto;

create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  title text not null,
  description text,
  template_type text,
  context_mode text not null default 'off' check (context_mode in ('off','necessary','all')),
  content jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  external_id text,
  question_number integer,
  question_text text,
  type text not null check (type in ('mcq','completion','essay')),
  points numeric not null default 0,
  expected_answer text,
  context_enabled boolean not null default false,
  context_text text,
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (exam_id, question_number)
);

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  external_id text unique not null,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists grading_results (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  exam_id uuid references exams(id) on delete set null,
  student_id uuid references students(id) on delete set null,
  student_external_id text,
  total_score numeric,
  max_score numeric,
  pending_review_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists grading_result_items (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references grading_results(id) on delete cascade,
  question_external_id text,
  recognized_text text,
  recognition_confidence numeric,
  suggested_score numeric,
  final_score numeric,
  max_score numeric,
  flagged_for_review boolean not null default false,
  reviewed boolean not null default false,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists review_actions (
  id uuid primary key default gen_random_uuid(),
  result_item_id uuid references grading_result_items(id) on delete cascade,
  reviewer_id text,
  corrected_score numeric,
  corrected_text text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_questions_exam_id on questions(exam_id);
create index if not exists idx_results_exam_id on grading_results(exam_id);
create index if not exists idx_results_student_external_id on grading_results(student_external_id);
create index if not exists idx_result_items_result_id on grading_result_items(result_id);

alter table exams enable row level security;
alter table questions enable row level security;
alter table students enable row level security;
alter table grading_results enable row level security;
alter table grading_result_items enable row level security;
alter table review_actions enable row level security;
