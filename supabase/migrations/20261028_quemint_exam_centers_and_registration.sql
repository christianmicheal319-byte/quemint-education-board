-- ============================================================================
-- QUEMINT EDUCATION BOARD — NON-DESTRUCTIVE SUPABASE MIGRATION SQL
-- Adds exam_centers (Q-Zones) table and new registration columns to students
-- WITHOUT dropping or deleting any existing columns or data.
-- ============================================================================

-- 1. Create exam_centers (Q-Zones) table if it does not exist
CREATE TABLE IF NOT EXISTS public.exam_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  max_capacity INTEGER NOT NULL CHECK (max_capacity >= 0),
  current_count INTEGER NOT NULL DEFAULT 0 CHECK (current_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default Q-Zones if table is empty
INSERT INTO public.exam_centers (name, max_capacity, current_count)
SELECT 'Q Zone 1', 50, 0
WHERE NOT EXISTS (SELECT 1 FROM public.exam_centers WHERE name = 'Q Zone 1');

INSERT INTO public.exam_centers (name, max_capacity, current_count)
SELECT 'Q Zone 2', 50, 0
WHERE NOT EXISTS (SELECT 1 FROM public.exam_centers WHERE name = 'Q Zone 2');

INSERT INTO public.exam_centers (name, max_capacity, current_count)
SELECT 'Main Hall', 100, 0
WHERE NOT EXISTS (SELECT 1 FROM public.exam_centers WHERE name = 'Main Hall');

-- 2. Create category enum type (Art, Science, Commercial) safely if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'student_category_enum') THEN
    CREATE TYPE public.student_category_enum AS ENUM ('Art', 'Science', 'Commercial');
  END IF;
END
$$;

-- 3. Add/update columns on existing students / candidates table (NON-DESTRUCTIVE)
-- Keeps all existing columns (email, phone, password, reg_number, etc.) intact.
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS middle_name TEXT,
  ADD COLUMN IF NOT EXISTS surname TEXT,
  ADD COLUMN IF NOT EXISTS subject_combination TEXT,
  ADD COLUMN IF NOT EXISTS course_of_study TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Science',
  ADD COLUMN IF NOT EXISTS state_of_origin TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS exam_center_id UUID REFERENCES public.exam_centers(id) ON DELETE SET NULL;

-- Migrate any legacy 4-category rows ('Medical', 'Engineering', 'Arts') to the new 3 categories ('Art', 'Science', 'Commercial')
UPDATE public.students
SET category = CASE
  WHEN LOWER(TRIM(category)) IN ('medical', 'engineering', 'science') THEN 'Science'
  WHEN LOWER(TRIM(category)) IN ('art', 'arts') THEN 'Art'
  WHEN LOWER(TRIM(category)) = 'commercial' THEN 'Commercial'
  ELSE 'Science'
END
WHERE category IS NULL
   OR LOWER(TRIM(category)) NOT IN ('art', 'science', 'commercial');

-- Enforce check constraint for category ('Art', 'Science', 'Commercial')
ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_category_check;

ALTER TABLE public.students
  ADD CONSTRAINT students_category_check
  CHECK (category IN ('Art', 'Science', 'Commercial'));

-- 4. Atomic RPC function to increment exam_center current_count safely
CREATE OR REPLACE FUNCTION public.increment_exam_center_count(target_center_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.exam_centers
  SET current_count = current_count + 1,
      updated_at = now()
  WHERE id = target_center_id
    AND current_count < max_capacity;
END;
$$;

-- 5. Create system_settings table for Admin-Controlled Exam Flow & Default Candidate Master Password
CREATE TABLE IF NOT EXISTS public.system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upsert default exam_start_flow ('dashboard_first' or 'immediate') and default_candidate_password (hashed)
INSERT INTO public.system_settings (key, value, updated_at)
VALUES
  ('exam_start_flow', 'dashboard_first', now()),
  ('default_candidate_password', encode(digest('quemint2026', 'sha256'), 'hex'), now())
ON CONFLICT (key) DO UPDATE
SET updated_at = now();

