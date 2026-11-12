create table if not exists shops (
  id text primary key,
  slug text not null unique,
  name text not null,
  rules_json jsonb not null default '[]'::jsonb,
  live boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id text primary key,
  shop_id text not null references shops (id),
  sku text not null,
  name text not null,
  detail text not null default '',
  price_cents integer not null,
  currency text not null default 'EUR',
  allergens jsonb not null default '[]'::jsonb,
  lead_hours integer not null default 0,
  stock integer not null default 20,
  available boolean not null default true,
  paypal_product_id text,
  unique (shop_id, sku)
);

create table if not exists orders (
  id text primary key,
  shop_id text not null references shops (id),
  status text not null,
  total_cents integer not null,
  currency text not null,
  lines_json jsonb not null,
  notes text not null default '',
  intent_json jsonb,
  cart_signature text,
  paypal_order_id text,
  paypal_capture_id text,
  tracking_number text,
  tracker_id text,
  mode text not null default 'replay',
  blocked_rule text,
  agent_name text not null default 'guest',
  created_at timestamptz not null default now()
);

create index if not exists orders_shop_created_idx on orders (shop_id, created_at desc);

create table if not exists demand_gaps (
  id text primary key,
  shop_id text not null references shops (id),
  query text not null,
  asks integer not null default 1,
  status text not null default 'open',
  updated_at timestamptz not null default now(),
  unique (shop_id, query)
);

create table if not exists agent_events (
  id text primary key,
  shop_id text not null references shops (id),
  agent_name text not null,
  kind text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists agent_events_shop_idx on agent_events (shop_id, created_at desc);
