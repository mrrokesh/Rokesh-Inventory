# Managing stock

The app counts stock automatically as you buy and sell. These tools are for the times when you need to correct or move it yourself.

## Three numbers to know

| Number | What it is |
|---|---|
| **Stock on hand** | What's physically on your shelves. |
| **Committed** | Promised to customers on confirmed orders but not shipped yet. |
| **Available for sale** | On hand minus committed – what you can still sell. |

You'll find all three on every item page, broken down by warehouse.

## Correct the stock count (adjustment)

Use this after counting your shelves, or when something is lost, stolen, damaged or expired.

1. Go to **Inventory → Inventory Adjustments → + New** (or open an item and press **Adjust stock**).
2. Pick the **Reason** and the **Warehouse**.
3. Add the item. You'll see the current quantity.
4. Either type the **New quantity on hand** (what you counted) or the **Quantity adjusted** (e.g. `-2` for two broken units). The other box fills in by itself.
5. For stock being added, enter its cost price (or leave it to use the current average cost).
6. Press **Convert to Adjusted** to apply it now, or **Save as Draft** to apply later.

**Value adjustment** (the second mode) changes what your stock is *worth* without changing the quantity – for example when market prices fall.

## Move stock between warehouses (transfer order)

1. Go to **Inventory → Transfer Orders → + New**.
2. Choose the **Source** (where it is now) and **Destination** (where it's going).
3. Add the items and quantities.
4. Choose:
   - **Transfer and Mark as Received** – the stock moves instantly.
   - **Initiate Transfer (in transit)** – the stock leaves the source now; press **Mark as received** when it arrives.

You need at least two warehouses. Add more in **Settings → Warehouses**.

## Build kits (assemblies)

See [Kits: composite items](/help/items). Go to **Inventory → Assemblies → + New**, pick the kit and the quantity, and press **Assemble**.

## How FIFO costing works (simply)

Suppose you bought 5 laptops at ₹40,000 and later 4 more at ₹42,000. When you ship 6 laptops, the app assumes the 5 older ones left first, plus 1 newer one:

5 × ₹40,000 + 1 × ₹42,000 = **₹2,42,000 cost of goods sold**

The 3 laptops left are valued at ₹42,000 each. This is the standard *First In, First Out* method and gives you accurate profit figures in the reports. You don't need to do anything – it happens automatically.

## "Not enough stock" message

By default, the app won't let stock go below zero, so you can't ship or adjust out more than you have. Receive the goods first, or check the warehouse you picked. If your business really needs to sell before stock is recorded, an administrator can allow negative stock in **Settings → Organization profile → Inventory preferences**.

## Stock history

Open any item and choose the **Stock history** tab to see every movement in and out, with the date, the document that caused it, the warehouse and who did it.
