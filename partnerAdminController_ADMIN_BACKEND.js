const pool = require('../config/db');

// insert a panel notification (shared DB; customer-backend socket/polling picks it up)
async function panelNotify(to, userId, type, title, message, data = {}) {
  try {
    await pool.query(
      `INSERT INTO panel_notifications (recipient_type, recipient_id, type, title, message, data)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [to, userId, type, title, message, JSON.stringify(data)]);
  } catch (e) { console.log('panelNotify:', e.message); }
}


// ───────── VENDORS (shops) ─────────
exports.getVendors = async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, shop_name, owner_name, owner_user_id, phone, email, address,
             pincode, city, state, vendor_type, categories,
             gst_number, fssai_number, open_time, close_time, service_pincodes,
             account_holder, account_number, ifsc,
             latitude, longitude, is_active, is_online, created_at
      FROM shops ORDER BY is_active ASC, id DESC`);
    res.json({ vendors: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
exports.approveVendor = async (req, res) => {
  try {
    const r = await pool.query(`UPDATE shops SET is_active=true, is_online=true WHERE id=$1 RETURNING id, shop_name, is_active`, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    try {
      const own = await pool.query('SELECT owner_user_id, shop_name FROM shops WHERE id=$1', [req.params.id]);
      if (own.rows[0]?.owner_user_id) await panelNotify('vendor', own.rows[0].owner_user_id, 'approved',
        'Your shop is approved 🎉', `${own.rows[0].shop_name || 'Your shop'} is now live on AbhiGro.`, { shop_id: Number(req.params.id) });
    } catch (e) {}
    res.json({ message: 'Vendor approved', vendor: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
exports.disableVendor = async (req, res) => {
  try {
    const r = await pool.query(`UPDATE shops SET is_active=false, is_online=false WHERE id=$1 RETURNING id, shop_name, is_active`, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ message: 'Vendor disabled', vendor: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ───────── DELIVERY PARTNERS ─────────
exports.getDeliveryPartners = async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, user_id, full_name, phone, email, address, pincode, city,
             vehicle_type, vehicle_number, emergency_contact,
             account_holder, account_number, ifsc, work_pincode,
             is_approved, created_at
      FROM delivery_partners ORDER BY is_approved ASC, id DESC`);
    res.json({ partners: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
exports.approveDeliveryPartner = async (req, res) => {
  try {
    const r = await pool.query(`UPDATE delivery_partners SET is_approved=true WHERE id=$1 RETURNING id, full_name, is_approved`, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Partner not found' });
    try {
      const u = await pool.query('SELECT user_id, full_name FROM delivery_partners WHERE id=$1', [req.params.id]);
      if (u.rows[0]?.user_id) await panelNotify('delivery', u.rows[0].user_id, 'approved',
        'You are approved 🎉', 'You can now go online and accept deliveries.', { partner_id: Number(req.params.id) });
    } catch (e) {}
    res.json({ message: 'Delivery partner approved', partner: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
exports.disableDeliveryPartner = async (req, res) => {
  try {
    const r = await pool.query(`UPDATE delivery_partners SET is_approved=false WHERE id=$1 RETURNING id, full_name, is_approved`, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Partner not found' });
    res.json({ message: 'Delivery partner disabled', partner: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ───────── RESTAURANTS (food) ─────────
exports.getRestaurants = async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, owner_id, restaurant_name, owner_name, phone, email, address,
             pincode, latitude, longitude, fssai_number, fssai_certificate,
             pan_number, gst_number, upi_id, bank_account_details,
             opening_time, closing_time, food_type, cuisine_type,
             commission_percent, is_online, is_approved, approval_status, rating, created_at
      FROM food_restaurants ORDER BY is_approved ASC, id DESC`);
    res.json({ restaurants: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
exports.approveRestaurant = async (req, res) => {
  try {
    const r = await pool.query(`UPDATE food_restaurants SET is_approved=true, approval_status='approved', updated_at=NOW() WHERE id=$1 RETURNING id, restaurant_name, approval_status`, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Restaurant not found' });
    try {
      const own = await pool.query('SELECT owner_id, restaurant_name FROM food_restaurants WHERE id=$1', [req.params.id]);
      if (own.rows[0]?.owner_id) await panelNotify('restaurant', own.rows[0].owner_id, 'approved',
        'Your restaurant is approved 🎉', `${own.rows[0].restaurant_name || 'Your restaurant'} can now go online and take orders.`, { restaurant_id: Number(req.params.id) });
    } catch (e) {}
    res.json({ message: 'Restaurant approved', restaurant: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
exports.rejectRestaurant = async (req, res) => {
  try {
    const r = await pool.query(`UPDATE food_restaurants SET is_approved=false, approval_status='rejected', is_online=false, updated_at=NOW() WHERE id=$1 RETURNING id, restaurant_name, approval_status`, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ message: 'Restaurant rejected', restaurant: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
exports.setRestaurantCommission = async (req, res) => {
  try {
    const { commission_percent } = req.body;
    const r = await pool.query(`UPDATE food_restaurants SET commission_percent=$1, updated_at=NOW() WHERE id=$2 RETURNING id, commission_percent`, [commission_percent, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ message: 'Commission updated', restaurant: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
