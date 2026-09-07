-- ============================================================
-- WISUREL AUTOMATION PLATFORM — SUPABASE SCHEMA
-- Multi-tenant, project-based AI automation engine.
-- Run in Supabase SQL editor. Requires pgcrypto for gen_random_uuid().
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- ORGANIZATIONS (tenants) ----------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,                -- "Wisurel Ogbomosho Farm"
  slug text unique not null,         -- "wisurel"
  logo_url text,
  primary_color text default '#22C55E',
  created_at timestamptz default now()
);

-- ---------- USERS (extends Supabase auth.users) ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references organizations(id) on delete cascade,
  full_name text,
  role text not null default 'member' check (role in ('owner','admin','member')),
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ---------- INVITE CODES ----------
-- Signup is gated by these — no valid code, no account, enforced at the
-- database level (not just hidden in the UI). Generate codes from the
-- Admin Portal's Invite Codes panel, or directly:
--   insert into invite_codes (org_id, code, role, max_uses)
--   values ('<your org id>', 'WISUREL-STAFF-2026', 'member', 10);
create table invite_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  code text not null unique,
  role text not null default 'member' check (role in ('owner','admin','member')),
  max_uses int not null default 1,
  used_count int not null default 0,
  label text,                    -- e.g. "September staff onboarding"
  expires_at timestamptz,
  created_at timestamptz default now()
);

-- ---------- AUTO-PROVISION A PROFILE ON SIGNUP (invite-code gated) ----------
-- Two paths, because not every sign-in method can carry an invite code:
--
-- PATH A — the app's own "Create account" form (`SB.auth.signUp()`) passes
-- the code as `options.data.invite_code`. This trigger validates it
-- immediately: no code, or an invalid/expired/exhausted one, raises an
-- exception that rolls back the ENTIRE signup (auth.users row included —
-- no dangling half-created accounts). A valid code provisions the profile
-- right away, fully active.
--
-- PATH B — Google OAuth and magic-link sign-in never pass through that
-- form, so there's no code to check at signup time. Rather than reject
-- these outright (which would just break the buttons), the trigger creates
-- a *pending* profile instead: org_id null, is_active false. Because every
-- RLS policy in this schema keys off current_org_id() — which returns null
-- for a pending profile — a pending account can see none of your org's
-- data. It's authenticated but inert until redeemed.
create or replace function handle_new_user()
returns trigger as $$
declare
  v_code text;
  v_invite invite_codes%rowtype;
  v_name text;
begin
  v_code := new.raw_user_meta_data->>'invite_code';
  v_name := coalesce(new.raw_user_meta_data->>'business_name',
                      new.raw_user_meta_data->>'full_name',
                      new.raw_user_meta_data->>'name',
                      split_part(new.email, '@', 1));

  if v_code is null or btrim(v_code) = '' then
    -- Path B: no code available at signup time (OAuth / magic link) —
    -- create a pending, org-less profile. The app prompts for a code
    -- right after login and calls redeem_invite_code() to finish setup.
    insert into public.profiles (id, org_id, full_name, role, is_active)
    values (new.id, null, v_name, 'member', false);
    return new;
  end if;

  -- Path A: the signup form's own code — validate now, fail loudly if bad.
  select * into v_invite from public.invite_codes
    where code = btrim(v_code)
      and (expires_at is null or expires_at > now())
      and used_count < max_uses
    for update;

  if not found then
    raise exception 'That invite code is invalid, expired, or has already been used.';
  end if;

  insert into public.profiles (id, org_id, full_name, role, is_active)
  values (new.id, v_invite.org_id, v_name, v_invite.role, true);

  update public.invite_codes set used_count = used_count + 1 where id = v_invite.id;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- REDEEM AN INVITE CODE (for pending Path-B accounts) ----------
