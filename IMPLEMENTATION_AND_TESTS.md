# AbhiGro — OTP Fix + Admin Orders/WhatsApp + Medicine Module

This covers three pieces of work, all additive — **the existing grocery flow is untouched.**

---

## 1. Implementation plan (what & why)

### A. OTP login (stay in-app)
The old login loaded the MSG91 **hosted widget** (`verify.msg91.com/otp-provider.js` → `initSendOTP`) and even hardcoded the MSG91 `tokenAuth` in the browser. That widget is the "MSG91 page" that opened. It's now removed.

New flow: frontend calls **our** backend only (`/auth/send-otp`, `/auth/verify-otp`); the backend talks to MSG91's **server OTP API** using keys from `.env`. The OTP box appears inside the AbhiGro login page; on success the backend issues the JWT and the app navigates home.

### B. Admin dashboard orders + WhatsApp
There was **no** `/admin/orders` endpoint (only stat counts) and **no** WhatsApp logic. Added:
- `GET /api/admin/orders` and `/api/admin/orders/:id` with all required fields.
- A `newOrder` **socket.io** event emitted on order placement (live dashboard, no refresh).
- A non-blocking **WhatsApp** alert to admin via MSG91 on each new order.
> The admin dashboard is a **separate frontend app** (not in the customer repo). Wire it to either poll `GET /api/admin/orders` or listen to the `newOrder` socket event — snippet in §5.

### C. Medicine module
Built as a fully separate module: its own 7 tables, services, controllers, routes, and frontend pages. It reuses existing auth/roles, Cloudinary upload, and socket/notification infra. Grocery tables and routes are never modified.

---

## 2. Files added / changed

### Backend (in the backend repo subfolder)
**OTP**
- `src/controllers/auth/otpController.js` *(new)* — sendOtp / resendOtp / verifyOtp
- `src/routes/authRoutes.js` *(changed)* — adds `/send-otp`, `/resend-otp`, `/verify-otp`

**Admin orders + WhatsApp**
- `src/controllers/admin/adminOrders.js` *(new)* — listOrders / getOrder
- `src/services/whatsappService.js` *(new)* — sendNewOrderWhatsApp (MSG91)
- `src/socket/emit.js` *(changed)* — adds `emitNewOrder`
- `src/routes/adminRoutes.js` *(changed)* — mounts `/orders`, `/orders/:id`
- `src/controllers/order/createOrder.js` *(changed)* — emits `newOrder` + fires WhatsApp (both non-blocking)

**Medicine module (all new)**
- `src/config/medicineSchema.js` — auto-creates the 7 tables on boot
- `src/services/medicine/pricing.js` — delivery fee, platform fee, commission, totals
- `src/services/medicine/pharmacyAssign.js` — pincode + licensed + online + stock assignment
- `src/services/medicine/statusHistory.js` — status update + audit log
- `src/middleware/pharmacyMiddleware.js` — pharmacy-role guard (`req.pharmacy`)
- `src/controllers/medicine/customerMedicineController.js`
- `src/controllers/medicine/pharmacyController.js`
- `src/controllers/medicine/deliveryMedicineController.js`
- `src/controllers/medicine/adminMedicineController.js`
- `src/routes/medicineRoutes.js`, `pharmacyRoutes.js`, `medicineDeliveryRoutes.js`, `adminMedicineRoutes.js`
- `server.js` *(changed)* — calls `ensureMedicineSchema()` and mounts the four routers
- `medicine_migration.sql` — standalone SQL (optional; schema also auto-runs)

### Frontend (customer repo)
- `src/pages/Login.jsx` *(changed)* — in-app OTP, widget removed
- `src/api/medicine.js` *(new)* — API client + local medicine cart
- `src/pages/MedicineHome.jsx`, `MedicineProductDetails.jsx`, `MedicineCheckout.jsx`, `MedicineOrders.jsx`, `PharmacyPanel.jsx` *(new)*
- `src/App.jsx` *(changed)* — routes: `/medicine`, `/medicine/product/:id`, `/medicine/checkout`, `/medicine/orders`, `/pharmacy`

