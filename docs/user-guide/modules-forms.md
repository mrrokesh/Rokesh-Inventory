# Custom modules, web forms and web tabs

## Custom modules: your own kind of record

Sometimes you need to keep track of something the app has no place for: **service requests**, **equipment on rent**, **warranty claims**, **site visits**, **samples sent**. A custom module gives it its own list, numbering, pages and fields, just like customers or items.

### Create a module

1. Go to **Settings → Custom modules → + New module**.
2. Enter the **name** (e.g. *Service requests*), what **one record** is called (*Service request*) and a **number prefix** (*SR*, so records are numbered SR-00001, SR-00002…).
3. Add the **fields**. Choose a type for each:
   - text, long text, whole number, number with decimals, date, yes/no, dropdown (type the choices, one per line), email, web address, phone
   - **link to a customer / vendor / item**: pick an existing record, and its name becomes a link.
   - Tick **Required** for fields that must be filled in, and **In list** for the columns shown on the list page.
   - The first field is the record's title.
4. Save. The module appears in the left menu under **More**.

### Use it

Open the module from the menu. Use **+ New** to add records, search and filter the list (dropdown fields become filters), export to Excel, and open a record to see its details and history. People need the **Custom modules** permission in their role (Settings → Roles). Existing roles already have view, add and edit. Managers can also delete and export.

Saved records keep their values even if you later change a field. Deleting a module deletes its records, and the app asks before doing that.

## Web forms: let people send you details online

A web form is a page **anyone can fill in without signing in**, on your website, from a WhatsApp or Instagram link, or embedded in a web page. Each submission creates:
- a **new customer**, for enquiries and leads, with their message saved in the customer's remarks, or
- a **record in one of your custom modules**, e.g. a new service request.

### Create a form

1. **Settings → Web forms → + New web form**.
2. Choose what each submission creates, tick the fields to ask for, rename them if you like, and choose which are required.
3. Optionally add a short text above the form, a thank-you message, and an email address to **notify you** of each submission (needs Settings → Email).
4. Save, then press **Share** to:
   - **copy the link**, which you can send it anywhere, or
   - **copy the embed code** and paste it into your website's HTML. The form then appears inside your page.

Turn a form off (untick *Form is live*) to stop new submissions. The link then shows "not available".

**Spam protection:** forms have a hidden box that only spam bots fill in (those submissions are quietly ignored), and one visitor can send at most 5 submissions in 10 minutes.

## Web tabs: other websites inside the app

Add websites your team uses every day to the left menu under **More**: a Google Sheet price list, a courier's tracking page, your bank, a supplier portal.

1. **Settings → Web tabs → + New web tab**.
2. Enter the name, the web address (must start with `https://`) and how it opens:
   - **Inside the app**: the page is shown within Rokesh Inventory.
   - **In a new browser tab**: for websites that refuse to be shown inside another app. Many banks and Google pages do this, and the tab then stays blank.

A tab shown inside the app always has an **Open in a new browser tab** button at the top, just in case.
