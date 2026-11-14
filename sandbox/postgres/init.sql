-- Schema and seed data for the haunted shop. Runs once, when the volume is empty.

CREATE TABLE carts (
  id    integer PRIMARY KEY,
  items jsonb   NOT NULL
);

CREATE TABLE orders (
  id           uuid        PRIMARY KEY,
  cart_id      integer     NOT NULL REFERENCES carts (id),
  amount       numeric     NOT NULL,
  status       text        NOT NULL CHECK (status IN ('paid', 'confirmed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
CREATE INDEX orders_status_idx ON orders (status);

CREATE TABLE payments (
  id         uuid        PRIMARY KEY,
  order_id   uuid        NOT NULL REFERENCES orders (id),
  amount     numeric     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Config overrides set through /__admin/config. Kept here so restarts do not clear them.
CREATE TABLE service_config (
  service text  NOT NULL,
  key     text  NOT NULL,
  value   jsonb NOT NULL,
  PRIMARY KEY (service, key)
);

INSERT INTO carts (id, items)
SELECT n, jsonb_build_array(
  jsonb_build_object('sku', 'candle-' || n, 'price', 4 + (n % 7), 'qty', 1 + (n % 3)),
  jsonb_build_object('sku', 'cauldron', 'price', 30, 'qty', 1)
)
FROM generate_series(1, 50) AS n;
