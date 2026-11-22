-- BotMegas — esquema da base de dados (Supabase / PostgreSQL)
-- Como usar: Supabase → SQL Editor → New query → cola este ficheiro → Run.
-- Pode ser corrido várias vezes sem estragar nada.

create table if not exists plans (
  id          text primary key,
  name        text not null,
  price       numeric(10,2) not null,
  days        int not null default 30,
  max_groups  int not null default 1,
  highlight   boolean not null default false,
  active      boolean not null default true,
  sort        int not null default 0
);

create table if not exists resellers (
  id            text primary key,
  name          text not null,
  phone         text not null,
  plan_id       text references plans(id) on delete set null,
  status        text not null default 'ativo' check (status in ('ativo','suspenso')),
  expires_at    timestamptz,
  invite_code   text unique not null,
  bot_phone     text,
  notes         text,
  config        jsonb not null default '{}'::jsonb,
  reminded_for  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists resellers_phone_idx on resellers(phone);

create table if not exists bot_numbers (
  phone         text primary key,
  label         text,
  status        text not null default 'desligado',
  pairing_code  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists groups (
  jid           text primary key,
  reseller_id   text not null references resellers(id) on delete cascade,
  bot_phone     text,
  name          text,
  active        boolean not null default true,
  activated_at  timestamptz not null default now(),
  activated_by  text
);
create index if not exists groups_reseller_idx on groups(reseller_id);

create table if not exists orders (
  reseller_id   text not null references resellers(id) on delete cascade,
  id            int not null,
  status        text not null,
  tx_id         text,
  amount        numeric(10,2),
  package_name  text,
  target_phone  text,
  customer_phone text,
  created_at    timestamptz not null,
  done_at       timestamptz,
  data          jsonb not null,
  primary key (reseller_id, id)
);
create unique index if not exists orders_tx_unique on orders(reseller_id, tx_id) where tx_id is not null;
create index if not exists orders_created_idx on orders(created_at desc);

create table if not exists payments (
  id            bigserial primary key,
  reseller_id   text not null references resellers(id) on delete cascade,
  amount        numeric(10,2) not null,
  days          int not null,
  method        text,
  reference     text,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists payments_created_idx on payments(created_at desc);

create table if not exists fraud_reports (
  id            int primary key,
  reseller_id   text,
  phone         text not null,
  reason        text,
  reported_by   text,
  reported_by_name text,
  group_jid     text,
  status        text not null default 'aberta',
  created_at    timestamptz not null default now()
);
create index if not exists fraud_reports_phone_idx on fraud_reports(phone);

create table if not exists banned_numbers (
  phone         text primary key,
  reseller_id   text,
  reason        text,
  created_at    timestamptz not null default now()
);

-- Sessão do WhatsApp de cada número de bot (chaves de cifra). NUNCA partilhes esta tabela.
create table if not exists wa_auth (
  bot_phone   text not null,
  key         text not null,
  value       text not null,
  updated_at  timestamptz not null default now(),
  primary key (bot_phone, key)
);

create table if not exists settings (
  key   text primary key,
  value jsonb not null
);

-- Segurança: activa RLS sem políticas. Assim, a chave pública (anon) do Supabase
-- não consegue ler nada; só o servidor do bot (ligação directa) tem acesso.
alter table plans          enable row level security;
alter table resellers      enable row level security;
alter table bot_numbers    enable row level security;
alter table groups         enable row level security;
alter table orders         enable row level security;
alter table payments       enable row level security;
alter table fraud_reports  enable row level security;
alter table banned_numbers enable row level security;
alter table settings       enable row level security;
alter table wa_auth        enable row level security;

-- Planos iniciais (podes mudar no painel)
insert into plans (id, name, price, days, max_groups, highlight, sort) values
  ('semanal', 'Semanal', 150, 7, 1, false, 1),
  ('mensal',  'Mensal',  450, 30, 2, true,  2),
  ('pro',     'Pro',     1200, 30, 6, false, 3)
on conflict (id) do nothing;