-- Called by the app right after a Google/magic-link login if the caller's
-- own profile is still pending (org_id is null). Operates only on
-- auth.uid()'s own row — a user can never redeem a code on someone else's
-- behalf. Raises on an invalid code, or if the account is already
-- provisioned (so it can't be run twice to hop between orgs).
create or replace function redeem_invite_code(p_code text)
returns void as $$
declare
  v_invite invite_codes%rowtype;
  v_already_active boolean;
begin
  select (org_id is not null) into v_already_active from public.profiles where id = auth.uid();

  if v_already_active is null then
    raise exception 'No pending account found for this user.';
  end if;
  if v_already_active then
    raise exception 'This account already belongs to a workspace.';
  end if;

  select * into v_invite from public.invite_codes
    where code = btrim(p_code)
      and (expires_at is null or expires_at > now())
      and used_count < max_uses
    for update;

  if not found then
    raise exception 'That invite code is invalid, expired, or has already been used.';
  end if;

  update public.profiles
    set org_id = v_invite.org_id, role = v_invite.role, is_active = true
    where id = auth.uid();

  update public.invite_codes set used_count = used_count + 1 where id = v_invite.id;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function redeem_invite_code(text) to authenticated;

-- ---------- PROJECTS ----------
-- A project = one automation the user is running (e.g. "Receipt Processor",
-- "Customer Feedback Sentiment"). This is what the sidebar/chat list shows.
create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  created_by uuid references profiles(id),
  name text not null,
  description text,
  status text default 'active' check (status in ('active','archived')),
  is_example boolean default false,   -- true for the seeded "Wisurel Receipts" demo
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- PROJECT BRANCHES ----------
-- "Update vs Branch" logic lives here. Every project has at least one branch
-- (the trunk). Reopening a project and choosing "Branch" creates a new row
-- with parent_branch_id set; choosing "Update" just reuses the active branch.
create table project_branches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_branch_id uuid references project_branches(id),
  label text not null default 'Main',   -- e.g. "Receipts – July 2026"
  blueprint jsonb not null,             -- the AI-generated sheet/column schema
  is_trunk boolean default false,
  created_at timestamptz default now()
);

-- ---------- WHATSAPP STAFF SENDERS ----------
-- Maps a WhatsApp phone number to a staff member so inbound daily reports
-- are trusted and auto-attributed without a login step.
create table whatsapp_senders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  phone_number text not null,          -- E.164 format, e.g. +2348012345678
  staff_name text not null,
  profile_id uuid references profiles(id),
  is_active boolean default true,
  created_at timestamptz default now(),
  unique(org_id, phone_number)
);

-- ---------- DAILY REPORTS (fed by the WhatsApp webhook) ----------
create table daily_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  sender_id uuid references whatsapp_senders(id),
  staff_name text not null,
  phone_number text not null,
  raw_message text,                    -- original WhatsApp text, if any
  media_url text,                      -- Supabase Storage path, if a photo/doc was sent
  media_type text,
  ai_summary text,                     -- Claude's structured summary of the report
  ai_structured jsonb,                 -- {tasks_done, issues, stock_levels, ...} — shape is AI-inferred
  status text default 'received' check (status in ('received','processed','flagged','error')),
  received_at timestamptz default now(),
  processed_at timestamptz
);

-- ---------- REPORT RECIPIENTS ----------
-- Who gets sent digests/reports, and how. Managed from the app's Settings
-- page — adding or removing someone here takes effect immediately, no
-- redeploy needed. A WhatsApp recipient can also *pull* a report on demand
-- by texting a trigger word ("report", "status") to the business number —
-- see whatsapp-webhook's boss-trigger logic.
create table report_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  label text not null,                 -- e.g. "Boss", "Accountant"
  channel text not null check (channel in ('whatsapp','email')),
  contact text not null,               -- E.164 phone number or email address
  auto_weekly boolean default false,   -- included in the scheduled Monday digest
  created_at timestamptz default now(),
  unique(org_id, channel, contact)
);

-- ---------- WORKFLOW DATA (rows generated per sheet) ----------
create table workflow_rows (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references project_branches(id) on delete cascade,
  sheet_name text not null,
  data jsonb not null,          -- {"Date":"...", "Amount":..., ...} matches blueprint columns
  source_file_id uuid,          -- references files.id, nullable
  created_at timestamptz default now()
);

-- ---------- FILES (Master Inbox) ----------
create table files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  uploaded_by uuid references profiles(id),
  storage_path text not null,   -- Supabase Storage path
  original_name text not null,
  mime_type text,
  size_bytes bigint,
  content_hash text,            -- SHA-256 of the file bytes — lets the app flag
                                 -- an exact re-upload before spending an AI call on it
  source text default 'upload' check (source in ('upload','camera')),
  status text default 'queued' check (status in ('queued','processing','done','error','duplicate')),
  created_at timestamptz default now()
);
create index files_content_hash_idx on files (org_id, content_hash) where content_hash is not null;

