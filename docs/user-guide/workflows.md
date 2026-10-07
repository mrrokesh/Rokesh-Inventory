# Workflow rules: let the app do routine work

A **workflow rule** is an instruction you give the app once, in three parts:

> **When** something happens → **if** certain things are true → **then** do something.

For example:

- **When** an invoice is 3 days past its due date, **if** it's still unpaid, **then** email the customer a reminder.
- **When** a sales order is confirmed, **if** the total is ₹50,000 or more, **then** create a task for the manager to call the customer.
- **When** a new customer is added, **then** send a welcome email and create a follow-up task.
- **When** an item is edited, **if** its stock is below 5, **then** notify the purchase team.

Rules are under **Settings → Workflow rules**. You need permission to edit settings to create or change them.

## Create a rule

Click **+ New rule**, give it a name, and choose what it **applies to**: invoices, sales orders, estimates, delivery challans, credit notes, purchase orders, bills, vendor credits, items, customers or vendors.

### 1. When should it run?

Choose one:

- **When something happens to a record**. Tick one or more:
  - **Created**: a new record is saved.
  - **Edited**: an existing record is changed.
  - **Approved / sent**: for example, an invoice is opened, a sales order confirmed, or a purchase order issued.
  - **Voided**: the record is cancelled.
- **On a date**: a number of days **before** or **after** one of the record's dates (date, due date, expected delivery date…). Use 0 days for "on the date itself".
  - The app checks date rules every few minutes, and again right after you save a rule.
  - Each record is handled **at most once a day** per rule, so nobody gets duplicate reminders.

### 2. Only if… (optional)

Add conditions to limit which records the rule applies to, for example *Status is sent*, *Total is at least 50000* or *Contact name contains "Traders"*. Custom fields can be used too.

- With several conditions, choose whether **all** of them must be true or **any one** is enough.
- Text comparisons ignore upper/lower case.
- Leave this empty to run for every record.

### 3. Then do this

Add one or more actions:

| Action | What it does |
|---|---|
| **Send an email** | Emails the customer/vendor, the user who created the record and/or any addresses you type. It can include the document (items and totals) and a button that opens the record. Needs **Settings → Email** to be set up. |
| **Call a webhook** | Sends the record as JSON to a web address, for connecting to Zapier, Make, n8n, WhatsApp tools or your own system. An optional secret signs each request. |
| **Update a field** | Changes a field on the record, such as a custom field (*Priority = Urgent*) or the salesperson or notes. Changes made by a rule never start another rule, so rules can't loop. |
| **Create a task** | Adds a task linked to the record, with an assignee, priority and due date ("due in 2 days"). It appears in **Tasks**. |

### Placeholders: put record details into emails and tasks

In the email subject and message, the task title and field values, you can write placeholders in double curly brackets. The app replaces them with the record's details:

- `{{number}}`: the document number, e.g. INV-000123
- `{{contact_name}}`: the customer or vendor
- `{{total}}`, `{{balance}}`: amounts, shown as ₹ amounts
- `{{due_date}}`: dates, shown as dd/mm/yyyy
- `{{cf.your_field}}`: one of your custom fields
- `{{link}}`: a link to open the record, `{{org_name}}`: your organization name, `{{today}}`: today's date

Click **"Insert record details with placeholders"** under the actions to see every placeholder for that record type, and click one to copy it.

Example reminder:

> **Subject:** Reminder: invoice {{number}} is overdue
>
> Dear {{contact_name}}, this is a friendly reminder that invoice {{number}} for {{total}} was due on {{due_date}}. The balance is {{balance}}. Thank you!

## Turn rules on and off

Use **Turn off** to pause a rule without deleting it, and **Turn on** to resume. **Delete** removes the rule, but its past runs stay in the log.

## Logs: check what ran

The **Logs** tab lists every time a rule ran: when, which rule, which record, what triggered it, and the result of **each action** (✓ done or ✕ failed, with the reason).

- **Success**: every action worked.
- **Partly failed**: some actions worked and some didn't, e.g. the task was created but the email couldn't be sent because email isn't set up.
- **Failed**: no action worked.

If something failed, fix the cause (for example set up email or correct the webhook address). The rule works again the next time it's triggered.

## Good to know

- Rules run a few seconds **after** the change is saved, in the background, so saving is never slowed down.
- If a change is cancelled because of an error (for example not enough stock), its rules don't run.
- Rules don't run on deleted records.
- An email to "the customer" is only sent if the customer has an email address. Otherwise the log shows why it wasn't sent.
