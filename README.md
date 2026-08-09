# Dreams Care Homes — Staff Compliance Portal

## What changed in this update

- **Real Firestore backend.** Everything (staff records, documents, training, audit log) now lives in Cloud Firestore + Firebase Storage instead of `localStorage`, and updates **live** across every open tab/browser via `onSnapshot`.
- **Fixed a bug that broke half the app.** `js/app.js` was calling `document.getElementById("save-next-btn")` on an element that didn't exist in `index.html`, which threw immediately and silently stopped *every* function defined after it (document uploads, training records, audit log, reports). That's fixed — the button now has the right id.
- **New sidebar section: Reports** — already existed in the markup but was one of the functions killed by the bug above; it now runs off live Firestore data and auto-refreshes if the underlying data changes while a report is open.
- **New sidebar section: Staff documents** — a single live table aggregating every document uploaded across all staff records (searchable by staff name, doc type or file name), with direct download links and a remove action.
- **New sidebar section: Contact staff** — a live directory of every staff member with one-tap **Call**, **Email**, and **WhatsApp** buttons built from each profile's phone/email fields.

## Before you deploy

1. **Enable Anonymous auth.** Firebase Console → Build → Authentication → Sign-in method → enable **Anonymous**. The "admin / admin" screen is a demo-only UI gate, not real Firebase Auth — the app signs every visitor in anonymously behind the scenes so Firestore/Storage rules have something to check. For a real production rollout, replace this with real accounts and update `firestore.rules` / `storage.rules` to check roles again.
2. **Deploy the updated rules:**
   ```
   firebase deploy --only firestore:rules,storage
   ```
3. **Create the Storage bucket** if you haven't already (Console → Build → Storage → Get started) — uploaded documents go to `documents/{employeeId}/{fileName}`.
4. Serve `index.html` over `http://` or `https://` (not `file://`) — ES module imports and Firebase both require it. `firebase serve` or `firebase deploy --only hosting` both work; `Link to a Firebase Hosting site` in your Firebase console SDK setup page does this for you.

Demo access: username `admin`, password `admin`.
