# Email, online payments, shipping and Shopify

All of these are optional. They're set up once by an administrator in **Settings**, using **your own accounts**. Passwords and keys are stored encrypted.

## Email (send documents from the app)

Once set up, every invoice, estimate, sales order, purchase order, credit note and challan gets an **Email** button, and invitations / password-reset links are emailed automatically.

1. Go to **Settings → Email**.
2. Pick your **email provider** (Gmail, Zoho Mail, Outlook) — the server details fill in for you — or choose *Other* and ask your provider for the SMTP details.
3. Enter your email address as the **Username** and your password.
   - **Gmail:** you must use an **App Password**, not your normal password: Google Account → Security → 2-Step Verification → App passwords.
4. Enter the **From name** (your company name) and **From email**.
5. Press **Save**, then **Send test** to check it arrives (look in spam too).

**Sending a document:** open it and press **Email**. The customer's email, a subject and a friendly message are filled in — edit if you like and press **Send**. The items, totals and tax are added below your message automatically, plus a *Pay online* or *View in portal* button when available. Every email is listed in **Settings → Email → Recently sent**.

## Razorpay (customers pay invoices online)

Customers pay by UPI, card or net banking. The payment is recorded and the invoice marked **Paid** automatically — no typing.

1. Go to **Settings → Integrations → Razorpay → Set up** and follow the three steps shown there.
2. On an unpaid invoice choose **More → Create online payment link**. The link is copied — send it to the customer. Emailed invoices and the customer portal include a **Pay online** button automatically.

> ⚠ For automatic "paid" updates, Razorpay must be able to reach your app over the internet. Your server's `APP_URL` must be the public address of the app (ask whoever hosts it).

## Shiprocket (book couriers)

1. Go to **Settings → Integrations → Shiprocket → Set up** and follow the steps (you create an *API user* in Shiprocket).
2. Pack a sales order as usual, open the package and press **Ship with Shiprocket**.
3. The app books the courier, gets the **AWB (tracking number)** and the **shipping label** (download it from the shipment page), and takes the stock out.
4. Delivery status updates automatically every 15 minutes — or press **Update Shiprocket tracking** on the Shipments page.

The customer's shipping address needs a **city, state, PIN code and 10-digit phone number**.

## Shopify (online store)

Items are matched by **SKU**, so use the same SKU in Shopify and here.

1. Go to **Settings → Integrations → Shopify → Set up** and follow the steps (you create a small private app in Shopify).
2. Choose what to do:
   - **Import new orders** – each Shopify order becomes a confirmed sales order (marked *Shopify*). New customers are created automatically.
   - **Update stock on Shopify** – your available stock is sent to Shopify, so you don't oversell.
   - **Automatically every 15 minutes** – or press **Import Shopify orders** on the Sales Orders page whenever you like.

## Connecting other software (API keys & webhooks)

For Tally, Zapier, Make, n8n or your own website, a developer can use **Settings → API keys & webhooks**:

- An **API key** lets another program read and create records here, with the permissions of the user it acts as.
- A **webhook** sends a message to another program the moment something happens (an invoice is sent, a payment arrives, stock is adjusted…).
