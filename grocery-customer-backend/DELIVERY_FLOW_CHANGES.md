# Delivery Boy Flow — What Was Added

This documents the backend changes that complete the Vendor → Delivery Boy → Completed flow.
**Nothing in the existing vendor-assignment or packed-status flow was removed or rewired** — all
changes are additive. The auto-assign-to-vendor-by-pincode logic and `markFulfilled` (Packed)
behaviour are untouched except for one safe, non-blocking notification.

---

## 1. Database — auto-migrated on boot (no manual SQL)

`src/config/ensureSchema.js` runs on every server start and adds these columns to `orders`
using `ADD COLUMN IF NOT EXISTS` (safe, never destructive):

| column           | purpose                                            |
|------------------|----------------------------------------------------|
| `delivery_boy_id`| which delivery boy is handling the order           |
| `payment_status` | `Pending` / `Paid` / `Collected`                   |
| `packed_photo`   | vendor's packed-order proof photo URL              |
| `delivery_photo` | delivery boy's proof-of-delivery photo URL         |
| `cash_collected` | COD cash collected flag                            |
| `picked_up_at`   | timestamp pickup was confirmed                     |
| `delivered_at`   | timestamp order was completed                      |

It also backfills `payment_status` for old rows. If you prefer to run it manually, the same
`ALTER TABLE` statements are in that file.

---

## 2. Payment status flow

- **COD order created** → `payment_status = 'Pending'` (`createOrder.js`)
- **Online order created** (Razorpay) → `'Pending'` until verified (`createPayment.js`)
- **Online payment verified** → `'Paid'` (`verifyPayment.js`)
- **COD cash collected on delivery** → `'Collected'`

---

## 3. Vendor flow additions

Existing `POST /api/vendor/orders/:id/fulfilled` (mark Packed) is unchanged, but now also
**notifies all delivery boys** that a packed order is ready (non-blocking).

New endpoint:

| method | route                                   | body (multipart) | does |
|--------|-----------------------------------------|------------------|------|
| POST   | `/api/vendor/orders/:id/packed-photo`   | photo file (any field name) | uploads packed proof photo to Cloudinary, saves `packed_photo` |

---

## 4. Delivery boy flow (`/api/delivery`)

| method | route                          | body                         | does |
|--------|--------------------------------|------------------------------|------|
| GET    | `/available`                   | —                            | packed orders not yet picked up |
| GET    | `/my`                          | —                            | my active deliveries |
| GET    | `/history`                     | —                            | my completed deliveries |
| POST   | `/:id/pickup`                  | —                            | claim/assign the order to me |
| POST   | `/:id/confirm-pickup`          | `{ "orderNumber": <id> }`    | **confirm pickup using order number** → status `Out For Delivery` |
| POST   | `/:id/proof`                   | photo file (any field name)  | upload delivery proof photo |
| POST   | `/:id/collect`                 | —                            | COD: mark cash `Collected` |
| POST   | `/:id/delivered`               | photo file + `cashCollected` | **all-in-one**: proof photo + COD collection + status `Completed` |
| POST   | `/:id/picked`                  | optional `{ orderNumber }`   | legacy simple pickup (kept for compatibility) |

### Recommended client sequence
1. `GET /api/delivery/available` → show packed orders.
2. `POST /:id/pickup` → claim it.
3. At the shop: `POST /:id/confirm-pickup` with `{ orderNumber: <orderId> }` → goes **Out For Delivery**.
4. At customer: either
   - one call: `POST /:id/delivered` (multipart) with the proof photo **and** `cashCollected=true` for COD, **or**
   - granular: `POST /:id/proof` (photo) → `POST /:id/collect` (COD) → `POST /:id/delivered`.
5. Order is now **Completed**; `payment_status` is `Collected` (COD) or `Paid` (online).

`/delivered` enforces the rules: it refuses to complete without a proof photo, and for COD it
refuses unless cash is collected.

---

## 5. Live updates (optional)

`src/socket/emit.js` lets controllers push socket events:
- `deliveryAvailable` — broadcast when an order is packed (for delivery-boy panels).
- `orderUpdated` — emitted to the `order_<id>` room on each status/payment change (customer tracking).

These are best-effort; the durable source of truth is the DB + the `notifications` table.

---

## Notes / things to confirm on the frontend
- **"Order number" = the order `id`.** `confirm-pickup` checks the typed number equals the order id.
  If you have a separate human-friendly order number, add an `order_number` column and switch the
  comparison in `confirmPickup` to use it.
- **Delivery boy accounts**: identified by `users.role` in
  `delivery | delivery_boy | deliveryboy | rider | delivery-boy`. Set whichever you use when
  creating those accounts. The delivery routes currently use only `auth` (same as the original
  code) — add a role guard if you want to restrict them.
- **Photo upload field name**: uploads accept *any* multipart field name (`photo`, `image`, `file`),
  so the frontend form field name doesn't matter.
- The **frontend zip did not upload**, so no frontend code was changed. The endpoints above are
  what the Vendor and Delivery Boy panels should call.
