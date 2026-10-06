# GST: invoices and returns

This guide is for GST-registered businesses in India. If you're not registered, you can skip it.

## One-time setup

1. **Settings → Organization profile**: tick **GST registered**, enter your **GSTIN**, and make sure **State** is correct. The state decides whether tax is CGST + SGST or IGST.
2. **Settings → Taxes**: add your rates, for example **GST5** (5%), **GST12** (12%), **GST18** (18%), **GST28** (28%). One rate per percentage is enough — the app splits it automatically.
3. **Items**: enter each item's **HSN code** (goods) or **SAC code** (services) and choose its default sales and purchase tax.
4. **Customers / vendors**: set the **GST treatment**, **GSTIN** (for registered businesses) and **Place of supply** (their state).

## How the tax is split (automatically)

Every document has a **Place of supply** — the state the goods or services go to. It comes from the customer, and you can change it on the document.

| Place of supply | Tax shown | Example (18%) |
|---|---|---|
| **Same state** as your business | CGST + SGST, half each | CGST 9% + SGST 9% |
| **Different state** | IGST, full rate | IGST 18% |

Printed and emailed invoices show the split, the HSN/SAC code of each item, and the customer's GSTIN.

## GST reports for filing

Go to **Reports → GST**, choose the month (Custom period), and **Export Excel** to give to your accountant. Save as CSV from Excel if you need the GST offline tool.

| Report | GSTR section | What it contains |
|---|---|---|
| **GSTR-1: B2B invoices** | Table 4 | Invoices to registered customers (with GSTIN), per tax rate |
| **GSTR-1: B2C large** | Table 5 | Inter-state invoices above ₹1,00,000 to unregistered customers |
| **GSTR-1: B2C small** | Table 7 | All other sales to unregistered customers, by state and rate |
| **GSTR-1: Credit notes (registered)** | Table 9B | Credit notes to registered customers |
| **GSTR-1: HSN summary** | Table 12 | Sales grouped by HSN/SAC code |
| **GSTR-3B summary** | 3.1, 3.2, 4 | Output tax, inter-state supplies to unregistered persons, input tax credit from bills, and net tax payable |

> ⚠ These reports prepare the numbers from what you recorded. Check them with your accountant before filing — the app does not file returns on the GST portal for you, and rules such as the B2C-large limit can change.

## Tips

- Record vendor **bills** with the vendor's GSTIN and the right tax, so your input tax credit in GSTR-3B is complete.
- If an item shows **(missing)** in the HSN summary, add its HSN/SAC code on the item.
- Not GST-registered? Leave *GST registered* unticked; you can still use simple tax rates or no tax at all.
