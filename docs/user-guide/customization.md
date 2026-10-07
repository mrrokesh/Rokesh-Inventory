# Custom fields, PDF templates and branding

Make the app and your documents fit your business: add your own fields, choose how invoices and orders look, and put your brand colour and signature on them.

All three are under **Settings**. Only people whose role can edit settings can change them.

## Custom fields — add your own boxes to a form

Use a custom field when you need to record something the app doesn't ask for. For example:

| Record | Example field | Type |
|---|---|---|
| Items | Warranty (months) | Number |
| Customers | Customer since | Date |
| Delivery challans / invoices | Vehicle number | Text (with a format rule) |
| Invoices | E-way bill | Dropdown: Required / Not required |
| Purchase orders | Project code | Text |

### Add a field

1. Go to **Settings → Custom fields**.
2. Under **Fields for**, choose the record type (Items, Customers, Invoices…).
3. Click **+ New custom field** and fill in:
   - **Label**: the name people see, e.g. *Warranty (months)*.
   - **Data type**: text, number, date, checkbox, dropdown, email, website or phone. For a dropdown, type one choice per line.
   - **Default value** *(optional)*: filled in automatically on new records.
   - **Help text** *(optional)*: a short tip shown under the box.
   - **Mandatory**: tick this if a record must not be saved without it.
   - **Show on printed / emailed PDF**: tick this if customers or vendors should see it.
4. Click **Save**.

The new box now appears:
- on the **form**: on items, under the Inventory section; on customers and vendors, on the *Other details* tab; on transactions, below the header fields
- on the record's **page**
- on the **PDF**, if you ticked that option

The app checks what people type. A number field won't accept letters, a date must be a real date, and a dropdown only takes one of its choices.

### Format rules (optional, advanced)

Text and phone fields can have a **format rule** so people can't type values in the wrong shape. For example, the rule `[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}` only accepts vehicle numbers like *TN01AB1234*. Also add a **message** that tells people the right format.

### Hide or delete a field

- **Hide** (mark inactive): the field disappears from forms and PDFs, but values already entered are kept. Click **Show** to bring it back.
- **Delete**: removes the field. Values already saved on records are kept in the database, but nobody sees them any more. If you might need the field again, hide it instead.

### Importing

When you import items or contacts from a spreadsheet, add a column named `cf_` followed by the field's key, for example `cf_warranty_months`. The key is the label in lowercase with underscores.

## PDF templates — how your documents look

**Settings → PDF templates** controls how each document type looks when you print it, save it as PDF or email it. Pick the document type on the left (Invoices, Sales orders, Purchase orders…), change the options, and watch the **live preview** below. The preview uses made-up sample data, and nothing in it is saved.

| Option | What it does |
|---|---|
| **Layout** | *Standard*, *Compact* (tighter rows, so more lines fit on a page) or *Modern* (coloured band and table header). |
| **Font size** | Small, normal or large. |
| **Accent colour** | Colour of the title, table header and total. Leave it empty to use your brand colour. |
| **Document title** | e.g. change *Tax Invoice* to *GST Invoice* or *Proforma Invoice*. |
| **Show on the document** | Turn the logo, address, SKU, HSN/SAC column, unit, discount column, tax column, custom fields and signature block on or off. |
| **Header note** | A line under the title, e.g. *Subject to Chennai jurisdiction*. |
| **Footer note** | Small text at the bottom, e.g. *This is a computer-generated invoice*. |
| **Bank details** | Account name, number, IFSC and UPI ID, so customers know where to pay. |
| **Default notes / terms** | Filled in automatically on every **new** document of this type. You can still change them on each document. |

Click **Save template**. The change applies to all documents of that type, including old ones. **Reset to default** puts every option back to the default; click **Save template** afterwards to keep that.

## Branding — colour and signature

**Settings → Branding**:

- **Brand colour**: pick a colour and click **Save colour**. Buttons, links and highlights across the app change to it, and so does the accent colour on your PDFs (unless a template sets its own). **Reset to default** brings back the standard blue.
- **Digital signature**: upload a picture of the authorised signature, ideally a PNG with a transparent or white background. It's printed above *Authorised Signatory* on your documents. You can rename that label in each PDF template, or turn the signature block off there.

Your **logo** is set under **Settings → Organization profile**.
