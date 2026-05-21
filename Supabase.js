// ─────────────────────────────────────────────────────
//  supabase.js  –  Supabase client initialisation
//  Replace the two constants below with your own project
//  values from: https://app.supabase.com → Settings → API
// ─────────────────────────────────────────────────────
 


const SUPABASE_URL  = 'https://hpshvffjnneywxvwkflz.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwc2h2ZmZqbm5leXd4dndrZmx6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyODYzNjUsImV4cCI6MjA5Mjg2MjM2NX0.BNwfr8F1gkCYrmVXs9Cw2Q4M5D6DEevKtgYtmH8XVXY';
 
// We load the Supabase CDN bundle via index.html so the
// global `supabase` object is available here.
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON); 
export default _sb;


 
// ─────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────
//  SQL — run once in Supabase Dashboard → SQL Editor
// ─────────────────────────────────────────────────────
//
// -- 1. PROFILES
// create table profiles (
//   id         uuid primary key references auth.users(id) on delete cascade,
//   email      text not null,
//   role       text not null default 'user' check (role in ('user','admin')),
//   created_at timestamptz default now()
// );
// alter table profiles enable row level security;
// create policy "own profile" on profiles for select using (auth.uid() = id);
// create policy "admin all profiles" on profiles for select using (
//   exists (select 1 from profiles where id = auth.uid() and role = 'admin')
// );
//
// create or replace function handle_new_user()
// returns trigger language plpgsql security definer as $$
// begin
//   insert into profiles (id, email) values (new.id, new.email);
//   return new;
// end; $$;
// create trigger on_auth_user_created
//   after insert on auth.users for each row execute procedure handle_new_user();
//
// -- 2. PEOPLE (11 fixed slots, shared across all users)
// create table people (
//   slot       int  primary key check (slot between 1 and 11),
//   name       text not null default ''
// );
// -- seed the 11 slots
// insert into people (slot, name) values
//   (1,'Person 1'),(2,'Person 2'),(3,'Person 3'),(4,'Person 4'),
//   (5,'Person 5'),(6,'Person 6'),(7,'Person 7'),(8,'Person 8'),
//   (9,'Person 9'),(10,'Person 10'),(11,'Person 11');
//
// alter table people enable row level security;
// -- everyone can read
// create policy "all read people" on people for select using (true);
// -- only admins can update names
// create policy "admin update people" on people for update using (
//   exists (select 1 from profiles where id = auth.uid() and role = 'admin')
// );
//
// -- 3. DAILY LOGS
// create table daily_logs (
//   id         uuid primary key default gen_random_uuid(),
//   user_id    uuid references auth.users(id) on delete cascade,
//   slot       int  references people(slot),
//   date       date not null default current_date,
//   value      numeric not null default 0,
//   unique(user_id, slot, date)
// );
// alter table daily_logs enable row level security;
// -- users manage own logs
// create policy "own logs" on daily_logs for all
//   using (auth.uid() = user_id)
//   with check (auth.uid() = user_id);
// -- admins read all
// create policy "admin read logs" on daily_logs for select using (
//   exists (select 1 from profiles where id = auth.uid() and role = 'admin')
// );
//
// -- 4. Make yourself admin
// update profiles set role = 'admin' where email = 'you@example.com';
 