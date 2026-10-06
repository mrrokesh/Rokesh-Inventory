# Settings, users and permissions

Settings are reached from the **gear icon** (top right) or **Settings** at the bottom of the left menu. Only administrators can change most settings.

## Organization profile

Your company name, address, logo, GST registration, PAN, currency, fiscal year and time zone. These appear on printed documents.

- **Fiscal year starts** – in India this is usually **April**.
- **GST registered** – tick this and enter your GSTIN if you're registered.
- **Allow stock to go below zero** – leave this **off** unless you really need to sell before recording stock.

## Taxes

Add every tax rate you charge, e.g. GST5, GST12, GST18, GST28. Then pick the right tax on each item; orders and invoices calculate tax automatically.

## Warehouses

Add each place you keep stock. One is the **Primary** warehouse – new orders use it by default. You can't delete a warehouse that has transactions; mark it **Inactive** instead.

## Units, number series and shipping carriers

- **Units** – the list of units (pcs, box, kg…) offered on items.
- **Number series** – the prefix and next number for each document, e.g. `INV-000001`. Change this if you're moving from another system and want to continue your numbering.
- **Shipping carriers** – the couriers you use. Add a tracking URL containing `{tracking}` (for example `https://www.delhivery.com/track/package/{tracking}`) and tracking numbers become clickable links.

## Invite your team

1. Go to **Settings → Users** and press **+ Invite user**.
2. Enter their name, email and **Role**.
3. Press **Invite**. An invitation link is copied to your clipboard.
4. Send the link to them (email, WhatsApp…). They open it, choose a password and they're in.

If the link is lost, press **New link**.

### Someone forgot their password

Go to **Settings → Users**, press **Password reset link** next to their name, and send them the copied link. They open it and choose a new password.

## Roles: who can do what

Each user has one role. The standard roles are:

| Role | Can |
|---|---|
| **Admin** | Everything, including settings and users. |
| **Manager** | All sales, purchasing, stock and reports. No user management. |
| **Sales User** | Customers, sales orders, packages, invoices, payments received, returns. |
| **Purchase User** | Vendors, purchase orders, receives, bills, payments made, vendor credits. |
| **Warehouse User** | Stock adjustments, transfers, packing, shipping and receiving. |
| **Accountant** | Invoices, bills, payments, credits and all reports. |

To change what a role can do, go to **Settings → Roles & permissions**, press **Edit permissions** and tick the boxes (view, create, edit, delete, approve, export, import) for each area. You can also create new roles.

> **Tip:** Give people the smallest role they need. Someone who only packs boxes doesn't need to see your profit report.

## Your own profile

Click your initials (top right) → **My profile** to change your name or password, and choose Light / Dark appearance.
