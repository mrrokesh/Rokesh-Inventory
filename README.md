# Rokesh Inventory

Full inventory management for goods, services and composite items: purchasing, sales, multi-warehouse stock with FIFO costing, payments, credits, reports, documents and role-based users.

- `backend/` – Node.js + TypeScript + Express + PostgreSQL API
- `frontend/` – React + TypeScript + Vite single-page app (routes load on demand)

## 1. Database
Create an empty PostgreSQL database (PostgreSQL 13+):

```
createdb -U postgres inventory
```

## 2. Backend
```
cd backend
copy .env.example .env      # then edit DATABASE_URL and JWT_SECRET
npm install
npm run dev                 # http://localhost:4000 — migrations run automatically
```

## 3. Frontend
```
cd frontend
npm install
npm run dev                 # http://localhost:5173 (proxies /api to the backend)
```

Open http://localhost:5173 and choose **Create an organization**. There is no sample data: signup creates your
organization, your admin login, a primary warehouse, default roles (Admin, Manager, Sales User, Purchase User,
Warehouse User, Accountant), units and document numbering (SO-00001, PO-00001, INV-000001 …).

### Production (Vercel + Render)

Frontend goes to [Vercel](https://vercel.com), API to [Render](https://render.com). Use the same PostgreSQL `DATABASE_URL` as local (do not create a new hosted database unless you want one).

**1. Render (API)** — New Web Service from `mrrokesh/Rokesh-Inventory`, or Blueprint `render.yaml`.

- Root directory: `backend`
- Build: `npm ci`
- Start: `npx tsx src/server.ts`
- Environment:
  - `DATABASE_URL` — the Postgres URL already used in this project
  - `JWT_SECRET` — long random string (same idea as `backend/.env`)
  - `APP_SECRET` — optional; defaults to `JWT_SECRET` if empty
  - `CORS_ORIGIN` — your Vercel URL, e.g. `https://rokesh-inventory.vercel.app`
  - `APP_URL` — same Vercel URL (emails, portal, payment links)
  - `NODE_ENV=production`
  - Render sets `PORT` for you

After the first deploy, copy the Render URL (`https://….onrender.com`). Disk uploads on Render’s free instance are wiped on restart.

**2. Vercel (UI)** — Import the same GitHub repo.

- Root Directory: `frontend`
- Framework: Vite
- Environment: `VITE_API_URL` = the Render URL with **no** trailing slash
- Redeploy after setting it (Vite bakes this in at build time)

Local `npm run dev` is unchanged: leave `VITE_API_URL` empty so Vite still proxies `/api` to `http://localhost:4000`.

## User guide
Plain-language guides for non-technical users are in [docs/user-guide](docs/user-guide/README.md).
The same guides are built into the app under **Help & Guides**, and the **?** button on every screen opens the guide for that screen.

## Recommended setup order
1. Settings → Organization profile (address, logo, GST/PAN, fiscal year), Taxes, Warehouses, Shipping carriers
2. Items (or Import → CSV template) with opening stock; Item groups for variants; Composite items for kits
3. Customers and Vendors (CSV import available)
4. Purchase: Purchase order → Issue → Receive → Convert to bill → Record payment
5. Sales: Sales order → Confirm → Create package → Ship → Create invoice → Record payment
6. Returns: Sales order → Create sales return → Receive → Create credit note → Apply/refund
7. Settings → Users: invite staff and assign roles (copy the invite link and send it to them)

## Stock rules
- FIFO cost lots per warehouse; stock cannot go negative unless enabled in Organization profile.
- Confirmed sales order → stock committed. Shipment → stock out. Direct invoice (no sales order) → stock out when marked sent.
- Purchase receive → stock in. Direct bill (no purchase order) → stock in when opened.
- Sales return receive → stock in (unless "back to stock" is unticked). Vendor credit with "goods returned" → stock out.
- Transfer orders move stock (and its cost) between warehouses; assemblies build/break composite items.
- Only drafts can be edited; posted documents are voided/deleted, which reverses their stock effects.

## Also included
- Estimates (quotes) → sales orders; delivery challans (on approval / job work) → invoices
- Serial-number and batch/expiry tracking (FIFO serials, first-expiry-first-out batches, full unit history)
- Customer portal at `/portal/<org-slug>` (invoices, orders, quotes, shipments, statement, comments, pay online)
- Email through your own SMTP account (Settings → Email)
- GST: CGST/SGST vs IGST by place of supply, HSN on documents, GSTR-1 (B2B, B2CL, B2CS, CDNR, HSN) and GSTR-3B reports
- Integrations (Settings → Integrations): Razorpay payment links with automatic payment recording, Shiprocket booking +
  tracking, Shopify order import + stock sync; API keys and signed outbound webhooks for anything else

For email links, the customer portal and payment webhooks, set `APP_URL` in `backend/.env` to the public address of the app.
Razorpay, Shiprocket and Shopify connect with your own accounts; they were built against the providers' documented APIs
and should be tested with your test/sandbox credentials before going live.

Licensed under the [Apache License 2.0](LICENSE).
