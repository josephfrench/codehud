create table if not exists public.profiles (
  id uuid primary key references auth.users(id),
  display_name text,
  created_at timestamptz default now()
);
create table public.posts (
  id bigint generated always as identity primary key,
  author uuid references profiles(id),
  body text not null
);
