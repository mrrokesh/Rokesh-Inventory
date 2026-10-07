# Buying: from purchase order to bill

This is how you order stock from a supplier and pay for it.

```
Purchase order  →  Issue  →  Receive  →  Bill  →  Payment
  (your order)     (send)    (stock in)  (owe)    (paid)
```

## 1. Create a purchase order

1. Go to **Purchases → Purchase Orders → + New**.
2. Choose the **Vendor**.
3. Choose the warehouse the goods should be delivered to (only shown if you have more than one).
4. Add the items, quantities and the price you agreed with the vendor.
5. Optional: **Expected delivery date**, notes and terms.
6. Press **Save and Issue**. Use **Print / PDF** to send it to the vendor.

> **Tip:** When the *Low stock* widget on your Home page shows items running low, press **Reorder** – a draft purchase order is created with those items already filled in.

## 2. Receive the goods

When the delivery arrives:

1. Open the purchase order and press **Receive**.
2. Check the quantities that actually arrived. If only part came, enter that part – you can receive the rest later.
3. Press **Receive**.

**This is when stock goes up.** The purchase price becomes the cost of those units (used for FIFO).

## 3. Record the vendor's bill

1. On the purchase order, press **Convert to bill**.
2. Type the **Bill#** – the number printed on the vendor's invoice.
3. Check the **Due date**.
4. Press **Save as Open**.

You now owe the vendor that amount. It appears in **Money you owe** on your dashboard.

## 4. Pay the vendor

1. Open the bill and press **Record payment**.
2. Enter the amount, payment mode and reference (UTR / cheque number).
3. Press **Save**.

## Bill without a purchase order

For quick purchases (for example, buying from a shop), go to **Bills → + New**, add the items and press **Save as Open**. Stock goes up when the bill is opened.

For expenses that aren't stock (rent, internet, courier charges), add a line with just a **description** and choose an **Account** such as *Rent* or *Utilities*.

## Returning goods to a vendor

1. Open the bill and choose **More → Create vendor credit**.
2. Keep only the items you are returning and tick **Goods returned to vendor**.
3. Press **Save as Open** – the goods leave your stock.
4. Press **Apply to bills** to reduce what you owe on an unpaid bill.

## Landed costs: add freight and duty to what the goods cost

Goods often cost more than the supplier's price. You may also pay a transporter, a customs or clearing agent, insurance or loading charges. A **landed cost** adds those charges to the cost of the goods, so your **stock value** and **profit** are correct.

**Example:** you buy 20 chairs at ₹2,000 and 10 tables at ₹5,000 (₹90,000 of goods) and pay ₹4,500 for the truck. Split by value, the chairs carry ₹2,000 and the tables ₹2,500, so a chair now costs ₹2,100 and a table ₹5,250. When you sell a chair, your profit is worked out from ₹2,100.

### Add one

1. Record the charges as a normal **bill** from the transporter or agent (an account such as *Freight & Shipping*, with no item) and open it.
2. On that bill, choose **More → Use as landed cost**. Or go to **Purchases → Landed Costs → + New landed cost**. You can also start from a purchase receive with **Add landed cost**.
3. Under **Goods this cost belongs to**, search for the **purchase receive(s)** or **bill(s)** that brought the goods in. You can pick more than one.
4. Choose **how to split it**:
   - **By value**: costlier goods carry more. This is the usual choice.
   - **By quantity**: the same amount on every unit.
   - **By weight**: heavier goods carry more. Uses the weight set on each item.
   - **Enter amounts myself**: type the amount for each line. The total must match.
5. Check the preview. It shows each line's share and its **new unit cost**. Then press **Add landed cost**.

### Good to know

- You can't use more than the bill's total as landed cost, across all landed costs from that bill.
- If some of the goods were already sold before you added the cost, their share can't go into stock any more. It's shown as **Already used (cost of sales)** on the landed cost.
- To undo a landed cost, open it and press **Void**. This only works while that stock hasn't been used since. Otherwise make a value adjustment under **Inventory → Adjustments**.
- A purchase receive or bill with a landed cost on it can't be deleted or voided until the landed cost is voided.

## Statuses you'll see

| Status | Meaning |
|---|---|
| Draft | Not sent yet. |
| Issued | Sent to the vendor, waiting for goods. |
| Partially received | Some goods arrived. |
| Closed | Everything received and billed. |
| Cancelled | Order cancelled before anything arrived. |
| Open (bill) | You owe this amount. |
| Paid | Fully paid. |
