import { useState } from "react"
import { useNavigate } from "react-router-dom"
import api from "../../api/axios"
import Navbar from "../../components/Navbar"
import toast from "react-hot-toast"

export default function RestaurantRegister() {
  const nav = useNavigate()
  const [f, setF] = useState({ restaurant_name:"", owner_name:"", phone:"", email:"", address:"", pincode:"",
    fssai_number:"", fssai_certificate:"", food_type:"Both", cuisine_type:"", opening_time:"", closing_time:"", upi_id:"" })
  const [busy, setBusy] = useState(false)
  const set = k => e => setF({ ...f, [k]: e.target.value })

  const submit = async () => {
    if (!f.restaurant_name) return toast.error("Restaurant name required")
    if (!f.fssai_number) return toast.error("FSSAI number is mandatory")
    if (!f.fssai_certificate) return toast.error("FSSAI certificate URL is mandatory")
    setBusy(true)
    try { await api.post("/restaurant/register", f); toast.success("Registered! Now log in using the Restaurant tab."); nav("/login") }
    catch (e) { toast.error(e.response?.data?.message || "Failed") } finally { setBusy(false) }
  }
  const F = ({ label, k, type="text", ph }) => (
    <div><label className="text-xs font-medium text-gray-600">{label}</label>
      <input type={type} value={f[k]} onChange={set(k)} placeholder={ph}
        className="w-full mt-1 border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-green-500" /></div>
  )
  return (
    <div className="min-h-screen bg-gray-50"><Navbar />
      <div className="max-w-xl mx-auto px-4 py-6 pb-28">
        <h1 className="text-2xl font-bold text-gray-800 mb-1">Register Your Restaurant 🍽️</h1>
        <p className="text-sm text-gray-500 mb-5">List your restaurant on AbhiGro. Admin will verify and approve.</p>
        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
          <F label="Restaurant name *" k="restaurant_name" />
          <F label="Owner name" k="owner_name" />
          <F label="Phone" k="phone" />
          <F label="Email" k="email" />
          <F label="Full address" k="address" />
          <F label="Pincode" k="pincode" />
          <div className="grid grid-cols-2 gap-3">
            <F label="Opening time" k="opening_time" ph="9:00 AM" />
            <F label="Closing time" k="closing_time" ph="11:00 PM" />
          </div>
          <div><label className="text-xs font-medium text-gray-600">Food type</label>
            <select value={f.food_type} onChange={set("food_type")} className="w-full mt-1 border border-gray-200 rounded-xl p-3 text-sm">
              <option>Both</option><option>Veg</option><option>Non-Veg</option></select></div>
          <F label="Cuisine type" k="cuisine_type" ph="South Indian, Chinese..." />
          <div className="border-t pt-3 mt-1">
            <p className="text-sm font-semibold text-gray-700 mb-2">FSSAI (mandatory)</p>
            <F label="FSSAI number *" k="fssai_number" />
            <F label="FSSAI certificate (image URL) *" k="fssai_certificate" ph="Upload & paste URL" />
          </div>
          <F label="UPI ID (for payouts)" k="upi_id" />
        </div>
        <button onClick={submit} disabled={busy} className="w-full mt-4 bg-green-700 hover:bg-green-800 text-white font-semibold py-3 rounded-xl disabled:bg-green-400">
          {busy ? "Submitting..." : "Submit for Approval"}</button>
      </div>
    </div>
  )
}
