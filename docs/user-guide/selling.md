# Selling: from order to payment

This is the full journey of a sale. Each step has its own button, so you always know what comes next.

```
Sales order  →  Confirm  →  Package  →  Shipment  →  Invoice  →  Payment
 (the deal)    (reserve)    (pack)      (stock out)  (ask to pay)  (paid)
```

## 1. Create a sales order

1. Go to **Sales → Sales Orders → + New** (or press the blue **+** and choose *Sales Order*).
2. In **Customer name**, start typing and pick the customer.
3. In the **Item table**, click *Type or click to select an item* and choose the item. The price fills in by itself. Under it you'll see how many are **available for sale**.
4. Change the **Quantity**. Add more rows with **+ Add new row**.
5. Optional: discount, tax, shipping charges, notes for the customer, terms & conditions.
6. Press **Save and Confirm** (or **Save as Draft** if you're not sure yet).

Confirming *reserves* the stock for this customer (it becomes **committed**), so you don't accidentally promise it to someone else.

## 2. Pack the items

1. Open the confirmed sales order.
2. Press **Create package**.
3. Check the quantities (you can pack part of the order now and the rest later), then press **Create package**.

## 3. Ship the package

1. On the package page, press **Ship package**.
2. Enter the carrier (e.g. Delhivery, Blue Dart) and the **tracking number** if you have one.
3. Press **Ship**.

**This is when the stock leaves your warehouse.** The app also works out the cost of the goods using FIFO.

When the customer receives it, open the shipment and press **Mark delivered** – or use the **Delivered** button on the *On the way* widget on your Home page.

## 4. Invoice the customer

1. Open the sales order and press **Create invoice**. Everything not yet invoiced is filled in for you.
2. Check the **Due date** (it comes from the customer's payment terms).
3. Press **Save and Mark as Sent**.

> **Tip:** Press **Print / PDF** on the invoice to print it or save a PDF you can email or WhatsApp to the customer.

## 5. Record the payment

1. On the invoice, press **Record payment**.
2. Enter the **Amount received**, the **Payment mode** (cash, UPI, bank transfer, cheque…) and a **Reference#** such as the UTR or cheque number.
3. Press **Save**.

The invoice becomes **Paid** (or **Partially paid** if they paid only part).

## Partial orders

You can pack, ship and invoice in several parts. The sales order shows badges like *Partially shipped* and *Partially invoiced* until everything is done; then it becomes **Closed** automatically.

## Quick sale without a sales order

For walk-in or counter sales, skip the sales order: go to **Invoices → + New**, add the items and press **Save and Mark as Sent**. The stock leaves your warehouse when the invoice is marked as sent.

## Statuses you'll see

| Status | Meaning |
|---|---|
| Draft | Saved but not active. No effect on stock. |
| Confirmed | Accepted. Stock is reserved. |
| Closed | Fully shipped and invoiced. Nothing left to do. |
| Void | Cancelled. Reserved stock is released. |
| Sent (invoice) | Waiting for payment. |
| Overdue | The due date has passed and it's still unpaid. |
| Paid | Fully paid. |

## Made a mistake?

- **Draft:** just press **Edit**.
- **Confirmed sales order with nothing packed or invoiced:** press **More → Void**, then create a new one (use **More → Clone** to copy it).
- **Shipped by mistake:** open the shipment and press **Delete** – the stock comes back.
- **Wrong invoice:** remove any payments first, then **More → Void** and create a new one.
