# Serial numbers and batches

Some products need to be tracked **one unit at a time** or **by batch**. The app can do both.

| Use | When | Examples |
|---|---|---|
| **Serial numbers** | Every unit has its own unique number, and you need to know exactly which unit went to which customer (warranty, repairs, theft). | Laptops, printers, phones, routers, UPS units |
| **Batches** | Units are made in lots, often with a manufacturing and **expiry date**. | Toner, ink, chemicals, medicines, food |
| **None** | You only need the count. | Cables, mice, stationery |

## Turn it on for an item

1. Open the item and press **Edit** (or create a new item).
2. Under **Inventory**, set **Serial / batch tracking** to **Serial numbers** or **Batches (with expiry date)**.
3. Save.

> ⚠ Choose this **before** the item has stock. It can't be changed once the item has transactions.

## When stock comes IN, you type the numbers

Wherever stock is added, a link appears under the item: **Add serial numbers** or **Add batch details** (marked *required*).

- **Opening stock** (on the item form)
- **Receive** on a purchase order
- **Bill** without a purchase order
- **Adjustment** that adds stock

**Serial numbers:** type or scan one per line. You need exactly as many as the quantity. A barcode scanner works well — scan each label and it moves to the next line.

**Batches:** type the batch number, manufacturing date and expiry date, and how many are in that batch. You can split one line into several batches.

## When stock goes OUT, the app can pick for you

When you pack, invoice directly, transfer, adjust down or use a delivery challan, you'll see **Choose serial numbers** / **Choose batches** (optional).

- **Leave it empty** and the app picks automatically: the **oldest serial numbers first**, and the batches that **expire soonest first** (so old stock doesn't go bad on the shelf).
- **Or choose exactly** which units go out — tick the serial numbers, or type how many to take from each batch.

For sales orders, choose the units on the **Create package** screen. They leave stock when you ship the package.

## Returns

When a customer returns a serial-numbered item, the app automatically brings back a unit that was shipped on that order. Its history shows it went out and came back.

## Find a serial number

- Type the serial number in the **search bar** at the top of any screen.
- Or open the item → **Serial numbers** tab. Press **History** next to a serial to see every time it came in or went out, with links to the documents.
- Switch the filter to **Sold / out of stock** to find a unit you have already sold (useful for warranty claims).

For batch items, the **Batches** tab shows each batch, its warehouse, quantity and expiry date. Expired batches are marked ⚠.
