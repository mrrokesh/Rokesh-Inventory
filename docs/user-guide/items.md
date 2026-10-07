# Items: products and services

An **item** is anything you buy or sell. Before you can create an order, the item must exist.

## Add an item

1. Go to **Items → Items** and press **+ New**.
2. Choose the **Type**:
   - **Goods** – a physical thing you can count (laptops, cables, printers).
   - **Service** – work or something you don't count (installation, AMC, consulting, software subscription).
3. Type the **Name** (required) – for example *Dell Latitude 5440 i5 16GB*.
4. Type an **SKU** – a short unique code you choose, like `DELL-5440`. It helps with searching. Optional, but recommended.
5. Pick the **Unit** – how you count it: *pcs*, *box*, *licence*, *hrs*…
6. Under **Sales information**, type the **Selling price** and choose a sales tax if you charge one.
7. Under **Purchase information**, type the **Cost price** (what you pay) and, optionally, the **Preferred vendor**.
8. Under **Inventory**:
   - Keep **Track inventory** ticked for goods you want to count.
   - Set a **Reorder point** to get a *Low stock* warning when you're running out.
   - If you already have stock, type it under **Opening stock** for each warehouse.
9. Press **Save**.

> ⚠ **Track inventory can't be changed later** once the item has been used in an order or has stock. Decide carefully.

### Which type should I choose?

| Example | Type | Track inventory? |
|---|---|---|
| Laptop, printer, cable | Goods | Yes |
| Software licence key you resell | Goods | Yes, if you keep a count of keys; otherwise No |
| Installation, repair, AMC visit | Service | (not available) |
| Monthly cloud subscription | Service | (not available) |

## Opening stock later

Forgot the opening stock? Open the item, press **More → Add opening stock**. This only works before the item has any other stock movement; after that, use an [adjustment](/help/stock).

## Variants: item groups

If one product comes in several versions (size, colour, RAM…), create an **item group** instead of typing each version by hand.

1. Go to **Items → Item Groups → + New**.
2. Type the group name, for example *Laptop Bag*.
3. Under **Attributes**, add up to three, like *Colour: Black, Grey* and *Size: 14", 15.6"*. Separate options with commas.
4. The app lists every combination with an SKU already filled in. Untick any you don't sell, adjust prices if needed.
5. Press **Save**. Each combination becomes its own item, so its stock is counted separately.

## Kits: composite items

A **composite item** is made from other items – for example *Office Starter Kit* = 1 laptop + 1 mouse + 1 bag.

1. Go to **Items → Composite Items → + New**.
2. Fill in the name and price, then add each **component** and how many of it go into one kit.
3. Press **Save**.

A kit starts with zero stock. To build kits from parts, go to **Inventory → Assemblies → + New**, pick the kit, enter how many to build and press **Assemble**. The parts leave stock and the kits arrive. Choose **Disassemble** to break kits back into parts.

## Price lists

Use a price list to give some customers (or vendors) different prices.

1. Go to **Items → Price Lists → + New**.
2. Choose **Mark up / mark down by a percentage** (e.g. 10% off for all items) or **Enter rates individually** for specific items.
3. Save, then open a customer, press **Edit → Other Details → Price list**, and select it.

New orders for that customer use the special prices automatically.

## Import many items at once

1. Go to **Items** and press **Import**.
2. Press **Download CSV template** and open it in Excel or Google Sheets.
3. Fill one row per item (keep the first row – the column names – unchanged), then save as **CSV**.
4. Upload the file, check the preview and press **Import**.

Rows with problems are skipped and listed with the reason, so you can fix them and import just those rows again.

## Scan barcodes into orders and invoices

Put the item's barcode (UPC/EAN/ISBN) in the **Barcode** box on the item. Then, on any sales order, invoice, purchase order, bill or other document, click the **Scan barcode** box above the item table and scan:

- A USB or Bluetooth barcode scanner works like a keyboard. It types the code and presses Enter for you.
- No scanner? Type the barcode or the SKU and press **Enter**.

The item is added with its price and tax. Scanning the same item again adds 1 to its quantity. If nothing matches, a message says so and nothing is added.

## Change or retire an item

- **Edit:** open the item and press **Edit**.
- **Stop selling it:** open it and choose **More → Mark as inactive**. It disappears from new orders but its history stays.
- **Delete:** only possible if the item has never been used in a transaction.
