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