---

## 3. Required `.env` additions (backend only)

```env
# OTP (server-side)
MSG91_AUTH_KEY=your_msg91_auth_key
MSG91_OTP_TEMPLATE_ID=your_otp_template_id      # or reuse MSG91_TEMPLATE_ID

# WhatsApp admin alerts
MSG91_WHATSAPP_INTEGRATED_NUMBER=9198XXXXXXXX
MSG91_WHATSAPP_TEMPLATE_NAME=new_order_alert    # approved template with 7 body vars
MSG91_WHATSAPP_NAMESPACE=your_namespace          # optional, from MSG91
MSG91_WHATSAPP_LANG=en
ADMIN_WHATSAPP_NUMBERS=9198XXXXXXXX,9197YYYYYYYY # comma separated

# Medicine commissions / fees (defaults shown; tune freely)
MED_COMM_OTC=12       # OTC/general 10–15%
MED_COMM_RX=8         # prescription 4–8%  (8 matches your ₹40/₹460 example)
MED_COMM_HIGH=4       # high-value 3–5%
MED_PLATFORM_FEE=5    # ₹5–10 per order
MED_URGENT_FEE=69     # ₹69–99
```

> WhatsApp template body variables must be, in order: `{{1}}` order#, `{{2}}` customer name, `{{3}}` phone, `{{4}}` address, `{{5}}` total, `{{6}}` payment method, `{{7}}` shop. If your approved template differs, adjust `body_1..body_7` in `whatsappService.js`.

---

## 4. Testing — curl / Postman examples

Base URL: `https://abhigro-customer-backend-cjaqezaufxhmdtbd.southindia-01.azurewebsites.net/api`

### OTP
```bash
# Send
curl -X POST $BASE/auth/send-otp -H "Content-Type: application/json" \
  -d '{"mobile":"9876543210"}'
# Verify (returns accessToken)
curl -X POST $BASE/auth/verify-otp -H "Content-Type: application/json" \
  -d '{"mobile":"9876543210","otp":"1234"}'
```

### Admin orders (needs admin JWT)
```bash
curl $BASE/admin/orders -H "Authorization: Bearer <ADMIN_JWT>"
curl $BASE/admin/orders/51 -H "Authorization: Bearer <ADMIN_JWT>"
```

### Medicine — customer
```bash
# Catalogue
curl "$BASE/medicine/products?search=para"
# Upload prescription (returns prescription_url)
curl -X POST $BASE/medicine/prescription/upload -H "Authorization: Bearer <JWT>" \
  -F "file=@rx.jpg"
# Place order (Rx required => include prescription_url)
curl -X POST $BASE/medicine/orders -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"medicine_product_id":2,"quantity":1}],"address":"MG Road","pincode":"560001","phone":"9876543210","paymentMethod":"cod","prescription_url":"https://...rx.jpg"}'
# My orders / detail / invoice / receipt
curl $BASE/medicine/orders/my-orders -H "Authorization: Bearer <JWT>"
curl $BASE/medicine/orders/1 -H "Authorization: Bearer <JWT>"
curl $BASE/medicine/orders/1/invoice -H "Authorization: Bearer <JWT>"
curl $BASE/medicine/orders/1/service-receipt -H "Authorization: Bearer <JWT>"
```

