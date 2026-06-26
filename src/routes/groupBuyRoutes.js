const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const gb = require("../controllers/groupBuy/groupBuyController")

router.get("/", gb.listGroupOrders)              // public — browse groups by pincode
router.get("/:id", gb.getGroupOrder)             // public — view group details
router.post("/", auth, gb.createGroupOrder)      // start a group
router.post("/:id/join", auth, gb.joinGroupOrder) // join with items

module.exports = router