-- ---------- CHAT MESSAGES (per project) ----------
create table messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz default now()
);

-- ---------- JOB QUEUE (for the 1000-jobs/24h processing target) ----------
create table jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid references projects(id),
  branch_id uuid references project_branches(id), -- which batch/branch results land in; falls back to the project's trunk branch if null (older jobs)
  file_id uuid references files(id),
  daily_report_id uuid references daily_reports(id),
  type text not null default 'process_file', -- 'process_file' | 'process_daily_report' | ...
  status text default 'pending' check (status in ('pending','running','done','failed')),
  priority int default 5,              -- lower = processed first
  attempts int default 0,
  max_attempts int default 3,
  error text,
  created_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index jobs_pending_idx on jobs (status, priority, created_at) where status = 'pending';

-- ---------- TOKEN / USAGE TRACKING (for admin analytics) ----------
create table usage_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid references projects(id),
  input_tokens int default 0,
  output_tokens int default 0,
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table invite_codes enable row level security;
alter table projects enable row level security;
alter table project_branches enable row level security;
alter table whatsapp_senders enable row level security;
alter table daily_reports enable row level security;
alter table report_recipients enable row level security;
alter table workflow_rows enable row level security;
alter table files enable row level security;
alter table messages enable row level security;
alter table jobs enable row level security;
alter table usage_events enable row level security;

-- helper: current user's org
create or replace function current_org_id() returns uuid as $$
  select org_id from profiles where id = auth.uid();
$$ language sql stable security definer;

-- profiles: users can see others in their own org
create policy "profiles_same_org" on profiles
  for select using (org_id = current_org_id());
create policy "profiles_self_update" on profiles
  for update using (id = auth.uid());

-- invite_codes: same org only, for the admin UI to manage. Signup itself
-- never queries this table directly with the anon key — the trigger above
-- validates codes server-side (security definer, bypasses RLS), so a
-- logged-out visitor can't enumerate valid codes through the client.
create policy "invite_codes_org_isolation" on invite_codes
  for all using (org_id = current_org_id());

-- everything else: standard org-scoped isolation
create policy "projects_org_isolation" on projects
  for all using (org_id = current_org_id());

create policy "branches_org_isolation" on project_branches
  for all using (project_id in (select id from projects where org_id = current_org_id()));

create policy "whatsapp_senders_org_isolation" on whatsapp_senders
  for all using (org_id = current_org_id());

create policy "daily_reports_org_isolation" on daily_reports
  for all using (org_id = current_org_id());

create policy "report_recipients_org_isolation" on report_recipients
  for all using (org_id = current_org_id());

create policy "rows_org_isolation" on workflow_rows
  for all using (branch_id in (
    select pb.id from project_branches pb
    join projects p on p.id = pb.project_id
    where p.org_id = current_org_id()
  ));

create policy "files_org_isolation" on files
  for all using (org_id = current_org_id());

create policy "messages_org_isolation" on messages
  for all using (project_id in (select id from projects where org_id = current_org_id()));

create policy "jobs_org_isolation" on jobs
  for all using (org_id = current_org_id());

create policy "usage_org_isolation" on usage_events
  for select using (org_id = current_org_id());

-- Admin override: org owners/admins can see everything in their org (already
-- covered above since policies are org-scoped, not per-user) — add an
-- is_admin() check here if you later want cross-org platform admin access.

-- ============================================================
-- SEED: organization + bootstrap invite code
-- ============================================================
-- Every signup now requires a valid invite code (see handle_new_user()
-- above) — including the very first one, the owner. Run these three steps
-- in order after creating your Supabase project:

-- 1. Create the organization:
-- insert into organizations (name, slug, primary_color) values
--   ('Wisurel Ogbomosho Farm', 'wisurel', '#22C55E');

-- 2. Create a one-time invite code for yourself, the owner:
-- insert into invite_codes (org_id, code, role, max_uses, label) values
--   ((select id from organizations where slug='wisurel'), 'WISUREL-OWNER-SETUP', 'owner', 1, 'Initial owner account');

-- 3. Sign up in the app using that code — it consumes itself (max_uses: 1),
-- so it won't work a second time. From then on, generate ordinary staff
-- invite codes from the Admin Portal's Invite Codes panel (role 'member',
-- however many uses you need), rather than going back to the SQL editor.