### Medicine — pharmacy (needs a user with role `pharmacy` linked to a pharmacy row)
```bash
curl $BASE/pharmacy/orders -H "Authorization: Bearer <PHARMACY_JWT>"
curl -X PUT $BASE/pharmacy/orders/1/approve-prescription -H "Authorization: Bearer <PHARMACY_JWT>"
curl -X PUT $BASE/pharmacy/orders/1/reject-prescription -H "Authorization: Bearer <PHARMACY_JWT>" \
  -H "Content-Type: application/json" -d '{"reason":"blurry"}'
curl -X PUT $BASE/pharmacy/orders/1/approve-order -H "Authorization: Bearer <PHARMACY_JWT>"
curl -X POST $BASE/pharmacy/orders/1/upload-packed-photo -H "Authorization: Bearer <PHARMACY_JWT>" -F "photo=@packed.jpg"
curl -X PUT $BASE/pharmacy/orders/1/packed -H "Authorization: Bearer <PHARMACY_JWT>"
```

### Medicine — delivery (needs delivery JWT)
```bash
curl $BASE/delivery/medicine-orders/packed -H "Authorization: Bearer <DELIVERY_JWT>"
curl -X PUT $BASE/delivery/medicine-orders/1/accept -H "Authorization: Bearer <DELIVERY_JWT>"
curl -X PUT $BASE/delivery/medicine-orders/1/pickup-confirm -H "Authorization: Bearer <DELIVERY_JWT>" \
  -H "Content-Type: application/json" -d '{"orderNumber":"MED..."}'
curl -X PUT $BASE/delivery/medicine-orders/1/delivered -H "Authorization: Bearer <DELIVERY_JWT>" \
  -F "photo=@proof.jpg" -F "cashCollected=true"
```

### Medicine — admin
```bash
curl $BASE/admin/medicine/orders -H "Authorization: Bearer <ADMIN_JWT>"
curl -X POST $BASE/admin/pharmacies -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"pharmacy_name":"City Care","pincode":"560001","drug_license_number":"KA-DL-1","owner_user_id":12,"is_active":true,"is_online":true}'
curl -X POST $BASE/admin/medicine/settlements/generate -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"pharmacy_id":1,"start":"2026-06-01","end":"2026-06-30","gst_percent":18}'
curl $BASE/admin/medicine/reports -H "Authorization: Bearer <ADMIN_JWT>"
```

### End-to-end happy path to verify
1. Admin creates a pharmacy (`/admin/pharmacies`) with `is_active=true, is_online=true` and links `owner_user_id`.
2. Insert 1–2 `medicine_products` for that pharmacy (or via your admin product UI).
3. Customer logs in via OTP, opens `/medicine`, adds an OTC item, checks out COD → order is `assigned_to_pharmacy`.
4. Pharmacy logs in (`/pharmacy`) → approve order → upload packed photo → mark packed.
5. Delivery boy: packed list → accept → pickup-confirm (order number) → delivered (+photo, +cash) → `completed`.
6. Customer `/medicine/orders` shows the tracker + invoice + service receipt.
7. Admin `/admin/medicine/reports` shows commission + fees earned.

---

## 5. Admin dashboard wiring (separate app)

**Poll:**
```js
setInterval(async () => {
  const { data } = await api.get("/admin/orders")
  setOrders(data.orders)
}, 15000)
```
**Or live via socket:**
```js
import { io } from "socket.io-client"
const socket = io("https://abhigro-customer-backend-cjaqezaufxhmdtbd.southindia-01.azurewebsites.net")
socket.on("newOrder", (order) => setOrders(prev => [order, ...prev]))
```

---

## 6. Notes / limitations
- **Pharmacy login:** create a user with `role = 'pharmacy'`, then set `pharmacies.owner_user_id` to that user id (added column).
- **Distance/delivery fee:** `distanceKm` defaults to 0 (₹25) unless you pass it / wire lat-long distance; urgent supported via `urgent:true`.
- **Online prescription payment capture-after-approval / refunds:** statuses (`refunded`) and fields exist; hook your Razorpay capture/refund where noted in `createOrder` / `verifyPayment` if you want capture-after-approval.
- **Invoice/receipt** are returned as structured JSON (ready to render or convert to PDF). PDF generation can be added later without schema changes (`pharmacy_invoice_url` / `abhigro_service_receipt_url` columns are ready).
