# Dreams Care Homes — Staff Compliance Portal

A staff records & Home Office sponsor-licence compliance portal: employee profiles, Right to Work
records, CoS/visa tracking, document storage with expiry alerts, training records, role-based
access, and an audit trail. Plain HTML/JS + Firebase — no build step required.

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**.
2. In the project, enable:
   - **Authentication** → Sign-in method → **Email/Password**.
   - **Firestore Database** → Create database (production mode).
   - **Storage** → Get started (default bucket).
3. Project settings → **Your apps** → Add app → Web (`</>`). Copy the config object it shows you.

## 2. Demo mode

The current app opens directly with the local demo credentials below:

- Username: `admin`
- Password: `admin`

Demo records are stored in this browser's local storage. This mode is intended for local preview
only and does not provide Firebase authentication or cloud data storage.

## 3. Connect the app to Firebase (optional)

Open `js/firebase-config.js` and paste in your values:

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

## 4. Deploy the security rules

Install the Firebase CLI once, then deploy from this folder:

```bash
npm install -g firebase-tools
firebase login
firebase init      # choose Firestore, Storage, Hosting; point Hosting at this folder ( . )
firebase deploy --only firestore:rules,storage:rules
```

`firestore.rules` and `storage.rules` are already written for you — `firebase init` will ask to
overwrite its defaults; say yes.

## 5. Create staff-user accounts and roles

The portal doesn't have a public sign-up form (deliberately — this is sensitive HR/immigration
data). To add a user:

1. Firebase Console → Authentication → Add user (email + password).
2. Firestore → `users` collection → new document, **document ID = that user's UID** → add a field
   `role` set to `admin`, `hr`, `manager`, or leave the user out entirely to block access.

Roles: `admin` (full access incl. delete), `hr` (create/edit records and documents), `manager`
(read-only across dashboard/reports).

## 6. Run it locally

No build tools needed — any static file server works:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed local URL. Firebase Auth requires `http://localhost` or a deployed domain
(not `file://`).

## 6. Deploy to Firebase Hosting (optional, free tier available)

```bash
firebase deploy --only hosting
```

You'll get a live `https://your-project.web.app` URL.

## 7. Push to GitHub

```bash
cd dreams-care-crm
git init
git add .
git commit -m "Initial staff compliance portal"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

**Before your first push**, make sure `js/firebase-config.js` doesn't contain real secrets you
mind being public if the repo is public — Firebase web config is not a secret (access is enforced
by the security rules, not by hiding this file), but if you'd rather keep it out of git history,
add it to `.gitignore` and load it another way (e.g. injected at hosting-deploy time).

## What's implemented vs. what to extend next

**Implemented:** employee profiles (all fields from your brief), Right to Work records, sponsor
licence / CoS tracking, DBS & references, document upload with expiry tracking, training records,
90-day expiry dashboard, five compliance reports with CSV export, audit log, role-based Firestore
rules.

**Worth adding next, once the core is live:**
- Automated email/SMS reminders — needs a Cloud Function on a daily schedule (Trigger Email
  extension or SendGrid) reading the same expiry logic in `app.js`.
- Attendance/absence tracking as its own module (currently a free-text notes field).
- Per-document view logging for a fully granular audit trail (currently logs at the action level).
- Stricter Storage rules that check the caller's Firestore role (needs the Blaze pay-as-you-go
  plan for a Firestore read inside Storage rules).
